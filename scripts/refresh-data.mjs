#!/usr/bin/env node
// Refreshes the real-data snapshot in data/real/. Plain Node 20+, no dependencies.
// Run: npm run refresh:data   (or: node scripts/refresh-data.mjs)
//
// Sources (all open, no key):
//   NASA FIRMS 7-day South East Asia CSVs: VIIRS 375 m (Suomi NPP, NOAA-20, NOAA-21) and MODIS C6.1.
//     About 8 MB each, so they are streamed and filtered line by line, never held whole.
//   USGS FDSN event query (GeoJSON) for one box around every watch area.
//   BMKG earthquake lists: Data Terbuka gempaterkini.json (latest 15 M 5.0+) and gempadirasakan.json
//     (latest 15 felt), and InaTEWS live30event.xml (latest located events, all magnitudes).
//
// Keeps rows inside the 7-day window (the last 7 UTC days, today included up to the retrieval time)
// and near a watch in data/watches.json: within COLLECT_*_RADIUS_KM of a volcano summit, or inside a
// haze box. The collection radii are wider than the watch rules in src/lib/watchRules.ts, which
// decide what is shown and what is an anomaly. This script makes no anomaly decisions.
//
// Writes data/real/firms.json, data/real/quakes.json, data/real/meta.json and the scenarioWindow of
// every watch in data/watches.json. All or nothing: if any download or parse fails, nothing is
// written, the previous snapshot stays in place, and the script exits with code 1.

