// Tests for scripts/lib/watchDataBuild.mjs (the watch-area snapshot builder behind refresh:data and
// /api/watch), against synthetic FIRMS, USGS and BMKG answers. They live under src/ because vitest
// collects src/**/*.test.ts.
import { describe, expect, it } from 'vitest';
import { buildWatchData } from '../../scripts/lib/watchDataBuild.mjs';

const NOW = Date.parse('2026-10-29T08:00:00Z');
const BOX = { id: 'watch-test-box', lat: -2.5, lon: 114, area: { kind: 'bbox', minLat: -3.5, maxLat: -1.5, minLon: 113, maxLon: 115 } };
/** A summit inside the box: its hotspots are kept whatever the haze cap does. */
const SUMMIT = { id: 'watch-test-summit', lat: -2, lon: 114, area: { kind: 'summit' } };

const VIIRS_HEAD = 'latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,version,frp,daynight';
const MODIS_HEAD = 'latitude,longitude,brightness,acq_date,acq_time,satellite,confidence,version,frp,daynight';

interface Hotspot {
  lat: number;
  lon: number;
  time: string;
  sat: string;
  conf: string | number;
  frp: number;
}

function csv(head: string, rows: Hotspot[]): string {
  return [head, ...rows.map((r) => [r.lat, r.lon, 330, '2026-10-28', r.time, r.sat, r.conf, '2.0NRT', r.frp, 'D'].join(','))].join('\n') + '\n';
}

/** 15 NOAA-20 hotspots in the box (FRP 1 to 15, two of them low confidence), one more near the summit (FRP 0.5). */
const N20: Hotspot[] = [
  ...Array.from({ length: 15 }, (_, i) => ({ lat: -3 + i * 0.01, lon: 113.5, time: i < 8 ? '0512' : '1752', sat: 'N20', conf: i < 2 ? 'low' : 'nominal', frp: i + 1 })),
  { lat: -2.01, lon: 114, time: '0512', sat: 'N20', conf: 'high', frp: 0.5 },
];
const SNPP: Hotspot[] = Array.from({ length: 3 }, (_, i) => ({ lat: -3 + i * 0.01, lon: 113.6, time: '0610', sat: 'N', conf: 'nominal', frp: 2 }));
const MODIS: Hotspot[] = [{ lat: -2.9, lon: 113.7, time: '0230', sat: 'T', conf: 80, frp: 9 }];
/** Far from every watch area: read, not kept (an empty FIRMS file is refused). */
const N21: Hotspot[] = [{ lat: 15, lon: 100, time: '0600', sat: 'N21', conf: 'nominal', frp: 3 }];

const LIVE30 =
  '<Infogempa><gempa><eventid>bmkg2026test</eventid><waktu>2026/10/28  06:42:29.657</waktu><lintang>-10</lintang>' +
  '<bujur>120</bujur><dalam>10</dalam><mag>3.1</mag><area>Laut Sawu</area><status>auto</status></gempa></Infogempa>';
const bmkgList = (date: string) => ({
  Infogempa: { gempa: [{ DateTime: date, Coordinates: '-10.0,120.0', Magnitude: '5.1', Kedalaman: '10 km', Wilayah: 'Laut Sawu' }] },
});

const fetchStub = (async (input: string | URL) => {
  const url = String(input);
  const body = url.includes('SUOMI_VIIRS')
    ? csv(VIIRS_HEAD, SNPP)
    : url.includes('J1_VIIRS')
      ? csv(VIIRS_HEAD, N20)
      : url.includes('J2_VIIRS')
        ? csv(VIIRS_HEAD, N21)
        : url.includes('MODIS')
          ? csv(MODIS_HEAD, MODIS)
          : url.includes('earthquake.usgs.gov')
            ? JSON.stringify({ type: 'FeatureCollection', features: [] })
            : url.includes('gempaterkini')
              ? JSON.stringify(bmkgList('2026-10-20T00:00:00+00:00'))
              : url.includes('gempadirasakan')
                ? JSON.stringify(bmkgList('2026-10-19T00:00:00+00:00'))
                : url.includes('live30event')
                  ? LIVE30
                  : null;
  return body === null ? new Response('not found', { status: 404 }) : new Response(body, { status: 200 });
}) as typeof fetch;

const build = () => buildWatchData({ watches: [BOX, SUMMIT], fetchImpl: fetchStub, now: NOW });

describe('buildWatchData: haze boxes in a heavy fire season', () => {
  it('keeps the 10 strongest hotspots per satellite per day in a box, and counts every one in a daily total', async () => {
    const built = await build();
    const firms = built.firms as unknown as {
      rows: { satellite: string; frp: number }[];
      hazeDayTotals: { watchId: string; satellite: string; date: string; rows: number; kept: number; confidence: Record<string, [number, number]>; times: string[] }[];
    };
    const n20 = firms.rows.filter((r) => r.satellite === 'N20');
    // FRP 15 down to 6, plus the summit hotspot (FRP 0.5) that a volcano rule needs.
    expect(n20.map((r) => r.frp).sort((a, b) => b - a)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 0.5]);
    expect(firms.hazeDayTotals).toEqual([
      {
        watchId: 'watch-test-box',
        satellite: 'N20',
        date: '2026-10-28',
        rows: 16,
        kept: 11,
        confidence: { low: [2, 3], nominal: [13, 117], high: [1, 0.5] },
        times: ['0512', '1752'],
      },
    ]);
    // Under the limit nothing is dropped and no total is written.
    expect(firms.rows.filter((r) => r.satellite === 'N')).toHaveLength(3);
    expect(firms.rows.filter((r) => r.satellite === 'T')).toHaveLength(1);
  });

  it('writes the totals into firms.json, reports kept and counted-only rows per file, and stays in budget', async () => {
    const built = await build();
    expect(JSON.parse(built.files.firms)).toEqual({ about: built.firms.about, rows: built.firms.rows, hazeDayTotals: built.firms.hazeDayTotals });
    expect(built.firms.about).toContain('hazeDayTotals');
    const sources = built.meta.sources as { id: string; rowsKept: number; rowsCountedNotKept?: number }[];
    expect(sources.find((s) => s.id === 'firms-viirs-noaa20')).toMatchObject({ rowsKept: 11, rowsCountedNotKept: 5 });
    expect(sources.find((s) => s.id === 'firms-viirs-snpp')).toMatchObject({ rowsKept: 3, rowsCountedNotKept: 0 });
    expect(built.meta.collection).toMatchObject({ hazeKeepPerSatelliteDay: 10 });
    expect(built.snapshotBytes).toBeLessThan(300 * 1024);
  });
});
