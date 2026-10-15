// Fires: a FIRMS-based, Fire Emissions Watch style view of active fires over the FIRMS South East Asia
// region. Reads the bundled snapshot data/fires-snapshot.json (written by scripts/refresh-fires.mjs) and
// turns it into grid cells, country and province rollups, week-over-week change, top clusters and plain
// sentences. Pure and deterministic (no wall-clock time); the only I/O is the bundled JSON import.
//
// Rules this module keeps (docs/CONTRACT.md):
// - Detections are MEASURED satellite data. The smoke heading is MODELLED and says so.
// - Fire radiative power (FRP, MW) is a proxy for fire intensity. This module never states emissions in
//   tonnes or any other mass; Copernicus Fire Emissions Watch (CAMS GFAS) is the place for emissions.
// - No detections is never "no fires": cloud, smoke and the time between passes hide fires.
// - Every figure can be traced to the FIRMS files listed in `sources`, with the FIRMS acknowledgement.
//
// Periods: index 0 is the 24 h before the snapshot's reference time (the latest moment all four sensors
// had delivered), index 6 the 24 h ending 144 h before it. Rolling 24-hour periods, not UTC days, so the
// last 24 h always hold a full day of satellite passes. Week-over-week uses complete UTC days from the
// snapshot's carried-forward history.
import snapshotJson from '../../data/fires-snapshot.json';
import type { WindGrid } from './windField';
import { computeTrajectories, haversineKm, receptorAnalysis, TRANSPORT_CAVEAT } from './transport';
import type { HotspotSource, Trajectory, TrajectoryPoint } from './transport';

// ---------------------------------------------------------------------------
// Constants

export const FIRE_PERIODS = 7;
export const FIRE_SENSORS = ['snpp', 'noaa20', 'noaa21', 'modis'] as const;
export type FireSensor = (typeof FIRE_SENSORS)[number];

export const FIRE_SENSOR_LABEL: Readonly<Record<FireSensor, string>> = {
  snpp: 'VIIRS 375 m (Suomi NPP)',
  noaa20: 'VIIRS 375 m (NOAA-20)',
  noaa21: 'VIIRS 375 m (NOAA-21)',
  modis: 'MODIS 1 km (Terra and Aqua)',
};

/** The acknowledgement FIRMS asks redistributors to show. */
export const FIRMS_ACKNOWLEDGEMENT =
  "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) " +
  "(https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations " +
  "(LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS).";

/** Link-outs (verified 2026-10-15: FEW, GFAS and FIRMS answered HTTP 200; CRISP's site answered behind a bot check). */
export const FIRE_LINKS = {
  fireEmissionsWatch: 'https://apps.atmosphere.copernicus.eu/fire-emissions-watch/',
  gfas: 'https://ads.atmosphere.copernicus.eu/datasets/cams-global-fire-emissions-gfas',
  camsFireMonitoring: 'https://atmosphere.copernicus.eu/global-fire-monitoring',
  crisp: 'https://crisp.nus.edu.sg/',
  firmsMap: 'https://firms.modaps.eosdis.nasa.gov/map/',
  firms: 'https://www.earthdata.nasa.gov/data/tools/firms',
  firmsAttributes: 'https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs',
} as const;

export const FRP_NOT_EMISSIONS =
  'Fire radiative power (FRP, in megawatts) is the heat a satellite measures from a fire at the moment it passes. It is a ' +
  'proxy for fire intensity, not emissions. Copernicus CAMS GFAS converts FRP into emissions; for emissions, use Fire ' +
  'Emissions Watch.';

export const NO_DETECTION_NOTE =
  'No confident detections does not mean no fire: cloud, thick smoke and the hours between satellite passes hide fires.';

export const SUMMED_FRP_NOTE =
  'Summed FRP adds every confident detection from every sensor and pass, so one fire seen by four sensors counts four ' +
  'times. Use it to compare places and days, not as a physical total.';

// ---------------------------------------------------------------------------
// Types

export interface FireAmount {
  /** Confident detections (hotspots), all sensors. */
  count: number;
  /** Summed FRP, MW. */
  frp: number;
}

/** Values per period; index 0 = the last 24 h. */
export interface FireSeries {
  count: readonly number[];
  frp: readonly number[];
  frpMax: readonly number[];
  /** Detections per sensor per period, in FIRE_SENSORS order. */
  sensors: readonly (readonly number[])[];
}

export type FireRollupKind = 'total' | 'country' | 'region' | 'unassigned';

export interface FireRollup {
  /** "ALL", ISO3 ("IDN"), "XXX" for outside country boundaries, or "IDN:Riau" for a region. */
  key: string;
  kind: FireRollupKind;
  name: string;
  /** ISO 3166-1 alpha-3, "XXX" when outside every country polygon, "ALL" for the total. */
  iso3: string;
  /** Country name (the region's country for a region). */
  country: string;
  asean: boolean;
  /** FRP-weighted centre of the last 24 h / last 7 days, [lat, lon]; null when empty. */
  centre24h: readonly [number, number] | null;
  centre7d: readonly [number, number] | null;
  series: FireSeries;
  last24h: FireAmount;
  prev24h: FireAmount;
  last7d: FireAmount;
  /** FRP change of the last 24 h against the 24 h before, %; null when the earlier value is 0. */
  frpChange24hPct: number | null;
  countChange24hPct: number | null;
}

export interface FirePlace {
  iso3: string;
  country: string;
  /** Province, state or first-level unit; null when unknown. */
  adm1: string | null;
  /** Regency, city or district (Indonesia and Malaysia only). */
  adm2: string | null;
  /** How the name was found, e.g. "nearest regency/district centre (approximate)". */
  method: string;
  /** Offshore clusters: the nearest country. */
  nearestCountry?: string | null;
}

export type FireClusterWindow = '24h' | '7d';

