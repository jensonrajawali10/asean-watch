import { describe, expect, it } from 'vitest';
import {
  FIRE_PERIODS,
  FIRMS_ACKNOWLEDGEMENT,
  FIRE_LINKS,
  baseCellIndex,
  changeWords,
  clusterAt,
  clusterById,
  clusterSentence,
  compassWords,
  countryRollups,
  dailyValues,
  decodeGridPeriod,
  fireCells,
  fireSourceRefs,
  formatCount,
  formatMw,
  formatPct,
  loadFireSnapshot,
  parseFireSnapshot,
  percentChange,
  periodInfo,
  regionRollups,
  regionalBadges,
  sensorMix,
  smokeHeading,
  topClusters,
  weekOverWeek,
  windowAmount,
} from './fires';
import type { FireSnapshot } from './fires';
import type { WindGrid } from './windField';

// ---------------------------------------------------------------------------
// Fixture: a small hand-built snapshot in the exact format scripts/refresh-fires.mjs writes.

const FRAME = { originLat: -20, originLon: 80, maxLat: 40, maxLon: 170 };
const zeros = () => [0, 0, 0, 0, 0, 0, 0];

/** [lat, lon, count, frpSum, frpMax, sensorMask] → one encoded grid period. */
function encode(p: number, cells: Array<[number, number, number, number, number, number]>, cellDeg = 0.25) {
  const nCols = Math.round((FRAME.maxLon - FRAME.originLon) / cellDeg);
  const rows = cells
    .map(([lat, lon, n, frp, max, mask]) => ({
      idx: Math.floor((lat - FRAME.originLat) / cellDeg) * nCols + Math.floor((lon - FRAME.originLon) / cellDeg),
      n,
      frp,
      max,
      mask,
    }))
    .sort((a, b) => a.idx - b.idx);
  const data: number[] = [];
  let prev = 0;
  for (const r of rows) {
    data.push(r.idx - prev, r.n, r.frp, r.max, r.mask);
    prev = r.idx;
  }
  return { p, cellDeg, nCols, cells: rows.length, data };
}

function series(count: number[], frp: number[]) {
  return { count, frp, frpMax: frp.map((f) => Math.min(f, 90)), sensors: [count, zeros(), zeros(), zeros()] };
}

const idx025 = (lat: number, lon: number) => Math.floor((lat - FRAME.originLat) / 0.25) * 360 + Math.floor((lon - FRAME.originLon) / 0.25);

