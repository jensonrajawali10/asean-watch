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
    `Thermal: a NASA FIRMS hotspot within ${THERMAL_RADIUS_KM} km of the summit (Smithsonian GVP point) ` +
    `with VIIRS confidence nominal or high, or MODIS confidence ${MODIS_MIN_CONFIDENCE} or more, is an anomaly. ` +
    `Low-confidence hotspots are shown but not flagged. ${RULE_DISCLAIMER}`,
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

export interface RuleOutput {
  observations: Observation[];
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

function firmsQualityNote(sensor: FirmsSensor, row: FirmsRow, conf: ConfidenceVerdict, volcano: boolean): string {
  return [
    `FIRMS ${conf.label} (FIRMS version ${row.version || 'not given'}).`,
    volcano
      ? 'A hotspot near a volcano can also be a vegetation fire or other hot ground, so it needs contextual review.'
      : 'A hotspot can be a vegetation or peat fire, a gas flare or other hot ground, so it needs contextual review.',
    'Near-real-time (NRT) data are preliminary and can change.',
    'Cloud and thick smoke hide hotspots, so a day without detections is not evidence of no heat.',
    `Fire radiative power from one overpass is approximate; pixel size ${sensor.pixel} at nadir, larger toward the swath edge.`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Thermal rule: volcano summit

/** One Observation per FIRMS hotspot within THERMAL_RADIUS_KM of the summit, inside the window. */
export function volcanoThermalObservations(watch: Watch, rows: readonly FirmsRow[], ctx: RuleContext): RuleOutput {
  const observations: Observation[] = [];
  const problems: RuleOutput['problems'] = [];
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
    const conf = firmsConfidence(row) as ConfidenceVerdict;
    const time = row.acq_time.trim().padStart(4, '0');

    const base =
      `${dayNightWord(row.daynight)} ${sensor.instrument} hotspot (${sensor.platform}) ${km(distance)} from the summit, ` +
      `fire radiative power ${mw(row.frp)}, ${conf.label.replace(`${sensor.instrument} `, '')}.`;
    observations.push({
      id: `${watch.key}-firms-${sensor.short}-${row.acq_date.replace(/-/g, '')}T${time}Z-${coordKey(row.latitude, row.longitude)}`,
      incidentId: watch.id,
      observedAt,
      ingestedAt: ingestedFor(ctx, `firms-${row.file}`),
      category: 'thermal',
      value: row.frp,
      unit: 'MW',
      sourceName: sensor.sourceName,
      sourceUrl: sensor.sourceUrl,
      dataMode: 'historical',
      qualityNote: firmsQualityNote(sensor, row, conf, true),
      summary: conf.passes ? base : `${base} Not flagged: ${conf.shortfall}.`,
      anomaly: conf.passes,
      anomalyReason: conf.passes
        ? `FIRMS hotspot ${km(distance)} from the summit (rule: within ${THERMAL_RADIUS_KM} km) with ${conf.label} ` +
          `(rule: VIIRS nominal or high, MODIS ${MODIS_MIN_CONFIDENCE} or more). ${RULE_DISCLAIMER}`
        : null,
      replayStep: step,
    });
  });
  return { observations, problems };
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
  if (area.kind !== 'bbox') return { observations: [], problems };

  interface Group {
    sensor: FirmsSensor;
    file: string;
    date: string;
    step: number;
    confident: FirmsRow[];
    low: FirmsRow[];
    times: Set<string>;
    lastObservedAt: string;
    versions: Set<string>;
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
      g = { sensor, file: row.file, date: row.acq_date, step, confident: [], low: [], times: new Set(), lastObservedAt: observedAt, versions: new Set() };
      groups.set(key, g);
    }
    ((firmsConfidence(row) as ConfidenceVerdict).passes ? g.confident : g.low).push(row);
    g.times.add(observedAt.slice(11, 16));
    g.versions.add(row.version || 'not given');
    if (observedAt > g.lastObservedAt) g.lastObservedAt = observedAt;
  });

  const observations: Observation[] = [];
  for (const g of groups.values()) {
    const count = g.confident.length;
    const frpSum = g.confident.reduce((sum, r) => sum + r.frp, 0);
    const anomaly = count >= HAZE_MIN_DETECTIONS_PER_DAY;
    const times = [...g.times].sort();
    const sensorText = `${g.sensor.platform} ${g.sensor.instrument}`;
    const confidentWords = g.sensor.instrument === 'VIIRS' ? 'nominal- or high-confidence' : `confidence ${MODIS_MIN_CONFIDENCE}+`;
    const lowText =
      g.low.length > 0 ? `; ${g.low.length} low-confidence ${g.low.length === 1 ? 'hotspot' : 'hotspots'} not counted` : '';
    const base =
      `${sensorText}: ${count} ${confidentWords} ${count === 1 ? 'hotspot' : 'hotspots'} in the watch box on ` +
      `${dayLabel(g.date)} (UTC), summed fire radiative power ${mw(frpSum)}${lowText}. ` +
      `Detection ${times.length === 1 ? 'time' : 'times'} (UTC): ${times.join(', ')}.`;
    observations.push({
      id: `${watch.key}-firms-${g.sensor.short}-${g.date.replace(/-/g, '')}`,
      incidentId: watch.id,
      observedAt: g.lastObservedAt,
      ingestedAt: ingestedFor(ctx, `firms-${g.file}`),
      category: 'thermal',
      value: count,
      unit: 'detections',
      sourceName: g.sensor.sourceName,
      sourceUrl: g.sensor.sourceUrl,
      dataMode: 'historical',
      qualityNote: [
        `Daily total for one sensor; the observed time is the last detection that day (FIRMS version ${[...g.versions].join(', ')}).`,
        'Each satellite is totalled separately, so one fire seen by two satellites is in both totals.',
        'A hotspot can be a vegetation or peat fire, a gas flare or other hot ground, so it needs contextual review.',
        'Cloud and thick smoke hide hotspots, so counts are a lower bound and days with different cloud cover are not comparable.',
        'Near-real-time (NRT) data are preliminary and can change.',
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
  return { observations, problems };
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
  return { observations, problems };
}

// ---------------------------------------------------------------------------
// Per watch

/** The rule texts that apply to a watch, thermal first. */
export function rulesForWatch(watch: Pick<Watch, 'area'>): string[] {
  return watch.area.kind === 'bbox'
    ? [WATCH_RULE_TEXT.thermalHaze, WATCH_RULE_TEXT.seismicBox]
    : [WATCH_RULE_TEXT.thermalVolcano, WATCH_RULE_TEXT.seismicVolcano];
}

/** Every observation for one watch, oldest first (then by id). Problems are reported per input file. */
export function observationsForWatch(
  watch: Watch,
  snapshot: { firms: readonly FirmsRow[]; quakes: readonly QuakeRow[] },
  ctx: RuleContext,
): { observations: Observation[]; firmsProblems: RuleOutput['problems']; quakeProblems: RuleOutput['problems'] } {
  const thermal =
    watch.area.kind === 'bbox'
      ? hazeThermalObservations(watch, snapshot.firms, ctx)
      : volcanoThermalObservations(watch, snapshot.firms, ctx);
  const seismic = seismicObservations(watch, snapshot.quakes, ctx);
  const observations = [...thermal.observations, ...seismic.observations].sort((a, b) =>
    a.observedAt !== b.observedAt ? (a.observedAt < b.observedAt ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return { observations, firmsProblems: thermal.problems, quakeProblems: seismic.problems };
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
