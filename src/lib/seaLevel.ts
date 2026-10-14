// Tide gauges from the IOC Sea Level Station Monitoring Facility (VLIZ/IOC).
//
// THESE ARE RAW, UNVALIDATED GAUGE DATA, NOT A TSUNAMI WARNING. Values are "provided as received" on
// each station's own datum and include the normal tide (a gauge can fall 0.5 m in under 2 h from tide
// alone). Never infer a tsunami, or the absence of one, from them, and never compute anomalies from
// them. The only valid signal to people is an official warning (BMKG, JMA, PTWC via national
// authorities, PHIVOLCS, NWS).
//
// Verified live 2026-10-14: both endpoints send Access-Control-Allow-Origin "*", so the browser calls
// IOC directly and no proxy is needed.
//   station list: https://www.ioc-sealevelmonitoring.org/service.php?query=stationlist&showall=all (~2.4 MB,
//                 ~10 s): too heavy for the browser, so the APAC subset is bundled (data/sealevel-snapshot.json,
//                 npm run refresh:sealevel) and labelled with its capture time.
//   readings:     service.php?query=data&code=<code>&timestart=<UTC>&timestop=<UTC>&format=json&includesensors[]=<sensor>
import snapshotJson from '../../data/sealevel-snapshot.json';
import type { ConnectorStatus, SeaLevelReading, SeaLevelSeries, SeaLevelStation } from '../types';
import { isRecord, isoNoMs, loadLiveFirst, num, snapshotOnly, str, toIsoUtc } from './liveLoad';

export const IOC_SERVICE = 'https://www.ioc-sealevelmonitoring.org/service.php';
export const IOC_STATION_PAGE = 'https://www.ioc-sealevelmonitoring.org/station.php?code=';

export const SEA_LEVEL_NOTE =
  'Raw tide-gauge data from the IOC Sea Level Station Monitoring Facility, provided as received and not ' +
  "quality controlled, on the station's own datum and including the normal tide. Not a tsunami warning: " +
  'follow official warnings from BMKG, PTWC (via national authorities), JMA, PHIVOLCS or NWS.';

export const SEA_LEVEL_ATTRIBUTION =
  'Flanders Marine Institute (VLIZ); Intergovernmental Oceanographic Commission (IOC) (2026): Sea level station ' +
  'monitoring facility. Accessed at https://www.ioc-sealevelmonitoring.org at VLIZ. DOI: 10.14284/482.';

/** Water-level sensors in preference order (radar, pressure, ...). Battery, atmospheric and DART rows excluded. */
export const WATER_SENSORS = ['rad', 'prs', 'pwl', 'wls', 'bub', 'flt', 'enc', 'aqu', 'ecs', 'ra2', 'pr1', 'pr2', 'ras', 'bwl', 'stp', 'bub1'] as const;
const NO_DATA = -999;

export function inSeaLevelBox(lat: number, lon: number): boolean {
  const east = ((lon % 360) + 360) % 360;
  return lat >= -50 && lat <= 60 && east >= 90 && east <= 210;
}

/** IOC station-list rows (one per code+sensor) -> stations grouped by code, APAC box, water sensors in metres only. */
export function parseStationList(raw: unknown): SeaLevelStation[] {
  if (!Array.isArray(raw)) throw new Error('not an IOC station list');
  const byCode = new Map<string, SeaLevelStation>();
  for (const r of raw) {
    if (!isRecord(r)) continue;
    const code = str(r.Code);
    const lat = num(r.Lat);
    const lon = num(r.Lon);
    const sensor = str(r.sensor);
    if (!code || lat === null || lon === null || !sensor || !inSeaLevelBox(lat, lon)) continue;
    if (!(WATER_SENSORS as readonly string[]).includes(sensor) || (r.units !== undefined && r.units !== 'M')) continue;
    const last = toIsoUtc(r.lasttime, true);
    const existing = byCode.get(code);
    if (existing) {
      if (!existing.sensors.includes(sensor)) existing.sensors.push(sensor);
      if (last && (!existing.lastTimeISO || last > existing.lastTimeISO)) existing.lastTimeISO = last;
      continue;
    }
    byCode.set(code, {
      code,
      name: str(r.Location) ?? code,
      country: str(r.country) ?? '',
      countryName: str(r.countryname),
      lat,
      lon,
      sensors: [sensor],
      sensor,
      rateMin: num(r.rate),
      lastTimeISO: last,
    });
  }
  const order = (s: string) => (WATER_SENSORS as readonly string[]).indexOf(s);
  return [...byCode.values()]
    .map((s) => {
      const sensors = [...s.sensors].sort((a, b) => order(a) - order(b));
      return { ...s, sensors, sensor: sensors[0] };
    })
    .sort((a, b) => (a.code < b.code ? -1 : 1));
}

