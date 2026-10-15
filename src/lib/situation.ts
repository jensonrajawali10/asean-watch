// Situation report and headline for the analyst workspace (docs/UX_V3.md sections 2 and 3). Pure and
// deterministic: no wall-clock reads, no I/O. Every "now" is the data's own anchor (the model run's
// retrieval or capture time, floored to the 3-hourly scrubber step, exactly as useHazeHour does), and ages
// are computed only when the caller passes `nowMs`.
//
// Contract (docs/CONTRACT.md): real data only; MODELLED, MEASURED and OFFICIAL kept apart and labelled;
// official text relayed verbatim; absence is never an all-clear; every figure carries its source and time.
// We never give health advice of our own: the text points to the national agency instead.
import type {
  ConnectorStatus,
  NeaContext,
  OfficialWarning,
  QuakeEvent,
  RiverDischargeSeries,
  WarningFeedStatus,
  WarningHazard,
} from '../types';
import {
  PM25_BANDS_NOTE,
  WHO_PM25_24H_UGM3,
  aqRange,
  forecastAnchorMs,
  forecastSteps,
  pm25Band,
  placePm25At,
} from './airQuality';
import type { AirQualityData, AqPlaceSeries, Pm25Band } from './airQuality';
import { ASH_LEVELS, ashDriftTracks, bearingDeg, compass16, distanceKm } from './ashDrift';
import type { AshWindData } from './ashDrift';
import { localTimeLabel, placeRef } from './places';
import { REACH_KM, SINGAPORE, TRANSPORT_CAVEAT, computeTrajectories, sampleWind } from './transport';
import type { HotspotSource, Trajectory } from './transport';
import type { FireRollup, FireSnapshot } from './fires';
import { compareWarnings } from './warnings';
import type { WindGrid } from './windField';

// ---------------------------------------------------------------------------
// Constants

export const SITUATION_DISCLAIMER =
  'Not an official warning service; follow the issuing agency. ASEAN Watch relays official messages verbatim and adds ' +
  'modelled and measured context; for any decision, follow the issuing agency and your national authorities.';

export const ASMC = {
  name: 'ASEAN Specialised Meteorological Centre (ASMC)',
  home: 'https://asmc.asean.org/home/',
  alerts: 'https://asmc.asean.org/asmc-alerts/',
  hotspots: 'https://asmc.asean.org/asmc-hotspot/',
  hotspotsDaily: 'https://asmc.asean.org/asmc-haze-hotspot-daily/',
  hazeReview: 'https://asmc.asean.org/category/haze-review/',
  satellite: 'https://asmc.asean.org/satellite-polar/',
  wis2Haze: 'https://wis2.asmc.asean.org/regional-haze-situation/',
  terms: 'https://asmc.asean.org/terms-of-use/',
  /** Links above returned HTTP 200 when checked; ASMC is linked to, never ingested (see asmcNote). */
  checkedAt: '2026-10-15',
} as const;

export const NUS_CRISP = {
  name: 'Centre for Remote Imaging, Sensing and Processing (CRISP), National University of Singapore',
  url: 'https://crisp.nus.edu.sg/',
} as const;

export const FIRMS_PAGE = 'https://www.earthdata.nasa.gov/data/tools/firms';

/** Hours of the haze forecast window the workspace reports on. */
export const HAZE_PAST_H = 24;
export const HAZE_FUTURE_H = 48;
const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Input

/**
 * Optional regional fire summary (a teammate's src/lib/fires.ts). Kept minimal: every field is optional
 * except the source and time, so whatever the fire module computes can be mapped onto it.
 */
export interface FiresSummary {
  /** e.g. "NASA FIRMS VIIRS 375 m NRT (Suomi NPP, NOAA-20, NOAA-21)". */
  source: string;
  sourceUrl?: string | null;
  /** ISO 8601 UTC time of the newest file or the retrieval. */
  asOf: string | null;
  dataMode?: 'live' | 'historical' | null;
  /** Detections in the last 24 h over the region covered. */
  hotspots24h?: number | null;
  /** Detections in the 24 h before that (for a change line). */
  hotspotsPrev24h?: number | null;
  hotspots7d?: number | null;
  /** Summed fire radiative power over the last 24 h, MW. */
  frpSum24hMW?: number | null;
  /** Regions (countries or provinces), largest first. */
  regions?: ReadonlyArray<{ name: string; hotspots24h: number; hotspots7d?: number | null; frpSum24hMW?: number | null }>;
  /** Clusters with a position: used as extra smoke-transport sources. */
  clusters?: ReadonlyArray<{ id: string; label: string; lat: number; lon: number; hotspots: number; frpSumMW?: number | null }>;
  /** Region the counts cover, e.g. "South East Asia". */
  coverage?: string | null;
  notes?: readonly string[];
}

/**
 * Map the fires module's parsed snapshot (loadFireSnapshot() in src/lib/fires.ts) onto FiresSummary. Regions do
 * not overlap: provinces and states where the snapshot has them (Indonesia, Malaysia), the country otherwise.
 * The 24 h clusters become extra smoke-transport sources. A type-only import: no snapshot is bundled from here.
 */
export function firesSummaryFromSnapshot(
  s: Pick<FireSnapshot, 'retrievedAt' | 'reference' | 'latestDetection' | 'laggingSensors' | 'totals' | 'countries' | 'regions' | 'clusters24h'>,
  opts?: { dataMode?: 'live' | 'historical'; maxRegions?: number; maxClusters?: number },
): FiresSummary {
  const withRegions = new Set(s.regions.map((r) => r.iso3));
  const parts: FireRollup[] = [
    ...s.regions,
    ...s.countries.filter((c) => c.kind === 'country' && !withRegions.has(c.iso3)),
  ].filter((r) => r.last7d.count > 0);
  parts.sort((a, b) => b.last24h.count - a.last24h.count || b.last7d.count - a.last7d.count || (a.key < b.key ? -1 : 1));
  const notes = [
    'Counts are confident detections from every sensor and pass, so one fire seen by several satellites is counted several times; summed FRP is for comparing places and days, not a physical total.',
  ];
  if (s.laggingSensors.length > 0) notes.push(`Some sensors' files lag behind the others (${s.laggingSensors.join(', ')}), so the latest 24 h may be incomplete.`);
  return {
    source: 'NASA FIRMS VIIRS and MODIS, near real time',
    sourceUrl: FIRMS_PAGE,
    asOf: s.reference,
    dataMode: opts?.dataMode ?? 'historical',
    hotspots24h: s.totals.last24h.count,
    hotspotsPrev24h: s.totals.prev24h.count,
    hotspots7d: s.totals.last7d.count,
    frpSum24hMW: s.totals.last24h.frp,
    regions: parts.slice(0, opts?.maxRegions ?? 12).map((r) => ({
      name: r.kind === 'region' ? `${r.name} (${r.country})` : r.name,
      hotspots24h: r.last24h.count,
      hotspots7d: r.last7d.count,
      frpSum24hMW: r.last24h.frp,
    })),
    clusters: s.clusters24h.slice(0, opts?.maxClusters ?? 8).map((c) => ({
      id: c.id,
      label: c.name,
      lat: c.lat,
      lon: c.lon,
      hotspots: c.last24h.count,
      frpSumMW: c.last24h.frp,
    })),
    coverage: "FIRMS' South East Asia region",
    notes,
  };
}

/** The FIRMS snapshot behind the watch areas (FIXTURES.snapshot fits this shape). */
export interface HotspotSnapshotInfo {
  retrievedAt: string;
  satelliteAsOf?: string | null;
  sources?: ReadonlyArray<{
    id: string;
    name: string;
    provider?: string;
    url?: string;
    productUrl?: string;
    retrievedAt?: string;
    lastModified?: string | null;
    licence?: string;
    attribution?: string;
  }>;
  attributions?: readonly string[];
}

export interface SituationInput {
  /** CAMS PM2.5 via Open-Meteo (live or snapshot); null when not loaded. */
  airQuality: AirQualityData | null;
  /** 10 m wind grid (App's windResult?.grid): the level the map's haze paths use. */
  wind10m?: WindGrid | null;
  /** 925 hPa wind grid (App's wind925): the smoke-transport level the particles show. */
  wind925?: WindGrid | null;
  /** Fire clusters for the trajectories, e.g. hazeSourcesFromFixtures(FIXTURES). */
  hazeSources?: readonly HotspotSource[] | null;
  /** FIXTURES.snapshot: when the FIRMS clusters above were captured. */
  hotspotSnapshot?: HotspotSnapshotInfo | null;
  /** Start time for the trajectories (e.g. App's transport.time, so the table matches the map). */
  transportStartISO?: string | null;
  nea?: NeaContext | null;
  /** neaResult.error from loadNeaContext. */
  neaError?: string | null;
  /** Every relayed official message (App's allWarnings, PTWC included). */
  warnings?: readonly OfficialWarning[] | null;
  /** Every official feed's status (App's allFeeds). */
  warningFeeds?: readonly WarningFeedStatus[] | null;
  fires?: FiresSummary | null;
  ashWind?: AshWindData | null;
  /** App's riverFlow (FloodModelResult fits). */
  riverFlow?: { series: readonly RiverDischargeSeries[]; status?: ConnectorStatus | null } | null;
  /** App's quakes (QuakesResult fits). */
  quakes?: { events: readonly QuakeEvent[]; statuses: readonly ConnectorStatus[] } | null;
  /** Wall-clock ms, only for "N h old" age notes. Omit for fully deterministic output. */
  nowMs?: number | null;
}

// ---------------------------------------------------------------------------
// Small formatting helpers (exported for the components and the export)

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2026-10-14 06:00 UTC"; the input unchanged when it is not a time. */
export function utcStamp(iso: string | null | undefined): string {
  if (!iso) return 'time not given';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** "Wed 14 Oct, 06:00 UTC". */
export function utcDayLabel(iso: string | null | undefined): string {
  if (!iso) return 'time not given';
  return localTimeLabel(iso, null);
}

/** PM2.5 value text: "<1", "9", "2,906". */
export function pmText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 0.5) return '<1';
  return Math.round(value).toLocaleString('en-US');
}

/** value / WHO 24-hour guideline, rounded like describePm25 (1 decimal under 10, whole above). */
export function whoMultiple(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  const r = value / WHO_PM25_24H_UGM3;
  return r >= 10 ? Math.round(r) : Math.round(r * 10) / 10;
}

export function whoMultipleText(value: number | null | undefined): string {
  const m = whoMultiple(value);
  return m === null ? '—' : `${m.toLocaleString('en-US')}×`;
}