function historyDays(n: number, startDate = '2026-09-30', perDay = (i: number) => [100 + i, 1000 + 10 * i] as [number, number]) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const date = new Date(Date.parse(`${startDate}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const [c, f] = perDay(i);
    out.push({ date, from: '2026-10-15T06:00:00Z', total: [c, f], countries: { IDN: [c - 10, f - 100] }, regions: { 'IDN:Riau': [5, 50] } });
  }
  return out;
}

function raw(over: Record<string, unknown> = {}) {
  const ogan = {
    id: '24h-1',
    window: '24h',
    rank: 1,
    name: 'Ogan Komering Ilir, South Sumatra',
    badge: 'Ogan Komering Ilir',
    place: { iso3: 'IDN', country: 'Indonesia', adm1: 'South Sumatra', adm2: 'Ogan Komering Ilir', method: 'nearest regency/district centre (approximate)' },
    lat: -3.3,
    lon: 105.2,
    bbox: [-3.5, 105, -3.25, 105.25],
    cells: [idx025(-3.3, 105.2)],
    windowCount: 312,
    ...series([312, 280, 200, 150, 100, 90, 80], [1400, 1000, 800, 700, 600, 500, 400]),
  };
  const riau7d = {
    ...ogan,
    id: '7d-1',
    window: '7d',
    name: 'Rokan Hilir, Riau',
    badge: 'Rokan Hilir',
    place: { iso3: 'IDN', country: 'Indonesia', adm1: 'Riau', adm2: 'Rokan Hilir', method: 'nearest regency/district centre (approximate)' },
    lat: 1.9,
    lon: 100.9,
    cells: [idx025(1.9, 100.9)],
    windowCount: 900,
    ...series([0, 300, 200, 150, 100, 90, 60], [0, 2000, 900, 700, 600, 500, 300]),
  };
  return {
    schema: 1,
    retrievedAt: '2026-10-15T06:06:13Z',
    reference: '2026-10-14T19:46:00Z',
    window: { start: '2026-10-07T19:46:00Z', end: '2026-10-14T19:46:00Z' },
    coverageStart: '2026-10-08T00:00:00Z',
    latestDetection: '2026-10-15T03:57:00Z',
    laggingSensors: [],
    filters: { viirs: 'confidence nominal or high', modis: 'confidence 50 or more' },
    sensors: ['snpp', 'noaa20', 'noaa21', 'modis'],
    method: { frp: 'Summed FRP adds every confident detection.' },
    totals: {
      key: 'ALL',
      name: 'All FIRMS South East Asia region',
      count: [400, 380, 300, 250, 200, 190, 150],
      frp: [2000, 1800, 1500, 1200, 1000, 900, 700],
      frpMax: [90, 80, 70, 60, 50, 40, 30],
      sensors: [
        [100, 100, 100, 100, 100, 100, 100],
        [100, 100, 100, 50, 50, 50, 50],
        [150, 150, 80, 80, 40, 30, 0],
        [50, 30, 20, 20, 10, 10, 0],
      ],
    },
    countries: [
      { iso3: 'IDN', name: 'Indonesia', asean: true, centre24h: [-2.5, 112.7], centre7d: [-2.6, 112.6], ...series([350, 300, 250, 200, 150, 150, 100], [1800, 1500, 1200, 1000, 800, 700, 500]) },
      { iso3: 'XXX', name: 'Outside country boundaries', asean: false, centre24h: [7, 102], centre7d: [7, 102], ...series([30, 40, 30, 30, 30, 30, 40], [150, 200, 200, 150, 150, 150, 150]) },
      { iso3: 'PNG', name: 'Papua New Guinea', asean: false, centre24h: [-8, 142], centre7d: [-8, 142], ...series([20, 40, 20, 20, 20, 10, 10], [50, 100, 100, 50, 50, 50, 50]) },
      { iso3: 'MYS', name: 'Malaysia', asean: true, centre24h: null, centre7d: [2, 111], ...series([0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]) },
    ],
    regions: [
      { key: 'IDN:South Sumatra', iso3: 'IDN', country: 'Indonesia', name: 'South Sumatra', centre24h: [-3.3, 105], centre7d: [-3.3, 105], ...series([312, 280, 200, 150, 100, 90, 80], [1400, 1000, 800, 700, 600, 500, 400]) },
      { key: 'IDN:Riau', iso3: 'IDN', country: 'Indonesia', name: 'Riau', centre24h: [1, 101], centre7d: [1, 101], ...series([1234, 20, 50, 50, 0, 0, 0], [300, 500, 400, 300, 200, 100, 100]) },
      { key: 'MYS:Sarawak', iso3: 'MYS', country: 'Malaysia', name: 'Sarawak', centre24h: [2, 111], centre7d: [2, 111], ...series([3, 0, 0, 0, 0, 0, 1], [10, 0, 0, 0, 0, 0, 3]) },
    ],
    clusters24h: [ogan],
    clusters7d: [riau7d],
    history: { days: historyDays(5, '2026-10-09') },
    grid: {
      frame: FRAME,
      baseCellDeg: 0.25,
      periods: [
        encode(0, [
          [-3.3, 105.2, 10, 120.5, 40, 0b0101],
          [1.9, 100.9, 2, 3.4, 2.1, 0b1000],
        ]),
        encode(1, [[-3.3, 105.2, 4, 20, 9, 0b0010]]),
        encode(2, []),
        encode(3, [
          [-3.3, 105.2, 1, 5, 5, 0b0001],
          [0.1, 109.9, 7, 70, 30, 0b0001],
        ]),
        encode(4, []),
        encode(5, []),
        encode(6, [[0.1, 109.9, 1, 1, 1, 0b0001]]),
      ],
    },
    sources: [
      {
        id: 'firms-snpp',
        sensor: 'snpp',
        name: 'NASA FIRMS VIIRS 375 m NRT (Suomi NPP), South East Asia, last 7 days (CSV)',
        provider: 'NASA FIRMS (LANCE)',
        url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_7d.csv',
        retrievedAt: '2026-10-15T06:06:13Z',
        lastModified: '2026-10-15T05:51:35Z',
        rowsRead: 81516,
        rowsConfident: 76161,
        licence: 'NASA open data',
      },
      { id: 'natural-earth-countries', name: 'Country polygons', provider: 'Natural Earth', url: 'https://www.naturalearthdata.com/', licence: 'Public domain' },
    ],
    attribution: `NASA FIRMS, LANCE. ${FIRMS_ACKNOWLEDGEMENT}`,
    ...over,
  };
}

function snap(over: Record<string, unknown> = {}): FireSnapshot {
  const s = parseFireSnapshot(raw(over));
  if (!s) throw new Error('fixture did not parse');
  return s;
}

// ---------------------------------------------------------------------------

describe('parseFireSnapshot', () => {
  it('accepts the snapshot format and derives 24 h, previous 24 h and 7-day amounts', () => {
    const s = snap();
    expect(s.gridPeriods).toHaveLength(FIRE_PERIODS);
    expect(s.totals.last24h).toEqual({ count: 400, frp: 2000 });
    expect(s.totals.prev24h).toEqual({ count: 380, frp: 1800 });
    expect(s.totals.last7d.count).toBe(1870);
    expect(s.countries.find((c) => c.iso3 === 'XXX')?.kind).toBe('unassigned');
    expect(s.regions[0].key).toBe('IDN:South Sumatra');
  });

  it('rejects a wrong schema, a broken grid, a bad timestamp or a wrong sensor list', () => {
    expect(parseFireSnapshot(raw({ schema: 2 }))).toBeNull();
    expect(parseFireSnapshot(raw({ reference: '2026-10-14 19:46' }))).toBeNull();
    expect(parseFireSnapshot(raw({ sensors: ['modis'] }))).toBeNull();
    const r = raw();
    (r.grid.periods[0].data as number[]).pop();
    expect(parseFireSnapshot(r)).toBeNull();
    expect(parseFireSnapshot(null)).toBeNull();
  });
});

describe('the bundled snapshot', () => {
  it('parses, covers four FIRMS sensors and carries the FIRMS acknowledgement', () => {
    const s = loadFireSnapshot();
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.gridPeriods).toHaveLength(FIRE_PERIODS);
    expect(s.sources.filter((x) => x.sensor).map((x) => x.sensor).sort()).toEqual(['modis', 'noaa20', 'noaa21', 'snpp']);
    expect(s.attribution).toContain("We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System");
    expect(Date.parse(s.reference)).toBeLessThanOrEqual(Date.parse(s.retrievedAt));
    for (const c of s.clusters24h) expect(c.last24h.count).toBeGreaterThan(0);
    // The grid and the totals agree.
    const gridCount = fireCells(s, '24h').reduce((n, c) => n + c.count, 0);
    expect(gridCount).toBe(s.totals.last24h.count);
  });
});

describe('grid cells', () => {
  it('decodes delta indices, cell corners and the sensor mask', () => {
    const s = snap();
    const cells = decodeGridPeriod(s, 0);
    expect(cells).toHaveLength(2);
    const c = cells.find((x) => x.count === 10);
    expect(c).toMatchObject({ south: -3.5, west: 105, lat: -3.375, lon: 105.125, cellDeg: 0.25, frp: 120.5, frpMax: 40, latestPeriod: 0 });
    expect(c?.sensors).toEqual(['snpp', 'noaa21']);
    expect(c?.index).toBe(baseCellIndex(s, -3.3, 105.2));
  });

  it('aggregates a window: sums, max of max, union of sensors, most recent period', () => {
    const s = snap();
    const week = fireCells(s, '7d');
    const c = week.find((x) => x.index === baseCellIndex(s, -3.3, 105.2));
    expect(c).toMatchObject({ count: 15, frp: 145.5, frpMax: 40, latestPeriod: 0 });
    expect(c?.sensors).toEqual(['snpp', 'noaa20', 'noaa21']);
    expect(c?.perPeriod).toEqual([10, 4, 0, 1, 0, 0, 0]);
    expect(fireCells(s, '24h')).toHaveLength(2);
    const older = fireCells(s, 'before24h');
    expect(older.find((x) => x.index === c?.index)?.latestPeriod).toBe(1);
    expect(older.find((x) => x.lat === 0.125)?.count).toBe(8);
  });
});

describe('periods and daily values', () => {
  it('counts back from the reference time and flags a period that starts before coverage', () => {
    const s = snap();
    expect(periodInfo(s, 0)).toMatchObject({ start: '2026-10-13T19:46:00Z', end: '2026-10-14T19:46:00Z', label: '14 Oct', partial: false });
    expect(periodInfo(s, 6).partial).toBe(true);
    expect(periodInfo(s, 5).partial).toBe(false);
  });

  it('gives seven values oldest first for charts', () => {
    const s = snap();
    const d = dailyValues(s, s.totals.series);
    expect(d).toHaveLength(7);
    expect(d[0].p).toBe(6);
    expect(d[6]).toMatchObject({ p: 0, count: 400, frp: 2000, label: '14 Oct' });
  });

  it('sums a series over a window', () => {
    const s = snap();
    expect(windowAmount(s.totals.series, '72h')).toEqual({ count: 1080, frp: 5300 });
  });
});

describe('rollups', () => {
  it('lists countries by 7-day FRP, leaving out offshore and empty rows unless asked', () => {
    const s = snap();
    expect(countryRollups(s).map((c) => c.iso3)).toEqual(['IDN', 'PNG']);
    expect(countryRollups(s, { includeUnassigned: true }).map((c) => c.iso3)).toEqual(['IDN', 'XXX', 'PNG']);
    expect(countryRollups(s, { aseanOnly: true }).map((c) => c.iso3)).toEqual(['IDN']);
    const idn = countryRollups(s)[0];
    expect(idn.frpChange24hPct).toBe(20);
    expect(dailyValues(s, idn.series).map((d) => d.count)).toEqual([100, 150, 150, 200, 250, 300, 350]);
  });

  it('lists Indonesian provinces and Malaysian states separately', () => {
    const s = snap();
    expect(regionRollups(s).map((r) => r.name)).toEqual(['South Sumatra', 'Riau']);
    expect(regionRollups(s, 'MYS').map((r) => r.name)).toEqual(['Sarawak']);
    expect(regionRollups(s, 'IDN', { sortBy: 'count24h' })[0].name).toBe('Riau');
  });

  it('makes regional badges from provinces, states and other countries, never offshore', () => {
    const s = snap();
    const b = regionalBadges(s, '24h');
    expect(b.map((x) => x.name)).toEqual(['South Sumatra', 'Riau', 'Papua New Guinea', 'Sarawak']);
    expect(b[1].text).toBe('Riau · 1,234 hotspots');
    expect(b.some((x) => x.name.includes('Outside'))).toBe(false);
  });
});

describe('change', () => {
  it('computes percent change and refuses a zero base', () => {
    expect(percentChange(140, 100)).toBe(40);
    expect(percentChange(75, 100)).toBe(-25);
    expect(percentChange(10, 0)).toBeNull();
    expect(formatPct(40)).toBe('+40%');
    expect(formatPct(-25)).toBe('−25%');
    expect(formatPct(null)).toBe('n/a');
  });

  it('says week-over-week is not yet available, and gives the 72-hour comparison meanwhile', () => {
    const w = weekOverWeek(snap());
    expect(w.status).toBe('insufficient');
    expect(w.daysAvailable).toBe(5);
    expect(w.interim.last72h).toEqual({ count: 1080, frp: 5300 });
    expect(w.interim.prev72h).toEqual({ count: 640, frp: 3100 });
    expect(w.sentence).toContain('needs 14 complete days');
    expect(w.sentence).toContain('fire power up 71% on the 72 h before');
  });

  it('compares the last 7 complete UTC days with the 7 before once 14 are held', () => {
    const s = snap({ history: { days: historyDays(16) } });
    const w = weekOverWeek(s);
    expect(w.status).toBe('ok');
    expect(w.thisWeek).toMatchObject({ from: '2026-10-09', to: '2026-10-15', count: 7 * 100 + (9 + 10 + 11 + 12 + 13 + 14 + 15) });
    expect(w.lastWeek?.from).toBe('2026-10-02');
    // FRP: this week 7000 + 10 × (9 + … + 15) = 7840; the week before 7000 + 10 × (2 + … + 8) = 7350.
    expect(w.frpChangePct).toBeCloseTo(((7840 - 7350) / 7350) * 100, 0);
    expect(weekOverWeek(s, { key: 'IDN' }).thisWeek?.count).toBe(w.thisWeek!.count - 70);
    expect(weekOverWeek(s, { key: 'IDN:Riau' }).thisWeek?.count).toBe(35);
  });

  it('needs the 14 days to be consecutive', () => {
    const days = historyDays(16).filter((d) => d.date !== '2026-10-05');
    expect(weekOverWeek(snap({ history: { days } })).status).toBe('insufficient');
  });
});

describe('clusters', () => {
  it('returns the top clusters and finds one by id or by a point in its cells', () => {
    const s = snap();
    expect(topClusters(s, '24h', 5).map((c) => c.id)).toEqual(['24h-1']);
    expect(topClusters(s, '7d', 0)).toEqual([]);
    expect(clusterById(s, '7d-1')?.name).toBe('Rokan Hilir, Riau');
    expect(clusterAt(s, -3.3, 105.2)?.id).toBe('24h-1');
    expect(clusterAt(s, 1.9, 100.9)?.id).toBe('7d-1');
    expect(clusterAt(s, 10, 100)).toBeNull();
  });

  it('writes the plain sentence for a 24 h cluster', () => {
    const c = snap().clusters24h[0];
    expect(clusterSentence(c)).toBe('312 hotspots in the last 24 h around Ogan Komering Ilir, South Sumatra; fire power up 40% on the day before.');
    expect(clusterSentence({ ...c, frpChange24hPct: -25, last24h: { count: 312, frp: 750 } })).toContain('fire power down 25% on the day before');
    expect(clusterSentence({ ...c, frpChange24hPct: 4 })).toContain('fire power about the same as the day before');
    expect(clusterSentence({ ...c, frpChange24hPct: 200, last24h: { count: 312, frp: 3000 } })).toContain('fire power 3.0 times the day before');
    expect(clusterSentence({ ...c, frpChange24hPct: null, prev24h: { count: 0, frp: 0 } })).toContain('none were confidently detected there over the day before');
  });

  it('writes a 7-day sentence that never treats no detections as no fire', () => {
    const c = snap().clusters7d[0];
    const t = clusterSentence(c);
    expect(t).toContain('900 hotspots in the last 7 days around Rokan Hilir, Riau');
    expect(t).toContain('not proof the fires are out');
  });

  it('never claims emissions', () => {
    const s = snap();
    const texts = [clusterSentence(s.clusters24h[0]), clusterSentence(s.clusters7d[0]), weekOverWeek(s).sentence, changeWords(10, 110, 100, 'x')];
    for (const t of texts) expect(t).not.toMatch(/tonne|emission|CO2|carbon/i);
  });
});

describe('sensor mix and sources', () => {
  it('shares sum to one over the window', () => {
    const mix = sensorMix(snap().totals.series, '24h');
    expect(mix.map((m) => m.count)).toEqual([100, 100, 150, 50]);
    expect(mix.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1, 10);
  });

  it('lists FIRMS files with row counts, the acknowledgement and the FEW link', () => {
    const refs = fireSourceRefs(snap());
    expect(refs[0].label).toContain('76,161 confident of 81,516 rows');
    expect(refs[0].mode).toBe('SNAPSHOT · MEASURED');
    expect(refs.some((r) => r.label.includes(FIRMS_ACKNOWLEDGEMENT))).toBe(true);
    expect(refs.some((r) => r.url === FIRE_LINKS.fireEmissionsWatch)).toBe(true);
  });

  it('formats counts and MW without locale surprises', () => {
    expect(formatCount(36809)).toBe('36,809');
    expect(formatMw(297765.4)).toBe('297,765 MW');
    expect(formatMw(8.44)).toBe('8.4 MW');
  });
});

// ---------------------------------------------------------------------------

function uniformGrid(u: number, v: number): WindGrid {
  const lats = Array.from({ length: 15 }, (_, i) => -6 + i);
  const lons = Array.from({ length: 26 }, (_, i) => 95 + i);
  const times = Array.from({ length: 17 }, (_, i) => new Date(Date.parse('2026-10-14T00:00:00Z') + i * 3 * 3_600_000).toISOString().replace('.000Z', 'Z'));
  const field = (x: number) => times.map(() => lats.map(() => lons.map(() => x)));
  return {
    lats,
    lons,
    times,
    u: field(u),
    v: field(v),
    source: 'Open-Meteo Forecast API',
    sourceUrl: 'https://open-meteo.com/en/docs',
    model: 'test',
    level: '925 hPa',
    retrievedAt: '2026-10-14T07:17:29Z',
    dataMode: 'historical',
    attribution: 'test',
  };
}

describe('smoke heading (MODELLED)', () => {
  const cluster = { id: '24h-9', name: 'Test fire', lat: -1, lon: 112, last24h: { count: 10, frp: 100 } };

  it('follows the wind and names the compass direction and the place it reaches', () => {
    const h = smokeHeading(cluster, uniformGrid(-5, 0), { startISO: '2026-10-14T06:00:00Z', places: [{ name: 'Testville', lat: -1, lon: 109 }] });
    expect(h).not.toBeNull();
    if (!h) return;
    expect(h.label).toBe('MODELLED');
    expect(h.compass).toBe('west');
    expect(h.distanceKm).toBeGreaterThan(400);
    expect(h.distanceKm).toBeLessThan(460);
    expect(h.toward?.name).toBe('Testville');
    expect(h.toward?.hours).toBeGreaterThanOrEqual(14);
    expect(h.toward?.hours).toBeLessThanOrEqual(16);
    expect(h.sentence).toContain('heading west, toward Testville');
    expect(h.caveat).toContain('MODELLED 925 hPa');
    expect(h.caveat).toContain('not a dispersion model');
  });

  it('says so when winds are light, and gives nothing outside the wind grid', () => {
    const light = smokeHeading(cluster, uniformGrid(0.1, 0), { startISO: '2026-10-14T06:00:00Z' });
    expect(light?.compass).toBeNull();
    expect(light?.sentence).toContain('light');
    expect(smokeHeading({ ...cluster, lat: -8, lon: 140 }, uniformGrid(-5, 0))).toBeNull();
  });

  it('uses plain compass words', () => {
    expect(compassWords(315)).toBe('north-west');
    expect(compassWords(-90)).toBe('west');
    expect(compassWords(22.5, 16)).toBe('north-north-east');
  });
});