export interface FireCluster {
  /** "24h-1", "7d-3", … (window and rank). */
  id: string;
  window: FireClusterWindow;
  rank: number;
  /** "Ogan Komering Ilir, South Sumatra"; repeated names carry coordinates. */
  name: string;
  /** Short label for a map badge: regency/district (IDN, MYS), province, or country. */
  badge: string;
  place: FirePlace;
  /** FRP-weighted centre. */
  lat: number;
  lon: number;
  /** [south, west, north, east] of the cluster cells. */
  bbox: readonly [number, number, number, number];
  /** Absolute indices of the cluster's 0.25° cells on the snapshot frame. */
  cells: readonly number[];
  /** Detections in the cluster's own cells over its window. */
  windowCount: number;
  /** Per-period values over the cluster cells and their unclaimed neighbours. */
  series: FireSeries;
  last24h: FireAmount;
  prev24h: FireAmount;
  last7d: FireAmount;
  frpChange24hPct: number | null;
  countChange24hPct: number | null;
}

export interface FireGridFrame {
  originLat: number;
  originLon: number;
  maxLat: number;
  maxLon: number;
}

export interface FireGridPeriod {
  p: number;
  cellDeg: number;
  nCols: number;
  cells: number;
  /** Flat [index delta, count, summed FRP, max FRP, sensor mask] × cells. */
  data: readonly number[];
}

export interface FireSourceInfo {
  id: string;
  sensor?: FireSensor;
  name: string;
  provider: string;
  url: string;
  productUrl?: string;
  retrievedAt?: string | null;
  lastModified?: string | null;
  bytes?: number;
  rowsRead?: number;
  rowsInvalid?: number;
  rowsLowConfidence?: number;
  rowsConfident?: number;
  rowsInPeriods?: number;
  rowsAfterReference?: number;
  earliestDetection?: string | null;
  latestDetection?: string | null;
  satelliteCodes?: readonly string[];
  licence?: string;
  attribution?: string;
}

export interface FireHistoryDay {
  /** UTC date, "2026-10-09". */
  date: string;
  /** retrievedAt of the snapshot that supplied the day. */
  from: string;
  total: readonly [number, number];
  countries: Readonly<Record<string, readonly [number, number]>>;
  regions: Readonly<Record<string, readonly [number, number]>>;
}

export interface FireSnapshot {
  schema: 1;
  retrievedAt: string;
  /** Periods count back from here. */
  reference: string;
  window: { start: string; end: string };
  /** The files cover from here; earlier period starts may miss the tail of a night pass. */
  coverageStart: string;
  latestDetection: string;
  laggingSensors: readonly FireSensor[];
  filters: { viirs: string; modis: string };
  method: Readonly<Record<string, string>>;
  frame: FireGridFrame;
  baseCellDeg: number;
  gridPeriods: readonly FireGridPeriod[];
  totals: FireRollup;
  countries: readonly FireRollup[];
  regions: readonly FireRollup[];
  clusters24h: readonly FireCluster[];
  clusters7d: readonly FireCluster[];
  history: readonly FireHistoryDay[];
  sources: readonly FireSourceInfo[];
  attribution: string;
}

