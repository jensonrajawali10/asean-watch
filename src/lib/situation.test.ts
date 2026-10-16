import { describe, expect, it } from 'vitest';
import type { NeaContext, OfficialWarning, WarningFeedStatus } from '../types';
import { AQ_PLACES, loadAqSnapshot } from './airQuality';
import type { AirQualityData, AqPlaceSeries } from './airQuality';
import { loadAshWindSnapshot } from './ashDrift';
import { loadFireSnapshot } from './fires';
import { loadFixtures } from './fixtures';
import { loadFloodModelSnapshot } from './floodModel';
import { loadNeaSnapshot } from './nea';
import { loadPtwcSnapshot } from './ptwc';
import { loadQuakesSnapshot } from './quakesLive';
import {
  SITUATION_DISCLAIMER,
  activeOfficial,
  cityHazeTable,
  compassWord,
  feedFor,
  fireClustersAsSources,
  firesSummaryFromSnapshot,
  headline,
  headlineSentence,
  modelAnchorISO,
  pmText,
  singaporeTransport,
  situationReport,
  sortCityRows,
  warningLine,
  whoMultiple,
} from './situation';
import type { SituationInput } from './situation';
import { TRANSPORT_CAVEAT, hazeSourcesFromFixtures } from './transport';
import type { HotspotSource } from './transport';
import { loadWarningsSnapshot } from './warnings';
import { loadWindSnapshot } from './windField';
import type { WindGrid } from './windField';

// ---------------------------------------------------------------------------
// Synthetic builders

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');

function hourly(startISO: string, hours: number, stepH = 1): string[] {
  const s = Date.parse(startISO);
  return Array.from({ length: Math.floor(hours / stepH) + 1 }, (_, k) => iso(s + k * stepH * H));
}

function place(id: string, pm25: number[]): AqPlaceSeries {
  const p = AQ_PLACES.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return { ...p, pm25 };
}

function aqData(opts: {
  dataMode?: 'live' | 'historical';
  retrievedAt?: string;
  times?: string[];
  places: Array<{ id: string; pm25: number[] | ((k: number) => number) }>;
}): AirQualityData {
  const times = opts.times ?? hourly('2026-10-13T00:00:00Z', 96);
  return {
    lats: [0, 1],
    lons: [100, 101],
    times,
    pm25: times.map(() => [
      [0, 0],
      [0, 0],
    ]),
    places: opts.places.map((p) => place(p.id, typeof p.pm25 === 'function' ? times.map((_, k) => (p.pm25 as (k: number) => number)(k)) : p.pm25)),
    source: 'Open-Meteo Air Quality API',
    sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    model: 'CAMS global',
    unit: 'µg/m³',
    retrievedAt: opts.retrievedAt ?? '2026-10-14T07:19:26Z',
    dataMode: opts.dataMode ?? 'live',
    attribution: 'Air quality: Open-Meteo.com (CC BY 4.0)',
  };
}

/** A uniform wind (u east, v north, m/s) over the haze grid for 72 h. */
function uniformWind(u: number, v: number, opts?: { level?: string; dataMode?: 'live' | 'historical'; retrievedAt?: string }): WindGrid {
  const lats = Array.from({ length: 15 }, (_, j) => -6 + j);
  const lons = Array.from({ length: 26 }, (_, i) => 95 + i);
  const times = hourly('2026-10-13T00:00:00Z', 96, 3);
  const field = (x: number) => times.map(() => lats.map(() => lons.map(() => x)));
  return {
    lats,
    lons,
    times,
    u: field(u),
    v: field(v),
    source: 'Open-Meteo Forecast API',
    sourceUrl: 'https://open-meteo.com/en/docs',
    model: 'best match',
    level: opts?.level ?? '925 hPa',
    retrievedAt: opts?.retrievedAt ?? '2026-10-14T07:17:29Z',
    dataMode: opts?.dataMode ?? 'live',
    attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
  };
}

/** A fire cluster about 220 km west of Singapore. */
const WEST_OF_SG: HotspotSource = { id: 'w:1:101.5', watchId: 'w', label: 'Test cluster', lat: 1.35, lon: 101.8, count: 12, frpSum: 340 };

