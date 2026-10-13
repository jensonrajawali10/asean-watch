// Stated watch rules for ASEAN Watch. Owned by the real-data builder.
// They turn raw snapshot rows (data/real/*.json, written by scripts/refresh-data.mjs) into Observations,
// and they are the only place that sets `anomaly` and `anomalyReason`. Every rule is an illustrative
// workflow rule, not an official threshold. Pure and deterministic: no wall-clock time, no I/O, inputs
// are never mutated.
import type { HazardType, Incident, Observation, ReplayStep, SourceRef } from '../types';
import { parseUtcTimestamp } from './reviewRules';

// ---------------------------------------------------------------------------
// Rule thresholds (change them here; the rule text below follows)

export const RULE_DISCLAIMER = 'Illustrative watch rule, not an official threshold.';
/** Thermal (volcano): a FIRMS hotspot this close to the GVP summit point. */
export const THERMAL_RADIUS_KM = 5;
/** MODIS confidence (0 to 100) needed for a thermal anomaly. VIIRS needs "nominal" or "high". */
export const MODIS_MIN_CONFIDENCE = 50;
/** Thermal (haze box): confident detections from one sensor on one UTC day needed for an anomaly. */
export const HAZE_MIN_DETECTIONS_PER_DAY = 10;
/** Seismic: an earthquake this close to the summit point (haze watches use their box instead). */
export const SEISMIC_RADIUS_KM = 30;
/** Seismic: magnitude at or above this is an anomaly; smaller events are context. */
export const SEISMIC_MIN_MAGNITUDE = 3.0;

/** Plain-language rules, one per rule kind, for "Why this state?" and the brief. */
export const WATCH_RULE_TEXT = {
  thermalVolcano:
    `Thermal: NASA FIRMS hotspots within ${THERMAL_RADIUS_KM} km of the summit (Smithsonian GVP point) are grouped ` +
    `per satellite overpass. An overpass is an anomaly when at least one of its hotspots has VIIRS confidence ` +
    `nominal or high, or MODIS confidence ${MODIS_MIN_CONFIDENCE} or more. Overpasses with only low-confidence ` +
    `hotspots are shown but not flagged. ${RULE_DISCLAIMER}`,
  thermalHaze:
    `Thermal: NASA FIRMS hotspots inside the watch box are totalled per sensor per UTC day. A day is an anomaly ` +
    `when one sensor has ${HAZE_MIN_DETECTIONS_PER_DAY} or more hotspots at VIIRS confidence nominal or high ` +
    `(MODIS ${MODIS_MIN_CONFIDENCE} or more). ${RULE_DISCLAIMER}`,
  seismicVolcano:
    `Seismic: a USGS or BMKG earthquake within ${SEISMIC_RADIUS_KM} km of the summit is shown; magnitude ` +
    `${SEISMIC_MIN_MAGNITUDE.toFixed(1)} or more is an anomaly, smaller ones are context. USGS and BMKG reports of ` +
    `the same event are both shown, never merged. ${RULE_DISCLAIMER}`,
  seismicBox:
    `Seismic: a USGS or BMKG earthquake inside the watch box is shown; magnitude ` +
    `${SEISMIC_MIN_MAGNITUDE.toFixed(1)} or more is an anomaly, smaller ones are context. USGS and BMKG reports of ` +
    `the same event are both shown, never merged. ${RULE_DISCLAIMER}`,
} as const;

// ---------------------------------------------------------------------------
// Watch areas and raw snapshot rows

export type WatchArea =
  | { kind: 'summit' }
  | { kind: 'bbox'; minLat: number; maxLat: number; minLon: number; maxLon: number };

/** A watch area from data/watches.json. Incident-shaped, so the UI can treat it as an incident. */
export interface Watch extends Incident {
  /** Short stable key used as the prefix of observation ids, e.g. "merapi". */
  key: string;
  /** "summit": the incident lat/lon is the Smithsonian GVP summit point. "bbox": a haze box. */
  area: WatchArea;
  /** Official and independent pages to consult (link-outs; never fetched by the app). */
  references: SourceRef[];
}

/** One NASA FIRMS CSV row, as kept by scripts/refresh-data.mjs. */
export interface FirmsRow {
  /** Which FIRMS file it came from: "viirs-snpp", "viirs-noaa20", "viirs-noaa21" or "modis". */
  file: string;
  latitude: number;
  longitude: number;
  /** UTC date, "2026-10-09". */
  acq_date: string;
  /** UTC time HHMM, "1812". */
  acq_time: string;
  /** N (Suomi NPP), N20 (NOAA-20), N21 (NOAA-21), T (Terra), A (Aqua). */
  satellite: string;
  /** VIIRS: "low", "nominal", "high" (or l/n/h). MODIS: 0 to 100. */
  confidence: string | number;
  version: string;
  /** Fire radiative power, MW. */
  frp: number;
  daynight: string;
  bright_ti4?: number | null;
  brightness?: number | null;
}