// ---------------------------------------------------------------------------
// Parsing (the bundled JSON is checked, never trusted)

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isIso = (x: unknown): x is string => isStr(x) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(x) && Number.isFinite(Date.parse(x));
const numArr = (x: unknown, n: number): x is number[] => Array.isArray(x) && x.length === n && x.every(isNum);
const sum = (a: readonly number[]) => a.reduce((s, v) => s + v, 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

function pct(now: number, before: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before <= 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/** Percent change from `before` to `now`, one decimal; null when `before` is 0 or not finite. */
export function percentChange(now: number, before: number): number | null {
  return pct(now, before);
}

function parseSeries(r: Rec): FireSeries | null {
  const { count, frp, frpMax, sensors } = r;
  if (!numArr(count, FIRE_PERIODS) || !numArr(frp, FIRE_PERIODS) || !numArr(frpMax, FIRE_PERIODS)) return null;
  if (!Array.isArray(sensors) || sensors.length !== FIRE_SENSORS.length || !sensors.every((s) => numArr(s, FIRE_PERIODS))) return null;
  return { count, frp, frpMax, sensors: sensors as number[][] };
}

function amounts(series: FireSeries) {
  const last24h = { count: series.count[0], frp: series.frp[0] };
  const prev24h = { count: series.count[1], frp: series.frp[1] };
  const last7d = { count: sum(series.count), frp: round1(sum(series.frp)) };
  return {
    last24h,
    prev24h,
    last7d,
    frpChange24hPct: pct(last24h.frp, prev24h.frp),
    countChange24hPct: pct(last24h.count, prev24h.count),
  };
}

function parseCentre(x: unknown): readonly [number, number] | null {
  return Array.isArray(x) && x.length === 2 && isNum(x[0]) && isNum(x[1]) ? [x[0], x[1]] : null;
}

function parseRollup(x: unknown, kind: FireRollupKind): FireRollup | null {
  if (!isRec(x)) return null;
  const series = parseSeries(x);
  if (!series) return null;
  const iso3 = isStr(x.iso3) ? x.iso3 : kind === 'total' ? 'ALL' : null;
  const name = isStr(x.name) ? x.name : null;
  if (!iso3 || !name) return null;
  const realKind: FireRollupKind = kind === 'country' && iso3 === 'XXX' ? 'unassigned' : kind;
  const key = kind === 'region' ? (isStr(x.key) ? x.key : `${iso3}:${name}`) : kind === 'total' ? 'ALL' : iso3;
  return {
    key,
    kind: realKind,
    name,
    iso3,
    country: kind === 'region' && isStr(x.country) ? x.country : kind === 'total' ? 'All countries' : name,
    asean: x.asean === true,
    centre24h: parseCentre(x.centre24h),
    centre7d: parseCentre(x.centre7d),
    series,
    ...amounts(series),
  };
}

function parseCluster(x: unknown): FireCluster | null {
  if (!isRec(x)) return null;
  const series = parseSeries(x);
  const { id, window, rank, name, badge, lat, lon, bbox, cells, windowCount, place } = x;
  if (!isRec(place)) return null;
  if (!series || !isStr(id) || (window !== '24h' && window !== '7d') || !isNum(rank) || !isStr(name) || !isStr(badge)) return null;
  if (!isNum(lat) || !isNum(lon) || !numArr(bbox, 4) || !Array.isArray(cells) || !cells.every(isNum) || !isNum(windowCount)) return null;
  if (!isStr(place.iso3) || !isStr(place.country)) return null;
  return {
    id,
    window,
    rank,
    name,
    badge,
    place: {
      iso3: place.iso3,
      country: place.country,
      adm1: isStr(place.adm1) ? place.adm1 : null,
      adm2: isStr(place.adm2) ? place.adm2 : null,
      method: isStr(place.method) ? place.method : 'approximate',
      nearestCountry: isStr(place.nearestCountry) ? place.nearestCountry : null,
    },
    lat,
    lon,
    bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
    cells: cells as number[],
    windowCount,
    series,
    ...amounts(series),
  };
}

function parseGrid(x: unknown): { frame: FireGridFrame; baseCellDeg: number; periods: FireGridPeriod[] } | null {
  if (!isRec(x) || !isRec(x.frame) || !isNum(x.baseCellDeg) || !Array.isArray(x.periods)) return null;
  const f = x.frame;
  if (!isNum(f.originLat) || !isNum(f.originLon) || !isNum(f.maxLat) || !isNum(f.maxLon)) return null;
  if (x.periods.length !== FIRE_PERIODS) return null;
  const periods: FireGridPeriod[] = [];
  for (const [i, p] of x.periods.entries()) {
    if (!isRec(p) || p.p !== i || !isNum(p.cellDeg) || p.cellDeg <= 0 || !isNum(p.nCols) || !isNum(p.cells) || !Array.isArray(p.data)) return null;
    if (p.data.length !== p.cells * 5 || !p.data.every(isNum)) return null;
    periods.push({ p: i, cellDeg: p.cellDeg, nCols: p.nCols, cells: p.cells, data: p.data as number[] });
  }
  return {
    frame: { originLat: f.originLat, originLon: f.originLon, maxLat: f.maxLat, maxLon: f.maxLon },
    baseCellDeg: x.baseCellDeg,
    periods,
  };
}

function parseHistoryDay(x: unknown): FireHistoryDay | null {
  if (!isRec(x) || !isStr(x.date) || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !numArr(x.total, 2)) return null;
  const pairs = (o: unknown): Record<string, readonly [number, number]> => {
    const out: Record<string, readonly [number, number]> = {};
    if (isRec(o)) for (const [k, v] of Object.entries(o)) if (numArr(v, 2)) out[k] = [v[0], v[1]];
    return out;
  };
  return {
    date: x.date,
    from: isStr(x.from) ? x.from : '',
    total: [x.total[0], x.total[1]],
    countries: pairs(x.countries),
    regions: pairs(x.regions),
  };
}

function parseSource(x: unknown): FireSourceInfo | null {
  if (!isRec(x) || !isStr(x.id) || !isStr(x.name) || !isStr(x.url)) return null;
  const s: FireSourceInfo = { id: x.id, name: x.name, provider: isStr(x.provider) ? x.provider : '', url: x.url };
  if ((FIRE_SENSORS as readonly string[]).includes(x.sensor as string)) s.sensor = x.sensor as FireSensor;
  if (isStr(x.productUrl)) s.productUrl = x.productUrl;
  if (isStr(x.retrievedAt)) s.retrievedAt = x.retrievedAt;
  if (isStr(x.lastModified) || x.lastModified === null) s.lastModified = x.lastModified;
  for (const k of ['bytes', 'rowsRead', 'rowsInvalid', 'rowsLowConfidence', 'rowsConfident', 'rowsInPeriods', 'rowsAfterReference'] as const) {
    const v = x[k];
    if (isNum(v)) s[k] = v;
  }
  if (isStr(x.earliestDetection)) s.earliestDetection = x.earliestDetection;
  if (isStr(x.latestDetection)) s.latestDetection = x.latestDetection;
  if (Array.isArray(x.satelliteCodes) && x.satelliteCodes.every(isStr)) s.satelliteCodes = x.satelliteCodes;
  if (isStr(x.licence)) s.licence = x.licence;
  if (isStr(x.attribution)) s.attribution = x.attribution;
  return s;
}

/** Validate a stored snapshot. Returns null on any structural problem: never a partial snapshot. */
export function parseFireSnapshot(raw: unknown): FireSnapshot | null {
  if (!isRec(raw) || raw.schema !== 1) return null;
  const { retrievedAt, reference, window, coverageStart, latestDetection } = raw;
  if (!isIso(retrievedAt) || !isIso(reference) || !isIso(coverageStart) || !isIso(latestDetection)) return null;
  if (!isRec(window) || !isIso(window.start) || !isIso(window.end)) return null;
  if (!Array.isArray(raw.sensors) || raw.sensors.join(',') !== FIRE_SENSORS.join(',')) return null;
  const grid = parseGrid(raw.grid);
  const totals = parseRollup(raw.totals, 'total');
  if (!grid || !totals) return null;
  const list = <T>(x: unknown, f: (y: unknown) => T | null): T[] | null => {
    if (!Array.isArray(x)) return null;
    const out: T[] = [];
    for (const y of x) {
      const v = f(y);
      if (v === null) return null;
      out.push(v);
    }
    return out;
  };
  const countries = list(raw.countries, (y) => parseRollup(y, 'country'));
  const regions = list(raw.regions, (y) => parseRollup(y, 'region'));
  const clusters24h = list(raw.clusters24h, parseCluster);
  const clusters7d = list(raw.clusters7d, parseCluster);
  const history = list(isRec(raw.history) ? raw.history.days : null, parseHistoryDay);
  const sources = list(raw.sources, parseSource);
  if (!countries || !regions || !clusters24h || !clusters7d || !history || !sources) return null;
  if (!sources.some((s) => s.sensor)) return null;
  const filters = isRec(raw.filters) ? raw.filters : {};
  const method: Record<string, string> = {};
  if (isRec(raw.method)) for (const [k, v] of Object.entries(raw.method)) if (isStr(v)) method[k] = v;
  return {
    schema: 1,
    retrievedAt,
    reference,
    window: { start: window.start, end: window.end },
    coverageStart,
    latestDetection,
    laggingSensors: Array.isArray(raw.laggingSensors) ? (raw.laggingSensors.filter((s) => (FIRE_SENSORS as readonly unknown[]).includes(s)) as FireSensor[]) : [],
    filters: {
      viirs: isStr(filters.viirs) ? filters.viirs : 'confidence nominal or high',
      modis: isStr(filters.modis) ? filters.modis : 'confidence 50 or more',
    },
    method,
    frame: grid.frame,
    baseCellDeg: grid.baseCellDeg,
    gridPeriods: grid.periods,
    totals,
    countries,
    regions,
    clusters24h,
    clusters7d,
    history,
    sources,
    attribution: isStr(raw.attribution) ? raw.attribution : FIRMS_ACKNOWLEDGEMENT,
  };
}

let cached: { snap: FireSnapshot | null } | null = null;

/** The bundled snapshot (parsed once); null when it is missing or malformed. Never throws. */
export function loadFireSnapshot(): FireSnapshot | null {
  if (!cached) {
    try {
      cached = { snap: parseFireSnapshot(snapshotJson as unknown) };
    } catch {
      cached = { snap: null };
    }
  }
  return cached.snap;
}

// ---------------------------------------------------------------------------
// Periods and windows

export type FireWindow = '24h' | '48h' | '72h' | '7d' | 'before24h' | { from: number; to: number };

/** Inclusive period range [from, to] for a window. "before24h" = periods 1 to 6 (the dim days on the map). */
export function windowPeriods(w: FireWindow): { from: number; to: number } {
  if (typeof w === 'object') {
    const from = Math.max(0, Math.min(FIRE_PERIODS - 1, Math.floor(w.from)));
    const to = Math.max(from, Math.min(FIRE_PERIODS - 1, Math.floor(w.to)));
    return { from, to };
  }
  switch (w) {
    case '24h':
      return { from: 0, to: 0 };
    case '48h':
      return { from: 0, to: 1 };
    case '72h':
      return { from: 0, to: 2 };
    case 'before24h':
      return { from: 1, to: FIRE_PERIODS - 1 };
    default:
      return { from: 0, to: FIRE_PERIODS - 1 };
  }
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "14 Oct 19:46 UTC" from an ISO time (no locale, no wall clock). */
export function formatFireTime(isoTime: string): string {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return isoTime;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:${mm} UTC`;
}
const dayLabel = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

export interface FirePeriodInfo {
  p: number;
  start: string;
  end: string;
  /** Short label for a bar: the UTC date the period ends on, e.g. "14 Oct". */
  label: string;
  /** True when the period starts before the files' coverage (may miss the tail of a night pass). */
  partial: boolean;
}

export function periodInfo(s: Pick<FireSnapshot, 'reference' | 'coverageStart'>, p: number): FirePeriodInfo {
  const ref = Date.parse(s.reference);
  const endMs = ref - p * 86_400_000;
  const startMs = endMs - 86_400_000;
  return { p, start: iso(startMs), end: iso(endMs), label: dayLabel(endMs - 60_000), partial: startMs < Date.parse(s.coverageStart) };
}

export interface FireDailyValue extends FirePeriodInfo, FireAmount {
  frpMax: number;
}

/** Seven values, OLDEST FIRST (for bar charts), from any series. */
export function dailyValues(s: Pick<FireSnapshot, 'reference' | 'coverageStart'>, series: FireSeries): FireDailyValue[] {
  const out: FireDailyValue[] = [];
  for (let p = FIRE_PERIODS - 1; p >= 0; p -= 1) {
    out.push({ ...periodInfo(s, p), count: series.count[p], frp: series.frp[p], frpMax: series.frpMax[p] });
  }
  return out;
}

/** Sum of a series over a window. */
export function windowAmount(series: FireSeries, w: FireWindow): FireAmount {
  const { from, to } = windowPeriods(w);
  let count = 0;
  let frp = 0;
  for (let p = from; p <= to; p += 1) {
    count += series.count[p];
    frp += series.frp[p];
  }
  return { count, frp: round1(frp) };
}

// ---------------------------------------------------------------------------
// Grid cells

export interface FireCell {
  /** `${cellDeg}:${index}` (stable across periods for the same cell size). */
  id: string;
  index: number;
  cellDeg: number;
  /** South-west corner and centre, degrees. */
  south: number;
  west: number;
  lat: number;
  lon: number;
  count: number;
  /** Summed FRP, MW. */
  frp: number;
  /** Largest single-detection FRP, MW. */
  frpMax: number;
  sensors: readonly FireSensor[];
  /** Most recent period with detections (0 = last 24 h). */
  latestPeriod: number;
  /** Detections per period inside the window (index = period; 0 outside the window). */
  perPeriod: readonly number[];
}

function maskSensors(mask: number): FireSensor[] {
  return FIRE_SENSORS.filter((_, i) => (mask & (1 << i)) !== 0);
}

/** Decode one period of the grid. */
export function decodeGridPeriod(s: Pick<FireSnapshot, 'frame' | 'gridPeriods'>, p: number): FireCell[] {
  const g = s.gridPeriods[p];
  if (!g) return [];
  const out: FireCell[] = [];
  let idx = 0;
  for (let k = 0; k + 4 < g.data.length; k += 5) {
    idx += g.data[k];
    const row = Math.floor(idx / g.nCols);
    const col = idx - row * g.nCols;
    const south = s.frame.originLat + row * g.cellDeg;
    const west = s.frame.originLon + col * g.cellDeg;
    const perPeriod = new Array<number>(FIRE_PERIODS).fill(0);
    perPeriod[p] = g.data[k + 1];
    out.push({
      id: `${g.cellDeg}:${idx}`,
      index: idx,
      cellDeg: g.cellDeg,
      south: round4(south),
      west: round4(west),
      lat: round4(south + g.cellDeg / 2),
      lon: round4(west + g.cellDeg / 2),
      count: g.data[k + 1],
      frp: g.data[k + 2],
      frpMax: g.data[k + 3],
      sensors: maskSensors(g.data[k + 4]),
      latestPeriod: p,
      perPeriod,
    });
  }
  return out;
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Grid cells aggregated over a window (count and FRP summed, max of max, union of sensors). */
export function fireCells(s: Pick<FireSnapshot, 'frame' | 'gridPeriods'>, w: FireWindow = '7d'): FireCell[] {
  const { from, to } = windowPeriods(w);
  const agg = new Map<string, { cell: FireCell; per: number[]; mask: Set<FireSensor> }>();
  for (let p = from; p <= to; p += 1) {
    for (const c of decodeGridPeriod(s, p)) {
      const a = agg.get(c.id);
      if (!a) {
        agg.set(c.id, { cell: { ...c }, per: [...c.perPeriod], mask: new Set(c.sensors) });
        continue;
      }
      a.cell.count += c.count;
      a.cell.frp = round1(a.cell.frp + c.frp);
      a.cell.frpMax = Math.max(a.cell.frpMax, c.frpMax);
      a.cell.latestPeriod = Math.min(a.cell.latestPeriod, p);
      a.per[p] += c.count;
      for (const sn of c.sensors) a.mask.add(sn);
    }
  }
  return [...agg.values()]
    .map(({ cell, per, mask }) => ({ ...cell, perPeriod: per, sensors: FIRE_SENSORS.filter((sn) => mask.has(sn)) }))
    .sort((a, b) => a.index - b.index || a.cellDeg - b.cellDeg);
}

/** Absolute 0.25° cell index of a point on the snapshot frame (matches cluster `cells`). */
export function baseCellIndex(s: Pick<FireSnapshot, 'frame' | 'baseCellDeg'>, lat: number, lon: number): number {
  const nCols = Math.round((s.frame.maxLon - s.frame.originLon) / s.baseCellDeg);
  return Math.floor((lat - s.frame.originLat) / s.baseCellDeg) * nCols + Math.floor((lon - s.frame.originLon) / s.baseCellDeg);
}

// ---------------------------------------------------------------------------
// Rollups

export interface RollupOptions {
  /** Include "Outside country boundaries" (default false). */
  includeUnassigned?: boolean;
  /** Only ASEAN members (default false). */
  aseanOnly?: boolean;
  /** Sort key (default "frp7d"). */
  sortBy?: 'frp7d' | 'frp24h' | 'count24h' | 'count7d';
  /** Drop rows with fewer detections over 7 days (default 1, so empty rows go). */
  minCount7d?: number;
}

function sortRollups<T extends { last24h: FireAmount; last7d: FireAmount; key: string }>(list: T[], by: RollupOptions['sortBy']): T[] {
  const key = (r: T) =>
    by === 'frp24h' ? r.last24h.frp : by === 'count24h' ? r.last24h.count : by === 'count7d' ? r.last7d.count : r.last7d.frp;
  return list.sort((a, b) => key(b) - key(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Countries with their 7 daily values (series index 0 = last 24 h; use dailyValues() for charts). */
export function countryRollups(s: Pick<FireSnapshot, 'countries'>, opts: RollupOptions = {}): FireRollup[] {
  const min = opts.minCount7d ?? 1;
  const list = s.countries.filter(
    (c) => (opts.includeUnassigned || c.kind !== 'unassigned') && (!opts.aseanOnly || c.asean) && c.last7d.count >= min,
  );
  return sortRollups([...list], opts.sortBy);
}

/** First-level regions of one country (default Indonesia; Malaysia is "MYS"). Approximate (nearest regency centre). */
export function regionRollups(s: Pick<FireSnapshot, 'regions'>, iso3 = 'IDN', opts: RollupOptions = {}): FireRollup[] {
  const min = opts.minCount7d ?? 1;
  return sortRollups(
    s.regions.filter((r) => r.iso3 === iso3 && r.last7d.count >= min),
    opts.sortBy,
  );
}

export function fireTotals(s: Pick<FireSnapshot, 'totals'>): FireRollup {
  return s.totals;
}

export interface FireBadge {
  id: string;
  /** "Central Kalimantan · 11,960 hotspots" */
  text: string;
  name: string;
  lat: number;
  lon: number;
  count: number;
  frp: number;
  kind: 'region' | 'country' | 'cluster';
}

/**
 * Badges for regional zoom: Indonesian provinces, Malaysian states and other countries (not offshore),
 * placed at the FRP-weighted centre of their detections in the window, largest first.
 */
export function regionalBadges(s: Pick<FireSnapshot, 'countries' | 'regions'>, w: '24h' | '7d' = '24h', max = 10): FireBadge[] {
  const pick = (r: FireRollup, kind: FireBadge['kind']): FireBadge | null => {
    const centre = w === '24h' ? r.centre24h : r.centre7d;
    const amount = w === '24h' ? r.last24h : r.last7d;
    if (!centre || amount.count <= 0) return null;
    return {
      id: `badge:${r.key}`,
      text: `${r.name} · ${formatCount(amount.count)} hotspot${amount.count === 1 ? '' : 's'}`,
      name: r.name,
      lat: centre[0],
      lon: centre[1],
      count: amount.count,
      frp: amount.frp,
      kind,
    };
  };
  const regionCountries = new Set(s.regions.map((r) => r.iso3));
  const out = [
    ...s.regions.map((r) => pick(r, 'region')),
    ...s.countries.filter((c) => c.kind === 'country' && !regionCountries.has(c.iso3)).map((c) => pick(c, 'country')),
  ].filter((b): b is FireBadge => b !== null);
  return out.sort((a, b) => b.frp - a.frp || b.count - a.count || (a.id < b.id ? -1 : 1)).slice(0, max);
}

// ---------------------------------------------------------------------------
// Week over week

export interface WeekOverWeekScope {
  /** ISO3 for a country, or "IDN:Riau" for a region; omit for the whole region. */
  key?: string;
}

export interface WeekOverWeek {
  status: 'ok' | 'insufficient';
  scopeName: string;
  /** Complete UTC days in the carried-forward history. */
  daysAvailable: number;
  daysNeeded: 14;
  thisWeek: (FireAmount & { from: string; to: string }) | null;
  lastWeek: (FireAmount & { from: string; to: string }) | null;
  frpChangePct: number | null;
  countChangePct: number | null;
  /** Always available: the last 72 h against the 72 h before (rolling periods 0–2 vs 3–5). */
  interim: { last72h: FireAmount; prev72h: FireAmount; frpChangePct: number | null; countChangePct: number | null };
  sentence: string;
}

function historyValue(day: FireHistoryDay, key: string | undefined): readonly [number, number] {
  if (!key) return day.total;
  return (key.includes(':') ? day.regions[key] : day.countries[key]) ?? [0, 0];
}

function seriesFor(s: Pick<FireSnapshot, 'totals' | 'countries' | 'regions'>, key: string | undefined): { name: string; series: FireSeries } {
  if (!key) return { name: 'the whole FIRMS South East Asia region', series: s.totals.series };
  const r = key.includes(':') ? s.regions.find((x) => x.key === key) : s.countries.find((x) => x.key === key);
  if (r) return { name: r.name, series: r.series };
  const zero = new Array<number>(FIRE_PERIODS).fill(0);
  return { name: key.includes(':') ? key.split(':')[1] : key, series: { count: zero, frp: zero, frpMax: zero, sensors: FIRE_SENSORS.map(() => zero) } };
}

const nextDate = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Week-over-week change from complete UTC days (needs 14 consecutive days ending at the latest one in the
 * history). Until the history holds them, status is "insufficient" and the interim 72-hour comparison is the
 * figure to quote.
 */
export function weekOverWeek(s: Pick<FireSnapshot, 'history' | 'totals' | 'countries' | 'regions'>, scope: WeekOverWeekScope = {}): WeekOverWeek {
  const { name, series } = seriesFor(s, scope.key);
  const last72h = windowAmount(series, { from: 0, to: 2 });
  const prev72h = windowAmount(series, { from: 3, to: 5 });
  const interim = { last72h, prev72h, frpChangePct: pct(last72h.frp, prev72h.frp), countChangePct: pct(last72h.count, prev72h.count) };

  // Longest run of consecutive dates ending at the latest history day.
  const days = [...s.history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const run: FireHistoryDay[] = [];
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (run.length && nextDate(days[i].date) !== run[0].date) break;
    run.unshift(days[i]);
  }
  const base = { scopeName: name, daysAvailable: run.length, daysNeeded: 14 as const, interim };
  if (run.length < 14) {
    const span = run.length ? ` (${run[0].date} to ${run[run.length - 1].date})` : '';
    const sentence =
      `Week-over-week change needs 14 complete days; the snapshot holds ${run.length}${span} and adds one with each daily refresh. ` +
      `Meanwhile, the last 72 h had ${formatCount(last72h.count)} hotspots and ${formatMw(last72h.frp)} summed FRP for ${name}: ` +
      `${changeWords(interim.frpChangePct, last72h.frp, prev72h.frp, 'the 72 h before')}.`;
    return { ...base, status: 'insufficient', thisWeek: null, lastWeek: null, frpChangePct: null, countChangePct: null, sentence };
  }
  const tail = run.slice(-14);
  const add = (list: FireHistoryDay[]) =>
    list.reduce<FireAmount>(
      (a, d) => {
        const [c, f] = historyValue(d, scope.key);
        return { count: a.count + c, frp: round1(a.frp + f) };
      },
      { count: 0, frp: 0 },
    );
  const lastWeek = { ...add(tail.slice(0, 7)), from: tail[0].date, to: tail[6].date };
  const thisWeek = { ...add(tail.slice(7)), from: tail[7].date, to: tail[13].date };
  const frpChangePct = pct(thisWeek.frp, lastWeek.frp);
  const countChangePct = pct(thisWeek.count, lastWeek.count);
  const sentence =
    `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${formatCount(thisWeek.count)} hotspots and ${formatMw(thisWeek.frp)} summed FRP in the week ` +
    `${thisWeek.from} to ${thisWeek.to} (UTC days); ${changeWords(frpChangePct, thisWeek.frp, lastWeek.frp, 'the week before')}.`;
  return { ...base, status: 'ok', thisWeek, lastWeek, frpChangePct, countChangePct, sentence };
}

// ---------------------------------------------------------------------------
// Clusters

export function topClusters(s: Pick<FireSnapshot, 'clusters24h' | 'clusters7d'>, w: FireClusterWindow = '24h', n = 10): FireCluster[] {
  return (w === '24h' ? s.clusters24h : s.clusters7d).slice(0, Math.max(0, n));
}

export function clusterById(s: Pick<FireSnapshot, 'clusters24h' | 'clusters7d'>, id: string): FireCluster | null {
  return s.clusters24h.find((c) => c.id === id) ?? s.clusters7d.find((c) => c.id === id) ?? null;
}

/** The cluster whose cells contain the point (24 h list first, then 7 days); null if none. */
export function clusterAt(s: Pick<FireSnapshot, 'frame' | 'baseCellDeg' | 'clusters24h' | 'clusters7d'>, lat: number, lon: number): FireCluster | null {
  const idx = baseCellIndex(s, lat, lon);
  return s.clusters24h.find((c) => c.cells.includes(idx)) ?? s.clusters7d.find((c) => c.cells.includes(idx)) ?? null;
}

// ---------------------------------------------------------------------------
// Plain language

/** "1,234" (en-US grouping, no locale dependence on the viewer). */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** "12,345 MW" / "8.4 MW". */
export function formatMw(frp: number): string {
  const v = frp < 10 ? Math.round(frp * 10) / 10 : Math.round(frp);
  return `${v.toLocaleString('en-US')} MW`;
}

/** "+40%", "−25%", "0%"; "n/a" for null. */
export function formatPct(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return 'n/a';
  const r = Math.round(p);
  return r > 0 ? `+${r}%` : r < 0 ? `−${Math.abs(r)}%` : '0%';
}

/** "fire power up 40% on the day before" style wording for a change. */
export function changeWords(p: number | null, now: number, before: number, against: string): string {
  if (p === null) {
    if (before <= 0 && now > 0) return `none were confidently detected there over ${against}`;
    return `no confident detections there over ${against} either`;
  }
  const r = Math.round(p);
  if (r >= 100) return `fire power ${(now / before).toFixed(1)} times ${against}`;
  if (r >= 10) return `fire power up ${r}% on ${against}`;
  if (r <= -10) return `fire power down ${Math.abs(r)}% on ${against}`;
  return `fire power about the same as ${against}`;
}

/**
 * One plain sentence for a cluster, e.g. "312 hotspots in the last 24 h around Ogan Komering Ilir, South
 * Sumatra; fire power up 40% on the day before." Never mentions emissions.
 */
export function clusterSentence(c: Pick<FireCluster, 'window' | 'name' | 'last24h' | 'prev24h' | 'last7d' | 'frpChange24hPct'>): string {
  const n24 = c.last24h.count;
  const change = changeWords(c.frpChange24hPct, c.last24h.frp, c.prev24h.frp, 'the day before');
  if (c.window === '24h' || c.last7d.count === n24) {
    const lead = `${formatCount(n24)} hotspot${n24 === 1 ? '' : 's'} in the last 24 h around ${c.name}`;
    return n24 > 0 ? `${lead}; ${change}.` : `${lead}. ${NO_DETECTION_NOTE}`;
  }
  const lead = `${formatCount(c.last7d.count)} hotspots in the last 7 days around ${c.name}`;
  if (n24 === 0) return `${lead}; none confidently detected in the last 24 h, which is not proof the fires are out (cloud and smoke hide fires).`;
  return `${lead}; ${formatCount(n24)} in the last 24 h, ${change}.`;
}

export interface SensorShare {
  sensor: FireSensor;
  label: string;
  count: number;
  /** Share of all detections in the window, 0–1. */
  share: number;
}

/** Detections per sensor over a window (one fire seen by several sensors counts once per sensor). */
export function sensorMix(series: FireSeries, w: FireWindow = '7d'): SensorShare[] {
  const { from, to } = windowPeriods(w);
  const counts = FIRE_SENSORS.map((_, i) => {
    let n = 0;
    for (let p = from; p <= to; p += 1) n += series.sensors[i][p];
    return n;
  });
  const total = sum(counts);
  return FIRE_SENSORS.map((sensor, i) => ({ sensor, label: FIRE_SENSOR_LABEL[sensor], count: counts[i], share: total > 0 ? counts[i] / total : 0 }));
}

// ---------------------------------------------------------------------------
// Modelled smoke heading (925 hPa wind)

export interface SmokePlace {
  name: string;
  lat: number;
  lon: number;
}

/** Cities and towns a smoke path is checked against (coordinates as in data/aq-snapshot.json, plus a few more). */
export const DEFAULT_SMOKE_PLACES: readonly SmokePlace[] = [
  { name: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Kuala Lumpur', lat: 3.1412, lon: 101.6865 },
  { name: 'Johor Bahru', lat: 1.4927, lon: 103.7414 },
  { name: 'Ipoh', lat: 4.5841, lon: 101.0829 },
  { name: 'George Town', lat: 5.4112, lon: 100.3354 },
  { name: 'Kuching', lat: 1.55, lon: 110.3333 },
  { name: 'Kota Kinabalu', lat: 5.9804, lon: 116.0735 },
  { name: 'Bandar Seri Begawan', lat: 4.9031, lon: 114.9398 },
  { name: 'Pekanbaru', lat: 0.5167, lon: 101.4417 },
  { name: 'Jambi', lat: -1.6, lon: 103.6167 },
  { name: 'Palembang', lat: -2.9167, lon: 104.7458 },
  { name: 'Pontianak', lat: -0.0319, lon: 109.325 },
  { name: 'Palangka Raya', lat: -2.2083, lon: 113.9167 },
  { name: 'Banjarmasin', lat: -3.3194, lon: 114.5908 },
  { name: 'Samarinda', lat: -0.5022, lon: 117.1536 },
  { name: 'Balikpapan', lat: -1.2654, lon: 116.8312 },
  { name: 'Medan', lat: 3.5833, lon: 98.6667 },
  { name: 'Jakarta', lat: -6.2146, lon: 106.8451 },
  { name: 'Batam', lat: 1.0456, lon: 104.0305 },
  { name: 'Hat Yai', lat: 7.0084, lon: 100.4767 },
];

export interface SmokeHeading {
  kind: 'modelled';
  /** Always "MODELLED". */
  label: 'MODELLED';
  /** Wind level, e.g. "925 hPa". */
  level: string;
  startTime: string;
  /** Hours the path ran (may be short of the request at the grid or data edge). */
  hours: number;
  endReason: Trajectory['endReason'];
  /** Bearing from the cluster to the path's end, degrees clockwise from north; null when it barely moves. */
  bearingDeg: number | null;
  /** "north-west" etc.; null when it barely moves. */
  compass: string | null;
  /** Straight-line distance from the cluster to the path's end, km. */
  distanceKm: number;
  /** First listed place the path comes within `nearKm` of (excluding places already that close at the start). */
  toward: { name: string; closestKm: number; hours: number } | null;
  points: readonly TrajectoryPoint[];
  sentence: string;
  caveat: string;
  windSource: string;
  windRetrievedAt: string;
  windDataMode: WindGrid['dataMode'];
}

const COMPASS16 = [
  'north',
  'north-north-east',
  'north-east',
  'east-north-east',
  'east',
  'east-south-east',
  'south-east',
  'south-south-east',
  'south',
  'south-south-west',
  'south-west',
  'west-south-west',
  'west',
  'west-north-west',
  'north-west',
  'north-north-west',
];
const COMPASS8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Plain compass words for a bearing (8 points: "north-west"). */
export function compassWords(deg: number, points: 8 | 16 = 8): string {
  const d = ((deg % 360) + 360) % 360;
  return points === 16 ? COMPASS16[Math.round(d / 22.5) % 16] : COMPASS8[Math.round(d / 45) % 8];
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Default start: the wind grid's retrieval time (floored to the hour), clamped so `hours` of wind remain. */
function defaultStart(grid: WindGrid, hours: number): string {
  const first = Date.parse(grid.times[0]);
  const last = Date.parse(grid.times[grid.times.length - 1]);
  const ret = Math.floor(Date.parse(grid.retrievedAt) / 3_600_000) * 3_600_000;
  const ms = Math.max(first, Math.min(Number.isFinite(ret) ? ret : first, last - hours * 3_600_000));
  return iso(ms);
}

/**
 * MODELLED smoke heading from a cluster: a forward trajectory through the wind grid (transport.ts, RK2,
 * no vertical motion, no dispersion). Null when the cluster is outside the wind grid or the grid has no
 * usable time. Illustrative only; not a dispersion model.
 */
export function smokeHeading(
  cluster: Pick<FireCluster, 'id' | 'name' | 'lat' | 'lon' | 'last24h'>,
  grid: WindGrid,
  opts: { startISO?: string; hours?: number; places?: readonly SmokePlace[]; nearKm?: number } = {},
): SmokeHeading | null {
  const hours = opts.hours ?? 24;
  if (!grid.times.length || hours <= 0) return null;
  const startISO = opts.startISO ?? defaultStart(grid, hours);
  const source: HotspotSource = {
    id: `fires:${cluster.id}`,
    watchId: 'fires',
    label: cluster.name,
    lat: cluster.lat,
    lon: cluster.lon,
    count: cluster.last24h.count,
    frpSum: cluster.last24h.frp,
  };
  const [traj] = computeTrajectories(grid, [source], startISO, hours, 30);
  if (!traj || traj.points.length < 2) return null;
  const pts = traj.points;
  const end = pts[pts.length - 1];
  const distanceKm = Math.round(haversineKm(cluster.lat, cluster.lon, end.lat, end.lon));
  const moved = distanceKm >= 30;
  const bearingDeg = moved ? Math.round(bearing(cluster.lat, cluster.lon, end.lat, end.lon)) : null;
  const compass = bearingDeg === null ? null : compassWords(bearingDeg);
  const nearKm = opts.nearKm ?? 75;
  let toward: SmokeHeading['toward'] = null;
  for (const place of opts.places ?? DEFAULT_SMOKE_PLACES) {
    const startKm = haversineKm(cluster.lat, cluster.lon, place.lat, place.lon);
    if (startKm <= nearKm) continue;
    const r = receptorAnalysis(pts, place, nearKm);
    // A real approach: at least an hour of travel and a path that ends up clearly closer than it started.
    if (!r.reaches || r.arrivalHours === null || r.arrivalHours < 1 || r.closestKm > startKm - 25) continue;
    if (!toward || r.arrivalHours < toward.hours) toward = { name: place.name, closestKm: r.closestKm, hours: Math.round(r.arrivalHours) };
  }
  const caveat = `MODELLED ${grid.level} wind (${grid.source}). ${TRANSPORT_CAVEAT}`;
  const ran = Math.round(traj.hours);
  let sentence: string;
  if (!moved) {
    sentence = `Modelled ${grid.level} winds are light here; smoke would stay near the source over ${ran} h.`;
  } else {
    const edge = traj.endReason === 'grid-edge' ? ` until it leaves the wind grid after ${ran} h` : ` (about ${distanceKm} km in ${ran} h)`;
    sentence = toward
      ? `Smoke from here is heading ${compass}, toward ${toward.name}: modelled ${grid.level} winds bring it within ${toward.closestKm} km after about ${toward.hours} h.`
      : `Smoke from here is heading ${compass}${edge}, by modelled ${grid.level} winds.`;
  }
  return {
    kind: 'modelled',
    label: 'MODELLED',
    level: grid.level,
    startTime: traj.points[0].time,
    hours: traj.hours,
    endReason: traj.endReason,
    bearingDeg,
    compass,
    distanceKm,
    toward,
    points: pts,
    sentence,
    caveat,
    windSource: grid.source,
    windRetrievedAt: grid.retrievedAt,
    windDataMode: grid.dataMode,
  };
}

// ---------------------------------------------------------------------------
// Sources (structurally compatible with the analyst SectionSource)

export interface FireSourceRef {
  label: string;
  url?: string;
  retrievedAt?: string | null;
  mode?: string;
  licence?: string;
}

/** Every source behind the fire figures, FIRMS files first, with the acknowledgement. */
export function fireSourceRefs(s: Pick<FireSnapshot, 'sources' | 'retrievedAt'>): FireSourceRef[] {
  const out: FireSourceRef[] = s.sources.map((src) => {
    const rows = src.sensor && isNum(src.rowsConfident) ? ` · ${formatCount(src.rowsConfident)} confident of ${formatCount(src.rowsRead ?? 0)} rows` : '';
    const lm = src.lastModified ? ` · file last modified ${formatFireTime(src.lastModified)}` : '';
    return {
      label: `${src.name}${rows}${lm}`,
      url: src.url,
      retrievedAt: src.retrievedAt ?? s.retrievedAt,
      mode: src.sensor ? 'SNAPSHOT · MEASURED' : 'REFERENCE',
      licence: src.licence,
    };
  });
  out.push(
    { label: `FIRMS acknowledgement: ${FIRMS_ACKNOWLEDGEMENT}`, url: FIRE_LINKS.firms },
    {
      label: 'Copernicus Atmosphere Monitoring Service: Fire Emissions Watch (emissions from CAMS GFAS; not used for figures here)',
      url: FIRE_LINKS.fireEmissionsWatch,
      mode: 'LINK',
    },
  );
  return out;
}