function nea(opts?: { dataMode?: 'live' | 'historical' }): NeaContext {
  const dataMode = opts?.dataMode ?? 'live';
  return {
    dataMode,
    observedAt: '2026-10-14T06:00:00Z',
    retrievedAt: '2026-10-14T06:10:00Z',
    stations: [],
    wind: { fromDeg: 180, meanSpeedKnots: 4, consistency: 0.9, stationCount: 10, label: 'From S (180°) at 4.0 kn' },
    haze: {
      observedAt: '2026-10-14T06:00:00Z',
      psi24h: { north: 90, south: 101, east: 95, west: 120, central: 99 },
      pm25OneHour: { north: 40, south: 52, east: 47, west: 66, central: 50 },
      psiBand: 'Unhealthy',
      dataMode,
    },
    sourceName: 'NEA real-time weather and air quality via data.gov.sg',
    sourceUrl: 'https://data.gov.sg/datasets/d_534cf203023b51f51f879145ccc56ff9/view',
    attribution: 'Contains information from PSI accessed on 2026-10-14 from data.gov.sg',
    qualityNote: 'test',
  };
}

function warning(over: Partial<OfficialWarning>): OfficialWarning {
  return {
    id: 'w1',
    issuer: 'BMKG InaTEWS',
    issuerUrl: 'https://inatews.bmkg.go.id/',
    authority: 'official',
    hazard: 'tsunami',
    product: 'Warning Tsunami',
    level: 'SIAGA',
    levelGloss: null,
    headline: 'Peringatan Dini Tsunami di Contoh | *uji*',
    areaDescription: 'Contoh',
    areas: [],
    location: null,
    issuedAt: '2026-10-14T05:00:00Z',
    expiresAt: null,
    ended: false,
    instruction: null,
    language: 'id',
    sourceUrl: 'https://example.invalid/feed.xml',
    dataMode: 'live',
    retrievedAt: '2026-10-14T05:10:00Z',
    ...over,
  };
}