/** One earthquake report from one product, as kept by scripts/refresh-data.mjs. */
export interface QuakeRow {
  source: 'usgs' | 'bmkg';
  /** "fdsn-event" (USGS), "gempaterkini", "gempadirasakan" or "live30event" (BMKG). */
  product: string;
  eventId: string | null;
  /** ISO 8601 UTC origin time. */
  time: string;
  lat: number;
  lon: number;
  depthKm: number | null;
  mag: number;
  magType: string | null;
  place: string;
  url: string | null;
  status: string | null;
  updated?: string | null;
  felt?: string | null;
}

/** What a rule needs from the snapshot metadata. */
export interface RuleContext {
  window: { start: string; end: string };
  /** Number of UTC days in the window (replay steps). */
  dayCount: number;
  /** ingestedAt per snapshot source id (e.g. "firms-viirs-noaa20", "usgs-fdsn", "bmkg-live30event"). */
  ingestedAt: Readonly<Record<string, string>>;
  /** Fallback ingestedAt: when the snapshot was retrieved. */
  retrievedAt: string;
}

/**
 * One FIRMS hotspot inside a grouped thermal record (a volcano overpass or a haze daily total).
 * Kept beside the Observation, never inside it, so the inspector can list the hotspots.
 */
export interface HotspotMember {
  /** Stable id of the single hotspot: watch key + sensor + time + coordinates. */
  id: string;
  /** ISO 8601 UTC acquisition time. */
  observedAt: string;
  latitude: number;
  longitude: number;
  /** Distance to the GVP summit point; null for haze-box hotspots. */
  distanceKm: number | null;
  /** Fire radiative power, MW. */
  frp: number;
  /** FIRMS confidence as given: "low" / "nominal" / "high" (VIIRS) or 0 to 100 (MODIS). */
  confidence: string | number;
  /** e.g. "VIIRS confidence nominal", "MODIS confidence 62". */
  confidenceLabel: string;
  /** True when this hotspot meets the confidence part of the watch rule. */
  meetsRule: boolean;
  /** "D" or "N" as given by FIRMS. */
  daynight: string;
  /** Brightness temperature in kelvin: VIIRS I4 (bright_ti4) or MODIS (brightness); null if absent. */
  brightnessK: number | null;
  /** FIRMS satellite code, e.g. "N20". */
  satellite: string;
  /** FIRMS version, e.g. "2.0NRT". */
  version: string;
  sourceName: string;
}

export interface RuleOutput {
  observations: Observation[];
  /** Hotspots of each grouped thermal record, keyed by observation id. Empty for seismic. */
  members: Record<string, HotspotMember[]>;
  /** Raw rows that could not be read, with the reason, for the data-check notice. */
  problems: { index: number; message: string }[];
}

// ---------------------------------------------------------------------------
// Helpers

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Great-circle distance in km (mean Earth radius 6371.0088 km). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function km(n: number): string {
  return n < 10 ? `${round(n, 1)} km` : `${Math.round(n)} km`;
}

function mw(n: number): string {
  return `${round(n, 2)} MW`;
}

