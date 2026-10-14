// Earthquakes across the APAC / Western Pacific Ring of Fire: USGS FDSN (M 4.5+, past 7 days) and
// BMKG (gempaterkini: latest 15 M 5.0+; datagempa: the latest InaTEWS earthquake message).
// Context only: never evidence, never a warning. USGS and BMKG reports of the same event are kept as
// separate records with their own sources and never merged (their magnitudes and times differ).
//
// Verified live 2026-10-14 (CORS "*" on all three):
//   https://earthquake.usgs.gov/fdsnws/event/1/query?...&minlongitude=90&maxlongitude=210  (one request
//     across the dateline: FDSN accepts longitudes up to 360 and returns them normalised to -180..180)
//   https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json   ("Coordinates" is "lat,lon")
//   https://bmkg-content-inatews.storage.googleapis.com/datagempa.json   (point.coordinates is "lon,lat")
// Snapshot: data/quakes-snapshot.json (scripts/capture-quakes-snapshot.mjs, npm run refresh:quakes).
import snapshotJson from '../../data/quakes-snapshot.json';
import type { ConnectorStatus, QuakeEvent } from '../types';
import { isRecord, isoNoMs, loadLiveFirst, normLon, num, snapshotOnly, str, toIsoUtc, type LiveLoadSpec } from './liveLoad';
import { wibToUtc } from './warnings';

/** APAC / Western Pacific box. Longitudes run east from 90°E across the dateline to 150°W (210°). */
export const QUAKE_BOX = { minLat: -50, maxLat: 60, minLon: 90, maxLon: 210 } as const;
export const QUAKE_MIN_MAGNITUDE = 4.5;
export const QUAKE_WINDOW_DAYS = 7;

export const USGS_TSUNAMI_FLAG_NOTE =
  'USGS "tsunami" flag: set for large events in oceanic regions so that tsunami information can be ' +
  'linked. It is NOT a tsunami warning and does not mean a tsunami occurred. Official tsunami warnings ' +
  'come only from BMKG, PTWC (via national authorities), JMA, PHIVOLCS and other national agencies.';

export const QUAKE_SOURCES = {
  usgs: {
    id: 'usgs-quakes',
    name: 'USGS Earthquake Hazards Program',
    url: 'https://earthquake.usgs.gov/earthquakes/map/',
    attribution: 'Earthquake data: U.S. Geological Survey (public domain).',
  },
  bmkgTerkini: {
    id: 'bmkg-gempaterkini',
    name: 'BMKG',
    url: 'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json',
    pageUrl: 'https://data.bmkg.go.id/gempabumi/',
    attribution: 'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika).',
  },
  bmkgDatagempa: {
    id: 'bmkg-datagempa',
    name: 'BMKG InaTEWS',
    url: 'https://bmkg-content-inatews.storage.googleapis.com/datagempa.json',
    pageUrl: 'https://inatews.bmkg.go.id/',
    attribution: 'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika).',
  },
} as const;

/** True when (lat, lon) is inside QUAKE_BOX, handling the dateline (lon in -180..180 or 0..360). */
export function inQuakeBox(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < QUAKE_BOX.minLat || lat > QUAKE_BOX.maxLat) return false;
  const east = ((lon % 360) + 360) % 360; // 0..360
  return east >= QUAKE_BOX.minLon && east <= QUAKE_BOX.maxLon;
}

/** USGS FDSN query for the box, M 4.5+, past 7 days. starttime is rounded to the hour so CDN caches help. */
export function usgsQueryUrl(nowMs: number): string {
  const start = new Date(Math.floor((nowMs - QUAKE_WINDOW_DAYS * 86400000) / 3600000) * 3600000).toISOString().slice(0, 19);
  return (
    'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson' +
    `&minlatitude=${QUAKE_BOX.minLat}&maxlatitude=${QUAKE_BOX.maxLat}` +
    `&minlongitude=${QUAKE_BOX.minLon}&maxlongitude=${QUAKE_BOX.maxLon}` +
    `&minmagnitude=${QUAKE_MIN_MAGNITUDE}&starttime=${start}&orderby=time`
  );
}

interface ParseMeta {
  dataMode: 'live' | 'historical';
}

