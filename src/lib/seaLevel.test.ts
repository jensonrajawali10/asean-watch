import { beforeEach, describe, expect, it } from 'vitest';
import { resetConnectorCaches } from './liveLoad';
import {
  inSeaLevelBox,
  loadSeaLevelReadings,
  loadSeaLevelSample,
  loadSeaLevelStations,
  nearestStations,
  parseReadings,
  parseStationList,
  SEA_LEVEL_NOTE,
  seaLevelDataUrl,
} from './seaLevel';

// Trimmed real IOC station-list rows (2026-10-14). The second Prigi row (rad) and the AMTSI/Aarhus
// coordinates are test-only edits to exercise sensor preference and the filters.
const LIST = [
  { Code: 'cili', Location: 'Cilacap', country: 'IDN', countryname: 'Indonesia', Lat: -7.75, Lon: 109, sensor: 'rad', rate: 1, units: 'M', lasttime: '2026-10-14 11:39:00.000' },
  { Code: 'cili', Location: 'Cilacap', country: 'IDN', countryname: 'Indonesia', Lat: -7.75, Lon: 109, sensor: 'rad', rate: 1, units: 'M', lasttime: '2026-10-14 11:39:00.000' },
  { Code: 'prig', Location: 'Prigi', country: 'IDN', countryname: 'Indonesia', Lat: -8.2833, Lon: 111.7333, sensor: 'prs', rate: 1, units: 'M', lasttime: '2026-10-14 11:40:00.000' },
  { Code: 'prig', Location: 'Prigi', country: 'IDN', countryname: 'Indonesia', Lat: -8.2833, Lon: 111.7333, sensor: 'rad', rate: 1, units: 'M', lasttime: '2026-10-14 11:40:00.000' },
  { Code: 'AMTSI', Location: 'Port of Ampana, Central Sulawesi', country: 'IDN', Lat: -0.86, Lon: 121.59, sensor: 'bat', units: 'V', lasttime: '2026-10-14 11:39:13.000' },
  { Code: 'aarh', Location: 'Aarhus', country: 'DMK', Lat: 56.15, Lon: 10.22, sensor: 'rad', units: 'M', lasttime: '2026-10-14 11:30:00.000' },
];
// Real Cilacap samples (radar, metres, station datum) incl. one -999 no-data sentinel and a battery row.
const DATA = [
  { slevel: 2.9529999999999998, stime: '2026-10-13 06:00:00', sensor: 'rad' },
  { slevel: 2.9449999999999998, stime: '2026-10-13 06:01:00', sensor: 'rad' },
  { slevel: -999, stime: '2026-10-13 06:02:00', sensor: 'rad' },
  { slevel: 12.9, stime: '2026-10-13 06:01:00', sensor: 'bat' },
];

beforeEach(() => resetConnectorCaches());

describe('station list', () => {
  it('keeps APAC water-level sensors, one station per code, radar preferred', () => {
    const s = parseStationList(LIST);
    expect(s.map((x) => x.code)).toEqual(['cili', 'prig']);
    expect(s[1]).toMatchObject({ name: 'Prigi', country: 'IDN', sensors: ['rad', 'prs'], sensor: 'rad', lastTimeISO: '2026-10-14T11:40:00Z' });
  });

  it('box spans the dateline', () => {
    expect(inSeaLevelBox(-18.1, 178.4)).toBe(true);
    expect(inSeaLevelBox(-14.3, -170.7)).toBe(true);
    expect(inSeaLevelBox(56.15, 10.22)).toBe(false);
  });

  it('bundled APAC list has the five sampled Indonesian gauges and fresh-station filtering', () => {
    const { stations, listRetrievedAt, note } = loadSeaLevelStations();
    expect(stations.length).toBeGreaterThan(100);
    expect(listRetrievedAt).toMatch(/Z$/);
    expect(note).toBe(SEA_LEVEL_NOTE);
    for (const code of ['cili', 'prig', 'pada', 'bitu', 'ambon']) expect(stations.some((s) => s.code === code)).toBe(true);
    const near = nearestStations(stations, -7.54, 110.45, { count: 3, maxAgeHours: 24, nowMs: Date.parse(listRetrievedAt!) });
    expect(near.map((n) => n.station.code)).toContain('cili'); // Merapi: Cilacap among the nearest fresh gauges
    expect(near[0].distanceKm).toBeLessThanOrEqual(near[1].distanceKm);
  });
});

describe('readings', () => {
  it('URL: UTC times without zone, one water sensor, refuses unsafe codes', () => {
    expect(seaLevelDataUrl('cili', 'rad', Date.parse('2026-10-14T12:00:00Z'))).toBe(
      'https://www.ioc-sealevelmonitoring.org/service.php?query=data&code=cili&timestart=2026-10-13T12:00:00&timestop=2026-10-14T12:00:00&format=json&includesensors[]=rad',
    );
    expect(() => seaLevelDataUrl('cili&x=1', 'rad', 0)).toThrow();
    expect(() => seaLevelDataUrl('cili', 'bat', 0)).toThrow();
  });

  it('parses raw values (no smoothing), drops -999 and other sensors', () => {
    expect(parseReadings(DATA, 'rad')).toEqual([
      { timeISO: '2026-10-13T06:00:00Z', value: 2.9529999999999998, unit: 'm' },
      { timeISO: '2026-10-13T06:01:00Z', value: 2.9449999999999998, unit: 'm' },
    ]);
  });

  it('notes that the data are raw and not a tsunami warning', () => {
    expect(SEA_LEVEL_NOTE).toMatch(/not quality controlled/);
    expect(SEA_LEVEL_NOTE).toMatch(/Not a tsunami warning/);
  });

  it('live on success, then the HISTORICAL sample, then unavailable', async () => {
    const ok = (async () => new Response(JSON.stringify(DATA), { status: 200 })) as unknown as typeof fetch;
    const live = await loadSeaLevelReadings('cili', { fetchImpl: ok });
    expect(live.status.status).toBe('live');
    expect(live.series?.readings).toHaveLength(2);
    expect(live.series?.dataMode).toBe('live');

    resetConnectorCaches();
    const down = (async () => new Response('err', { status: 503 })) as unknown as typeof fetch;
    const snap = await loadSeaLevelReadings('cili', { fetchImpl: down });
    expect(snap.status.status).toBe('snapshot');
    expect(snap.series?.dataMode).toBe('historical');
    expect(snap.series!.readings.length).toBeGreaterThan(50);

    resetConnectorCaches();
    const none = await loadSeaLevelReadings('cili', { fetchImpl: down, snapshot: { capturedAt: 'x', stationList: { url: '', retrievedAt: 'x', raw: LIST }, samples: {} } });
    expect(none.series).toBeNull();
    expect(none.status.status).toBe('unavailable');
  });

  it('refuses codes outside the APAC list without fetching', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('[]');
    }) as unknown as typeof fetch;
    const r = await loadSeaLevelReadings('aarh', { fetchImpl: spy });
    expect(called).toBe(false);
    expect(r.status.status).toBe('unavailable');
  });

  it('bundled samples cover five Indonesian gauges on 10-minute marks', () => {
    for (const code of ['cili', 'prig', 'pada', 'bitu', 'ambon']) {
      const s = loadSeaLevelSample(code);
      expect(s, code).not.toBeNull();
      expect(s!.readings.every((r) => /:[0-5]0:00Z$/.test(r.timeISO) && r.unit === 'm')).toBe(true);
    }
  });
});