/** IOC times are UTC without a zone ("2026-10-13T06:00:00"). */
function iocTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

const CODE_RE = /^[A-Za-z0-9]{2,10}$/;

/** Readings URL for the last `hours` (default 24) ending at endMs. Throws on an unsafe code or sensor. */
export function seaLevelDataUrl(code: string, sensor: string, endMs: number, hours = 24): string {
  if (!CODE_RE.test(code)) throw new Error(`invalid IOC station code: ${code}`);
  if (!(WATER_SENSORS as readonly string[]).includes(sensor)) throw new Error(`not a water-level sensor: ${sensor}`);
  const h = Math.min(Math.max(hours, 1), 72);
  return (
    `${IOC_SERVICE}?query=data&code=${encodeURIComponent(code)}&timestart=${iocTime(endMs - h * 3600000)}` +
    `&timestop=${iocTime(endMs)}&format=json&includesensors[]=${sensor}`
  );
}

/** IOC data rows -> readings for one sensor, oldest first; -999 and non-finite values dropped. */
export function parseReadings(raw: unknown, sensor: string): SeaLevelReading[] {
  if (!Array.isArray(raw)) throw new Error('not an IOC data array');
  const out: SeaLevelReading[] = [];
  for (const d of raw) {
    if (!isRecord(d) || (d.sensor !== undefined && d.sensor !== sensor)) continue;
    const v = num(d.slevel);
    const t = toIsoUtc(d.stime, true);
    if (v === null || v === NO_DATA || !t) continue;
    out.push({ timeISO: t, value: v, unit: 'm' });
  }
  return out.sort((a, b) => (a.timeISO < b.timeISO ? -1 : a.timeISO > b.timeISO ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Snapshot and loading

interface SampleEntry {
  url: string;
  sensor: string;
  retrievedAt: string;
  raw: unknown;
}
export interface SeaLevelSnapshot {
  capturedAt: string;
  stationList: { url: string; retrievedAt: string; raw: unknown } | null;
  samples: Record<string, SampleEntry | undefined>;
}
export const BUNDLED_SEA_LEVEL_SNAPSHOT = snapshotJson as unknown as SeaLevelSnapshot;

export interface SeaLevelStationList {
  stations: SeaLevelStation[];
  /** Station list capture time (bundled list; refreshed with npm run refresh:sealevel). */
  listRetrievedAt: string | null;
  note: string;
  attribution: string;
}

let stationCache: SeaLevelStationList | null = null;

/** APAC station list from the bundled snapshot (HISTORICAL list; lastTimeISO is as of capture). Never throws. */
export function loadSeaLevelStations(source: SeaLevelSnapshot | null = BUNDLED_SEA_LEVEL_SNAPSHOT): SeaLevelStationList {
  if (source === BUNDLED_SEA_LEVEL_SNAPSHOT && stationCache) return stationCache;
  let stations: SeaLevelStation[] = [];
  try {
    stations = source?.stationList ? parseStationList(source.stationList.raw) : [];
  } catch {
    stations = [];
  }
  const result = {
    stations,
    listRetrievedAt: source?.stationList?.retrievedAt ?? null,
    note: SEA_LEVEL_NOTE,
    attribution: SEA_LEVEL_ATTRIBUTION,
  };
  if (source === BUNDLED_SEA_LEVEL_SNAPSHOT) stationCache = result;
  return result;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Nearest stations to a point. With maxAgeHours, only stations whose last sample (at list capture
 * time) is that recent are returned; stale stations are common in IOC's list.
 */
export function nearestStations(
  stations: SeaLevelStation[],
  lat: number,
  lon: number,
  opts?: { count?: number; maxKm?: number; maxAgeHours?: number; nowMs?: number },
): { station: SeaLevelStation; distanceKm: number }[] {
  const now = opts?.nowMs ?? Date.now();
  return stations
    .filter((s) => {
      if (opts?.maxAgeHours === undefined) return true;
      return s.lastTimeISO !== null && now - Date.parse(s.lastTimeISO) <= opts.maxAgeHours * 3600000;
    })
    .map((station) => ({ station, distanceKm: Math.round(haversineKm(lat, lon, station.lat, station.lon)) }))
    .filter((x) => opts?.maxKm === undefined || x.distanceKm <= opts.maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, opts?.count ?? 3);
}

export interface SeaLevelReadingsResult {
  series: SeaLevelSeries | null;
  status: ConnectorStatus;
}

/**
 * Last 24 h of raw readings for one station: live IOC (5 min cache, 60 s backoff), then the bundled
 * sample (five Indonesian gauges, 10-minute marks, HISTORICAL), then unavailable. Never throws.
 * Unknown codes (not in the bundled APAC list) are refused without a request.
 */
export async function loadSeaLevelReadings(
  code: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; hours?: number; snapshot?: SeaLevelSnapshot | null },
): Promise<SeaLevelReadingsResult> {
  const source = opts?.snapshot === undefined ? BUNDLED_SEA_LEVEL_SNAPSHOT : opts.snapshot;
  const station = loadSeaLevelStations(source).stations.find((s) => s.code === code) ?? null;
  const sourceName = `IOC sea level station ${code}`;
  if (!station) {
    return {
      series: null,
      status: {
        sourceId: `ioc-sealevel:${code}`,
        sourceName,
        status: 'unavailable',
        retrievedAt: null,
        message: `Station ${code} is not in the APAC station list; check ${IOC_STATION_PAGE}${code} directly.`,
      },
    };
  }
  const sensor = station.sensor;
  const build = (readings: SeaLevelReading[], dataMode: 'live' | 'historical', retrievedAt: string, url: string): SeaLevelSeries => ({
    stationCode: code,
    sensor,
    readings,
    dataMode,
    retrievedAt,
    sourceUrl: url,
    note: SEA_LEVEL_NOTE,
  });
  const res = await loadLiveFirst<SeaLevelSeries>({
    sourceId: `ioc-sealevel:${code}`,
    sourceName,
    fetchImpl: opts?.fetchImpl,
    timeoutMs: opts?.timeoutMs ?? 10000,
    retrievedAtOf: (v) => v.retrievedAt,
    live: async (get) => {
      const url = seaLevelDataUrl(code, sensor, Date.now(), opts?.hours ?? 24);
      const readings = parseReadings(await get(url, 'json'), sensor);
      if (readings.length === 0) throw new Error('no readings in the last 24 h');
      return build(readings, 'live', isoNoMs(Date.now()), url);
    },
    snapshot: () => {
      const s = source?.samples?.[code];
      if (!s || typeof s.retrievedAt !== 'string') return null;
      const readings = parseReadings(s.raw, s.sensor);
      return readings.length ? { value: build(readings, 'historical', s.retrievedAt, s.url), retrievedAt: s.retrievedAt } : null;
    },
  });
  return { series: res.value, status: res.status };
}

/** Bundled sample only (no network). */
export function loadSeaLevelSample(code: string, source: SeaLevelSnapshot | null = BUNDLED_SEA_LEVEL_SNAPSHOT): SeaLevelSeries | null {
  const s = source?.samples?.[code];
  if (!s) return null;
  const out = snapshotOnly<SeaLevelSeries>({
    sourceId: `ioc-sealevel:${code}`,
    sourceName: `IOC sea level station ${code}`,
    retrievedAtOf: (v) => v.retrievedAt,
    live: async () => {
      throw new Error('snapshot only');
    },
    snapshot: () => {
      const readings = parseReadings(s.raw, s.sensor);
      return readings.length
        ? {
            value: { stationCode: code, sensor: s.sensor, readings, dataMode: 'historical', retrievedAt: s.retrievedAt, sourceUrl: s.url, note: SEA_LEVEL_NOTE },
            retrievedAt: s.retrievedAt,
          }
        : null;
    },
  });
  return out.value;
}

export function seaLevelStationPage(code: string): string {
  return `${IOC_STATION_PAGE}${encodeURIComponent(code)}`;
}