function coordKey(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(5)}${lat < 0 ? 'S' : 'N'}-${Math.abs(lon).toFixed(5)}${lon < 0 ? 'W' : 'E'}`;
}

/** "2026-10-07" -> "7 Oct". */
export function dayLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

/** acq_date "2026-10-09" + acq_time "1812" (HHMM UTC, leading zeros optional) -> "2026-10-09T18:12:00Z", or null. */
export function firmsObservedAt(acqDate: string, acqTime: string): string | null {
  if (typeof acqDate !== 'string' || typeof acqTime !== 'string') return null;
  const time = acqTime.trim().padStart(4, '0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acqDate) || !/^\d{4}$/.test(time)) return null;
  const iso = `${acqDate}T${time.slice(0, 2)}:${time.slice(2)}:00Z`;
  return parseUtcTimestamp(iso) === null ? null : iso;
}

/** Index of the UTC day of `observedAt` counted from the UTC day of `windowStart` (0 = first day), or null. */
export function utcDayIndex(observedAt: string, windowStart: string): number | null {
  const t = parseUtcTimestamp(observedAt);
  const s = parseUtcTimestamp(windowStart);
  if (t === null || s === null) return null;
  return Math.floor((t - (s - (s % DAY_MS))) / DAY_MS);
}

/**
 * One replay step per UTC day of the window, oldest first. Each clock is the end of that day
 * (23:59:59Z), except the last, which is the snapshot time (window end).
 */
export function buildReplayDays(window: { start: string; end: string }): ReplayStep[] {
  const s = parseUtcTimestamp(window?.start);
  const e = parseUtcTimestamp(window?.end);
  if (s === null || e === null || e < s) return [];
  const firstDay = s - (s % DAY_MS);
  const count = Math.floor((e - firstDay) / DAY_MS) + 1;
  const steps: ReplayStep[] = [];
  for (let i = 0; i < count; i += 1) {
    const dayStart = firstDay + i * DAY_MS;
    const isLast = i === count - 1;
    const date = isoSeconds(dayStart).slice(0, 10);
    const endText = isoSeconds(e).slice(11, 16);
    steps.push({
      index: i,
      label: dayLabel(date),
      description: isLast
        ? `Real records observed on ${dayLabel(date)} ${date.slice(0, 4)} (UTC) up to the snapshot at ${endText} UTC. The day is incomplete.`
        : `Real records observed on ${dayLabel(date)} ${date.slice(0, 4)}, 00:00 to 23:59 UTC.`,
      clock: isLast ? isoSeconds(e) : isoSeconds(dayStart + DAY_MS - 1000),
    });
  }
  return steps;
}

/** Rule context from the snapshot metadata. ingestedAt = each source's Last-Modified header, else retrievedAt. */
export function ruleContext(meta: {
  retrievedAt: string;
  window: { start: string; end: string };
  sources: { id: string; lastModified: string | null }[];
}): RuleContext {
  const ingestedAt: Record<string, string> = {};
  for (const s of meta.sources) {
    ingestedAt[s.id] = s.lastModified && parseUtcTimestamp(s.lastModified) !== null ? s.lastModified : meta.retrievedAt;
  }
  return {
    window: { start: meta.window.start, end: meta.window.end },
    dayCount: buildReplayDays(meta.window).length,
    ingestedAt,
    retrievedAt: meta.retrievedAt,
  };
}

/** Replay step of a record, or null when it falls outside the snapshot window. */
function stepFor(observedAt: string, ctx: RuleContext): number | null {
  const t = parseUtcTimestamp(observedAt);
  const end = parseUtcTimestamp(ctx.window.end);
  const day = utcDayIndex(observedAt, ctx.window.start);
  if (t === null || end === null || day === null || t > end || day < 0 || day >= ctx.dayCount) return null;
  return day;
}

function ingestedFor(ctx: RuleContext, sourceId: string): string {
  return ctx.ingestedAt[sourceId] ?? ctx.retrievedAt;
}

// ---------------------------------------------------------------------------
// FIRMS sensors and confidence

export interface FirmsSensor {
  /** Short id part, e.g. "n20". */
  short: string;
  instrument: 'VIIRS' | 'MODIS';
  platform: string;
  sourceName: string;
  sourceUrl: string;
  /** Approximate pixel size at nadir, for the quality note. */
  pixel: string;
}

const VIIRS_URL = 'https://www.earthdata.nasa.gov/data/instruments/viirs/viirs-i-band-375-m-active-fire-data';
const MODIS_URL = 'https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs';

const SENSORS: Record<string, Omit<FirmsSensor, 'sourceName' | 'sourceUrl' | 'pixel'>> = {
  N: { short: 'snpp', instrument: 'VIIRS', platform: 'Suomi NPP' },
  N20: { short: 'n20', instrument: 'VIIRS', platform: 'NOAA-20' },
  N21: { short: 'n21', instrument: 'VIIRS', platform: 'NOAA-21' },
  T: { short: 'terra', instrument: 'MODIS', platform: 'Terra' },
  A: { short: 'aqua', instrument: 'MODIS', platform: 'Aqua' },
};

/** Sensor for a FIRMS row from its satellite code, or null for an unknown code. */
export function firmsSensor(row: Pick<FirmsRow, 'satellite'>): FirmsSensor | null {
  const s = SENSORS[String(row.satellite ?? '').trim()];
  if (!s) return null;
  const viirs = s.instrument === 'VIIRS';
  return {
    ...s,
    sourceName: viirs ? `NASA FIRMS VIIRS 375 m NRT (${s.platform})` : `NASA FIRMS MODIS 1 km NRT (${s.platform})`,
    sourceUrl: viirs ? VIIRS_URL : MODIS_URL,
    pixel: viirs ? 'about 375 m' : 'about 1 km',
  };
}

export interface ConfidenceVerdict {
  /** True for VIIRS nominal/high or MODIS >= MODIS_MIN_CONFIDENCE. */
  passes: boolean;
  /** e.g. "VIIRS confidence nominal", "MODIS confidence 62". */
  label: string;
  /** Why it does not pass, or null when it passes. */
  shortfall: string | null;
}

const VIIRS_CLASSES: Record<string, 'low' | 'nominal' | 'high'> = {
  l: 'low',
  low: 'low',
  n: 'nominal',
  nominal: 'nominal',
  h: 'high',
  high: 'high',
};

/** Confidence verdict for a FIRMS row, or null when the value cannot be read. */
export function firmsConfidence(row: Pick<FirmsRow, 'satellite' | 'confidence'>): ConfidenceVerdict | null {
  const sensor = firmsSensor(row);
  if (!sensor) return null;
  if (sensor.instrument === 'VIIRS') {
    const cls = VIIRS_CLASSES[String(row.confidence ?? '').trim().toLowerCase()];
    if (!cls) return null;
    const passes = cls !== 'low';
    return {
      passes,
      label: `VIIRS confidence ${cls}`,
      shortfall: passes ? null : 'the watch rule needs VIIRS confidence nominal or high',
    };
  }
  const n = typeof row.confidence === 'number' ? row.confidence : Number(String(row.confidence ?? '').trim());
  if (!Number.isFinite(n) || n < 0 || n > 100 || String(row.confidence).trim() === '') return null;
  const passes = n >= MODIS_MIN_CONFIDENCE;
  return {
    passes,
    label: `MODIS confidence ${n}`,
    shortfall: passes ? null : `the watch rule needs MODIS confidence ${MODIS_MIN_CONFIDENCE} or more`,
  };
}

function firmsProblem(row: FirmsRow): string | null {
  if (!row || typeof row !== 'object') return 'not a record';
  if (!firmsSensor(row)) return `unknown FIRMS satellite code ${JSON.stringify(row.satellite)}`;
  if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return 'latitude or longitude is not a number';
  if (!Number.isFinite(row.frp)) return 'frp is not a number';
  if (firmsObservedAt(row.acq_date, row.acq_time) === null) return `acq_date/acq_time ${JSON.stringify(`${row.acq_date} ${row.acq_time}`)} is not a valid UTC time`;
  if (!firmsConfidence(row)) return `confidence ${JSON.stringify(row.confidence)} is not a FIRMS confidence value`;
  return null;
}

function dayNightWord(dn: string): string {
  return dn === 'D' ? 'Daytime' : dn === 'N' ? 'Night-time' : 'Satellite';
}

function thermalCaveats(volcano: boolean): string[] {
  return [
    volcano
      ? 'A hotspot near a volcano can also be a vegetation fire or other hot ground, so it needs contextual review.'
      : 'A hotspot can be a vegetation or peat fire, a gas flare or other hot ground, so it needs contextual review.',
    'Near-real-time (NRT) data are preliminary and can change.',
  ];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function compareMembers(a: HotspotMember, b: HotspotMember): number {
  if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? -1 : 1;
  const da = a.distanceKm ?? 0;
  const db = b.distanceKm ?? 0;
  if (da !== db) return da - db;
  if (a.frp !== b.frp) return b.frp - a.frp;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The single-hotspot record kept beside a grouped Observation. */
function hotspotMember(watch: Watch, row: FirmsRow, observedAt: string, distanceKm: number | null): HotspotMember {
  const sensor = firmsSensor(row) as FirmsSensor;
  const conf = firmsConfidence(row) as ConfidenceVerdict;
  const time = row.acq_time.trim().padStart(4, '0');
  const bright = row.bright_ti4 ?? row.brightness ?? null;
  return {
    id: `${watch.key}-firms-${sensor.short}-${row.acq_date.replace(/-/g, '')}T${time}Z-${coordKey(row.latitude, row.longitude)}`,
    observedAt,
    latitude: row.latitude,
    longitude: row.longitude,
    distanceKm: distanceKm === null ? null : round(distanceKm, 2),
    frp: row.frp,
    confidence: row.confidence,
    confidenceLabel: conf.label,
    meetsRule: conf.passes,
    daynight: row.daynight,
    brightnessK: typeof bright === 'number' && Number.isFinite(bright) ? bright : null,
    satellite: row.satellite,
    version: row.version,
    sourceName: sensor.sourceName,
  };
}

/** "nominal" or "2 nominal, 1 low" (VIIRS); "62" or "62, 23" (MODIS). */
function confidenceSummary(sensor: FirmsSensor, members: HotspotMember[]): string {
  if (sensor.instrument === 'MODIS') return members.map((m) => String(m.confidence)).join(', ');
  const counts = new Map<string, number>();
  for (const m of members) {
    const cls = m.confidenceLabel.replace('VIIRS confidence ', '');
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  const order = ['high', 'nominal', 'low'].filter((c) => counts.has(c));
  if (members.length === 1) return order[0];
  return order.map((c) => `${counts.get(c)} ${c}`).join(', ');
}

// ---------------------------------------------------------------------------
// Thermal rule: volcano summit, one record per satellite overpass

/**
 * One Observation per satellite overpass (sensor + acquisition date and time) with FIRMS hotspots
 * within THERMAL_RADIUS_KM of the summit, inside the window. value = the highest FRP in the overpass.
 * The overpass is an anomaly when at least one hotspot meets the confidence rule.
 */
export function volcanoThermalObservations(watch: Watch, rows: readonly FirmsRow[], ctx: RuleContext): RuleOutput {
  const problems: RuleOutput['problems'] = [];
  interface Pass {
    sensor: FirmsSensor;
    file: string;
    date: string;
    time: string;
    observedAt: string;
    step: number;
    members: HotspotMember[];
  }
  const passes = new Map<string, Pass>();
  rows.forEach((row, index) => {
    const problem = firmsProblem(row);
    if (problem) {
      problems.push({ index, message: problem });
      return;
    }
    const distance = haversineKm(watch.lat, watch.lon, row.latitude, row.longitude);
    if (distance > THERMAL_RADIUS_KM) return;
    const observedAt = firmsObservedAt(row.acq_date, row.acq_time) as string;
    const step = stepFor(observedAt, ctx);
    if (step === null) return;
    const sensor = firmsSensor(row) as FirmsSensor;
    const time = row.acq_time.trim().padStart(4, '0');
    const key = `${sensor.short}|${row.acq_date}|${time}`;
    let pass = passes.get(key);
    if (!pass) {
      pass = { sensor, file: row.file, date: row.acq_date, time, observedAt, step, members: [] };
      passes.set(key, pass);
    }
    pass.members.push(hotspotMember(watch, row, observedAt, distance));
  });

  const observations: Observation[] = [];
  const members: Record<string, HotspotMember[]> = {};
  for (const p of passes.values()) {
    const list = [...p.members].sort(compareMembers);
    const qualifying = list.filter((m) => m.meetsRule);
    const n = list.length;
    const maxFrp = Math.max(...list.map((m) => m.frp));
    const sumFrp = list.reduce((sum, m) => sum + m.frp, 0);
    const distances = list.map((m) => m.distanceKm as number);
    const nearest = Math.min(...distances);
    const farthest = Math.max(...distances);
    const anomaly = qualifying.length > 0;
    const { sensor } = p;
    const pass = `${sensor.platform} ${sensor.instrument} overpass`;
    const versions = [...new Set(list.map((m) => m.version || 'not given'))].join(', ');
    const id = `${watch.key}-firms-${sensor.short}-${p.date.replace(/-/g, '')}T${p.time}Z`;
    const ruleWords =
      sensor.instrument === 'VIIRS' ? 'VIIRS confidence nominal or high' : `MODIS confidence ${MODIS_MIN_CONFIDENCE} or more`;

    const base =
      `${dayNightWord(list[0].daynight)} ${pass}: ${plural(n, 'hotspot', 'hotspots')} ` +
      `${n === 1 ? km(nearest) : `${km(nearest)} to ${km(farthest)}`} from the summit, ` +
      (n === 1 ? `fire radiative power ${mw(maxFrp)}` : `max fire radiative power ${mw(maxFrp)}, summed ${mw(sumFrp)}`) +
      `; ${sensor.instrument} confidence ${confidenceSummary(sensor, list)}.`;

    members[id] = list;
    observations.push({
      id,
      incidentId: watch.id,
      observedAt: p.observedAt,
      ingestedAt: ingestedFor(ctx, `firms-${p.file}`),
      category: 'thermal',
      value: maxFrp,
      unit: 'MW',
      sourceName: sensor.sourceName,
      sourceUrl: sensor.sourceUrl,
      dataMode: 'historical',
      qualityNote: [
        `One record per satellite overpass: ${plural(n, 'FIRMS hotspot', 'FIRMS hotspots')} within ${THERMAL_RADIUS_KM} km at the same acquisition time; the value is the highest fire radiative power, and each hotspot is kept as a member of this record.`,
        `FIRMS ${sensor.instrument} confidence as given: ${confidenceSummary(sensor, list)} (FIRMS version ${versions}).`,
        ...thermalCaveats(true),
        'Cloud and thick smoke hide hotspots, so a day without detections is not evidence of no heat.',
        `Fire radiative power from one overpass is approximate; pixel size ${sensor.pixel} at nadir, larger toward the swath edge.`,
      ].join(' '),
      summary: anomaly ? base : `${base} Not flagged: no hotspot in this overpass has ${ruleWords}.`,
      anomaly,
      anomalyReason: anomaly
        ? `${qualifying.length} of ${plural(n, 'FIRMS hotspot', 'FIRMS hotspots')} in this ${pass} met the rule ` +
          `(within ${THERMAL_RADIUS_KM} km of the summit with VIIRS confidence nominal or high, or MODIS ` +
          `${MODIS_MIN_CONFIDENCE} or more); the nearest is ${km(qualifying[0].distanceKm as number)} from the summit. ` +
          RULE_DISCLAIMER
        : null,
      replayStep: p.step,
    });
  }
  return { observations, members, problems };
}

// ---------------------------------------------------------------------------
// Thermal rule: haze box, one total per sensor per UTC day

function insideBox(area: Extract<WatchArea, { kind: 'bbox' }>, lat: number, lon: number): boolean {
  return lat >= area.minLat && lat <= area.maxLat && lon >= area.minLon && lon <= area.maxLon;
}

/** One Observation per sensor per UTC day with any FIRMS hotspot inside the box. */
export function hazeThermalObservations(watch: Watch, rows: readonly FirmsRow[], ctx: RuleContext): RuleOutput {
  const problems: RuleOutput['problems'] = [];
  const area = watch.area;
  if (area.kind !== 'bbox') return { observations: [], members: {}, problems };

  interface Group {
    sensor: FirmsSensor;
    file: string;
    date: string;
    step: number;
    members: HotspotMember[];
  }
  const groups = new Map<string, Group>();
  rows.forEach((row, index) => {
    const problem = firmsProblem(row);
    if (problem) {
      problems.push({ index, message: problem });
      return;
    }
    if (!insideBox(area, row.latitude, row.longitude)) return;
    const observedAt = firmsObservedAt(row.acq_date, row.acq_time) as string;
    const step = stepFor(observedAt, ctx);
    if (step === null) return;
    const sensor = firmsSensor(row) as FirmsSensor;
    const key = `${sensor.short}|${row.acq_date}`;
    let g = groups.get(key);
    if (!g) {
      g = { sensor, file: row.file, date: row.acq_date, step, members: [] };
      groups.set(key, g);
    }
    g.members.push(hotspotMember(watch, row, observedAt, null));
  });

  const observations: Observation[] = [];
  const members: Record<string, HotspotMember[]> = {};
  for (const g of groups.values()) {
    const list = [...g.members].sort(compareMembers);
    const confident = list.filter((m) => m.meetsRule);
    const low = list.length - confident.length;
    const count = confident.length;
    const frpSum = confident.reduce((sum, m) => sum + m.frp, 0);
    const anomaly = count >= HAZE_MIN_DETECTIONS_PER_DAY;
    const times = [...new Set(list.map((m) => m.observedAt.slice(11, 16)))].sort();
    const lastObservedAt = list[list.length - 1].observedAt;
    const versions = [...new Set(list.map((m) => m.version || 'not given'))].join(', ');
    const sensorText = `${g.sensor.platform} ${g.sensor.instrument}`;
    const confidentWords = g.sensor.instrument === 'VIIRS' ? 'nominal- or high-confidence' : `confidence ${MODIS_MIN_CONFIDENCE}+`;
    const lowText = low > 0 ? `; ${plural(low, 'low-confidence hotspot', 'low-confidence hotspots')} not counted` : '';
    const base =
      `${sensorText}: ${count} ${confidentWords} ${count === 1 ? 'hotspot' : 'hotspots'} in the watch box on ` +
      `${dayLabel(g.date)} (UTC), summed fire radiative power ${mw(frpSum)}${lowText}. ` +
      `Detection ${times.length === 1 ? 'time' : 'times'} (UTC): ${times.join(', ')}.`;
    const id = `${watch.key}-firms-${g.sensor.short}-${g.date.replace(/-/g, '')}`;
    members[id] = list;
    observations.push({
      id,
      incidentId: watch.id,
      observedAt: lastObservedAt,
      ingestedAt: ingestedFor(ctx, `firms-${g.file}`),
      category: 'thermal',
      value: count,
      unit: 'detections',
      sourceName: g.sensor.sourceName,
      sourceUrl: g.sensor.sourceUrl,
      dataMode: 'historical',
      qualityNote: [
        `Daily total for one sensor; the observed time is the last detection that day, and each hotspot is kept as a member of this record (FIRMS version ${versions}).`,
        'Each satellite is totalled separately, so one fire seen by two satellites is in both totals.',
        ...thermalCaveats(false),
        'Cloud and thick smoke hide hotspots, so counts are a lower bound and days with different cloud cover are not comparable.',
      ].join(' '),
      summary: anomaly ? base : `${base} Not flagged: below the watch rule of ${HAZE_MIN_DETECTIONS_PER_DAY} per sensor per UTC day.`,
      anomaly,
      anomalyReason: anomaly
        ? `${count} ${confidentWords} FIRMS hotspots from one sensor (${sensorText}) inside the watch box on this ` +
          `UTC day (rule: ${HAZE_MIN_DETECTIONS_PER_DAY} or more). ${RULE_DISCLAIMER}`
        : null,
      replayStep: g.step,
    });
  }
  return { observations, members, problems };
}

// ---------------------------------------------------------------------------
// Seismic rule

const BMKG_PRODUCTS: Record<string, { name: string; url: string }> = {
  gempaterkini: { name: 'BMKG gempaterkini (latest earthquakes M 5.0+)', url: 'https://data.bmkg.go.id/gempabumi/' },
  gempadirasakan: { name: 'BMKG gempadirasakan (latest felt earthquakes)', url: 'https://data.bmkg.go.id/gempabumi/' },
  live30event: { name: 'BMKG InaTEWS live30event (latest located earthquakes)', url: 'https://inatews.bmkg.go.id/' },
};

function quakeProblem(q: QuakeRow): string | null {
  if (!q || typeof q !== 'object') return 'not a record';
  if (q.source !== 'usgs' && q.source !== 'bmkg') return `unknown earthquake source ${JSON.stringify(q.source)}`;
  if (q.source === 'bmkg' && !BMKG_PRODUCTS[q.product]) return `unknown BMKG product ${JSON.stringify(q.product)}`;
  if (q.source === 'usgs' && !q.eventId) return 'USGS row has no event id';
  if (parseUtcTimestamp(q.time) === null) return `time ${JSON.stringify(q.time)} is not an ISO 8601 UTC timestamp`;
  if (!Number.isFinite(q.lat) || !Number.isFinite(q.lon)) return 'lat or lon is not a number';
  if (!Number.isFinite(q.mag)) return 'mag is not a number';
  return null;
}

function slug(text: string): string {
  return text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Earthquakes within SEISMIC_RADIUS_KM of the summit, or inside a haze box. USGS and BMKG kept apart. */
export function seismicObservations(watch: Watch, quakes: readonly QuakeRow[], ctx: RuleContext): RuleOutput {
  const observations: Observation[] = [];
  const problems: RuleOutput['problems'] = [];
  const area = watch.area;
  quakes.forEach((q, index) => {
    const problem = quakeProblem(q);
    if (problem) {
      problems.push({ index, message: problem });
      return;
    }
    const distance = haversineKm(watch.lat, watch.lon, q.lat, q.lon);
    const inside = area.kind === 'bbox' ? insideBox(area, q.lat, q.lon) : distance <= SEISMIC_RADIUS_KM;
    if (!inside) return;
    const observedAt = isoSeconds(parseUtcTimestamp(q.time) as number);
    const step = stepFor(observedAt, ctx);
    if (step === null) return;

    const usgs = q.source === 'usgs';
    const magType = usgs && q.magType ? q.magType : null;
    const magText = `M ${round(q.mag, 1).toFixed(1)}${magType ? ` (${magType})` : ''}`;
    const where = area.kind === 'bbox' ? 'inside the watch box' : `${km(distance)} from the summit`;
    const depth = q.depthKm !== null && Number.isFinite(q.depthKm) ? `, depth ${Math.round(q.depthKm)} km` : '';
    const anomaly = q.mag >= SEISMIC_MIN_MAGNITUDE;
    const product = usgs ? null : BMKG_PRODUCTS[q.product];
    const sourceName = usgs
      ? `USGS earthquake catalog (ComCat), magnitude type ${magType ?? 'not given'}`
      : `${product?.name}, magnitude type not stated`;
    const who = usgs ? `USGS${q.status ? `, status ${q.status}` : ''}` : `BMKG ${q.product}; sumber data: BMKG`;
    const base = `Earthquake ${magText} ${where}${depth}: ${q.place || 'location text not given'} (${who}).`;
    const rule =
      area.kind === 'bbox'
        ? `inside the watch box and M ${SEISMIC_MIN_MAGNITUDE.toFixed(1)} or more`
        : `within ${SEISMIC_RADIUS_KM} km and M ${SEISMIC_MIN_MAGNITUDE.toFixed(1)} or more`;

    observations.push({
      id: usgs
        ? `${watch.key}-usgs-${slug(q.eventId as string)}`
        : q.eventId
          ? `${watch.key}-bmkg-${q.product}-${slug(q.eventId)}`
          : `${watch.key}-bmkg-${q.product}-${observedAt.replace(/[-:]/g, '')}-${coordKey(q.lat, q.lon)}`,
      incidentId: watch.id,
      observedAt,
      ingestedAt: ingestedFor(ctx, usgs ? 'usgs-fdsn' : `bmkg-${q.product}`),
      category: 'seismic',
      value: q.mag,
      unit: magType ? `M (${magType})` : 'M (type not stated)',
      sourceName,
      sourceUrl: usgs ? (q.url ?? `https://earthquake.usgs.gov/earthquakes/eventpage/${q.eventId}`) : (product?.url as string),
      dataMode: 'historical',
      qualityNote: [
        usgs
          ? `USGS location and magnitude; USGS can revise them${q.updated ? ` (last updated ${q.updated})` : ''}.`
          : `BMKG ${q.product} value. BMKG products can give different magnitudes for the same event, and the magnitude type is not stated.`,
        'The same event may also be reported by the other agency with a different magnitude; both are shown, never merged or averaged.',
        'An earthquake near a volcano is not necessarily volcanic.',
      ].join(' '),
      summary: anomaly ? base : `${base} Context only: below the M ${SEISMIC_MIN_MAGNITUDE.toFixed(1)} watch rule.`,
      anomaly,
      anomalyReason: anomaly
        ? `Earthquake ${magText}, ${usgs ? 'USGS' : `BMKG ${q.product}`}, ${where} (rule: ${rule}). ${RULE_DISCLAIMER}`
        : null,
      replayStep: step,
    });
  });
  return { observations, members: {}, problems };
}