const intText = (n: number) => Math.round(n).toLocaleString('en-US');

const WORDS8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** 8-point compass word for a bearing, e.g. "north-west". */
export function compassWord(deg: number): string {
  return WORDS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function hoursText(h: number): string {
  const r = Math.round(h);
  return `${r} h`;
}

function ageText(iso: string | null | undefined, nowMs: number | null | undefined): string | null {
  if (!iso || nowMs === null || nowMs === undefined || !Number.isFinite(nowMs)) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const h = (nowMs - ms) / HOUR_MS;
  if (h < -0.5) return null;
  if (h < 1) return 'under 1 h old';
  if (h < 48) return `about ${Math.round(h)} h old`;
  return `about ${Math.round(h / 24)} days old`;
}

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function plural(n: number, one: string, many: string): string {
  return `${intText(n)} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Model anchor and the city table

/** The model's "now": the 3-hourly step at (the floor of) the run's retrieval or capture time. */
export function modelAnchorISO(aq: AirQualityData | null): string | null {
  if (!aq || aq.times.length === 0) return null;
  const clock = Date.parse(aq.retrievedAt);
  if (!Number.isFinite(clock)) return null;
  const steps = forecastSteps(forecastAnchorMs(aq, clock), aqRange(aq));
  return steps.times[steps.nowIndex] ?? null;
}

export interface CityPeak {
  value: number;
  timeISO: string;
  /** "Thu 15 Oct, 2:00 pm local (06:00 UTC)", or the UTC label when the offset is unknown. */
  localLabel: string;
  /** "Thu 15 Oct, 2:00 pm local" (no UTC part). */
  shortLocal: string;
}

export interface CitySeriesPoint {
  timeISO: string;
  value: number;
  /** True after the anchor (forecast hours). */
  future: boolean;
}

export interface CityHazeRow {
  id: string;
  name: string;
  country: string;
  kind: 'city' | 'fire-area';
  lat: number;
  lon: number;
  /** MODELLED PM2.5 at the anchor, µg/m³. */
  now: number;
  nowBand: Pm25Band | null;
  /** Mean over the 24 h up to the anchor; null when the data do not cover them. */
  mean24hPast: number | null;
  /** mean24hPast / 15 (the WHO 24-hour guideline is a 24-hour mean, so this is the honest comparison). */
  whoMultiple24h: number | null;
  /** Mean over the next 24 h; null when the forecast does not cover them. */
  mean24hNext: number | null;
  /** Highest value from the anchor to +24 h and to +48 h (data hours; snapshot runs are 3-hourly). */
  peak24h: CityPeak;
  peak48h: CityPeak;
  peak48hBand: Pm25Band | null;
  /** Next-24 h mean against the past-24 h mean: ±20 % and at least 5 µg/m³. */
  trend: 'rising' | 'falling' | 'steady' | null;
  /** −24 h … +48 h at the data's own resolution. */
  series: CitySeriesPoint[];
}

export interface CityHazeTable {
  anchorISO: string;
  rows: CityHazeRow[];
  dataMode: 'live' | 'historical';
  retrievedAt: string;
  model: string;
  source: string;
  sourceUrl: string;
  attribution: string;
  /** Last data hour inside the +48 h window. */
  forecastEndISO: string;
  /** False when the run ends before anchor +48 h (peaks then cover less). */
  covers48h: boolean;
  /** False when the run starts after anchor −24 h (24 h means then unavailable). */
  covers24hPast: boolean;
  /** Hours between data points (1 live, 3 snapshot). */
  stepHours: number;
}

function peakOf(points: ReadonlyArray<{ ms: number; v: number; t: string }>, place: AqPlaceSeries): CityPeak {
  let best = points[0];
  for (const p of points.slice(1)) if (p.v > best.v) best = p;
  const ref = placeRef(place);
  return {
    value: best.v,
    timeISO: best.t,
    localLabel: localTimeLabel(best.t, ref),
    shortLocal: localTimeLabel(best.t, ref, { utc: false }),
  };
}

const mean = (xs: readonly number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Every AQ place with now, 24 h mean and WHO multiple, 24/48 h peaks with local times, trend and a 72 h series. */
export function cityHazeTable(aq: AirQualityData | null): CityHazeTable | null {
  const anchorISO = modelAnchorISO(aq);
  if (!aq || !anchorISO || aq.places.length === 0) return null;
  const a = Date.parse(anchorISO);
  const tMs = aq.times.map((t) => Date.parse(t));
  const first = tMs[0];
  const last = tMs[tMs.length - 1];
  const stepHours = tMs.length > 1 ? Math.round((tMs[1] - tMs[0]) / HOUR_MS) : 1;
  const covers24hPast = first <= a - HAZE_PAST_H * HOUR_MS + HOUR_MS;
  const covers48h = last >= a + HAZE_FUTURE_H * HOUR_MS - HOUR_MS;
  const inFuture = tMs.filter((ms) => ms > a && ms <= a + HAZE_FUTURE_H * HOUR_MS);
  const forecastEndISO = inFuture.length > 0 ? aq.times[tMs.indexOf(inFuture[inFuture.length - 1])] : anchorISO;

  const rows: CityHazeRow[] = aq.places.map((place) => {
    const now = placePm25At(aq, place, anchorISO);
    const pts = aq.times.map((t, k) => ({ ms: tMs[k], v: place.pm25[k], t }));
    const past = pts.filter((p) => p.ms >= a - HAZE_PAST_H * HOUR_MS && p.ms <= a);
    const next24 = pts.filter((p) => p.ms > a && p.ms <= a + 24 * HOUR_MS);
    const next48 = pts.filter((p) => p.ms > a && p.ms <= a + HAZE_FUTURE_H * HOUR_MS);
    const nowPoint = { ms: a, v: now, t: anchorISO };
    const mean24hPast = covers24hPast ? mean(past.map((p) => p.v)) : null;
    const covers24hNext = last >= a + 24 * HOUR_MS - HOUR_MS;
    const mean24hNext = covers24hNext ? mean(next24.map((p) => p.v)) : null;
    let trend: CityHazeRow['trend'] = null;
    if (mean24hPast !== null && mean24hNext !== null) {
      const diff = mean24hNext - mean24hPast;
      const rel = mean24hPast > 0 ? diff / mean24hPast : diff > 0 ? Infinity : 0;
      trend = Math.abs(diff) < 5 || Math.abs(rel) < 0.2 ? 'steady' : diff > 0 ? 'rising' : 'falling';
    }
    const peak48h = peakOf([nowPoint, ...next48], place);
    return {
      id: place.id,
      name: place.name,
      country: place.country,
      kind: place.kind,
      lat: place.lat,
      lon: place.lon,
      now,
      nowBand: pm25Band(now),
      mean24hPast,
      whoMultiple24h: whoMultiple(mean24hPast),
      mean24hNext,
      peak24h: peakOf([nowPoint, ...next24], place),
      peak48h,
      peak48hBand: pm25Band(peak48h.value),
      trend,
      series: pts
        .filter((p) => p.ms >= a - HAZE_PAST_H * HOUR_MS && p.ms <= a + HAZE_FUTURE_H * HOUR_MS)
        .map((p) => ({ timeISO: p.t, value: p.v, future: p.ms > a })),
    };
  });

  return {
    anchorISO,
    rows,
    dataMode: aq.dataMode,
    retrievedAt: aq.retrievedAt,
    model: aq.model,
    source: aq.source,
    sourceUrl: aq.sourceUrl,
    attribution: aq.attribution,
    forecastEndISO,
    covers48h,
    covers24hPast,
    stepHours,
  };
}

export type CitySortKey = 'now' | 'mean24h' | 'peak24h' | 'peak48h' | 'name';

/** Worst first for the numeric keys (ties keep the AQ_PLACES order); A to Z for name. */
export function sortCityRows(rows: readonly CityHazeRow[], key: CitySortKey): CityHazeRow[] {
  const value = (r: CityHazeRow): number => {
    if (key === 'now') return r.now;
    if (key === 'mean24h') return r.mean24hPast ?? -1;
    if (key === 'peak24h') return r.peak24h.value;
    return r.peak48h.value;
  };
  const indexed = rows.map((r, i) => ({ r, i }));
  indexed.sort((x, y) =>
    key === 'name' ? x.r.name.localeCompare(y.r.name, 'en') || x.i - y.i : value(y.r) - value(x.r) || x.i - y.i,
  );
  return indexed.map((x) => x.r);
}

// ---------------------------------------------------------------------------
// Wind and transport

export interface WindAtPoint {
  /** Direction the wind blows TOWARD, degrees clockwise from north. */
  towardDeg: number;
  speedMs: number;
  /** The grid time actually sampled (clamped into the grid's time range). */
  timeISO: string;
  level: string;
}

/** Modelled wind at a point (bilinear), clamped in time to the grid; null outside the grid area. */
export function windAt(grid: WindGrid | null | undefined, lat: number, lon: number, timeISO: string): WindAtPoint | null {
  if (!grid || grid.times.length === 0) return null;
  const ms = Date.parse(timeISO);
  const first = Date.parse(grid.times[0]);
  const last = Date.parse(grid.times[grid.times.length - 1]);
  const t = !Number.isFinite(ms) ? grid.times[0] : ms < first ? grid.times[0] : ms > last ? grid.times[grid.times.length - 1] : timeISO;
  const w = sampleWind(grid, lat, lon, t);
  if (!w || !Number.isFinite(w.u) || !Number.isFinite(w.v)) return null;
  const speedMs = Math.hypot(w.u, w.v);
  const towardDeg = ((((Math.atan2(w.u, w.v) * 180) / Math.PI) % 360) + 360) % 360;
  return { towardDeg, speedMs, timeISO: t, level: grid.level };
}

export interface TransportRow {
  sourceId: string;
  label: string;
  lat: number;
  lon: number;
  hotspots: number;
  frpSumMW: number;
  reaches: boolean;
  closestKm: number;
  hoursToClosest: number;
  arrivalHours: number | null;
  endReason: Trajectory['endReason'];
  /** Hours the path actually ran (less than 48 when it left the grid or the wind data). */
  hours: number;
  summary: string;
}

export interface TransportSummary {
  /** e.g. "10 m", "925 hPa". */
  level: string;
  startISO: string;
  dataMode: 'live' | 'historical';
  retrievedAt: string;
  source: string;
  sourceUrl: string;
  model: string;
  attribution: string;
  rows: TransportRow[];
  reachingCount: number;
  /** The reaching row with the earliest arrival, else the row that passes closest. */
  lead: TransportRow | null;
  sentence: string;
  caveats: string[];
}

/** Grid time nearest `ms` (ties to the earlier). */
function nearestGridTime(times: readonly string[], ms: number): string {
  let best = times[0];
  let bestD = Infinity;
  for (const t of times) {
    const d = Math.abs(Date.parse(t) - ms);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** Fire clusters from a fire summary as trajectory sources. */
export function fireClustersAsSources(fires: FiresSummary | null | undefined): HotspotSource[] {
  return (fires?.clusters ?? [])
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
    .map((c) => ({
      id: `fires:${c.id}`,
      watchId: 'fires',
      label: c.label,
      lat: c.lat,
      lon: c.lon,
      count: c.hotspots,
      frpSum: c.frpSumMW ?? 0,
    }));
}

export const TRANSPORT_CAVEATS: readonly string[] = [
  TRANSPORT_CAVEAT,
  'Each path follows the modelled wind at one level only, with no vertical motion, mixing, rain-out or chemistry.',
  `"Reaches Singapore" means the path passes within ${REACH_KM} km of it; it says where air could go, not how much smoke arrives.`,
  "For what is actually in Singapore's air, use NEA's measured PSI and PM2.5.",
];

/**
 * Forward 48 h trajectories from each source through one wind grid, checked against Singapore. Starts at
 * `startISO` when it lies inside the grid's times, else at the grid time nearest the grid's own retrieval
 * or capture time. Null without a grid or sources.
 */
export function singaporeTransport(
  grid: WindGrid | null | undefined,
  sources: readonly HotspotSource[] | null | undefined,
  opts?: { startISO?: string | null; sourcesNote?: string | null; hours?: number },
): TransportSummary | null {
  if (!grid || grid.times.length < 2 || !sources || sources.length === 0) return null;
  const first = Date.parse(grid.times[0]);
  const last = Date.parse(grid.times[grid.times.length - 1]);
  const wanted = opts?.startISO ? Date.parse(opts.startISO) : Number.NaN;
  const startISO =
    Number.isFinite(wanted) && wanted >= first && wanted < last
      ? new Date(wanted).toISOString().replace(/\.000Z$/, 'Z')
      : nearestGridTime(grid.times, Date.parse(grid.retrievedAt));
  const hours = opts?.hours ?? HAZE_FUTURE_H;
  let trajectories: Trajectory[];
  try {
    trajectories = computeTrajectories(grid, sources, startISO, hours, 30);
  } catch {
    return null;
  }
  const rows: TransportRow[] = trajectories.map((t) => ({
    sourceId: t.source.id,
    label: t.source.label,
    lat: t.source.lat,
    lon: t.source.lon,
    hotspots: t.source.count,
    frpSumMW: t.source.frpSum,
    reaches: t.receptor.reaches,
    closestKm: t.receptor.closestKm,
    hoursToClosest: t.receptor.hoursToClosest,
    arrivalHours: t.receptor.arrivalHours,
    endReason: t.endReason,
    hours: t.hours,
    summary: t.summary,
  }));
  rows.sort(
    (x, y) =>
      Number(y.reaches) - Number(x.reaches) ||
      (x.arrivalHours ?? Infinity) - (y.arrivalHours ?? Infinity) ||
      x.closestKm - y.closestKm ||
      (x.sourceId < y.sourceId ? -1 : 1),
  );
  const reaching = rows.filter((r) => r.reaches);
  const lead = rows[0] ?? null;
  const ranH = Math.max(0, ...rows.map((r) => r.hours));
  const allLabels = [...new Set(rows.map((r) => r.label))];
  const labels =
    allLabels.length > 3 ? [...allLabels.slice(0, 3), `${allLabels.length - 3} other cluster${allLabels.length - 3 === 1 ? '' : 's'}`] : allLabels;
  let sentence: string;
  if (!lead) {
    sentence = `No modelled ${grid.level} path could be computed. ${TRANSPORT_CAVEAT}`;
  } else if (reaching.length > 0) {
    sentence =
      `Modelled ${grid.level} winds carry air from ${lead.label} to within ${lead.closestKm} km of Singapore after ` +
      `about ${hoursText(lead.arrivalHours ?? lead.hoursToClosest)} (${plural(reaching.length, 'path', 'paths')} of ${rows.length} reach it; ` +
      `paths start ${utcDayLabel(startISO)}). ${TRANSPORT_CAVEAT}`;
  } else {
    const closest =
      lead.hoursToClosest < 1
        ? `the paths move away from Singapore, and the nearest point is a starting cluster ${lead.closestKm} km away`
        : `the closest passes ${lead.closestKm} km away after about ${hoursText(lead.hoursToClosest)}`;
    sentence =
      `None of the ${plural(rows.length, 'modelled path', 'modelled paths')} at ${grid.level} from ${joinList(labels)} reaches ` +
      `Singapore within ${hoursText(ranH)}; ${closest} (paths start ${utcDayLabel(startISO)}). ${TRANSPORT_CAVEAT}`;
  }
  const caveats = [...TRANSPORT_CAVEATS];
  if (opts?.sourcesNote) caveats.push(opts.sourcesNote);
  if (rows.some((r) => r.endReason !== 'complete')) {
    caveats.push('Some paths stop early because they leave the wind grid (6°S to 8°N, 95°E to 120°E) or run past the end of the wind data.');
  }
  return {
    level: grid.level,
    startISO,
    dataMode: grid.dataMode,
    retrievedAt: grid.retrievedAt,
    source: grid.source,
    sourceUrl: grid.sourceUrl,
    model: grid.model,
    attribution: grid.attribution,
    rows,
    reachingCount: reaching.length,
    lead,
    sentence,
    caveats,
  };
}

function transportSources(input: SituationInput): HotspotSource[] {
  return [...(input.hazeSources ?? []), ...fireClustersAsSources(input.fires)];
}

/** Where the trajectory start points come from, with their times (they show where fires were, not where they are now). */
function sourcesNote(input: SituationInput): string | null {
  const parts: string[] = [];
  if ((input.hazeSources?.length ?? 0) > 0) {
    const t = input.hotspotSnapshot?.satelliteAsOf ?? input.hotspotSnapshot?.retrievedAt ?? null;
    parts.push(`the watch-area FIRMS snapshot${t ? ` as of ${utcStamp(t)}` : ''}`);
  }
  if ((input.fires?.clusters?.length ?? 0) > 0) parts.push(`the regional fire summary (24 h to ${utcStamp(input.fires?.asOf ?? null)})`);
  if (parts.length === 0) return null;
  return `Fire clusters come from ${joinList(parts)}: they show where fires were, not where they are now.`;
}

/** Trajectory summaries at 925 hPa and 10 m (whichever grids are loaded), 925 hPa first. */
export function transportSummaries(input: SituationInput): TransportSummary[] {
  const sources = transportSources(input);
  const opts = { startISO: input.transportStartISO ?? null, sourcesNote: sourcesNote(input) };
  return [singaporeTransport(input.wind925, sources, opts), singaporeTransport(input.wind10m, sources, opts)].filter(
    (t): t is TransportSummary => t !== null,
  );
}

// ---------------------------------------------------------------------------
// Headline (map top-left)

export interface Headline {
  /** One or two plain sentences. */
  text: string;
  freshness: 'LIVE' | 'SNAPSHOT' | 'UNAVAILABLE';
  /** Model run retrieval or capture time behind the chip. */
  asOf: string | null;
  /** "LIVE · 14 Oct 07:19 UTC", "SNAPSHOT · 14 Oct 07:19 UTC", "NO MODEL DATA". */
  chip: string;
  /** The hour the sentence describes. */
  timeISO: string | null;
  worst: { id: string; name: string; pm25: number } | null;
}

export interface HeadlineOptions {
  /** The scrubber hour; defaults to the model anchor ("now"). */
  atISO?: string | null;
}

function chipTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

function worstAt(aq: AirQualityData, timeISO: string): { place: AqPlaceSeries; pm25: number } | null {
  let best: { place: AqPlaceSeries; pm25: number } | null = null;
  for (const place of aq.places) {
    const v = placePm25At(aq, place, timeISO);
    if (!Number.isFinite(v)) continue;
    if (!best || v > best.pm25) best = { place, pm25: v };
  }
  return best;
}

function shortPlaceName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '');
}

/** The full headline: sentence, freshness chip and the worst place. */
export function headline(input: SituationInput, opts: HeadlineOptions = {}): Headline {
  const aq = input.airQuality;
  const anchorISO = modelAnchorISO(aq);
  if (!aq || !anchorISO) {
    const fires = input.fires;
    const hasFireData = Boolean(fires) || (input.hazeSources?.length ?? 0) > 0;
    let text: string;
    if (fires && typeof fires.hotspots24h === 'number') {
      text =
        `Air-quality model unavailable; showing satellite fire data only: ${plural(fires.hotspots24h, 'hotspot', 'hotspots')} ` +
        `in the last 24 h (${fires.source}). This is not an all-clear.`;
    } else if (hasFireData) {
      text = 'Air-quality model unavailable; showing satellite fire data only. This is not an all-clear.';
    } else {
      text = 'Air-quality model and fire data are unavailable right now; this is not an all-clear. Check ASMC and your national air-quality agency.';
    }
    return { text, freshness: 'UNAVAILABLE', asOf: null, chip: 'NO MODEL DATA', timeISO: null, worst: null };
  }

  const atMs = opts.atISO ? Date.parse(opts.atISO) : Number.NaN;
  const timeISO = Number.isFinite(atMs) ? (opts.atISO as string) : anchorISO;
  const offsetH = Math.round((Date.parse(timeISO) - Date.parse(anchorISO)) / HOUR_MS);
  const snapshot = aq.dataMode === 'historical';
  const signed = offsetH < 0 ? `−${Math.abs(offsetH)} h` : `+${offsetH} h`;
  const when = snapshot
    ? `Snapshot run, ${utcDayLabel(timeISO)}`
    : offsetH === 0
      ? 'Now'
      : `${offsetH > 0 ? 'Forecast' : 'Model'} ${signed} (${utcDayLabel(timeISO)})`;
  const freshness = snapshot ? 'SNAPSHOT' : 'LIVE';
  const chip = `${freshness} · ${chipTime(aq.retrievedAt)}`;

  const worst = worstAt(aq, timeISO);
  if (!worst) {
    return {
      text: `${when}: the air-quality model returned no usable values. This is not an all-clear.`,
      freshness,
      asOf: aq.retrievedAt,
      chip,
      timeISO,
      worst: null,
    };
  }
  const name = shortPlaceName(worst.place.name);
  const value = pmText(worst.pm25);
  let first: string;
  if (worst.pm25 < WHO_PM25_24H_UGM3) {
    first = `${when}: modelled PM2.5 is low at all ${aq.places.length} tracked places; the highest is ${name} (${value} µg/m³, modelled).`;
  } else if (worst.pm25 < 35) {
    first = `${when}: modelled PM2.5 is highest over ${name} (${value} µg/m³, modelled).`;
  } else {
    first = `${when}: haze is worst over ${name} (${value} µg/m³, modelled).`;
  }

  // Second sentence: a modelled path reaching Singapore, else the low-level wind at the worst place.
  let second = '';
  const transport = offsetH === 0 ? transportSummaries(input) : [];
  const reaching = transport.find((t) => t.reachingCount > 0 && t.lead);
  if (reaching && reaching.lead) {
    second = ` Modelled low-level winds carry air from ${reaching.lead.label} to Singapore in about ${hoursText(reaching.lead.arrivalHours ?? reaching.lead.hoursToClosest)}.`;
  } else {
    const w = windAt(input.wind925 ?? input.wind10m, worst.place.lat, worst.place.lon, timeISO);
    if (w && w.speedMs < 1) {
      second = ' Low-level winds there are light (modelled).';
    } else if (w) {
      const toSg = bearingDeg(worst.place.lat, worst.place.lon, SINGAPORE.lat, SINGAPORE.lon);
      const diff = Math.abs(((w.towardDeg - toSg + 540) % 360) - 180);
      const farKm = distanceKm(worst.place.lat, worst.place.lon, SINGAPORE.lat, SINGAPORE.lon);
      const towardSg = worst.place.id !== 'singapore' && diff <= 22.5 && farKm > 50;
      second = towardSg
        ? ` Low-level winds there blow toward the ${compassWord(w.towardDeg)}, the direction of Singapore (modelled).`
        : ` Low-level winds there blow toward the ${compassWord(w.towardDeg)} (modelled).`;
    }
  }
  return {
    text: `${first}${second}`,
    freshness,
    asOf: aq.retrievedAt,
    chip,
    timeISO,
    worst: { id: worst.place.id, name: worst.place.name, pm25: worst.pm25 },
  };
}

/** One live sentence for the map's top-left (see headline() for the chip and the worst place). */
export function headlineSentence(input: SituationInput, opts: HeadlineOptions = {}): string {
  return headline(input, opts).text;
}

// ---------------------------------------------------------------------------
// Report model

export type Basis = 'MODELLED' | 'MEASURED' | 'OFFICIAL' | 'ESTIMATE';

export interface Citation {
  /** Stable id, e.g. "cams", "wind-925", "nea", "feed:magma-level-list". */
  id: string;
  label: string;
  url: string | null;
  basis: Basis;
  /** LIVE (fetched this session), SNAPSHOT (bundled, with its capture time), RECORDED, LINK (not ingested). */
  mode: 'LIVE' | 'SNAPSHOT' | 'RECORDED' | 'UNAVAILABLE' | 'LINK';
  time: string | null;
  timeKind: 'retrieved' | 'captured' | 'reading' | 'issued' | 'checked';
  licence: string | null;
}

export interface ReportFigure {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  basis: Basis;
  /** Citation id. */
  cite: string;
  /** ISO time the figure refers to. */
  time: string | null;
}

export type ReportBlock =
  | { kind: 'paragraph'; text: string; cites: readonly string[] }
  | { kind: 'bullets'; items: readonly string[]; cites: readonly string[]; official?: boolean }
  | {
      kind: 'table';
      caption: string;
      columns: readonly string[];
      /** true for right-aligned numeric columns. */
      numeric?: readonly boolean[];
      rows: ReadonlyArray<readonly string[]>;
      cites: readonly string[];
      official?: boolean;
    }
  | { kind: 'caveat'; text: string };

export type ReportSectionId = 'overview' | 'haze' | 'transport' | 'fires' | 'volcanoes' | 'warnings' | 'water' | 'freshness';

export interface ReportSection {
  id: ReportSectionId;
  title: string;
  basis: Basis | 'MIXED';
  /** One sentence: what this section says. */
  summary: string;
  figures: ReportFigure[];
  blocks: ReportBlock[];
}

export interface FreshnessLine {
  source: string;
  basis: Basis;
  mode: Citation['mode'];
  time: string | null;
  /** e.g. "captured 2026-10-14 07:19 UTC (about 30 h old)". */
  text: string;
}

export interface SituationReport {
  title: string;
  headline: Headline;
  /** The model's "now". */
  anchorISO: string | null;
  sections: ReportSection[];
  /** Change lines derivable from the data (same model run 24 h earlier, fire counts). */
  whatChanged: string[];
  /** Every source cited, in first-use order. */
  citations: Citation[];
  freshness: FreshnessLine[];
  gaps: string[];
  disclaimer: string;
  /** Figures for the overview grid (same objects as the overview section's). */
  keyFigures: ReportFigure[];
}

// ---------------------------------------------------------------------------
// Citation book

interface Book {
  add(c: Citation): string;
  list(): Citation[];
}

function citationBook(): Book {
  const map = new Map<string, Citation>();
  return {
    add(c) {
      if (!map.has(c.id)) map.set(c.id, c);
      return c.id;
    },
    list() {
      return [...map.values()];
    },
  };
}

function modeOf(dataMode: 'live' | 'historical' | null | undefined): Citation['mode'] {
  return dataMode === 'live' ? 'LIVE' : 'SNAPSHOT';
}

function feedMode(status: WarningFeedStatus['status'] | ConnectorStatus['status']): Citation['mode'] {
  if (status === 'live' || status === 'cached') return 'LIVE';
  if (status === 'snapshot') return 'SNAPSHOT';
  return 'UNAVAILABLE';
}

function camsCitation(aq: AirQualityData): Citation {
  return {
    id: 'cams',
    label: `${aq.model}, PM2.5, via ${aq.source}`,
    url: aq.sourceUrl,
    basis: 'MODELLED',
    mode: modeOf(aq.dataMode),
    time: aq.retrievedAt,
    timeKind: aq.dataMode === 'live' ? 'retrieved' : 'captured',
    licence: aq.attribution,
  };
}

function windCitation(grid: Pick<WindGrid, 'level' | 'source' | 'sourceUrl' | 'model' | 'dataMode' | 'retrievedAt' | 'attribution'>): Citation {
  const id = /925/.test(grid.level) ? 'wind-925' : 'wind-10m';
  return {
    id,
    label: `${grid.source}, wind at ${grid.level} (${grid.model})`,
    url: grid.sourceUrl,
    basis: 'MODELLED',
    mode: modeOf(grid.dataMode),
    time: grid.retrievedAt,
    timeKind: grid.dataMode === 'live' ? 'retrieved' : 'captured',
    licence: grid.attribution,
  };
}

function neaCitation(nea: NeaContext): Citation {
  const hazeMode = nea.haze?.dataMode ?? nea.dataMode;
  return {
    id: 'nea',
    label: `${nea.sourceName}: 24-hour PSI and 1-hour PM2.5 (NEA Singapore stations)`,
    url: nea.sourceUrl,
    basis: 'MEASURED',
    mode: modeOf(hazeMode),
    time: nea.haze?.observedAt ?? nea.observedAt,
    timeKind: 'reading',
    licence: nea.attribution,
  };
}

function firmsCitation(snap: HotspotSnapshotInfo): Citation {
  return {
    id: 'firms',
    label: 'NASA FIRMS active fire hotspots (VIIRS 375 m and MODIS 1 km NRT), bundled snapshot for the watch areas',
    url: FIRMS_PAGE,
    basis: 'MEASURED',
    mode: 'SNAPSHOT',
    time: snap.satelliteAsOf ?? snap.retrievedAt,
    timeKind: 'captured',
    licence: 'NASA open data; FIRMS acknowledgement requested (see Sources).',
  };
}

function firesCitation(f: FiresSummary): Citation {
  return {
    id: 'fires',
    label: f.source,
    url: f.sourceUrl ?? FIRMS_PAGE,
    basis: 'MEASURED',
    mode: f.dataMode === 'live' ? 'LIVE' : 'SNAPSHOT',
    time: f.asOf,
    timeKind: f.dataMode === 'live' ? 'retrieved' : 'captured',
    licence: 'NASA open data; FIRMS acknowledgement requested (see Sources).',
  };
}

function feedCitation(f: WarningFeedStatus): Citation {
  return {
    id: `feed:${f.feedId}`,
    label: `${f.issuer} (${f.feedId})`,
    url: f.issuerUrl,
    basis: f.feedId === 'gdacs' ? 'ESTIMATE' : 'OFFICIAL',
    mode: f.feedId === 'magma-level-list' && f.status !== 'unavailable' ? 'RECORDED' : feedMode(f.status),
    time: f.retrievedAt,
    timeKind: 'retrieved',
    licence: null,
  };
}

function asmcCitation(): Citation {
  return {
    id: 'asmc',
    label: `${ASMC.name}: regional haze situation and alert levels (linked, not ingested)`,
    url: ASMC.alerts,
    basis: 'OFFICIAL',
    mode: 'LINK',
    time: null,
    timeKind: 'checked',
    licence: 'ASMC terms of use: reproduction needs written permission from the Meteorological Service Singapore; linked only.',
  };
}

// ---------------------------------------------------------------------------
// Warnings helpers

const HAZARD_NAMES: Record<WarningHazard, string> = {
  tsunami: 'Tsunami',
  volcano: 'Volcano',
  earthquake: 'Earthquake',
  flood: 'Flood',
  haze: 'Haze',
  weather: 'Weather',
  other: 'Other',
};

export function hazardName(h: WarningHazard): string {
  return HAZARD_NAMES[h] ?? h;
}

/** Feed keywords per hazard, for issuers with more than one feed (JMA, BMKG). */
const HAZARD_FEED_HINT: Partial<Record<WarningHazard, RegExp>> = {
  tsunami: /tsunami|inatews/,
  volcano: /volcano|magma|val/,
  earthquake: /gempa|quake/,
  flood: /flood|thaiwater|dsda/,
};

/** The feed a message came from: same issuer, and the hazard's feed when the issuer has several. */
export function feedFor(w: OfficialWarning, feeds: readonly WarningFeedStatus[]): WarningFeedStatus | null {
  const same = feeds.filter((f) => f.issuer === w.issuer);
  if (same.length <= 1) return same[0] ?? null;
  const hint = HAZARD_FEED_HINT[w.hazard];
  return (hint ? same.find((f) => hint.test(f.feedId)) : undefined) ?? same[0];
}

/** Official (not aggregator) messages that are not ended or expired as relayed. */
export function activeOfficial(warnings: readonly OfficialWarning[] | null | undefined): OfficialWarning[] {
  return (warnings ?? []).filter((w) => w.authority === 'official' && !w.ended).sort(compareWarnings);
}

/** "LIVE" or "HISTORICAL" as the relay mode of one message. */
export function warningModeText(w: OfficialWarning): string {
  return w.dataMode === 'live' ? 'LIVE' : 'HISTORICAL';
}

/** Verbatim one-liner: issuer, level (with the fixed gloss), headline, issue time and mode. */
export function warningLine(w: OfficialWarning): string {
  const level = w.levelGloss ? `"${w.level}" [${w.levelGloss}]` : `"${w.level}"`;
  const when = w.issuedAt ? `issued ${utcStamp(w.issuedAt)}` : `no issue time published; retrieved ${utcStamp(w.retrievedAt)}`;
  const status = w.ended ? (w.expiresAt ? `; EXPIRED ${utcStamp(w.expiresAt)}` : '; ENDED by the issuer') : '';
  return `${w.issuer}: ${level}: "${w.headline}" (${when}; ${warningModeText(w)}${status})`;
}

// ---------------------------------------------------------------------------
// Report builder

export function situationReport(input: SituationInput): SituationReport {
  const book = citationBook();
  const aq = input.airQuality;
  const table = cityHazeTable(aq);
  const head = headline(input);
  const anchorISO = table?.anchorISO ?? null;
  const transports = transportSummaries(input);
  const gaps: string[] = [];
  const whatChanged: string[] = [];
  const cams = aq ? book.add(camsCitation(aq)) : null;

  // --- Haze --------------------------------------------------------------
  const hazeFigures: ReportFigure[] = [];
  const hazeBlocks: ReportBlock[] = [];
  let hazeSummary: string;
  const sgRow = table?.rows.find((r) => r.id === 'singapore') ?? null;
  /** A snapshot never says "now" (docs/CONTRACT.md): it is the snapshot hour. */
  const nowWord = table?.dataMode === 'live' ? 'now' : 'at the snapshot hour';
  const NowLabel = table?.dataMode === 'live' ? 'Now' : 'Snapshot hour';
  if (table && cams) {
    const byNow = sortCityRows(table.rows, 'now');
    const byPeak = sortCityRows(table.rows, 'peak48h');
    const worst = byNow[0];
    const peak = byPeak[0];
    const overWho = table.rows.filter((r) => (r.mean24hPast ?? -1) > WHO_PM25_24H_UGM3);
    const unhealthyNow = table.rows.filter((r) => r.now >= 55);
    const unhealthy48 = table.rows.filter((r) => r.peak48h.value >= 55);
    const veryUnhealthy48 = table.rows.filter((r) => r.peak48h.value >= 150);
    const runWord = table.dataMode === 'live' ? 'live model run' : 'bundled snapshot run';
    hazeSummary =
      `In the ${runWord} for ${utcDayLabel(table.anchorISO)}, modelled PM2.5 is highest over ${worst.name} ` +
      `(${pmText(worst.now)} µg/m³); over the next ${HAZE_FUTURE_H} h it peaks at ${pmText(peak.peak48h.value)} µg/m³ over ${peak.name}.`;
    hazeFigures.push(
      {
        label: `Highest modelled PM2.5 ${nowWord}`,
        value: pmText(worst.now),
        unit: 'µg/m³',
        note: `${worst.name}; ${worst.nowBand?.label ?? 'no band'}`,
        basis: 'MODELLED',
        cite: cams,
        time: table.anchorISO,
      },
      {
        label: `Highest in the next ${HAZE_FUTURE_H} h`,
        value: pmText(peak.peak48h.value),
        unit: 'µg/m³',
        note: `${peak.name}, ${peak.peak48h.shortLocal}`,
        basis: 'MODELLED',
        cite: cams,
        time: peak.peak48h.timeISO,
      },
      {
        label: 'Places over the WHO 24 h guideline',
        value: table.covers24hPast ? `${overWho.length} of ${table.rows.length}` : '—',
        note: table.covers24hPast ? `24 h mean above ${WHO_PM25_24H_UGM3} µg/m³` : 'run does not cover the past 24 h',
        basis: 'MODELLED',
        cite: cams,
        time: table.anchorISO,
      },
    );
    if (sgRow) {
      hazeFigures.push({
        label: `Singapore, modelled ${nowWord}`,
        value: pmText(sgRow.now),
        unit: 'µg/m³',
        note: sgRow.nowBand?.label ?? undefined,
        basis: 'MODELLED',
        cite: cams,
        time: table.anchorISO,
      });
    }
    hazeBlocks.push({
      kind: 'paragraph',
      text:
        `${NowLabel} (model hour ${utcStamp(table.anchorISO)}): the highest modelled values are ` +
        `${joinList(byNow.slice(0, 3).map((r) => `${r.name} ${pmText(r.now)} µg/m³ (${r.nowBand?.label ?? 'no band'})`))}. ` +
        `${plural(unhealthyNow.length, 'place is', 'places are')} at 55 µg/m³ or more (the "Unhealthy" concentration band or worse). ` +
        (table.covers24hPast
          ? `${plural(overWho.length, 'of the tracked places has', 'of the tracked places have')} a modelled 24-hour mean above the WHO 24-hour guideline of ${WHO_PM25_24H_UGM3} µg/m³.`
          : 'This run does not cover the past 24 h, so no 24-hour means are given.'),
      cites: [cams],
    });
    hazeBlocks.push({
      kind: 'paragraph',
      text:
        `Next ${HAZE_FUTURE_H} h (to ${utcStamp(table.forecastEndISO)}): the model's highest value is ${pmText(peak.peak48h.value)} µg/m³ over ` +
        `${peak.name} at ${peak.peak48h.localLabel}. ${plural(unhealthy48.length, 'place reaches', 'places reach')} 55 µg/m³ or more at some ` +
        `forecast hour, and ${plural(veryUnhealthy48.length, 'place reaches', 'places reach')} 150 µg/m³ or more.` +
        (table.covers48h ? '' : ` The run ends before +${HAZE_FUTURE_H} h, so later hours are not covered.`),
      cites: [cams],
    });
    hazeBlocks.push({
      kind: 'table',
      caption: `Worst places by modelled ${HAZE_FUTURE_H} h peak (CAMS PM2.5, µg/m³, MODELLED). Times are local with UTC.`,
      columns: ['Place', NowLabel, '24 h mean', '× WHO', `${HAZE_FUTURE_H} h peak`, 'Peak time', 'Band at peak'],
      numeric: [false, true, true, true, true, false, false],
      rows: byPeak.slice(0, 8).map((r) => [
        r.name,
        pmText(r.now),
        pmText(r.mean24hPast),
        whoMultipleText(r.mean24hPast),
        pmText(r.peak48h.value),
        r.peak48h.localLabel,
        r.peak48hBand?.label ?? '—',
      ]),
      cites: [cams],
    });
    if (table.dataMode === 'historical') {
      gaps.push(`The air-quality model values come from the bundled snapshot captured ${utcStamp(table.retrievedAt)}, not a current run.`);
    }
    // What changed: the same run, 24 h earlier.
    if (table.covers24hPast && aq) {
      const before = new Date(Date.parse(table.anchorISO) - 24 * HOUR_MS).toISOString().replace(/\.000Z$/, 'Z');
      const was = worstAt(aq, before);
      if (was) {
        whatChanged.push(
          `Highest modelled PM2.5: ${worst.name} ${pmText(worst.now)} µg/m³ ${nowWord}, against ${was.place.name} ${pmText(was.pm25)} µg/m³ ` +
            `24 h earlier (same model run; modelled, not measured).`,
        );
      }
      const unhealthyBefore = aq.places.filter((p) => placePm25At(aq, p, before) >= 55).length;
      if (unhealthyBefore !== unhealthyNow.length) {
        whatChanged.push(
          `Places at 55 µg/m³ or more (modelled): ${unhealthyNow.length} ${nowWord}, against ${unhealthyBefore} 24 h earlier.`,
        );
      }
      const sgPlace = aq.places.find((p) => p.id === 'singapore');
      if (sgPlace && sgRow) {
        whatChanged.push(
          `Singapore (modelled): ${pmText(sgRow.now)} µg/m³ ${nowWord}, against ${pmText(placePm25At(aq, sgPlace, before))} µg/m³ 24 h earlier.`,
        );
      }
    }
  } else {
    hazeSummary = 'The air-quality model is unavailable, so no modelled PM2.5 is reported. This is not an all-clear.';
    hazeBlocks.push({
      kind: 'paragraph',
      text: 'No CAMS PM2.5 run was loaded (neither live nor the bundled snapshot). Check ASMC and the national air-quality agencies directly.',
      cites: [book.add(asmcCitation())],
    });
    gaps.push('Air-quality model (CAMS PM2.5 via Open-Meteo) unavailable: no modelled haze figures in this report.');
  }

  // NEA Singapore: measured, beside the modelled value.
  const nea = input.nea ?? null;
  if (nea?.haze) {
    const neaId = book.add(neaCitation(nea));
    const psiMax = Math.max(...Object.values(nea.haze.psi24h));
    const pmVals = nea.haze.pm25OneHour ? Object.values(nea.haze.pm25OneHour) : [];
    hazeFigures.push({
      label: 'Singapore 24 h PSI (NEA, highest region)',
      value: intText(psiMax),
      note: `${nea.haze.psiBand} (NEA band); reading ${utcStamp(nea.haze.observedAt)}`,
      basis: 'MEASURED',
      cite: neaId,
      time: nea.haze.observedAt,
    });
    const regions = Object.entries(nea.haze.psi24h)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    const modelAtReading = aq && sgRow ? placePm25At(aq, aq.places.find((p) => p.id === 'singapore') as AqPlaceSeries, nea.haze.observedAt) : null;
    const hazeSnap = nea.haze.dataMode === 'historical';
    hazeBlocks.push({
      kind: 'paragraph',
      text:
        `Singapore, measured by NEA (${hazeSnap ? 'HISTORICAL SNAPSHOT' : 'LIVE'}, reading ${utcStamp(nea.haze.observedAt)}): 24-hour PSI by region ${regions}; ` +
        `NEA's band for the highest region is "${nea.haze.psiBand}".` +
        (pmVals.length > 0 ? ` 1-hour PM2.5 ranges from ${Math.min(...pmVals)} to ${Math.max(...pmVals)} µg/m³ across regions.` : '') +
        (modelAtReading !== null && Number.isFinite(modelAtReading)
          ? ` The model gives ${pmText(modelAtReading)} µg/m³ for Singapore at that hour (MODELLED); the two are different products and are not expected to match.`
          : '') +
        " For health advice, follow NEA's haze advisories.",
      cites: cams ? [neaId, cams] : [neaId],
    });
    if (hazeSnap) gaps.push(`NEA PSI and PM2.5 are from a saved reading (${utcStamp(nea.haze.observedAt)}), not live.`);
  } else {
    gaps.push(
      `NEA Singapore measured PSI/PM2.5 not available${input.neaError ? ` (${input.neaError})` : ''}: check https://www.haze.gov.sg/ directly.`,
    );
  }
  hazeBlocks.push({ kind: 'caveat', text: PM25_BANDS_NOTE });
  hazeBlocks.push({
    kind: 'caveat',
    text:
      `The regional haze alert level is issued by ASMC and is not ingested here; check ${ASMC.alerts} for the current level ` +
      'and the daily regional haze situation.',
  });
  book.add(asmcCitation());

  // --- Transport ---------------------------------------------------------
  const transportBlocks: ReportBlock[] = [];
  const transportFigures: ReportFigure[] = [];
  for (const t of transports) {
    const wid = book.add(windCitation(t));
    const fid = input.hotspotSnapshot ? book.add(firmsCitation(input.hotspotSnapshot)) : null;
    const cites = fid ? [wid, fid] : [wid];
    transportFigures.push({
      label: `Paths reaching Singapore (${t.level})`,
      value: `${t.reachingCount} of ${t.rows.length}`,
      note: t.lead ? (t.lead.reaches ? `first after ~${hoursText(t.lead.arrivalHours ?? 0)}` : `closest ${t.lead.closestKm} km`) : undefined,
      basis: 'MODELLED',
      cite: wid,
      time: t.startISO,
    });
    transportBlocks.push({ kind: 'paragraph', text: t.sentence, cites });
    transportBlocks.push({
      kind: 'table',
      caption: `Forward ${HAZE_FUTURE_H} h paths at ${t.level} from ${utcStamp(t.startISO)} (MODELLED, illustrative).`,
      columns: ['Fire cluster', 'Hotspots', 'FRP (MW)', 'Reaches Singapore', 'Closest (km)', 'After (h)'],
      numeric: [false, true, true, false, true, true],
      rows: t.rows.map((r) => [
        r.label.includes('°') ? r.label : `${r.label} (${Math.abs(r.lat).toFixed(2)}°${r.lat >= 0 ? 'N' : 'S'} ${r.lon.toFixed(2)}°E)`,
        intText(r.hotspots),
        intText(r.frpSumMW),
        r.reaches ? `yes, ~${hoursText(r.arrivalHours ?? r.hoursToClosest)}` : 'no',
        intText(r.closestKm),
        String(Math.round(r.hoursToClosest)),
      ]),
      cites,
    });
  }
  if (transports.length > 0) {
    for (const c of transports[0].caveats) transportBlocks.push({ kind: 'caveat', text: c });
  } else {
    transportBlocks.push({
      kind: 'paragraph',
      text:
        (input.wind10m || input.wind925) && transportSources(input).length === 0
          ? 'No fire clusters were available to start paths from, so no transport toward Singapore is computed.'
          : 'No modelled wind grid was loaded, so no transport toward Singapore is computed.',
      cites: [],
    });
    gaps.push('Smoke transport toward Singapore not computed (no wind grid or no fire clusters).');
  }
  const leadT = transports.find((t) => t.reachingCount > 0) ?? transports[0] ?? null;
  const transportSummary = leadT
    ? leadT.reachingCount > 0
      ? `At ${leadT.level}, ${plural(leadT.reachingCount, 'modelled path reaches', 'modelled paths reach')} Singapore within ${HAZE_FUTURE_H} h (illustrative).`
      : `No modelled path at ${transports.map((t) => t.level).join(' or ')} reaches Singapore within ${HAZE_FUTURE_H} h (illustrative).`
    : 'Smoke transport toward Singapore could not be computed.';

  // --- Fires -------------------------------------------------------------
  const fires = input.fires ?? null;
  const fireFigures: ReportFigure[] = [];
  const fireBlocks: ReportBlock[] = [];
  let fireSummary: string;
  if (fires) {
    const fid = book.add(firesCitation(fires));
    const cover = fires.coverage ? ` over ${fires.coverage}` : '';
    if (typeof fires.hotspots24h === 'number') {
      fireFigures.push({
        label: 'Hotspots, last 24 h',
        value: intText(fires.hotspots24h),
        note: typeof fires.frpSum24hMW === 'number' ? `${intText(fires.frpSum24hMW)} MW summed FRP` : undefined,
        basis: 'MEASURED',
        cite: fid,
        time: fires.asOf,
      });
    }
    if (typeof fires.hotspots7d === 'number') {
      fireFigures.push({ label: 'Hotspots, last 7 days', value: intText(fires.hotspots7d), basis: 'MEASURED', cite: fid, time: fires.asOf });
    }
    fireSummary =
      typeof fires.hotspots24h === 'number'
        ? `${plural(fires.hotspots24h, 'satellite hotspot was', 'satellite hotspots were')} detected${cover} in the 24 h to ${utcStamp(fires.asOf)} (${fires.source}).`
        : `Fire data from ${fires.source} (${utcStamp(fires.asOf)}).`;
    fireBlocks.push({ kind: 'paragraph', text: fireSummary, cites: [fid] });
    if (typeof fires.hotspots24h === 'number' && typeof fires.hotspotsPrev24h === 'number') {
      const line = `Hotspots in the last 24 h: ${intText(fires.hotspots24h)}, against ${intText(fires.hotspotsPrev24h)} in the 24 h before (${fires.source}).`;
      fireBlocks.push({ kind: 'paragraph', text: line, cites: [fid] });
      whatChanged.push(line);
    }
    if (fires.regions && fires.regions.length > 0) {
      fireBlocks.push({
        kind: 'table',
        caption: `Hotspots by region (${fires.source}, MEASURED by satellite; counts are lower bounds under cloud and smoke).`,
        columns: ['Region', '24 h', '7 days', 'FRP 24 h (MW)'],
        numeric: [false, true, true, true],
        rows: fires.regions.map((r) => [
          r.name,
          intText(r.hotspots24h),
          typeof r.hotspots7d === 'number' ? intText(r.hotspots7d) : '—',
          typeof r.frpSum24hMW === 'number' ? intText(r.frpSum24hMW) : '—',
        ]),
        cites: [fid],
      });
    }
    for (const n of fires.notes ?? []) fireBlocks.push({ kind: 'caveat', text: n });
  } else {
    fireSummary = 'No regional fire summary was supplied to this report.';
    const sources = input.hazeSources ?? [];
    if (sources.length > 0 && input.hotspotSnapshot) {
      const fid = book.add(firmsCitation(input.hotspotSnapshot));
      const total = sources.reduce((s, c) => s + c.count, 0);
      const labels = [...new Set(sources.map((s) => s.label))];
      fireSummary = `Only the watch-area FIRMS snapshot is loaded: ${plural(total, 'confident hotspot', 'confident hotspots')} in the largest clusters of ${joinList(labels)}.`;
      fireBlocks.push({
        kind: 'paragraph',
        text:
          `${fireSummary} These are the clusters used for the transport paths, from the NASA FIRMS snapshot as of ` +
          `${utcStamp(input.hotspotSnapshot.satelliteAsOf ?? input.hotspotSnapshot.retrievedAt)}; they cover the watch areas only, not the region.`,
        cites: [fid],
      });
    } else {
      fireBlocks.push({ kind: 'paragraph', text: fireSummary, cites: [] });
    }
    fireBlocks.push({
      kind: 'caveat',
      text: `For regional hotspot counts, see the Fires section, NASA FIRMS (${FIRMS_PAGE}) and ASMC's hotspot pages (${ASMC.hotspots}).`,
    });
    gaps.push('Regional fire summary not loaded: hotspot counts here cover the watch areas only.');
  }
  fireBlocks.push({
    kind: 'caveat',
    text:
      'A satellite hotspot is a possible fire, not a confirmed one; cloud and thick smoke hide hotspots, so counts are lower bounds, and one fire seen by two satellites is counted twice.',
  });

  // --- Volcanoes ---------------------------------------------------------
  const warnings = input.warnings ?? [];
  const feeds = input.warningFeeds ?? [];
  const feedById = new Map(feeds.map((f) => [f.feedId, f]));
  const citeFeedFor = (w: OfficialWarning): string => {
    const f = feedFor(w, feeds);
    if (f) return book.add(feedCitation(f));
    return book.add({
      id: `issuer:${w.issuer}`,
      label: w.issuer,
      url: w.issuerUrl,
      basis: w.authority === 'aggregator' ? 'ESTIMATE' : 'OFFICIAL',
      mode: w.dataMode === 'live' ? 'LIVE' : 'SNAPSHOT',
      time: w.retrievedAt,
      timeKind: 'retrieved',
      licence: null,
    });
  };
  const volcanoLevels = warnings
    .filter((w) => w.hazard === 'volcano' && w.authority === 'official' && !w.ended)
    .sort((a, b) => {
      const ma = a.issuer.includes('MAGMA') ? 0 : 1;
      const mb = b.issuer.includes('MAGMA') ? 0 : 1;
      return ma - mb || compareWarnings(a, b);
    });
  const volcanoFigures: ReportFigure[] = [];
  const volcanoBlocks: ReportBlock[] = [];
  const byIssuer = new Map<string, number>();
  for (const w of volcanoLevels) byIssuer.set(w.issuer, (byIssuer.get(w.issuer) ?? 0) + 1);
  const volcanoSummary =
    volcanoLevels.length > 0
      ? `${plural(volcanoLevels.length, 'official volcano level notice is', 'official volcano level notices are')} relayed, verbatim: ` +
        `${joinList([...byIssuer.entries()].map(([k, n]) => `${n} from ${k}`))}.`
      : 'No official volcano level notice was returned by the feeds checked. This is not an all-clear: check PVMBG (MAGMA Indonesia) and PHIVOLCS directly.';
  if (volcanoLevels.length > 0) {
    const cites = [...new Set(volcanoLevels.map(citeFeedFor))];
    volcanoFigures.push({
      label: 'Volcano level notices relayed',
      value: intText(volcanoLevels.length),
      note: [...byIssuer.entries()].map(([k, n]) => `${n} ${k.replace(/\s*\(.*?\)/g, '').replace(/ via .*/, '')}`).join(', '),
      basis: 'OFFICIAL',
      cite: cites[0],
      time: volcanoLevels[0].issuedAt ?? volcanoLevels[0].retrievedAt,
    });
    volcanoBlocks.push({ kind: 'paragraph', text: volcanoSummary, cites });
    volcanoBlocks.push({
      kind: 'table',
      caption: 'Official volcano levels, verbatim from the issuer, with fixed English glosses where reviewed. Our tool never ranks or re-scores them.',
      columns: ['Volcano / area', 'Level (verbatim)', 'Gloss', 'Issuer', 'Issued or recorded', 'Mode'],
      rows: volcanoLevels.map((w) => [
        w.areas[0]?.name || w.areaDescription,
        w.level,
        w.levelGloss ?? '—',
        w.issuer,
        w.issuedAt ? utcStamp(w.issuedAt) : `recorded ${utcStamp(w.retrievedAt)}`,
        warningModeText(w),
      ]),
      cites,
      official: true,
    });
  } else {
    volcanoBlocks.push({ kind: 'paragraph', text: volcanoSummary, cites: [] });
  }
  const magma = feedById.get('magma-level-list');
  if (magma && magma.status !== 'unavailable') {
    volcanoBlocks.push({
      kind: 'caveat',
      text: `MAGMA Indonesia levels are a recorded copy (${utcStamp(magma.retrievedAt)}), not a live feed; MAGMA's API is token-only. Check ${'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas'} for the current level.`,
    });
  }
  volcanoBlocks.push({
    kind: 'caveat',
    text: 'PHIVOLCS (Philippines) levels and VAAC Darwin ash advisories are not relayed here; check https://www.phivolcs.dost.gov.ph/ and the Darwin VAAC directly.',
  });
  // Ash-drift scenario numbers.
  const ash = input.ashWind ?? null;
  if (ash && ash.volcanoes.length > 0) {
    const ashId = book.add({
      id: 'ash-wind',
      label: `${ash.source}, pressure-level winds at 700, 500 and 300 hPa at each summit`,
      url: ash.sourceUrl,
      basis: 'MODELLED',
      mode: modeOf(ash.dataMode),
      time: ash.retrievedAt,
      timeKind: ash.dataMode === 'live' ? 'retrieved' : 'captured',
      licence: ash.attribution,
    });
    const anchor = Date.parse(ash.retrievedAt);
    const rows: string[][] = [];
    let start: string | null = null;
    for (const v of ash.volcanoes) {
      const d = ashDriftTracks(v, anchor);
      if (!d) continue;
      start = start ?? d.startISO;
      rows.push([
        v.name,
        ...ASH_LEVELS.map((l) => {
          const t = d.tracks.find((x) => x.level === l.key);
          if (!t || t.points.length < 2) return '—';
          return t.bearingDeg === null ? 'little movement' : `${intText(t.distanceKm)} km ${compass16(t.bearingDeg)}`;
        }),
      ]);
    }
    if (rows.length > 0) {
      volcanoBlocks.push({
        kind: 'table',
        caption:
          `If it erupted at ${utcStamp(start)}: straight-line drift after 24 h from the summit's forecast winds (MODELLED SCENARIO, not a prediction, ` +
          'not an ash advisory).',
        columns: ['Volcano', ...ASH_LEVELS.map((l) => `${l.label} (${l.hPa})`)],
        rows,
        cites: [ashId],
      });
      volcanoBlocks.push({
        kind: 'caveat',
        text: 'The scenario uses the forecast wind at the summit for the whole path; it ignores where the ash has moved to, plume height, fall-out and dispersion. VAAC Darwin issues the official ash advisories for Indonesia.',
      });
    }
  }

  // --- Warnings ----------------------------------------------------------
  const active = activeOfficial(warnings);
  const endedCount = warnings.filter((w) => w.authority === 'official' && w.ended).length;
  const aggregator = warnings.filter((w) => w.authority === 'aggregator');
  const hazards = [...new Set(active.map((w) => w.hazard))];
  const warningBlocks: ReportBlock[] = [];
  const warningFigures: ReportFigure[] = [];
  const unavailable = feeds.filter((f) => f.status === 'unavailable');
  const snapshotFeeds = feeds.filter((f) => f.status === 'snapshot');
  const feedCites = feeds.map((f) => book.add(feedCitation(f)));
  const warningSummary =
    active.length > 0
      ? `${plural(active.length, 'official message is', 'official messages are')} in force as relayed: ` +
        `${joinList(hazards.map((h) => `${hazardName(h).toLowerCase()} ${active.filter((w) => w.hazard === h).length}`))}.`
      : 'The feeds checked returned no official message in force. This is not an all-clear.';
  warningFigures.push({
    label: 'Official messages in force (as relayed)',
    value: intText(active.length),
    note: hazards.map((h) => `${hazardName(h)} ${active.filter((w) => w.hazard === h).length}`).join(', ') || 'none returned; not an all-clear',
    basis: 'OFFICIAL',
    cite: feedCites[0] ?? book.add(asmcCitation()),
    time: active[0]?.issuedAt ?? active[0]?.retrievedAt ?? null,
  });
  if (unavailable.length > 0) {
    warningFigures.push({
      label: 'Official feeds unavailable',
      value: intText(unavailable.length),
      note: unavailable.map((f) => f.issuer).join(', '),
      basis: 'OFFICIAL',
      cite: book.add(feedCitation(unavailable[0])),
      time: null,
    });
  }
  warningBlocks.push({ kind: 'paragraph', text: warningSummary, cites: feedCites });
  if (active.length > 0) {
    warningBlocks.push({
      kind: 'table',
      caption: 'Official messages in force as relayed, by hazard. "In force" means not ended or expired when retrieved; check the issuer for the current status.',
      columns: ['Hazard', 'In force', 'Issuers', 'Newest issue time'],
      numeric: [false, true, false, false],
      rows: hazards.map((h) => {
        const list = active.filter((w) => w.hazard === h);
        const newest = list.map((w) => w.issuedAt).filter((t): t is string => t !== null).sort().at(-1) ?? null;
        return [hazardName(h), intText(list.length), [...new Set(list.map((w) => w.issuer))].join('; '), newest ? utcStamp(newest) : 'not published'];
      }),
      cites: feedCites,
      official: true,
    });
    for (const h of hazards) {
      const list = active.filter((w) => w.hazard === h);
      const shown = list.slice(0, 3);
      warningBlocks.push({
        kind: 'bullets',
        items: [
          ...shown.map(warningLine),
          ...(list.length > shown.length ? [`… and ${list.length - shown.length} more ${hazardName(h).toLowerCase()} messages (full list in the Warnings section).`] : []),
        ],
        cites: [...new Set(shown.map(citeFeedFor))],
        official: true,
      });
    }
  }
  if (endedCount > 0) {
    warningBlocks.push({
      kind: 'paragraph',
      text: `${plural(endedCount, 'further official message was', 'further official messages were')} ended or expired when retrieved; they are listed in the Warnings section with their times.`,
      cites: [],
    });
  }
  if (aggregator.length > 0) {
    warningBlocks.push({
      kind: 'caveat',
      text: `${plural(aggregator.length, 'GDACS item is', 'GDACS items are')} also listed: GDACS is an aggregator, and its alerts are impact estimates, not official warnings.`,
    });
  }
  const snapshotByIssuer = new Map<string, WarningFeedStatus[]>();
  for (const f of snapshotFeeds) snapshotByIssuer.set(f.issuer, [...(snapshotByIssuer.get(f.issuer) ?? []), f]);
  const feedLines = [
    ...unavailable.map((f) => `Official feed unavailable: check ${f.issuer} directly (${f.issuerUrl}).`),
    ...[...snapshotByIssuer.entries()].map(([issuer, list]) => {
      const times = [...new Set(list.map((f) => utcStamp(f.retrievedAt)))].join(' and ');
      const what = list.every((f) => f.feedId === 'magma-level-list') ? 'recorded copy' : 'bundled snapshot';
      return `${issuer} (${list.map((f) => f.feedId).join(', ')}): ${what} from ${times}; it may no longer be current.`;
    }),
  ];
  if (feedLines.length > 0) warningBlocks.push({ kind: 'bullets', items: feedLines, cites: [] });
  warningBlocks.push({
    kind: 'caveat',
    text: 'Messages are relayed word for word from the issuing agencies and never re-scored. The absence of a message is not an all-clear; follow the issuer for current instructions.',
  });
  for (const f of unavailable) gaps.push(`Official feed unavailable: check ${f.issuer} directly.`);
  if (feeds.length === 0) gaps.push('No official feed status was supplied: the warnings figures cannot be checked against their feeds.');

  // --- Water -------------------------------------------------------------
  const waterBlocks: ReportBlock[] = [];
  const waterFigures: ReportFigure[] = [];
  const river = input.riverFlow ?? null;
  if (river && river.series.length > 0) {
    const s0 = river.series[0];
    const rid = book.add({
      id: 'glofas',
      label: 'GloFAS river discharge (Copernicus Emergency Management Service) via the Open-Meteo Flood API',
      url: 'https://open-meteo.com/en/docs/flood-api',
      basis: 'MODELLED',
      mode: modeOf(s0.dataMode),
      time: s0.retrievedAt,
      timeKind: s0.dataMode === 'live' ? 'retrieved' : 'captured',
      licence: 'Open-Meteo.com (CC BY 4.0), based on Copernicus Emergency Management Service GloFAS (European Union).',
    });
    const rows = river.series.map((s) => {
      const today = s.days.find((d) => d.kind === 'today') ?? null;
      const todayIdx = today ? s.days.indexOf(today) : -1;
      const weekAgo = todayIdx >= 7 ? s.days[todayIdx - 7] : null;
      const fc = s.days.filter((d) => d.kind === 'forecast' && d.dischargeM3s !== null);
      const peak = fc.reduce<(typeof fc)[number] | null>((b, d) => (b === null || (d.dischargeM3s ?? -1) > (b.dischargeM3s ?? -1) ? d : b), null);
      const change =
        today?.dischargeM3s && weekAgo?.dischargeM3s ? `${Math.round(((today.dischargeM3s - weekAgo.dischargeM3s) / weekAgo.dischargeM3s) * 100)} %` : '—';
      return [
        `${s.river} at ${s.place} (${s.country})`,
        today?.dischargeM3s !== null && today?.dischargeM3s !== undefined ? intText(today.dischargeM3s) : '—',
        weekAgo?.dischargeM3s !== null && weekAgo?.dischargeM3s !== undefined ? intText(weekAgo.dischargeM3s) : '—',
        change,
        peak?.dischargeM3s !== null && peak?.dischargeM3s !== undefined ? `${intText(peak.dischargeM3s)} (${peak.date})` : '—',
      ];
    });
    waterBlocks.push({
      kind: 'table',
      caption: 'Modelled river discharge, m³/s (GloFAS, MODELLED: not a gauge reading and not a flood warning).',
      columns: ['River', 'Today', '7 days ago', 'Change', 'Forecast peak (date)'],
      numeric: [false, true, true, true, false],
      rows,
      cites: [rid],
    });
    waterBlocks.push({ kind: 'caveat', text: 'GloFAS is a 0.05° global model; small urban rivers such as the Ciliwung are poorly resolved. Follow the national flood agency.' });
  } else {
    gaps.push('Modelled river discharge (GloFAS) not loaded.');
  }
  const tsunamiActive = active.filter((w) => w.hazard === 'tsunami');
  const floodActive = active.filter((w) => w.hazard === 'flood');
  const ptwcMsg = warnings.filter((w) => w.issuer.includes('PTWC')).sort(compareWarnings)[0] ?? null;
  const citeList = (list: readonly OfficialWarning[], feedHint: RegExp): string => {
    if (list.length > 0) return citeFeedFor(list[0]);
    const f = feeds.find((x) => feedHint.test(x.feedId));
    return f ? book.add(feedCitation(f)) : (feedCites[0] ?? book.add(asmcCitation()));
  };
  waterFigures.push({
    label: 'Tsunami messages in force (as relayed)',
    value: intText(tsunamiActive.length),
    note: tsunamiActive.length === 0 ? 'none returned; not an all-clear' : [...new Set(tsunamiActive.map((w) => w.issuer))].join(', '),
    basis: 'OFFICIAL',
    cite: citeList(tsunamiActive, /tsunami|inatews|ptwc/),
    time: tsunamiActive[0]?.issuedAt ?? null,
  });
  waterFigures.push({
    label: 'Flood messages in force (as relayed)',
    value: intText(floodActive.length),
    note: floodActive.length === 0 ? 'none returned; not an all-clear' : [...new Set(floodActive.map((w) => w.issuer.replace(/\s*\(.*\)$/, '')))].join(', '),
    basis: 'OFFICIAL',
    cite: citeList(floodActive, /flood|thaiwater|dsda/),
    time: floodActive[0]?.issuedAt ?? null,
  });
  if (ptwcMsg) {
    waterBlocks.push({
      kind: 'bullets',
      items: [warningLine(ptwcMsg), 'PTWC Pacific messages are for national authorities; the public warning for each country comes from its national agency.'],
      cites: [citeFeedFor(ptwcMsg)],
      official: true,
    });
  }
  waterBlocks.push({
    kind: 'caveat',
    text: 'Tide gauges (IOC) are raw readings including the normal tide and are never a tsunami signal on their own; see the Water section.',
  });

  // --- Freshness ---------------------------------------------------------
  const freshness: FreshnessLine[] = [];
  const pushFresh = (source: string, basis: Basis, mode: Citation['mode'], time: string | null, kind: string) => {
    const age = ageText(time, input.nowMs);
    const modeWord = mode === 'SNAPSHOT' ? 'bundled snapshot' : mode === 'LIVE' ? 'live' : mode === 'RECORDED' ? 'recorded copy' : mode === 'LINK' ? 'linked only' : 'unavailable';
    freshness.push({
      source,
      basis,
      mode,
      time,
      text: `${source} (${basis}): ${modeWord}${time ? `, ${kind} ${utcStamp(time)}` : ''}${age ? ` (${age})` : ''}.`,
    });
  };
  if (aq) pushFresh('CAMS PM2.5 (Open-Meteo)', 'MODELLED', modeOf(aq.dataMode), aq.retrievedAt, aq.dataMode === 'live' ? 'retrieved' : 'captured');
  else pushFresh('CAMS PM2.5 (Open-Meteo)', 'MODELLED', 'UNAVAILABLE', null, '');
  for (const g of [input.wind925, input.wind10m]) {
    if (g) pushFresh(`Wind ${g.level} (Open-Meteo)`, 'MODELLED', modeOf(g.dataMode), g.retrievedAt, g.dataMode === 'live' ? 'retrieved' : 'captured');
  }
  if (nea) pushFresh('NEA Singapore PSI and PM2.5', 'MEASURED', modeOf(nea.haze?.dataMode ?? nea.dataMode), nea.haze?.observedAt ?? nea.observedAt, 'reading');
  else pushFresh('NEA Singapore PSI and PM2.5', 'MEASURED', 'UNAVAILABLE', null, '');
  if (input.hotspotSnapshot) pushFresh('NASA FIRMS hotspots (watch areas)', 'MEASURED', 'SNAPSHOT', input.hotspotSnapshot.satelliteAsOf ?? input.hotspotSnapshot.retrievedAt, 'newest file');
  if (fires) pushFresh(fires.source, 'MEASURED', fires.dataMode === 'live' ? 'LIVE' : 'SNAPSHOT', fires.asOf, 'as of');
  if (ash) pushFresh('Ash-drift winds (Open-Meteo)', 'MODELLED', modeOf(ash.dataMode), ash.retrievedAt, ash.dataMode === 'live' ? 'retrieved' : 'captured');
  if (river?.series[0]) pushFresh('GloFAS river discharge', 'MODELLED', modeOf(river.series[0].dataMode), river.series[0].retrievedAt, river.series[0].dataMode === 'live' ? 'retrieved' : 'captured');
  for (const s of input.quakes?.statuses ?? []) pushFresh(`${s.sourceName} earthquakes`, 'MEASURED', feedMode(s.status), s.retrievedAt, 'retrieved');
  if (feeds.length > 0) {
    const counts = { live: 0, snapshot: 0, unavailable: 0 };
    for (const f of feeds) {
      if (f.status === 'unavailable') counts.unavailable += 1;
      else if (f.status === 'snapshot') counts.snapshot += 1;
      else counts.live += 1;
    }
    const newest = feeds.map((f) => f.retrievedAt).filter((t): t is string => t !== null).sort().at(-1) ?? null;
    freshness.push({
      source: 'Official warning feeds',
      basis: 'OFFICIAL',
      mode: counts.live > 0 ? 'LIVE' : counts.snapshot > 0 ? 'SNAPSHOT' : 'UNAVAILABLE',
      time: newest,
      text:
        `Official warning feeds (OFFICIAL): ${counts.live} live, ${counts.snapshot} from a bundled snapshot or recorded copy, ${counts.unavailable} unavailable` +
        `${newest ? `; newest retrieval ${utcStamp(newest)}` : ''}.`,
    });
  }
  pushFresh('ASMC regional haze alert level', 'OFFICIAL', 'LINK', null, '');
  gaps.push(`ASMC's regional haze alert level is not ingested (no open feed; its terms restrict republishing): check ${ASMC.alerts}.`);
  gaps.push('PHIVOLCS levels, VAAC Darwin ash advisories and Malaysian and Philippine flood feeds are not relayed.');

  // --- Overview ----------------------------------------------------------
  const keyFigures: ReportFigure[] = [
    ...hazeFigures.slice(0, 3),
    ...hazeFigures.filter((f) => f.basis === 'MEASURED'),
    ...hazeFigures.filter((f) => f.label.startsWith('Singapore, modelled')),
    ...transportFigures.slice(0, 1),
    ...fireFigures.slice(0, 1),
    ...volcanoFigures,
    ...warningFigures,
  ];
  const overviewBlocks: ReportBlock[] = [
    { kind: 'paragraph', text: head.text, cites: cams ? [cams] : [] },
    {
      kind: 'bullets',
      items: [hazeSummary, transportSummary, fireSummary, volcanoSummary, warningSummary],
      cites: [],
    },
  ];
  if (whatChanged.length > 0) overviewBlocks.push({ kind: 'bullets', items: whatChanged, cites: cams ? [cams] : [] });
  overviewBlocks.push({
    kind: 'caveat',
    text: 'Every figure is labelled MODELLED (a forecast model), MEASURED (stations or satellites) or OFFICIAL (relayed from the issuing agency, verbatim). Modelled values are context, not observations.',
  });

  const sections: ReportSection[] = [
    { id: 'overview', title: 'Situation overview', basis: 'MIXED', summary: head.text, figures: keyFigures, blocks: overviewBlocks },
    { id: 'haze', title: `Haze and air quality: ${table?.dataMode === 'live' ? 'now' : 'the snapshot hour'} and the next ${HAZE_FUTURE_H} h`, basis: 'MIXED', summary: hazeSummary, figures: hazeFigures, blocks: hazeBlocks },
    { id: 'transport', title: 'Smoke transport toward Singapore', basis: 'MODELLED', summary: transportSummary, figures: transportFigures, blocks: transportBlocks },
    { id: 'fires', title: 'Fires', basis: 'MEASURED', summary: fireSummary, figures: fireFigures, blocks: fireBlocks },
    { id: 'volcanoes', title: 'Volcanoes: official levels', basis: 'OFFICIAL', summary: volcanoSummary, figures: volcanoFigures, blocks: volcanoBlocks },
    { id: 'warnings', title: 'Official warnings by hazard', basis: 'OFFICIAL', summary: warningSummary, figures: warningFigures, blocks: warningBlocks },
    {
      id: 'water',
      title: 'Water and tsunami',
      basis: 'MIXED',
      summary: `${plural(tsunamiActive.length, 'tsunami message', 'tsunami messages')} and ${plural(floodActive.length, 'flood message', 'flood messages')} in force as relayed.`,
      figures: waterFigures,
      blocks: waterBlocks,
    },
    {
      id: 'freshness',
      title: 'Data freshness and gaps',
      basis: 'MIXED',
      summary: 'When each source was retrieved, and what this report cannot see.',
      figures: [],
      blocks: [
        { kind: 'bullets', items: freshness.map((f) => f.text), cites: [] },
        { kind: 'bullets', items: gaps, cites: [] },
      ],
    },
  ];

  return {
    title: 'ASEAN Watch situation report',
    headline: head,
    anchorISO,
    sections,
    whatChanged,
    citations: book.list(),
    freshness,
    gaps,
    disclaimer: SITUATION_DISCLAIMER,
    keyFigures,
  };
}