import { readFile, rename, rm, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WATCHES_PATH = path.join(ROOT, 'data', 'watches.json');
const OUT_DIR = path.join(ROOT, 'data', 'real');

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 7;
/** Collection margins. The watch rules (5 km thermal, 30 km seismic) must stay inside these. */
const COLLECT_THERMAL_RADIUS_KM = 10;
const COLLECT_SEISMIC_RADIUS_KM = 50;
const SIZE_BUDGET_BYTES = 300 * 1024;
const USER_AGENT = 'asean-watch refresh-data script (open-data snapshot for a prototype)';

const FIRMS_ATTRIBUTION =
  "NASA FIRMS, LANCE. We acknowledge the use of data and/or imagery from NASA's Fire Information " +
  'for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA\'s Land, ' +
  'Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) ' +
  "and NASA's Earth Science Data and Information System (ESDIS).";
const FIRMS_LICENCE = 'NASA open data (full and open sharing); FIRMS asks redistributors to use the acknowledgement above.';
const USGS_ATTRIBUTION = 'U.S. Geological Survey, Earthquake Hazards Program (ComCat via the FDSN event web service).';
const USGS_LICENCE = 'Public domain (U.S. Government work).';
const BMKG_ATTRIBUTION = 'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika).';
const BMKG_LICENCE =
  'BMKG Data Terbuka terms (https://data.bmkg.go.id/gempabumi/): BMKG must be credited as the data source ' +
  'and shown in the app; access limit 60 requests per minute per IP.';

const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire';
const VIIRS_PRODUCT_URL = 'https://www.earthdata.nasa.gov/data/instruments/viirs/viirs-i-band-375-m-active-fire-data';
const MODIS_PRODUCT_URL = 'https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs';

const FIRMS_FILES = [
  {
    key: 'viirs-snpp',
    name: 'NASA FIRMS VIIRS 375 m NRT (Suomi NPP), South East Asia, last 7 days (CSV)',
    url: `${FIRMS_BASE}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_7d.csv`,
    productUrl: VIIRS_PRODUCT_URL,
    brightColumn: 'bright_ti4',
  },
  {
    key: 'viirs-noaa20',
    name: 'NASA FIRMS VIIRS 375 m NRT (NOAA-20), South East Asia, last 7 days (CSV)',
    url: `${FIRMS_BASE}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_7d.csv`,
    productUrl: VIIRS_PRODUCT_URL,
    brightColumn: 'bright_ti4',
  },
  {
    key: 'viirs-noaa21',
    name: 'NASA FIRMS VIIRS 375 m NRT (NOAA-21), South East Asia, last 7 days (CSV)',
    url: `${FIRMS_BASE}/noaa-21-viirs-c2/csv/J2_VIIRS_C2_SouthEast_Asia_7d.csv`,
    productUrl: VIIRS_PRODUCT_URL,
    brightColumn: 'bright_ti4',
  },
  {
    key: 'modis',
    name: 'NASA FIRMS MODIS C6.1 1 km NRT (Terra and Aqua), South East Asia, last 7 days (CSV)',
    url: `${FIRMS_BASE}/modis-c6.1/csv/MODIS_C6_1_SouthEast_Asia_7d.csv`,
    productUrl: MODIS_PRODUCT_URL,
    brightColumn: 'brightness',
  },
];

const BMKG_TEWS = 'https://data.bmkg.go.id/DataMKG/TEWS';
const BMKG_INATEWS = 'https://bmkg-content-inatews.storage.googleapis.com';

// ---------------------------------------------------------------------------
// Small helpers

function isoSeconds(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function headerTime(res, name) {
  const v = res.headers.get(name);
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? isoSeconds(t) : null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function fetchOk(url, timeoutMs) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': USER_AGENT } });
  } catch (err) {
    throw new Error(`${url}: request failed (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

function num(value) {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Watch areas

function loadWatchAreas(watches) {
  if (!Array.isArray(watches) || watches.length === 0) throw new Error('data/watches.json must be a non-empty list');
  return watches.map((w, i) => {
    const where = `data/watches.json entry ${i} (${w?.id ?? 'no id'})`;
    if (typeof w?.id !== 'string' || !w.id) throw new Error(`${where}: id is missing`);
    if (!Number.isFinite(w.lat) || !Number.isFinite(w.lon)) throw new Error(`${where}: lat/lon must be numbers`);
    const a = w.area;
    if (a?.kind === 'summit') return { id: w.id, kind: 'summit', lat: w.lat, lon: w.lon };
    if (a?.kind === 'bbox' && [a.minLat, a.maxLat, a.minLon, a.maxLon].every(Number.isFinite) && a.minLat < a.maxLat && a.minLon < a.maxLon) {
      return { id: w.id, kind: 'bbox', minLat: a.minLat, maxLat: a.maxLat, minLon: a.minLon, maxLon: a.maxLon };
    }
    throw new Error(`${where}: area must be {"kind":"summit"} or a valid {"kind":"bbox",...}`);
  });
}

/** Quick-reject boxes around every area (summit areas get the given radius). */
function boundsFor(areas, radiusKm) {
  return areas.map((a) => {
    if (a.kind === 'bbox') return a;
    const dLat = radiusKm / 110.574;
    const dLon = radiusKm / (111.32 * Math.cos((a.lat * Math.PI) / 180));
    return { minLat: a.lat - dLat, maxLat: a.lat + dLat, minLon: a.lon - dLon, maxLon: a.lon + dLon };
  });
}

function inBox(b, lat, lon) {
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

/** True when the point is within radiusKm of a summit area or inside a haze box. */
function nearAnyArea(areas, bounds, lat, lon, radiusKm) {
  for (let i = 0; i < areas.length; i += 1) {
    if (!inBox(bounds[i], lat, lon)) continue;
    const a = areas[i];
    if (a.kind === 'bbox' || haversineKm(a.lat, a.lon, lat, lon) <= radiusKm) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// NASA FIRMS (streamed CSV)

const FIRMS_REQUIRED = ['latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'confidence', 'version', 'frp', 'daynight'];

async function fetchFirms(file, ctx) {
  const res = await fetchOk(file.url, 240_000);
  const lastModified = headerTime(res, 'last-modified');
  const contentLength = num(res.headers.get('content-length'));
  const encoded = Boolean(res.headers.get('content-encoding'));
  if (!res.body) throw new Error(`${file.url}: empty response body`);

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let pending = '';
  let bytes = 0;
  let header = null;
  let col = null;
  let rowsRead = 0;
  let rowsInvalid = 0;
  const satellites = new Set();
  const kept = [];

  const handle = (rawLine) => {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') return;
    if (header === null) {
      header = line.split(',').map((h) => h.trim());
      const missing = [...FIRMS_REQUIRED, file.brightColumn].filter((c) => !header.includes(c));
      if (missing.length > 0) throw new Error(`${file.url}: unexpected CSV header, missing ${missing.join(', ')}`);
      col = Object.fromEntries(header.map((h, i) => [h, i]));
      return;
    }
    rowsRead += 1;
    const c = line.split(',');
    if (c.length !== header.length) {
      rowsInvalid += 1;
      return;
    }
    const lat = num(c[col.latitude]);
    const lon = num(c[col.longitude]);
    const date = c[col.acq_date];
    const time = c[col.acq_time].padStart(4, '0');
    if (lat === null || lon === null || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}$/.test(time)) {
      rowsInvalid += 1;
      return;
    }
    satellites.add(c[col.satellite]);
    if (date < ctx.startDate || date > ctx.endDate) return;
    if (!nearAnyArea(ctx.areas, ctx.thermalBounds, lat, lon, COLLECT_THERMAL_RADIUS_KM)) return;
    const frp = num(c[col.frp]);
    const rawConfidence = c[col.confidence].trim();
    const confidence = file.key === 'modis' ? num(rawConfidence) : rawConfidence;
    if (frp === null || confidence === null || confidence === '') {
      rowsInvalid += 1;
      return;
    }
    kept.push({
      file: file.key,
      latitude: lat,
      longitude: lon,
      [file.brightColumn]: num(c[col[file.brightColumn]]),
      acq_date: date,
      acq_time: time,
      satellite: c[col.satellite],
      confidence,
      version: c[col.version],
      frp,
      daynight: c[col.daynight],
    });
  };

  for await (const chunk of res.body) {
    bytes += chunk.byteLength;
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) handle(line);
  }
  pending += decoder.decode();
  if (pending !== '') handle(pending);

  if (!encoded && contentLength !== null && bytes !== contentLength) {
    throw new Error(`${file.url}: download incomplete (${bytes} of ${contentLength} bytes)`);
  }
  if (header === null || rowsRead === 0) throw new Error(`${file.url}: no data rows`);
  if (rowsInvalid > rowsRead * 0.01) throw new Error(`${file.url}: ${rowsInvalid} of ${rowsRead} rows could not be parsed`);

  return {
    rows: kept,
    source: {
      id: `firms-${file.key}`,
      name: file.name,
      provider: 'NASA FIRMS (LANCE)',
      url: file.url,
      productUrl: file.productUrl,
      retrievedAt: ctx.retrievedAt,
      lastModified,
      bytes,
      rowsRead,
      rowsInvalid,
      rowsKept: kept.length,
      satelliteCodes: [...satellites].sort(),
      attribution: FIRMS_ATTRIBUTION,
      licence: FIRMS_LICENCE,
    },
  };
}

// ---------------------------------------------------------------------------
// USGS FDSN event query

async function fetchUsgs(ctx) {
  const b = ctx.seismicBounds.reduce(
    (acc, x) => ({
      minLat: Math.min(acc.minLat, x.minLat),
      maxLat: Math.max(acc.maxLat, x.maxLat),
      minLon: Math.min(acc.minLon, x.minLon),
      maxLon: Math.max(acc.maxLon, x.maxLon),
    }),
    { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 },
  );
  const r2 = (v) => Math.round(v * 100) / 100;
  const limit = 20000;
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: ctx.windowStart.replace(/Z$/, ''),
    endtime: ctx.retrievedAt.replace(/Z$/, ''),
    minlatitude: String(r2(b.minLat - 0.01)),
    maxlatitude: String(r2(b.maxLat + 0.01)),
    minlongitude: String(r2(b.minLon - 0.01)),
    maxlongitude: String(r2(b.maxLon + 0.01)),
    orderby: 'time-asc',
    limit: String(limit),
  });
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`;
  const res = await fetchOk(url, 60_000);
  const lastModified = headerTime(res, 'last-modified');
  const json = await res.json();
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) throw new Error(`${url}: not a GeoJSON FeatureCollection`);
  if (json.features.length >= limit) throw new Error(`${url}: hit the ${limit}-event limit; narrow the query`);

  const rows = [];
  for (const f of json.features) {
    const p = f?.properties ?? {};
    const [lon, lat, depth] = f?.geometry?.coordinates ?? [];
    const mag = num(p.mag);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || mag === null || !Number.isFinite(p.time)) continue;
    if (!nearAnyArea(ctx.areas, ctx.seismicBounds, lat, lon, COLLECT_SEISMIC_RADIUS_KM)) continue;
    rows.push({
      source: 'usgs',
      product: 'fdsn-event',
      eventId: String(f.id),
      time: isoSeconds(p.time),
      lat,
      lon,
      depthKm: Number.isFinite(depth) ? depth : null,
      mag,
      magType: typeof p.magType === 'string' && p.magType ? p.magType : null,
      place: typeof p.place === 'string' ? p.place : '',
      url: typeof p.url === 'string' ? p.url : null,
      status: typeof p.status === 'string' ? p.status : null,
      updated: Number.isFinite(p.updated) ? isoSeconds(p.updated) : null,
    });
  }
  return {
    rows,
    source: {
      id: 'usgs-fdsn',
      name: 'USGS earthquake catalog (ComCat), FDSN event query for the watch-area box',
      provider: 'U.S. Geological Survey',
      url,
      productUrl: 'https://earthquake.usgs.gov/fdsnws/event/1/',
      retrievedAt: ctx.retrievedAt,
      lastModified,
      rowsRead: json.features.length,
      rowsKept: rows.length,
      attribution: USGS_ATTRIBUTION,
      licence: USGS_LICENCE,
    },
  };
}

// ---------------------------------------------------------------------------
// BMKG

function bmkgDataTerbukaRows(json, product, url) {
  const list = json?.Infogempa?.gempa;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${url}: expected Infogempa.gempa to be a non-empty list`);
  return list.map((g) => {
    const t = Date.parse(String(g.DateTime ?? ''));
    const [lat, lon] = String(g.Coordinates ?? '').split(',').map(num);
    const mag = num(g.Magnitude);
    if (!Number.isFinite(t) || lat === null || lon === null || mag === null) {
      throw new Error(`${url}: an entry has no usable DateTime, Coordinates or Magnitude`);
    }
    return {
      source: 'bmkg',
      product,
      eventId: null,
      time: isoSeconds(t),
      lat,
      lon,
      depthKm: num(g.Kedalaman),
      mag,
      magType: null,
      place: typeof g.Wilayah === 'string' ? g.Wilayah : '',
      url: null,
      status: null,
      felt: typeof g.Dirasakan === 'string' ? g.Dirasakan : null,
    };
  });
}

function xmlField(block, tag) {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block);
  return m ? m[1].trim() : null;
}

/** live30event.xml `waktu` is UTC ("2026/10/13  06:42:29.657"); see data/SOURCES.md for the check. */
function bmkgLive30Rows(xml, url) {
  const blocks = [...xml.matchAll(/<gempa>([\s\S]*?)<\/gempa>/g)].map((m) => m[1]);
  if (blocks.length === 0) throw new Error(`${url}: no <gempa> entries`);
  return blocks.map((b) => {
    const w = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(xmlField(b, 'waktu') ?? '');
    const lat = num(xmlField(b, 'lintang'));
    const lon = num(xmlField(b, 'bujur'));
    const mag = num(xmlField(b, 'mag'));
    if (!w || lat === null || lon === null || mag === null) throw new Error(`${url}: an entry has no usable waktu, lintang, bujur or mag`);
    const t = Date.UTC(+w[1], +w[2] - 1, +w[3], +w[4], +w[5], +w[6]);
    return {
      source: 'bmkg',
      product: 'live30event',
      eventId: xmlField(b, 'eventid'),
      time: isoSeconds(t),
      lat,
      lon,
      depthKm: num(xmlField(b, 'dalam')),
      mag,
      magType: null,
      place: xmlField(b, 'area') ?? '',
      url: null,
      status: xmlField(b, 'status'),
      felt: null,
    };
  });
}

async function fetchBmkg(ctx) {
  const specs = [
    {
      product: 'gempaterkini',
      url: `${BMKG_TEWS}/gempaterkini.json`,
      name: 'BMKG Data Terbuka gempaterkini.json (latest 15 earthquakes M 5.0+)',
      productUrl: 'https://data.bmkg.go.id/gempabumi/',
      parse: async (res, url) => bmkgDataTerbukaRows(await res.json(), 'gempaterkini', url),
    },
    {
      product: 'gempadirasakan',
      url: `${BMKG_TEWS}/gempadirasakan.json`,
      name: 'BMKG Data Terbuka gempadirasakan.json (latest 15 felt earthquakes)',
      productUrl: 'https://data.bmkg.go.id/gempabumi/',
      parse: async (res, url) => bmkgDataTerbukaRows(await res.json(), 'gempadirasakan', url),
    },
    {
      product: 'live30event',
      url: `${BMKG_INATEWS}/live30event.xml`,
      name: 'BMKG InaTEWS live30event.xml (latest located earthquakes, all magnitudes)',
      productUrl: 'https://inatews.bmkg.go.id/',
      parse: async (res, url) => bmkgLive30Rows(await res.text(), url),
    },
  ];
  const rows = [];
  const sources = [];
  const all = {};
  for (const s of specs) {
    const res = await fetchOk(s.url, 60_000);
    const parsed = await s.parse(res, s.url);
    all[s.product] = parsed;
    const inWindow = parsed.filter((r) => r.time >= ctx.windowStart && r.time <= ctx.retrievedAt);
    const near = inWindow.filter((r) => nearAnyArea(ctx.areas, ctx.seismicBounds, r.lat, r.lon, COLLECT_SEISMIC_RADIUS_KM));
    rows.push(...near);
    const times = parsed.map((r) => r.time).sort();
    sources.push({
      id: `bmkg-${s.product}`,
      name: s.name,
      provider: 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
      url: s.url,
      productUrl: s.productUrl,
      retrievedAt: ctx.retrievedAt,
      lastModified: headerTime(res, 'last-modified'),
      rowsRead: parsed.length,
      rowsKept: near.length,
      coversFrom: times[0] ?? null,
      coversTo: times[times.length - 1] ?? null,
      attribution: BMKG_ATTRIBUTION,
      licence: BMKG_LICENCE,
    });
  }

  // Time-zone check for live30event: felt events (gempadirasakan, ISO UTC) that fall inside the
  // live30event period should appear there within 10 s when live30event `waktu` is read as UTC.
  const live = all.live30event;
  const liveFrom = live.reduce((m, r) => (r.time < m ? r.time : m), live[0].time);
  const felt = all.gempadirasakan.filter((r) => r.time >= liveFrom);
  const matched = felt.filter((f) =>
    live.some((l) => Math.abs(Date.parse(l.time) - Date.parse(f.time)) <= 10_000 && haversineKm(l.lat, l.lon, f.lat, f.lon) <= 100),
  );
  const check = {
    live30eventTimesAreUtc: {
      feltEventsInPeriod: felt.length,
      matchedWithin10sAnd100km: matched.length,
      note: 'BMKG gempadirasakan DateTime is ISO UTC. Each felt event in the live30event period should match a live30event entry when live30event waktu is read as UTC.',
    },
  };
  if (felt.length > 0 && matched.length === 0) {
    throw new Error('BMKG live30event times did not match any felt event when read as UTC; the time zone may have changed');
  }
  return { rows, sources, check };
}

// ---------------------------------------------------------------------------
// Output

function rowsFile(about, rows) {
  const body = rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
  return `{\n  "about": ${JSON.stringify(about)},\n  "rows": [\n${body}${rows.length ? '\n' : ''}  ]\n}\n`;
}

function sortRows(rows, keyFn) {
  return [...rows].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

async function writeAllOrNothing(files) {
  await mkdir(OUT_DIR, { recursive: true });
  const temps = [];
  try {
    for (const [target, content] of files) {
      const tmp = `${target}.tmp`;
      await writeFile(tmp, content, 'utf8');
      temps.push([tmp, target]);
    }
  } catch (err) {
    await Promise.all(temps.map(([tmp]) => rm(tmp, { force: true })));
    throw err;
  }
  for (const [tmp, target] of temps) await rename(tmp, target);
}

// ---------------------------------------------------------------------------

async function main() {
  const startedMs = Date.now();
  const retrievedAt = isoSeconds(startedMs);
  const today = new Date(startedMs);
  const endDayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const startDayMs = endDayMs - (WINDOW_DAYS - 1) * DAY_MS;
  const windowStart = isoSeconds(startDayMs);

  const watches = JSON.parse(await readFile(WATCHES_PATH, 'utf8'));
  const areas = loadWatchAreas(watches);
  const ctx = {
    retrievedAt,
    windowStart,
    startDate: windowStart.slice(0, 10),
    endDate: retrievedAt.slice(0, 10),
    areas,
    thermalBounds: boundsFor(areas, COLLECT_THERMAL_RADIUS_KM),
    seismicBounds: boundsFor(areas, COLLECT_SEISMIC_RADIUS_KM),
  };

  console.log(`Snapshot window ${windowStart} to ${retrievedAt} (${WINDOW_DAYS} UTC days). Downloading...`);
  const [firmsResults, usgs, bmkg] = await Promise.all([
    Promise.all(FIRMS_FILES.map((f) => fetchFirms(f, ctx))),
    fetchUsgs(ctx),
    fetchBmkg(ctx),
  ]);

  const firmsRows = sortRows(
    firmsResults.flatMap((r) => r.rows),
    (r) => `${r.acq_date}T${r.acq_time}|${r.file}|${r.latitude.toFixed(5)}|${r.longitude.toFixed(5)}`,
  );
  const quakeRows = sortRows([...usgs.rows, ...bmkg.rows], (r) => `${r.time}|${r.source}|${r.product}|${r.eventId ?? ''}`);
  const sources = [...firmsResults.map((r) => r.source), usgs.source, ...bmkg.sources];

  const meta = {
    about:
      'ASEAN Watch real-data snapshot written by scripts/refresh-data.mjs. Records are real; nothing is simulated. ' +
      'Anomalies are decided by the stated watch rules in src/lib/watchRules.ts, not here.',
    schema: 1,
    retrievedAt,
    window: { start: windowStart, end: retrievedAt, days: WINDOW_DAYS },
    collection: {
      thermalRadiusKm: COLLECT_THERMAL_RADIUS_KM,
      seismicRadiusKm: COLLECT_SEISMIC_RADIUS_KM,
      note:
        'Rows were kept within these distances of each volcano summit point, or inside each haze box, and inside the window. ' +
        'The watch rules use smaller radii and drop the rest.',
    },
    sources,
    checks: bmkg.check,
  };

  const updatedWatches = watches.map((w) => ({ ...w, scenarioWindow: { start: windowStart, end: retrievedAt } }));
  const files = [
    [path.join(OUT_DIR, 'firms.json'), rowsFile('NASA FIRMS hotspot rows near the watch areas; columns as in the FIRMS CSVs, plus "file" (which CSV).', firmsRows)],
    [path.join(OUT_DIR, 'quakes.json'), rowsFile('USGS and BMKG earthquake rows near the watch areas, one row per product; duplicates across agencies and products are kept on purpose.', quakeRows)],
    [path.join(OUT_DIR, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`],
    [WATCHES_PATH, `${JSON.stringify(updatedWatches, null, 2)}\n`],
  ];
  const snapshotBytes = files.slice(0, 3).reduce((n, [, c]) => n + Buffer.byteLength(c, 'utf8'), 0);
  if (snapshotBytes > SIZE_BUDGET_BYTES) {
    throw new Error(`snapshot would be ${Math.round(snapshotBytes / 1024)} KB, over the ${SIZE_BUDGET_BYTES / 1024} KB budget; nothing written`);
  }
  await writeAllOrNothing(files);

  console.log(`Wrote data/real/ (${Math.round(snapshotBytes / 1024)} KB) and the scenarioWindow in data/watches.json.`);
  for (const s of sources) {
    console.log(`  ${s.id.padEnd(22)} read ${String(s.rowsRead).padStart(6)}  kept ${String(s.rowsKept).padStart(4)}  last-modified ${s.lastModified ?? 'n/a'}`);
  }
  console.log(`  live30event UTC check: ${bmkg.check.live30eventTimesAreUtc.matchedWithin10sAnd100km} of ${bmkg.check.live30eventTimesAreUtc.feltEventsInPeriod} felt events matched`);
  console.log(`Done in ${((Date.now() - startedMs) / 1000).toFixed(1)} s.`);
}

main().catch((err) => {
  console.error(`refresh-data failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Nothing was written; the previous snapshot in data/real/ is unchanged.');
  process.exit(1);
});