// ---------------------------------------------------------------------------
// Per watch

/** Plain words for a watch area, e.g. for the detail panel and the brief. */
export function describeWatchArea(watch: Pick<Watch, 'area' | 'lat' | 'lon'>): string {
  const a = watch.area;
  if (a.kind === 'bbox') {
    return `Box: latitude ${a.minLat} to ${a.maxLat}, longitude ${a.minLon} to ${a.maxLon}`;
  }
  return (
    `Within ${THERMAL_RADIUS_KM} km (hotspots) and ${SEISMIC_RADIUS_KM} km (earthquakes) of the Smithsonian GVP ` +
    `summit point, latitude ${watch.lat}, longitude ${watch.lon}`
  );
}

/** The rule texts that apply to a watch, thermal first. */
export function rulesForWatch(watch: Pick<Watch, 'area'>): string[] {
  return watch.area.kind === 'bbox'
    ? [WATCH_RULE_TEXT.thermalHaze, WATCH_RULE_TEXT.seismicBox]
    : [WATCH_RULE_TEXT.thermalVolcano, WATCH_RULE_TEXT.seismicVolcano];
}

/**
 * Every observation for one watch, oldest first (then by id), the hotspot members of each grouped
 * thermal record (keyed by observation id), and unreadable rows per input file.
 */