/** USGS FDSN / summary GeoJSON -> QuakeEvent[] (box and magnitude filtered client-side as well). */
export function parseUsgsQuakes(raw: unknown, meta: ParseMeta): QuakeEvent[] {
  if (!isRecord(raw) || !Array.isArray(raw.features)) throw new Error('not a USGS GeoJSON FeatureCollection');
  const out: QuakeEvent[] = [];
  for (const f of raw.features) {
    if (!isRecord(f) || !isRecord(f.properties) || !isRecord(f.geometry) || !Array.isArray(f.geometry.coordinates)) continue;
    const p = f.properties;
    const [lonRaw, latRaw, depthRaw] = f.geometry.coordinates.map((v) => num(v));
    const mag = num(p.mag);
    const time = num(p.time);
    const id = str(f.id);
    if (lonRaw === null || latRaw === null || mag === null || time === null || !id) continue;
    if (mag < QUAKE_MIN_MAGNITUDE || !inQuakeBox(latRaw, lonRaw)) continue;
    if (p.type !== undefined && p.type !== 'earthquake') continue;
    out.push({
      id: `usgs:${id}`,
      source: 'USGS',
      product: `USGS FDSN event service (${str(p.status) ?? 'status not given'})`,
      magnitude: mag,
      magType: str(p.magType),
      depthKm: depthRaw ?? null,
      lat: latRaw,
      lon: normLon(lonRaw),
      place: str(p.place) ?? str(p.title) ?? 'Place not given',
      timeISO: isoNoMs(time),
      url: str(p.url) ?? QUAKE_SOURCES.usgs.url,
      tsunamiFlag: num(p.tsunami) === 1,
      potential: null,
      dataMode: meta.dataMode,
    });
  }
  return out;
}

function depthKm(value: unknown): number | null {
  const m = /(-?\d+(?:\.\d+)?)/.exec(str(value) ?? '');
  return m ? Number(m[1]) : null;
}