function feed(over: Partial<WarningFeedStatus>): WarningFeedStatus {
  return {
    feedId: 'bmkg-inatews',
    issuer: 'BMKG InaTEWS',
    issuerUrl: 'https://inatews.bmkg.go.id/',
    status: 'live',
    retrievedAt: '2026-10-14T05:10:00Z',
    message: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('modelAnchorISO', () => {
  it('floors the run retrieval time to the 3-hourly step, like the scrubber', () => {
    expect(modelAnchorISO(aqData({ places: [{ id: 'singapore', pm25: () => 10 }] }))).toBe('2026-10-14T06:00:00Z');
    expect(modelAnchorISO(aqData({ retrievedAt: '2026-10-14T09:00:00Z', places: [{ id: 'singapore', pm25: () => 10 }] }))).toBe(
      '2026-10-14T09:00:00Z',
    );
    expect(modelAnchorISO(null)).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('rounds PM2.5 and the WHO multiple like describePm25', () => {
    expect(pmText(0.2)).toBe('<1');
    expect(pmText(2905.7)).toBe('2,906');
    expect(pmText(null)).toBe('—');
    expect(whoMultiple(15)).toBe(1);
    expect(whoMultiple(100)).toBe(6.7);
    expect(whoMultiple(1090)).toBe(73);
    expect(compassWord(315)).toBe('north-west');
    expect(compassWord(-90)).toBe('west');
  });
});

describe('headline', () => {
  const smoky = aqData({
    places: [
      { id: 'singapore', pm25: () => 40 },
      { id: 'palangka-raya', pm25: (k) => 300 + k },
      { id: 'cebu', pm25: () => 3 },
    ],
  });

  it('names the worst place with its modelled value and says "Now" for a live run', () => {
    const h = headline({ airQuality: smoky });
    // Anchor 06:00 is hour index 30 of the run: 300 + 30.
    expect(h.text).toBe('Now: haze is worst over Palangka Raya (330 µg/m³, modelled).');
    expect(h.freshness).toBe('LIVE');
    expect(h.chip).toBe('LIVE · 14 Oct 07:19 UTC');
    expect(h.worst?.id).toBe('palangka-raya');
    expect(headlineSentence({ airQuality: smoky })).toBe(h.text);
  });

  it('never says "now" for a snapshot run (docs/CONTRACT.md)', () => {
    const snap = { ...smoky, dataMode: 'historical' as const };
    const h = headline({ airQuality: snap });
    expect(h.text.startsWith('Snapshot run, Wed 14 Oct, 06:00 UTC: haze is worst over Palangka Raya')).toBe(true);
    expect(h.text).not.toMatch(/\bnow\b/i);
    expect(h.chip.startsWith('SNAPSHOT')).toBe(true);
  });

  it('follows the scrubber hour when given', () => {
    const h = headline({ airQuality: smoky }, { atISO: '2026-10-15T06:00:00Z' });
    expect(h.text.startsWith('Forecast +24 h (Thu 15 Oct, 06:00 UTC): haze is worst over Palangka Raya (354 µg/m³, modelled).')).toBe(true);
  });

  it('stays calm when every value is low', () => {
    const clean = aqData({ places: [{ id: 'singapore', pm25: () => 9 }, { id: 'cebu', pm25: () => 3 }] });
    expect(headlineSentence({ airQuality: clean })).toBe('Now: modelled PM2.5 is low at all 2 tracked places; the highest is Singapore (9 µg/m³, modelled).');
  });

  it('adds the low-level wind at the worst place and says when that is the direction of Singapore', () => {
    // Singapore lies about 289° (west-north-west) of Palangka Raya. A wind toward 289° points at it; one toward
    // the north-west (315°) is 26° off, so it is not called the direction of Singapore.
    const wnw = uniformWind(-5, 1.75);
    expect(headlineSentence({ airQuality: smoky, wind925: wnw })).toContain(
      'Low-level winds there blow toward the west, the direction of Singapore (modelled).',
    );
    expect(headlineSentence({ airQuality: smoky, wind925: uniformWind(-5, 5) })).toContain(
      'Low-level winds there blow toward the north-west (modelled).',
    );
    const east = uniformWind(5, 0);
    expect(headlineSentence({ airQuality: smoky, wind925: east })).toContain('Low-level winds there blow toward the east (modelled).');
    const calm = uniformWind(0.2, 0.1);
    expect(headlineSentence({ airQuality: smoky, wind925: calm })).toContain('Low-level winds there are light (modelled).');
  });

  it('prefers a modelled path that reaches Singapore', () => {
    const h = headlineSentence({ airQuality: smoky, wind925: uniformWind(5, 0), hazeSources: [WEST_OF_SG] });
    expect(h).toMatch(/Modelled low-level winds carry air from Test cluster to Singapore in about \d+ h\./);
  });

  it('handles a missing air-quality model without an all-clear', () => {
    expect(headlineSentence({ airQuality: null })).toBe(
      'Air-quality model and fire data are unavailable right now; this is not an all-clear. Check ASMC and your national air-quality agency.',
    );
    expect(headlineSentence({ airQuality: null, hazeSources: [WEST_OF_SG] })).toBe(
      'Air-quality model unavailable; showing satellite fire data only. This is not an all-clear.',
    );
    const fires = { source: 'NASA FIRMS VIIRS 375 m NRT', asOf: '2026-10-14T06:00:00Z', hotspots24h: 1234 };
    expect(headlineSentence({ airQuality: null, fires })).toBe(
      'Air-quality model unavailable; showing satellite fire data only: 1,234 hotspots in the last 24 h (NASA FIRMS VIIRS 375 m NRT). This is not an all-clear.',
    );
    expect(headline({ airQuality: null }).freshness).toBe('UNAVAILABLE');
  });
});

describe('cityHazeTable', () => {
  it('gives now, 24 h mean and WHO multiple, peaks with local times, trend and a 72 h series', () => {
    // Singapore: 30 for the past day, then rising by 2 per hour.
    const data = aqData({ places: [{ id: 'singapore', pm25: (k) => (k <= 30 ? 30 : 30 + (k - 30) * 2) }, { id: 'bangkok', pm25: () => 12 }] });
    const t = cityHazeTable(data);
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.anchorISO).toBe('2026-10-14T06:00:00Z');
    expect(t.covers24hPast).toBe(true);
    expect(t.covers48h).toBe(true);
    const sg = t.rows.find((r) => r.id === 'singapore');
    expect(sg?.now).toBe(30);
    expect(sg?.mean24hPast).toBe(30);
    expect(sg?.whoMultiple24h).toBe(2);
    expect(sg?.peak24h.value).toBe(78);
    expect(sg?.peak24h.timeISO).toBe('2026-10-15T06:00:00Z');
    expect(sg?.peak24h.localLabel).toBe('Thu 15 Oct, 2:00 pm local (06:00 UTC)');
    expect(sg?.peak48h.value).toBe(126);
    expect(sg?.peak48hBand?.key).toBe('unhealthy');
    expect(sg?.trend).toBe('rising');
    expect(sg?.series[0].timeISO).toBe('2026-10-13T06:00:00Z');
    expect(sg?.series.at(-1)?.timeISO).toBe('2026-10-16T06:00:00Z');
    expect(sg?.series.filter((p) => !p.future).length).toBe(25);
    const bkk = t.rows.find((r) => r.id === 'bangkok');
    expect(bkk?.trend).toBe('steady');
    expect(bkk?.peak48h.timeISO).toBe('2026-10-14T06:00:00Z');
  });

  it('flags a run that does not cover the past 24 h or the next 48 h', () => {
    const data = aqData({ times: hourly('2026-10-14T00:00:00Z', 30), places: [{ id: 'singapore', pm25: () => 20 }] });
    const t = cityHazeTable(data);
    expect(t?.covers24hPast).toBe(false);
    expect(t?.covers48h).toBe(false);
    expect(t?.rows[0].mean24hPast).toBeNull();
    expect(t?.rows[0].whoMultiple24h).toBeNull();
    expect(t?.forecastEndISO).toBe('2026-10-15T06:00:00Z');
  });

  it('sorts worst first, keeping the AQ_PLACES order on ties, or by name', () => {
    const data = aqData({ places: [{ id: 'singapore', pm25: () => 50 }, { id: 'kuala-lumpur', pm25: () => 80 }, { id: 'ipoh', pm25: () => 50 }] });
    const rows = cityHazeTable(data)?.rows ?? [];
    expect(sortCityRows(rows, 'now').map((r) => r.id)).toEqual(['kuala-lumpur', 'singapore', 'ipoh']);
    expect(sortCityRows(rows, 'name').map((r) => r.id)).toEqual(['ipoh', 'kuala-lumpur', 'singapore']);
  });
});

describe('singaporeTransport', () => {
  it('reports a path that reaches Singapore, with the caveats', () => {
    const t = singaporeTransport(uniformWind(5, 0), [WEST_OF_SG]);
    expect(t?.reachingCount).toBe(1);
    expect(t?.lead?.reaches).toBe(true);
    expect(t?.lead?.arrivalHours).toBeGreaterThan(5);
    expect(t?.lead?.arrivalHours).toBeLessThan(15);
    expect(t?.sentence).toContain('Modelled 925 hPa winds carry air from Test cluster to within');
    expect(t?.sentence.endsWith(TRANSPORT_CAVEAT)).toBe(true);
    expect(t?.caveats).toContain(TRANSPORT_CAVEAT);
  });

  it('says plainly when no path reaches Singapore', () => {
    const t = singaporeTransport(uniformWind(-5, 0, { level: '10 m' }), [WEST_OF_SG]);
    expect(t?.reachingCount).toBe(0);
    expect(t?.sentence).toContain('None of the 1 modelled path at 10 m from Test cluster reaches Singapore');
    expect(t?.sentence).toContain('the paths move away from Singapore');
  });

  it('starts at the requested time when it lies inside the grid, else near the grid retrieval time', () => {
    expect(singaporeTransport(uniformWind(5, 0), [WEST_OF_SG], { startISO: '2026-10-13T12:00:00Z' })?.startISO).toBe('2026-10-13T12:00:00Z');
    expect(singaporeTransport(uniformWind(5, 0), [WEST_OF_SG], { startISO: '2030-01-01T00:00:00Z' })?.startISO).toBe('2026-10-14T06:00:00Z');
  });

  it('returns null without a grid or sources', () => {
    expect(singaporeTransport(null, [WEST_OF_SG])).toBeNull();
    expect(singaporeTransport(uniformWind(5, 0), [])).toBeNull();
  });

  it('turns fire-summary clusters into sources', () => {
    const s = fireClustersAsSources({
      source: 'FIRMS',
      asOf: null,
      clusters: [{ id: 'kalbar', label: 'West Kalimantan', lat: -0.5, lon: 110, hotspots: 40, frpSumMW: 900 }],
    });
    expect(s).toEqual([{ id: 'fires:kalbar', watchId: 'fires', label: 'West Kalimantan', lat: -0.5, lon: 110, count: 40, frpSum: 900 }]);
  });
});

describe('warnings helpers', () => {
  it('relays the level and headline verbatim with time and mode', () => {
    const w = warning({ levelGloss: 'Level 2 of 3' });
    expect(warningLine(w)).toBe(
      'BMKG InaTEWS: "SIAGA" [Level 2 of 3]: "Peringatan Dini Tsunami di Contoh | *uji*" (issued 2026-10-14 05:00 UTC; LIVE)',
    );
    // Expired at retrieval (05:10): EXPIRED with the issuer's expiry time.
    expect(warningLine(warning({ ended: true, expiresAt: '2026-10-14T05:00:00Z', dataMode: 'historical' }))).toContain(
      'HISTORICAL; EXPIRED 2026-10-14 05:00 UTC',
    );
    // Ended by the issuer while its 06:00 expiry was still ahead: ENDED, never "EXPIRED <a later time>" (night M4).
    const cancelled = warning({ ended: true, expiresAt: '2026-10-14T06:00:00Z', dataMode: 'historical' });
    expect(warningLine(cancelled)).toContain('HISTORICAL; ENDED by the issuer');
    expect(warningLine(cancelled, Date.parse('2026-10-15T00:00:00Z'))).toContain('HISTORICAL; ENDED by the issuer');
    // Not ended as relayed, but past its expiry on the page clock: EXPIRED.
    const dated = warning({ expiresAt: '2026-10-14T06:00:00Z' });
    expect(warningLine(dated)).not.toMatch(/EXPIRED|ENDED/);
    expect(warningLine(dated, Date.parse('2026-10-14T07:00:00Z'))).toContain('LIVE; EXPIRED 2026-10-14 06:00 UTC');
  });

  it('counts only official messages that have not ended', () => {
    const list = [warning({ id: 'a' }), warning({ id: 'b', ended: true }), warning({ id: 'c', authority: 'aggregator', issuer: 'GDACS' })];
    expect(activeOfficial(list).map((w) => w.id)).toEqual(['a']);
  });

  it('given the page clock, also drops messages whose expiry has passed (night M4)', () => {
    const list = [warning({ id: 'a' }), warning({ id: 'd', expiresAt: '2026-10-14T06:00:00Z' })];
    expect(activeOfficial(list).map((w) => w.id)).toEqual(['a', 'd']);
    expect(activeOfficial(list, Date.parse('2026-10-14T05:30:00Z')).map((w) => w.id)).toEqual(['a', 'd']);
    expect(activeOfficial(list, Date.parse('2026-10-14T07:00:00Z')).map((w) => w.id)).toEqual(['a']);
    const r = situationReport({ airQuality: null, warnings: list, warningFeeds: [], nowMs: Date.parse('2026-10-14T07:00:00Z') });
    const warnings = r.sections.find((x) => x.id === 'warnings');
    expect(warnings?.figures[0].value).toBe('1');
    expect(JSON.stringify(warnings)).toContain('1 further official message was ended or past their expiry time');
  });

  it('matches a message to the right feed when the issuer has two', () => {
    const feeds = [feed({ feedId: 'jma-tsunami', issuer: 'JMA' }), feed({ feedId: 'jma-volcano', issuer: 'JMA' })];
    expect(feedFor(warning({ issuer: 'JMA', hazard: 'volcano' }), feeds)?.feedId).toBe('jma-volcano');
    expect(feedFor(warning({ issuer: 'JMA', hazard: 'tsunami' }), feeds)?.feedId).toBe('jma-tsunami');
  });
});

describe('situationReport', () => {
  const base: SituationInput = {
    airQuality: aqData({
      places: [
        { id: 'singapore', pm25: (k) => 40 + k },
        { id: 'palangka-raya', pm25: () => 600 },
        { id: 'jakarta', pm25: () => 20 },
      ],
    }),
    wind925: uniformWind(5, 0),
    wind10m: uniformWind(-3, 0, { level: '10 m' }),
    hazeSources: [WEST_OF_SG],
    hotspotSnapshot: { retrievedAt: '2026-10-13T07:26:44Z', satelliteAsOf: '2026-10-13T06:50:48Z' },
    nea: nea(),
    warnings: [warning({ id: 'a' }), warning({ id: 'b', hazard: 'flood', issuer: 'PUB', level: 'High', headline: 'Flash flood at Test Rd' })],
    warningFeeds: [feed({}), feed({ feedId: 'pub-flood', issuer: 'PUB', status: 'unavailable', retrievedAt: null })],
  };

  it('is deterministic', () => {
    expect(JSON.stringify(situationReport(base))).toBe(JSON.stringify(situationReport(base)));
  });

  it('cites a known source and a time for every figure, and every cited id exists', () => {
    const r = situationReport(base);
    const ids = new Set(r.citations.map((c) => c.id));
    for (const s of r.sections) {
      for (const f of s.figures) {
        expect(ids.has(f.cite)).toBe(true);
        expect(['MODELLED', 'MEASURED', 'OFFICIAL', 'ESTIMATE']).toContain(f.basis);
      }
      for (const b of s.blocks) if ('cites' in b) for (const c of b.cites) expect(ids.has(c)).toBe(true);
    }
    for (const c of r.citations) expect(c.time !== null || c.mode === 'LINK' || c.mode === 'UNAVAILABLE').toBe(true);
    expect(r.disclaimer).toBe(SITUATION_DISCLAIMER);
  });

  it('covers haze, transport, NEA beside the model, warnings by hazard, freshness and gaps', () => {
    const r = situationReport(base);
    expect(r.sections.map((s) => s.id)).toEqual(['overview', 'haze', 'transport', 'fires', 'volcanoes', 'warnings', 'water', 'freshness']);
    const haze = r.sections.find((s) => s.id === 'haze');
    expect(haze?.figures.find((f) => f.label.startsWith('Singapore 24 h PSI'))?.value).toBe('120');
    const text = JSON.stringify(r);
    expect(text).toContain('the two are different products and are not expected to match');
    expect(text).toContain("follow NEA's haze advisories");
    const transport = r.sections.find((s) => s.id === 'transport');
    expect(transport?.figures.map((f) => f.value)).toEqual(['1 of 1', '0 of 1']);
    const warnings = r.sections.find((s) => s.id === 'warnings');
    expect(warnings?.summary).toBe('2 official messages are in force as relayed: tsunami 1 and flood 1.');
    expect(r.gaps).toContain('Official feed unavailable: check PUB directly.');
    expect(r.freshness.map((f) => f.source)).toContain('CAMS PM2.5 (Open-Meteo)');
    expect(r.whatChanged.some((l) => l.startsWith('Singapore (modelled): 70 µg/m³ now, against 46 µg/m³ 24 h earlier'))).toBe(true);
  });

  it('never presents absence as an all-clear', () => {
    const r = situationReport({ airQuality: null, warnings: [], warningFeeds: [] });
    const text = JSON.stringify(r);
    expect(text).toContain('The feeds checked returned no official message in force. This is not an all-clear.');
    expect(text).toContain('No official volcano level notice was returned by the feeds checked. This is not an all-clear');
    expect(r.headline.text).toContain('not an all-clear');
    expect(text).not.toMatch(/all clear\b(?! )|no warnings\b|is safe/i);
  });

  it('uses fire-summary counts and their change when supplied', () => {
    const r = situationReport({
      ...base,
      fires: { source: 'NASA FIRMS VIIRS 375 m NRT', asOf: '2026-10-14T06:00:00Z', hotspots24h: 500, hotspotsPrev24h: 320, coverage: 'South East Asia' },
    });
    const fires = r.sections.find((s) => s.id === 'fires');
    expect(fires?.figures[0].value).toBe('500');
    expect(r.whatChanged).toContain('Hotspots in the last 24 h: 500, against 320 in the 24 h before (NASA FIRMS VIIRS 375 m NRT).');
  });

  it('adds ages only when the caller passes a clock', () => {
    const without = situationReport(base);
    const withClock = situationReport({ ...base, nowMs: Date.parse('2026-10-14T19:19:26Z') });
    expect(without.freshness[0].text).toBe('CAMS PM2.5 (Open-Meteo) (MODELLED): live, retrieved 2026-10-14 07:19 UTC.');
    expect(withClock.freshness[0].text).toBe('CAMS PM2.5 (Open-Meteo) (MODELLED): live, retrieved 2026-10-14 07:19 UTC (about 12 h old).');
  });
});

describe('situationReport on the bundled snapshots', () => {
  const fx = loadFixtures();
  const w = loadWarningsSnapshot();
  const p = loadPtwcSnapshot();
  const input: SituationInput = {
    airQuality: loadAqSnapshot(),
    wind10m: loadWindSnapshot('10m'),
    wind925: loadWindSnapshot('925hPa'),
    hazeSources: hazeSourcesFromFixtures(fx),
    hotspotSnapshot: fx.snapshot,
    nea: loadNeaSnapshot(),
    warnings: [...w.warnings, ...p.warnings],
    warningFeeds: [...w.feeds, p.status],
    ashWind: loadAshWindSnapshot(),
    riverFlow: loadFloodModelSnapshot(),
    quakes: loadQuakesSnapshot(),
  };

  it('builds a full report with a snapshot headline', () => {
    const r = situationReport(input);
    expect(r.headline.freshness).toBe('SNAPSHOT');
    expect(r.headline.text.startsWith('Snapshot run, ')).toBe(true);
    expect(AQ_PLACES.some((pl) => r.headline.text.includes(pl.name.replace(/\s*\(.*\)$/, '')))).toBe(true);
    for (const s of r.sections) for (const f of s.figures) expect(f.label).not.toMatch(/\bnow\b/);
  });

  it('relays the MAGMA levels verbatim', () => {
    const r = situationReport(input);
    const volcano = r.sections.find((s) => s.id === 'volcanoes');
    const table = volcano?.blocks.find((b) => b.kind === 'table' && b.columns[1] === 'Level (verbatim)');
    expect(table && table.kind === 'table' ? table.rows.some((row) => row[1] === 'Level III (Siaga)' && row[0] === 'Merapi') : false).toBe(true);
  });
});

describe('firesSummaryFromSnapshot (the fires module snapshot)', () => {
  const snap = loadFireSnapshot();

  it('maps totals, non-overlapping regions and the 24 h clusters', () => {
    expect(snap).not.toBeNull();
    if (!snap) return;
    const f = firesSummaryFromSnapshot(snap);
    expect(f.hotspots24h).toBe(snap.totals.last24h.count);
    expect(f.hotspotsPrev24h).toBe(snap.totals.prev24h.count);
    expect(f.asOf).toBe(snap.reference);
    expect(f.dataMode).toBe('historical');
    expect(f.regions?.length).toBeGreaterThan(0);
    // Indonesia is split into provinces, so it never appears as a country row as well.
    expect(f.regions?.some((r) => r.name === 'Indonesia')).toBe(false);
    const counts = (f.regions ?? []).map((r) => r.hotspots24h);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(f.clusters?.[0]).toMatchObject({ id: snap.clusters24h[0].id, label: snap.clusters24h[0].name });
  });

  it('feeds the fire section, the change line and the transport sources', () => {
    if (!snap) return;
    const fires = firesSummaryFromSnapshot(snap);
    const r = situationReport({ airQuality: null, wind925: loadWindSnapshot('925hPa'), fires });
    const sec = r.sections.find((x) => x.id === 'fires');
    expect(sec?.figures[0].label).toBe('Hotspots, last 24 h');
    expect(r.whatChanged.some((l) => l.startsWith('Hotspots in the last 24 h:'))).toBe(true);
    const transport = r.sections.find((x) => x.id === 'transport');
    const table = transport?.blocks.find((b) => b.kind === 'table');
    expect(table && table.kind === 'table' ? table.rows.length : 0).toBe(fires.clusters?.length);
    expect(headlineSentence({ airQuality: null, fires })).toMatch(/^Air-quality model unavailable; showing satellite fire data only: [\d,]+ hotspots in the last 24 h/);
  });
});