export function observationsForWatch(
  watch: Watch,
  snapshot: { firms: readonly FirmsRow[]; quakes: readonly QuakeRow[] },
  ctx: RuleContext,
): {
  observations: Observation[];
  members: Record<string, HotspotMember[]>;
  firmsProblems: RuleOutput['problems'];
  quakeProblems: RuleOutput['problems'];
} {
  const thermal =
    watch.area.kind === 'bbox'
      ? hazeThermalObservations(watch, snapshot.firms, ctx)
      : volcanoThermalObservations(watch, snapshot.firms, ctx);
  const seismic = seismicObservations(watch, snapshot.quakes, ctx);
  const observations = [...thermal.observations, ...seismic.observations].sort((a, b) =>
    a.observedAt !== b.observedAt ? (a.observedAt < b.observedAt ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return { observations, members: thermal.members, firmsProblems: thermal.problems, quakeProblems: seismic.problems };
}

/** True when a raw value is a usable watch area. */
export function isWatchArea(value: unknown): value is WatchArea {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  if (a.kind === 'summit') return true;
  if (a.kind !== 'bbox') return false;
  const [minLat, maxLat, minLon, maxLon] = [a.minLat, a.maxLat, a.minLon, a.maxLon];
  return (
    [minLat, maxLat, minLon, maxLon].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (minLat as number) < (maxLat as number) &&
    (minLon as number) < (maxLon as number)
  );
}

/** Hazards a watch can have. */
export const WATCH_HAZARDS: readonly HazardType[] = ['volcano', 'wildfire', 'flood'];