/** BMKG gempaterkini.json (Infogempa.gempa[], "Coordinates" = "lat,lon", DateTime is UTC with offset). */
export function parseBmkgTerkini(raw: unknown, meta: ParseMeta): QuakeEvent[] {
  const list = isRecord(raw) && isRecord(raw.Infogempa) ? raw.Infogempa.gempa : null;
  if (!Array.isArray(list)) throw new Error('not a BMKG gempaterkini document');
  const out: QuakeEvent[] = [];
  for (const g of list) {
    if (!isRecord(g)) continue;
    const [lat, lon] = (str(g.Coordinates) ?? '').split(',').map((v) => num(v));
    const mag = num(g.Magnitude);
    const timeISO = toIsoUtc(g.DateTime);
    if (lat == null || lon == null || mag === null || !timeISO || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({
      id: `bmkg-gempaterkini:${timeISO.replace(/\D/g, '').slice(0, 14)}`,
      source: 'BMKG',
      product: 'BMKG gempaterkini (latest 15, M 5.0+)',
      magnitude: mag,
      magType: null,
      depthKm: depthKm(g.Kedalaman),
      lat,
      lon,
      place: str(g.Wilayah) ?? 'Wilayah tidak disebutkan',
      timeISO,
      url: QUAKE_SOURCES.bmkgTerkini.pageUrl,
      tsunamiFlag: null,
      potential: str(g.Potensi),
      dataMode: meta.dataMode,
    });
  }
  return out;
}

/** BMKG InaTEWS datagempa.json: one message; info.point.coordinates is "lon,lat". */
export function parseBmkgDatagempa(raw: unknown, meta: ParseMeta): QuakeEvent[] {
  const info = isRecord(raw) && isRecord(raw.info) ? raw.info : null;
  if (!info) throw new Error('not a BMKG datagempa document');
  const point = isRecord(info.point) ? str(info.point.coordinates) : null;
  const [lon, lat] = (point ?? '').split(',').map((v) => num(v));
  const mag = num(info.magnitude);
  const sent = isRecord(raw) ? raw.sent : null;
  const eventId = str(info.eventid);
  // Origin time: eventid is YYYYMMDDhhmmss in WIB (UTC+7), matching info.date/info.time.
  const m = eventId ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(eventId) : null;
  const timeISO = m ? wibToUtc(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}WIB`) : wibToUtc(sent);
  if (lat == null || lon == null || mag === null || !timeISO) return [];
  return [
    {
      id: `bmkg-datagempa:${eventId ?? timeISO}`,
      source: 'BMKG',
      product: `BMKG InaTEWS ${str(info.subject) ?? 'earthquake message'}`,
      magnitude: mag,
      magType: null,
      depthKm: depthKm(info.depth),
      lat,
      lon,
      place: str(info.area) ?? 'Wilayah tidak disebutkan',
      timeISO,
      url: QUAKE_SOURCES.bmkgDatagempa.pageUrl,
      tsunamiFlag: null,
      potential: str(info.potential),
      dataMode: meta.dataMode,
    },
  ];
}

/**
 * Combine sources. BMKG's two products can describe the same BMKG event: keep the gempaterkini record
 * and drop the datagempa duplicate (same agency, same origin time). USGS vs BMKG is NEVER merged.
 */
export function combineQuakes(usgs: QuakeEvent[], terkini: QuakeEvent[], datagempa: QuakeEvent[]): QuakeEvent[] {
  const bmkgTimes = new Set(terkini.map((q) => q.timeISO));
  const all = [...usgs, ...terkini, ...datagempa.filter((q) => !bmkgTimes.has(q.timeISO))];
  const seen = new Set<string>();
  return all
    .filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)))
    .sort((a, b) => (a.timeISO < b.timeISO ? 1 : a.timeISO > b.timeISO ? -1 : a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Loading

interface SnapshotFeed {
  url: string;
  retrievedAt: string;
  raw: unknown;
}
export interface QuakesSnapshot {
  capturedAt: string;
  feeds: Record<string, SnapshotFeed | undefined>;
}
export const BUNDLED_QUAKES_SNAPSHOT = snapshotJson as unknown as QuakesSnapshot;

interface Parsed {
  events: QuakeEvent[];
  retrievedAt: string;
}

export interface QuakesResult {
  /** Newest first; one record per agency report. */
  events: QuakeEvent[];
  statuses: ConnectorStatus[];
  tsunamiFlagNote: string;
  attribution: string[];
}

function specFor(
  key: 'usgs' | 'bmkgTerkini' | 'bmkgDatagempa',
  parse: (raw: unknown, meta: ParseMeta) => QuakeEvent[],
  url: (nowMs: number) => string,
  source: QuakesSnapshot | null,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): LiveLoadSpec<Parsed> {
  const src = QUAKE_SOURCES[key];
  return {
    sourceId: src.id,
    sourceName: src.name,
    fetchImpl: opts?.fetchImpl,
    timeoutMs: opts?.timeoutMs ?? 8000,
    retrievedAtOf: (v) => v.retrievedAt,
    live: async (get) => {
      const raw = await get(url(Date.now()), 'json');
      return { events: parse(raw, { dataMode: 'live' }), retrievedAt: isoNoMs(Date.now()) };
    },
    snapshot: () => {
      const f = source?.feeds?.[src.id];
      if (!f || typeof f.retrievedAt !== 'string') return null;
      return { value: { events: parse(f.raw, { dataMode: 'historical' }), retrievedAt: f.retrievedAt }, retrievedAt: f.retrievedAt };
    },
  };
}

function specs(source: QuakesSnapshot | null, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }) {
  return [
    specFor('usgs', parseUsgsQuakes, usgsQueryUrl, source, opts),
    specFor('bmkgTerkini', parseBmkgTerkini, () => QUAKE_SOURCES.bmkgTerkini.url, source, opts),
    specFor('bmkgDatagempa', parseBmkgDatagempa, () => QUAKE_SOURCES.bmkgDatagempa.url, source, opts),
  ] as const;
}

function assemble(results: { value: Parsed | null; status: ConnectorStatus }[]): QuakesResult {
  const [u, t, d] = results.map((r) => r.value?.events ?? []);
  return {
    events: combineQuakes(u, t, d),
    statuses: results.map((r) => r.status),
    tsunamiFlagNote: USGS_TSUNAMI_FLAG_NOTE,
    attribution: [QUAKE_SOURCES.usgs.attribution, QUAKE_SOURCES.bmkgTerkini.attribution],
  };
}

/** Live USGS + BMKG (each: live -> 5 min cache -> 60 s backoff -> HISTORICAL snapshot -> unavailable). Never throws. */
export async function loadQuakes(opts?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Override the bundled snapshot (null = none). For tests. */
  snapshot?: QuakesSnapshot | null;
}): Promise<QuakesResult> {
  const source = opts?.snapshot === undefined ? BUNDLED_QUAKES_SNAPSHOT : opts.snapshot;
  return assemble(await Promise.all(specs(source, opts).map((s) => loadLiveFirst(s))));
}

/** The bundled snapshot only (HISTORICAL), for first paint and offline. */
export function loadQuakesSnapshot(source: QuakesSnapshot | null = BUNDLED_QUAKES_SNAPSHOT): QuakesResult {
  return assemble(specs(source).map((s) => snapshotOnly(s)));
}
