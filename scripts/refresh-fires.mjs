#!/usr/bin/env node
// Refreshes data/fires-snapshot.json: a FIRMS-based, Fire Emissions Watch style summary of active fires
// over the whole FIRMS "South East Asia" region (about 12°S to 31°N, 88°E to 160°E). Plain Node 22+, no
// dependencies. Run: npm run refresh:fires   (or: node scripts/refresh-fires.mjs)
//
// Source: the four NASA FIRMS 7-day South East Asia CSVs (open, no key): VIIRS 375 m on Suomi NPP, NOAA-20
// and NOAA-21, and MODIS C6.1 (Terra and Aqua). About 8 MB each, streamed line by line, never held whole.
// Kept: confident detections only (VIIRS confidence nominal or high; MODIS confidence 50 or more, the
// same thresholds as src/lib/watchRules.ts).
//
// What it writes (everything is MEASURED satellite detections; no emissions, no model):
//   grid      Detections binned into 0.25° cells per 24-hour period counted back from the snapshot time
//             (period 0 = the last 24 h). Rolling periods, not UTC days, so "the last 24 h" always holds a
//             full day of overpasses. Per cell: detection count, summed FRP (MW), max FRP (MW), and a mask
//             of the sensors that saw it. Older periods fall back to 0.5° cells only if the file would
//             otherwise exceed the size budget.
//   countries Per country (point in polygon against data/region.geojson, Natural Earth): count, summed
//             FRP and per-sensor counts for each of the 7 periods.
//   regions   Indonesian provinces and Malaysian states: each detection takes the province or state of
//             the NEAREST regency/district centre in data/fire-admin-lookup.json. Approximate.
//   clusters  Top fire clusters for the last 24 h and the last 7 days: connected 0.25° cells (8-neighbour),
//             large complexes split into pieces of at most about 1.25°, ranked by summed FRP, named after
//             the nearest regency/district (IDN, MYS) or province (other ASEAN members) centre.
//   history   Complete UTC days (count and summed FRP per country and region), carried forward from the
//             previous snapshot so week-over-week change becomes available after 14 days of refreshes.
//
// FRP is a proxy for fire intensity, not emissions. CAMS GFAS / Fire Emissions Watch converts FRP to
// emissions; this file never states emissions.
//
// All or nothing: if any download or parse fails, or the file would exceed the size budget, nothing is
// written, the previous snapshot stays in place, and the script exits with code 1.

import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'data', 'fires-snapshot.json');
const REGION_PATH = path.join(ROOT, 'data', 'region.geojson');
const ADMIN_PATH = path.join(ROOT, 'data', 'fire-admin-lookup.json');

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PERIODS = 7;
/**
 * A sensor whose latest detection is this much older than the freshest sensor's is treated as lagging
 * (an outage) and does not hold the reference time back; the snapshot names it.
 */
const LAGGING_SENSOR_H = 36;
const HISTORY_MAX_DAYS = 35;
const SIZE_BUDGET_BYTES = 600 * 1024;
const MODIS_MIN_CONFIDENCE = 50;
const USER_AGENT = 'asean-watch refresh-fires script (open-data snapshot for a prototype)';

/** Fixed grid frame (covers the FIRMS South East Asia region with margin). Cell index = row * nCols + col. */
const FRAME = { originLat: -20, originLon: 80, maxLat: 40, maxLon: 170 };
const BASE_CELL = 0.25;
const COARSE_CELL = 0.5;
/** Coastal fallback: a point outside every country polygon within this distance of one is given to it. */
const COAST_SNAP_DEG = 0.15;
/** Cluster complexes wider than this many base cells are split into pieces around the strongest cells. */
const SPLIT_SPAN_CELLS = 5;
const SPLIT_RADIUS_CELLS = 2;
const TOP_CLUSTERS = 15;

const FIRMS_ATTRIBUTION =
  "NASA FIRMS, LANCE. We acknowledge the use of data and/or imagery from NASA's Fire Information " +
  'for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA\'s Land, ' +
  'Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) ' +
  "and NASA's Earth Science Data and Information System (ESDIS).";
const FIRMS_LICENCE = 'NASA open data (full and open sharing); FIRMS asks redistributors to use the acknowledgement above.';
const REGION_ATTRIBUTION = 'Country boundaries: Natural Earth (public domain), data/region.geojson.';

const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire';
const VIIRS_PRODUCT_URL = 'https://www.earthdata.nasa.gov/data/instruments/viirs/viirs-i-band-375-m-active-fire-data';
const MODIS_PRODUCT_URL = 'https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs';

/** Sensor order is fixed: index i is bit (1 << i) of the cell sensor mask and slot i of every sensor array. */
const SENSORS = ['snpp', 'noaa20', 'noaa21', 'modis'];
const FIRMS_FILES = [
  {
    sensor: 'snpp',
    name: 'NASA FIRMS VIIRS 375 m NRT (Suomi NPP), South East Asia, last 7 days (CSV)',
    url: `${FIRMS_BASE}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_7d.csv`,
    productUrl: VIIRS_PRODUCT_URL,
    kind: 'viirs',
  },
  {
    sensor: 'noaa20',
    name: 'NASA FIRMS VIIRS 375 m NRT (NOAA-20), South East Asia, last 7 days (CSV)',
    url: `${FIRMS_BASE}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_7d.csv`,
    productUrl: VIIRS_PRODUCT_URL,
    kind: 'viirs',
  },
  {
    sensor: 'noaa21',
    name: 'NASA FIRMS VIIRS 375 m NRT (NOAA-21), South East Asia, last 7 days (CSV)',
    url: `${FIRMS_BASE}/noaa-21-viirs-c2/csv/J2_VIIRS_C2_SouthEast_Asia_7d.csv`,
    productUrl: VIIRS_PRODUCT_URL,
    kind: 'viirs',
  },
  {
    sensor: 'modis',
    name: 'NASA FIRMS MODIS C6.1 1 km NRT (Terra and Aqua), South East Asia, last 7 days (CSV)',
    url: `${FIRMS_BASE}/modis-c6.1/csv/MODIS_C6_1_SouthEast_Asia_7d.csv`,
    productUrl: MODIS_PRODUCT_URL,
    kind: 'modis',
  },
];

/** Natural Earth names in data/region.geojson to ISO 3166-1 alpha-3. */
const ISO3_BY_NAME = {
  'Ashmore and Cartier Is.': 'AUS',
  Australia: 'AUS',
  Bangladesh: 'BGD',
  Bhutan: 'BTN',
  'Br. Indian Ocean Ter.': 'IOT',
  China: 'CHN',
  Guam: 'GUM',
  'Hong Kong': 'HKG',
  India: 'IND',
  Japan: 'JPN',
  Macao: 'MAC',
  Maldives: 'MDV',
  Micronesia: 'FSM',
  'N. Mariana Is.': 'MNP',
  Nepal: 'NPL',
  'North Korea': 'PRK',
  Pakistan: 'PAK',
  Palau: 'PLW',
  'Papua New Guinea': 'PNG',
  'Solomon Is.': 'SLB',
  'South Korea': 'KOR',
  'Sri Lanka': 'LKA',
  Taiwan: 'TWN',
  Brunei: 'BRN',
  Cambodia: 'KHM',
  Indonesia: 'IDN',
  Laos: 'LAO',
  Malaysia: 'MYS',
  Myanmar: 'MMR',
  Philippines: 'PHL',
  Singapore: 'SGP',
  Thailand: 'THA',
  'Timor-Leste': 'TLS',
  Vietnam: 'VNM',
};
const UNASSIGNED = { iso3: 'XXX', name: 'Outside country boundaries', asean: false };
/** Countries whose first-level regions are rolled up (others are named only). */
const ROLLUP_REGION_ISO3 = new Set(['IDN', 'MYS']);

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

function num(value) {
  const n = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

/** MW values: one decimal below 10 MW, whole MW above (keeps the bundled file small). */
function mw(x) {
  return x < 10 ? Math.round(x * 10) / 10 : Math.round(x);
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const zeros = () => new Array(PERIODS).fill(0);

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

// ---------------------------------------------------------------------------
// Countries: point in polygon against data/region.geojson, with a coastal snap

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist2(px, py, ax, ay, bx, by, k) {
  const x = (px - ax) * k;
  const y = py - ay;
  const dx = (bx - ax) * k;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const f = len2 > 0 ? Math.min(1, Math.max(0, (x * dx + y * dy) / len2)) : 0;
  const ex = x - f * dx;
  const ey = y - f * dy;
  return ex * ex + ey * ey;
}

function buildCountryIndex(geojson) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) throw new Error('data/region.geojson is not a FeatureCollection');
  const parts = [];
  for (const f of geojson.features) {
    const name = f?.properties?.name;
    if (typeof name !== 'string') throw new Error('data/region.geojson: a feature has no name');
    const iso3 = ISO3_BY_NAME[name];
    if (!iso3) throw new Error(`data/region.geojson: no ISO3 code for "${name}"; add it to ISO3_BY_NAME`);
    const country = { iso3, name: name === 'Ashmore and Cartier Is.' ? 'Australia' : name, asean: f.properties.asean === true };
    const polys = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const rings of polys) {
      let minX = 180;
      let minY = 90;
      let maxX = -180;
      let maxY = -90;
      for (const [x, y] of rings[0]) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      parts.push({ country, rings, bbox: [minX, minY, maxX, maxY] });
    }
  }
  // 1° buckets of part ids (bbox expanded by the coastal snap distance).
  const buckets = new Map();
  parts.forEach((p, id) => {
    const [x0, y0, x1, y1] = p.bbox;
    for (let by = Math.floor(y0 - COAST_SNAP_DEG); by <= Math.floor(y1 + COAST_SNAP_DEG); by += 1) {
      for (let bx = Math.floor(x0 - COAST_SNAP_DEG); bx <= Math.floor(x1 + COAST_SNAP_DEG); bx += 1) {
        const key = by * 1000 + bx;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(id);
      }
    }
  });
  const cache = new Map();
  const stats = { inside: 0, coastal: 0, outside: 0 };

  function lookup(lat, lon) {
    const candidates = buckets.get(Math.floor(lat) * 1000 + Math.floor(lon)) ?? [];
    for (const id of candidates) {
      const p = parts[id];
      const [x0, y0, x1, y1] = p.bbox;
      if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
      if (!inRing(lon, lat, p.rings[0])) continue;
      let hole = false;
      for (let h = 1; h < p.rings.length && !hole; h += 1) hole = inRing(lon, lat, p.rings[h]);
      if (!hole) return { country: p.country, how: 'inside' };
    }
    const k = Math.cos((lat * Math.PI) / 180);
    let best = { country: null, d2: COAST_SNAP_DEG * COAST_SNAP_DEG };
    for (const id of candidates) {
      const p = parts[id];
      const [x0, y0, x1, y1] = p.bbox;
      if (lon < x0 - COAST_SNAP_DEG || lon > x1 + COAST_SNAP_DEG || lat < y0 - COAST_SNAP_DEG || lat > y1 + COAST_SNAP_DEG) continue;
      const ring = p.rings[0];
      for (let i = 1; i < ring.length; i += 1) {
        const d2 = segDist2(lon, lat, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1], k);
        if (d2 < best.d2) best = { country: p.country, d2 };
      }
    }
    return best.country ? { country: best.country, how: 'coastal' } : { country: UNASSIGNED, how: 'outside' };
  }

  /** Nearest country polygon edge, any distance (for naming offshore clusters). */
  function nearestCountry(lat, lon) {
    const k = Math.cos((lat * Math.PI) / 180);
    let best = { country: null, d2: Infinity };
    for (const p of parts) {
      const ring = p.rings[0];
      const [x0, y0, x1, y1] = p.bbox;
      const dx = Math.max(0, x0 - lon, lon - x1) * k;
      const dy = Math.max(0, y0 - lat, lat - y1);
      if (dx * dx + dy * dy > best.d2) continue;
      for (let i = 1; i < ring.length; i += 1) {
        const d2 = segDist2(lon, lat, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1], k);
        if (d2 < best.d2) best = { country: p.country, d2 };
      }
    }
    return best.country ? { country: best.country, km: Math.round(Math.sqrt(best.d2) * 111.32) } : null;
  }

  return {
    stats,
    nearestCountry,
    countryAt(lat, lon) {
      const key = `${Math.round(lat * 100)}:${Math.round(lon * 100)}`;
      let hit = cache.get(key);
      if (!hit) cache.set(key, (hit = lookup(lat, lon)));
      stats[hit.how] += 1;
      return hit.country;
    },
  };
}

// ---------------------------------------------------------------------------
// Regions and place names: nearest centre in data/fire-admin-lookup.json

function buildAdminIndex(lookup) {
  if (!lookup?.countries || typeof lookup.countries !== 'object') throw new Error('data/fire-admin-lookup.json has no countries; run npm run build:fire-admin');
  for (const iso3 of ROLLUP_REGION_ISO3) {
    if (!Array.isArray(lookup.countries[iso3]) || lookup.countries[iso3].length === 0) throw new Error(`data/fire-admin-lookup.json has no ${iso3} points`);
  }
  const cache = new Map();
  function nearest(iso3, lat, lon) {
    const pts = lookup.countries[iso3];
    if (!Array.isArray(pts) || pts.length === 0) return null;
    const key = `${iso3}:${Math.round(lat * 50)}:${Math.round(lon * 50)}`;
    if (cache.has(key)) return cache.get(key);
    const k = Math.cos((lat * Math.PI) / 180) ** 2;
    let best = null;
    let bestD = Infinity;
    for (const p of pts) {
      const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2 * k;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    const out = best ? { adm2: best.name ?? null, adm1: best.adm1, km: Math.round(Math.sqrt(bestD) * 111.32) } : null;
    cache.set(key, out);
    return out;
  }
  return { nearest };
}

// ---------------------------------------------------------------------------
// Accumulators

function newRollup(extra) {
  return { ...extra, count: zeros(), frp: zeros(), frpMax: zeros(), sensors: SENSORS.map(() => zeros()), w: [0, 0, 0, 0, 0, 0] };
}

/** Weighted sums for the centre of the last 24 h ([0..2]) and of all 7 periods ([3..5]); weight 1 + FRP. */
function addCentre(roll, p, lat, lon, frp) {
  const wt = 1 + frp;
  if (p === 0) {
    roll.w[0] += lat * wt;
    roll.w[1] += lon * wt;
    roll.w[2] += wt;
  }
  roll.w[3] += lat * wt;
  roll.w[4] += lon * wt;
  roll.w[5] += wt;
}

function addTo(roll, p, s, frp) {
  roll.count[p] += 1;
  roll.frp[p] += frp;
  if (frp > roll.frpMax[p]) roll.frpMax[p] = frp;
  roll.sensors[s][p] += 1;
}

function rollupOut(r) {
  const { count, frp, frpMax, sensors, w, ...rest } = r;
  const centre24h = w[2] > 0 ? [r4(w[0] / w[2]), r4(w[1] / w[2])] : null;
  const centre7d = w[5] > 0 ? [r4(w[3] / w[5]), r4(w[4] / w[5])] : null;
  return { ...rest, centre24h, centre7d, count, frp: frp.map(mw), frpMax: frpMax.map(mw), sensors };
}

function cellIndex(lat, lon, cellDeg) {
  const nCols = Math.round((FRAME.maxLon - FRAME.originLon) / cellDeg);
  const row = Math.floor((lat - FRAME.originLat) / cellDeg);
  const col = Math.floor((lon - FRAME.originLon) / cellDeg);
  return row * nCols + col;
}

const BASE_COLS = Math.round((FRAME.maxLon - FRAME.originLon) / BASE_CELL);

// ---------------------------------------------------------------------------
// NASA FIRMS (streamed CSV)

const FIRMS_REQUIRED = ['latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'confidence', 'version', 'frp', 'daynight'];

function confident(kind, raw) {
  const c = raw.trim().toLowerCase();
  if (kind === 'modis') {
    const n = num(c);
    return n === null ? null : n >= MODIS_MIN_CONFIDENCE;
  }
  if (c === 'n' || c === 'nominal' || c === 'h' || c === 'high') return true;
  if (c === 'l' || c === 'low') return false;
  return null;
}

async function fetchFirms(file, ctx) {
  const s = SENSORS.indexOf(file.sensor);
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
  const st = { rowsRead: 0, rowsInvalid: 0, rowsLowConfidence: 0, rowsConfident: 0, earliest: Infinity, latest: -Infinity };
  const satellites = new Set();

  const handle = (rawLine) => {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') return;
    if (header === null) {
      header = line.split(',').map((h) => h.trim());
      const missing = FIRMS_REQUIRED.filter((c) => !header.includes(c));
      if (missing.length > 0) throw new Error(`${file.url}: unexpected CSV header, missing ${missing.join(', ')}`);
      col = Object.fromEntries(header.map((h, i) => [h, i]));
      return;
    }
    st.rowsRead += 1;
    const c = line.split(',');
    if (c.length !== header.length) {
      st.rowsInvalid += 1;
      return;
    }
    const lat = num(c[col.latitude]);
    const lon = num(c[col.longitude]);
    const date = c[col.acq_date];
    const time = c[col.acq_time].trim().padStart(4, '0');
    const frp = num(c[col.frp]);
    const ok = confident(file.kind, c[col.confidence]);
    if (lat === null || lon === null || frp === null || ok === null || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}$/.test(time)) {
      st.rowsInvalid += 1;
      return;
    }
    const t = Date.parse(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);
    if (!Number.isFinite(t)) {
      st.rowsInvalid += 1;
      return;
    }
    satellites.add(c[col.satellite].trim());
    if (t < st.earliest) st.earliest = t;
    if (t > st.latest) st.latest = t;
    if (!ok) {
      st.rowsLowConfidence += 1;
      return;
    }
    st.rowsConfident += 1;
    ctx.rows.push({ s, lat, lon, t, date, frp: Math.max(0, frp) });
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
  if (header === null || st.rowsRead === 0) throw new Error(`${file.url}: no data rows`);
  if (st.rowsInvalid > st.rowsRead * 0.01) throw new Error(`${file.url}: ${st.rowsInvalid} of ${st.rowsRead} rows could not be parsed`);

  return {
    sensor: file.sensor,
    earliestMs: st.earliest,
    latestMs: st.latest,
    source: {
      id: `firms-${file.sensor}`,
      sensor: file.sensor,
      name: file.name,
      provider: 'NASA FIRMS (LANCE)',
      url: file.url,
      productUrl: file.productUrl,
      retrievedAt: ctx.retrievedAt,
      lastModified,
      bytes,
      rowsRead: st.rowsRead,
      rowsInvalid: st.rowsInvalid,
      rowsLowConfidence: st.rowsLowConfidence,
      rowsConfident: st.rowsConfident,
      rowsInPeriods: 0,
      rowsAfterReference: 0,
      earliestDetection: Number.isFinite(st.earliest) ? isoSeconds(st.earliest) : null,
      latestDetection: Number.isFinite(st.latest) ? isoSeconds(st.latest) : null,
      satelliteCodes: [...satellites].sort(),
      attribution: FIRMS_ATTRIBUTION,
      licence: FIRMS_LICENCE,
    },
  };
}

// ---------------------------------------------------------------------------
// Grid encoding

/** Aggregate base cells (0.25°) of one period to `cellDeg` and encode as a flat delta list. */
function encodePeriod(baseCells, cellDeg) {
  const nCols = Math.round((FRAME.maxLon - FRAME.originLon) / cellDeg);
  const factor = Math.round(cellDeg / BASE_CELL);
  const agg = new Map();
  for (const [idx, v] of baseCells) {
    let key = idx;
    if (factor !== 1) {
      const row = Math.floor(idx / BASE_COLS);
      const col = idx % BASE_COLS;
      key = Math.floor(row / factor) * nCols + Math.floor(col / factor);
    }
    const a = agg.get(key);
    if (!a) agg.set(key, { n: v.n, frp: v.frp, max: v.max, mask: v.mask });
    else {
      a.n += v.n;
      a.frp += v.frp;
      a.max = Math.max(a.max, v.max);
      a.mask |= v.mask;
    }
  }
  const keys = [...agg.keys()].sort((a, b) => a - b);
  const data = [];
  let prev = 0;
  for (const k of keys) {
    const a = agg.get(k);
    data.push(k - prev, a.n, mw(a.frp), mw(a.max), a.mask);
    prev = k;
  }
  return { cellDeg, nCols, cells: keys.length, data };
}

// ---------------------------------------------------------------------------
// Clusters

function neighbours(idx) {
  const row = Math.floor(idx / BASE_COLS);
  const col = idx % BASE_COLS;
  const out = [];
  for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) if (dr || dc) out.push((row + dr) * BASE_COLS + (col + dc));
  return out;
}

const rowOf = (idx) => Math.floor(idx / BASE_COLS);
const colOf = (idx) => idx % BASE_COLS;
const centreLat = (idx) => FRAME.originLat + (rowOf(idx) + 0.5) * BASE_CELL;
const centreLon = (idx) => FRAME.originLon + (colOf(idx) + 0.5) * BASE_CELL;

/** Window totals per base cell: periods [0, toPeriod]. */
function windowCells(cellPeriods, toPeriod) {
  const out = new Map();
  for (const [idx, per] of cellPeriods) {
    let n = 0;
    let frp = 0;
    for (let p = 0; p <= toPeriod; p += 1) {
      if (!per[p]) continue;
      n += per[p].n;
      frp += per[p].frp;
    }
    if (n > 0) out.set(idx, { n, frp });
  }
  return out;
}

function components(cells) {
  const seen = new Set();
  const comps = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const idx = stack.pop();
      comp.push(idx);
      for (const nb of neighbours(idx)) {
        if (cells.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

/** Split a wide complex into compact pieces: strongest unassigned cell + its cells within the radius. */
function splitComponent(comp, cells) {
  const rows = comp.map(rowOf);
  const cols = comp.map(colOf);
  const span = Math.max(Math.max(...rows) - Math.min(...rows), Math.max(...cols) - Math.min(...cols)) + 1;
  if (span <= SPLIT_SPAN_CELLS) return [comp];
  const order = [...comp].sort((a, b) => cells.get(b).frp - cells.get(a).frp || cells.get(b).n - cells.get(a).n || a - b);
  const taken = new Set();
  const pieces = [];
  for (const seed of order) {
    if (taken.has(seed)) continue;
    const piece = [];
    for (const idx of order) {
      if (taken.has(idx)) continue;
      if (Math.abs(rowOf(idx) - rowOf(seed)) <= SPLIT_RADIUS_CELLS && Math.abs(colOf(idx) - colOf(seed)) <= SPLIT_RADIUS_CELLS) {
        piece.push(idx);
        taken.add(idx);
      }
    }
    pieces.push(piece);
  }
  return pieces;
}

function buildClusters(windowKey, toPeriod, ctx) {
  const cells = windowCells(ctx.cellPeriods, toPeriod);
  const pieces = components(cells).flatMap((c) => splitComponent(c, cells));
  const owner = new Map();
  pieces.forEach((piece, i) => piece.forEach((idx) => owner.set(idx, i)));
  const scored = pieces.map((piece, i) => {
    let n = 0;
    let frp = 0;
    for (const idx of piece) {
      n += cells.get(idx).n;
      frp += cells.get(idx).frp;
    }
    return { i, piece, n, frp };
  });
  scored.sort((a, b) => b.frp - a.frp || b.n - a.n || Math.min(...a.piece) - Math.min(...b.piece));
  return scored.slice(0, TOP_CLUSTERS).map(({ i, piece }, rank) => {
    // Footprint for the period series: own cells plus the neighbouring cells no other piece owns.
    const foot = new Set(piece);
    for (const idx of piece) for (const nb of neighbours(idx)) if (!owner.has(nb) || owner.get(nb) === i) foot.add(nb);
    const series = { count: zeros(), frp: zeros(), frpMax: zeros(), sensors: SENSORS.map(() => zeros()) };
    for (const idx of foot) {
      const per = ctx.cellPeriods.get(idx);
      if (!per) continue;
      for (let p = 0; p < PERIODS; p += 1) {
        const v = per[p];
        if (!v) continue;
        series.count[p] += v.n;
        series.frp[p] += v.frp;
        series.frpMax[p] = Math.max(series.frpMax[p], v.max);
        for (let s = 0; s < SENSORS.length; s += 1) series.sensors[s][p] += v.sensors[s];
      }
    }
    // FRP-weighted centre (count and FRP both pull) and bbox of the own cells, over the window.
    let wLat = 0;
    let wLon = 0;
    let w = 0;
    let minLat = 90;
    let maxLat = -90;
    let minLon = 180;
    let maxLon = -180;
    const countryVotes = new Map();
    for (const idx of piece) {
      const c = cells.get(idx);
      const wt = c.n + c.frp;
      wLat += centreLat(idx) * wt;
      wLon += centreLon(idx) * wt;
      w += wt;
      minLat = Math.min(minLat, centreLat(idx) - BASE_CELL / 2);
      maxLat = Math.max(maxLat, centreLat(idx) + BASE_CELL / 2);
      minLon = Math.min(minLon, centreLon(idx) - BASE_CELL / 2);
      maxLon = Math.max(maxLon, centreLon(idx) + BASE_CELL / 2);
      for (const [iso3, n] of ctx.cellCountries.get(idx) ?? []) countryVotes.set(iso3, (countryVotes.get(iso3) ?? 0) + n);
    }
    const lat = wLat / w;
    const lon = wLon / w;
    const iso3 = [...countryVotes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? 'XXX';
    const place = namePlace(iso3, lat, lon, ctx);
    const windowCount = toPeriod === 0 ? series.count[0] : series.count.reduce((a, b) => a + b, 0);
    return {
      id: `${windowKey}-${rank + 1}`,
      window: windowKey,
      rank: rank + 1,
      name: place.name,
      badge: place.badge,
      place: place.place,
      lat: r4(lat),
      lon: r4(lon),
      bbox: [r4(minLat), r4(minLon), r4(maxLat), r4(maxLon)],
      cells: [...piece].sort((a, b) => a - b),
      windowCount,
      count: series.count,
      frp: series.frp.map(mw),
      frpMax: series.frpMax.map(mw),
      sensors: series.sensors,
    };
  });
}

function namePlace(iso3, lat, lon, ctx) {
  if (iso3 === 'XXX') {
    const near = ctx.countries.nearestCountry(lat, lon);
    const nearName = near?.country?.name ?? null;
    return {
      name: nearName ? `Offshore, ${near.km} km from ${nearName}` : 'Offshore',
      badge: 'Offshore',
      place: { iso3: 'XXX', country: UNASSIGNED.name, adm1: null, adm2: null, nearestCountry: nearName, method: 'outside country polygons' },
    };
  }
  const country = ctx.countryMeta.get(iso3);
  const countryName = country?.name ?? iso3;
  const near = ctx.admin.nearest(iso3, lat, lon);
  if (near && near.adm2) {
    return {
      name: `${near.adm2}, ${near.adm1}`,
      badge: near.adm2,
      place: { iso3, country: countryName, adm1: near.adm1, adm2: near.adm2, centreKm: near.km, method: 'nearest regency/district centre (approximate)' },
    };
  }
  if (near) {
    return {
      name: `${near.adm1}, ${countryName}`,
      badge: near.adm1,
      place: { iso3, country: countryName, adm1: near.adm1, adm2: null, centreKm: near.km, method: 'nearest province centre (approximate)' },
    };
  }
  return { name: countryName, badge: countryName, place: { iso3, country: countryName, adm1: null, adm2: null, method: 'country only' } };
}

const fmtLatLon = (lat, lon) => `${Math.abs(lat).toFixed(1)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(1)}°${lon < 0 ? 'W' : 'E'}`;

/** Pieces of one complex can share the nearest centre: give repeated names their coordinates. */
function disambiguate(list) {
  const seen = new Map();
  for (const c of list) seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
  return list.map((c) => (seen.get(c.name) > 1 ? { ...c, name: `${c.name} (${fmtLatLon(c.lat, c.lon)})` } : c));
}

// ---------------------------------------------------------------------------
// History (complete UTC days, carried forward)

async function readPreviousHistory() {
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    const days = prev?.history?.days;
    if (!Array.isArray(days)) return [];
    return days.filter((d) => typeof d?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Array.isArray(d.total));
  } catch {
    return [];
  }
}

function mergeHistory(previous, current) {
  const byDate = new Map(previous.map((d) => [d.date, d]));
  for (const d of current) byDate.set(d.date, d); // the newer snapshot wins
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-HISTORY_MAX_DAYS);
}

// ---------------------------------------------------------------------------
// Output

function serialise(obj) {
  // Top-level keys and grid periods on their own lines; everything else compact.
  const lines = Object.entries(obj).map(([k, v]) => {
    if (k === 'grid') {
      const { periods, ...rest } = v;
      const head = JSON.stringify(rest).slice(0, -1);
      const body = periods.map((p) => `      ${JSON.stringify(p)}`).join(',\n');
      return `  "grid": ${head},\n    "periods": [\n${body}\n    ]\n  }`;
    }
    if (k === 'countries' || k === 'regions' || k === 'clusters24h' || k === 'clusters7d') {
      return `  ${JSON.stringify(k)}: [\n${v.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`;
    }
    return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

// ---------------------------------------------------------------------------

async function main() {
  const startedMs = Date.now();
  const retrievedAt = isoSeconds(startedMs);
  // Set after the downloads: the reference time is the latest moment every (non-lagging) sensor has delivered.
  let refMs = 0;
  let windowStartMs = 0;

  const countries = buildCountryIndex(JSON.parse(await readFile(REGION_PATH, 'utf8')));
  const adminLookup = JSON.parse(await readFile(ADMIN_PATH, 'utf8'));
  const admin = buildAdminIndex(adminLookup);
  const previousHistory = await readPreviousHistory();

  const ctx = {
    retrievedAt,
    countries,
    admin,
    countryMeta: new Map(),
    /** base cell idx → per period { n, frp, max, mask, sensors[4] } */
    cellPeriods: new Map(),
    /** base cell idx → Map(iso3 → detections, all periods) */
    cellCountries: new Map(),
    total: newRollup({ key: 'ALL', name: 'All FIRMS South East Asia region' }),
    countryRoll: new Map(),
    regionRoll: new Map(),
    /** date → { total: [n, frp], countries: Map, regions: Map } */
    days: new Map(),
    /** Confident rows from every file, binned once the reference time is known. */
    rows: [],
    ingest(row, st) {
      const { s, lat, lon, t, date, frp } = row;
      const country = countries.countryAt(lat, lon);
      if (!ctx.countryMeta.has(country.iso3)) ctx.countryMeta.set(country.iso3, country);
      let region = null;
      if (ROLLUP_REGION_ISO3.has(country.iso3)) {
        const near = admin.nearest(country.iso3, lat, lon);
        if (near) region = near.adm1;
      }
      // History: every confident row, by UTC date.
      let day = ctx.days.get(date);
      if (!day) ctx.days.set(date, (day = { n: 0, frp: 0, countries: new Map(), regions: new Map() }));
      day.n += 1;
      day.frp += frp;
      const dc = day.countries.get(country.iso3) ?? [0, 0];
      dc[0] += 1;
      dc[1] += frp;
      day.countries.set(country.iso3, dc);
      if (region) {
        const rk = `${country.iso3}:${region}`;
        const dr = day.regions.get(rk) ?? [0, 0];
        dr[0] += 1;
        dr[1] += frp;
        day.regions.set(rk, dr);
      }
      // Rolling periods: [ref - (p + 1) * 24 h, ref - p * 24 h). Rows at or after the reference wait for the next refresh.
      if (t >= refMs) {
        st.rowsAfterReference += 1;
        return;
      }
      if (t < windowStartMs) return;
      const p = Math.min(PERIODS - 1, Math.floor((refMs - t) / DAY_MS));
      st.rowsInPeriods += 1;
      addTo(ctx.total, p, s, frp);
      let cr = ctx.countryRoll.get(country.iso3);
      if (!cr) ctx.countryRoll.set(country.iso3, (cr = newRollup({ iso3: country.iso3, name: country.name, asean: country.asean })));
      addTo(cr, p, s, frp);
      addCentre(cr, p, lat, lon, frp);
      if (region) {
        const rk = `${country.iso3}:${region}`;
        let rr = ctx.regionRoll.get(rk);
        if (!rr) ctx.regionRoll.set(rk, (rr = newRollup({ key: rk, iso3: country.iso3, country: country.name, name: region })));
        addTo(rr, p, s, frp);
        addCentre(rr, p, lat, lon, frp);
      }
      const idx = cellIndex(lat, lon, BASE_CELL);
      let per = ctx.cellPeriods.get(idx);
      if (!per) ctx.cellPeriods.set(idx, (per = new Array(PERIODS).fill(null)));
      let v = per[p];
      if (!v) per[p] = v = { n: 0, frp: 0, max: 0, mask: 0, sensors: [0, 0, 0, 0] };
      v.n += 1;
      v.frp += frp;
      if (frp > v.max) v.max = frp;
      v.mask |= 1 << s;
      v.sensors[s] += 1;
      let cc = ctx.cellCountries.get(idx);
      if (!cc) ctx.cellCountries.set(idx, (cc = new Map()));
      cc.set(country.iso3, (cc.get(country.iso3) ?? 0) + 1);
    },
  };

  console.log('Downloading the four FIRMS South East Asia 7-day CSVs...');
  // The four downloads run concurrently; each is parsed line by line as it streams (only confident rows are kept).
  const results = await Promise.all(FIRMS_FILES.map((f) => fetchFirms(f, ctx)));

  const latestMs = Math.max(...results.map((r) => r.latestMs));
  const lagging = results.filter((r) => latestMs - r.latestMs > LAGGING_SENSOR_H * HOUR_MS).map((r) => r.sensor);
  const current = results.filter((r) => !lagging.includes(r.sensor));
  // Reference: one minute after the oldest "latest detection" among current sensors, so every period holds the
  // same overpasses for every sensor (FIRMS NRT files arrive up to about 3 h after each pass).
  refMs = Math.floor(Math.min(...current.map((r) => r.latestMs)) / 60_000) * 60_000 + 60_000;
  windowStartMs = refMs - PERIODS * DAY_MS;
  const reference = isoSeconds(refMs);
  const statsBySensor = new Map(results.map((r) => [r.sensor, r.source]));
  // Fixed order (the downloads interleave), so the place caches and every total are reproducible.
  ctx.rows.sort((a, b) => a.s - b.s || a.t - b.t || a.lat - b.lat || a.lon - b.lon || a.frp - b.frp);
  for (const row of ctx.rows) ctx.ingest(row, statsBySensor.get(SENSORS[row.s]));
  ctx.rows.length = 0;
  console.log(`Reference time ${reference} (latest time all current sensors have delivered); periods back to ${isoSeconds(windowStartMs)}.`);

  // Coverage: from 00:00 UTC of the first date present in all four files (the 7-day files start on a UTC date).
  const coverageStartMs = Math.floor(Math.max(...results.map((r) => r.earliestMs)) / DAY_MS) * DAY_MS;
  const firstFullDate = isoSeconds(coverageStartMs + DAY_MS).slice(0, 10);

  // Complete UTC days: after each file's first (possibly partial) date, and ended by the reference time.
  const historyNow = [...ctx.days.entries()]
    .filter(([date]) => date >= firstFullDate && Date.parse(`${date}T00:00:00Z`) + DAY_MS <= refMs)
    .map(([date, d]) => ({
      date,
      from: retrievedAt,
      total: [d.n, mw(d.frp)],
      countries: Object.fromEntries([...d.countries.entries()].sort().map(([k, v]) => [k, [v[0], mw(v[1])]])),
      regions: Object.fromEntries([...d.regions.entries()].sort().map(([k, v]) => [k, [v[0], mw(v[1])]])),
    }));
  const history = mergeHistory(previousHistory, historyNow);

  const clusters24h = disambiguate(buildClusters('24h', 0, ctx));
  const clusters7d = disambiguate(buildClusters('7d', PERIODS - 1, ctx));

  const byPeriod = Array.from({ length: PERIODS }, () => new Map());
  for (const [idx, per] of ctx.cellPeriods) per.forEach((v, p) => v && byPeriod[p].set(idx, v));

  const countryList = [...ctx.countryRoll.values()]
    .map(rollupOut)
    .sort((a, b) => b.frp.reduce((x, y) => x + y, 0) - a.frp.reduce((x, y) => x + y, 0) || (a.iso3 < b.iso3 ? -1 : 1));
  const regionList = [...ctx.regionRoll.values()]
    .map(rollupOut)
    .sort((a, b) => (a.iso3 < b.iso3 ? -1 : a.iso3 > b.iso3 ? 1 : 0) || b.frp.reduce((x, y) => x + y, 0) - a.frp.reduce((x, y) => x + y, 0));

  const base = {
    about:
      'ASEAN Watch fire snapshot written by scripts/refresh-fires.mjs from the four NASA FIRMS 7-day South East Asia CSVs. ' +
      'MEASURED satellite detections only (VIIRS confidence nominal or high, MODIS confidence 50 or more). Fire radiative power ' +
      '(FRP, MW) is a proxy for fire intensity, not emissions; CAMS GFAS (Fire Emissions Watch) converts FRP to emissions. ' +
      'No detections in a cell does not mean no fire: cloud, smoke and overpass timing hide fires.',
    schema: 1,
    retrievedAt,
    reference,
    periods: { count: PERIODS, hours: 24, note: 'Index 0 is the 24 h before the reference time, index 6 the 24 h ending 144 h before it.' },
    window: { start: isoSeconds(windowStartMs), end: reference },
    coverageStart: isoSeconds(coverageStartMs),
    coverageNote:
      'The files cover from 00:00 UTC of the first date present in all four. A period that starts earlier can miss the tail of one night pass; ' +
      'the first date is also left out of the complete-day history in case it is partial.',
    latestDetection: isoSeconds(latestMs),
    laggingSensors: lagging,
    filters: {
      viirs: 'confidence nominal or high',
      modis: `confidence ${MODIS_MIN_CONFIDENCE} or more`,
      note: 'Same thresholds as the watch rules in src/lib/watchRules.ts. Low-confidence detections are counted per source but not used.',
    },
    sensors: SENSORS,
    method: {
      countries:
        'Point in polygon against data/region.geojson (Natural Earth); points up to 0.15° outside a coastline go to that country; ' +
        'the rest are "Outside country boundaries" (sea, offshore platforms, or islands missing from the boundary data).',
      regions:
        'Indonesian provinces and Malaysian states: each detection takes the region of the nearest regency/district centre ' +
        '(data/fire-admin-lookup.json, from geoBoundaries). Approximate; detections near a boundary can land in the neighbouring region. ' +
        'Indonesian provinces follow the 2022 Papua split.',
      clusters:
        `Connected 0.25° cells with detections (8-neighbour), complexes wider than ${SPLIT_SPAN_CELLS} cells split around the ` +
        `strongest cells into pieces of at most ${2 * SPLIT_RADIUS_CELLS + 1} × ${2 * SPLIT_RADIUS_CELLS + 1} cells ` +
        `(about ${(2 * SPLIT_RADIUS_CELLS + 1) * BASE_CELL}°); ranked by summed FRP. Period series cover the ` +
        'cluster cells plus their unclaimed neighbours. Names come from the nearest regency, district or province centre: approximate.',
      frp: 'Summed FRP adds every confident detection from every sensor and overpass, so one fire seen by four sensors counts four times. It is an index of fire activity, not an instantaneous total or emissions.',
      reference:
        'Periods count back from the reference time: the latest moment every current sensor has delivered (one minute after the ' +
        'oldest "latest detection" among the four files), not the retrieval time, so the last 24 h are not short of a late pass. ' +
        `A sensor more than ${LAGGING_SENSOR_H} h behind the freshest is listed in laggingSensors and does not hold the reference back.`,
      history: `Complete UTC days (ended by the reference time, after each file's first date), carried forward from earlier snapshots, at most ${HISTORY_MAX_DAYS} days.`,
    },
    counts: {
      countryAssignment: countries.stats,
    },
    totals: rollupOut(ctx.total),
    countries: countryList,
    regions: regionList,
    clusters24h,
    clusters7d,
    history: { days: history },
    sources: [
      ...results.map((r) => r.source),
      {
        id: 'natural-earth-countries',
        name: 'Country polygons (data/region.geojson)',
        provider: 'Natural Earth',
        url: 'https://www.naturalearthdata.com/',
        licence: 'Public domain',
        attribution: REGION_ATTRIBUTION,
      },
      {
        id: 'fire-admin-lookup',
        name: 'Regency, district and province centres (data/fire-admin-lookup.json)',
        provider: 'geoBoundaries',
        url: 'https://www.geoboundaries.org/',
        retrievedAt: adminLookup.retrievedAt ?? null,
        licence: 'Per source: CC BY 3.0 IGO, CC BY 3.0, CC BY 4.0, public domain, ODbL 1.0 (© OpenStreetMap contributors)',
        attribution: adminLookup.attribution ?? 'geoBoundaries (Runfola et al. 2020, www.geoboundaries.org).',
      },
    ],
    attribution: FIRMS_ATTRIBUTION,
    links: {
      fireEmissionsWatch: 'https://apps.atmosphere.copernicus.eu/fire-emissions-watch/',
      gfas: 'https://ads.atmosphere.copernicus.eu/datasets/cams-global-fire-emissions-gfas',
      firmsMap: 'https://firms.modaps.eosdis.nasa.gov/map/',
    },
  };

  // Grid: 0.25° everywhere; if over budget, 0.5° for periods 2+; then 0.5° for all; else fail.
  const plans = [
    () => BASE_CELL,
    (p) => (p >= 2 ? COARSE_CELL : BASE_CELL),
    () => COARSE_CELL,
  ];
  let text = null;
  let plan = 0;
  for (; plan < plans.length; plan += 1) {
    const periods = byPeriod.map((cells, p) => ({ p, ...encodePeriod(cells, plans[plan](p)) }));
    const grid = {
      frame: FRAME,
      baseCellDeg: BASE_CELL,
      encoding:
        'Per period, a flat list of 5 numbers per cell: [index delta, detections, summed FRP MW, max FRP MW, sensor mask]. ' +
        'Index = row * nCols + col on the frame with cellDeg; row = floor((lat - originLat) / cellDeg), col = floor((lon - originLon) / cellDeg). ' +
        'The first delta is the absolute index. Sensor mask bit i = sensors[i]. Cluster "cells" are absolute indices on the 0.25° frame.',
      periods,
    };
    const candidate = serialise({ ...base, grid });
    if (Buffer.byteLength(candidate, 'utf8') <= SIZE_BUDGET_BYTES) {
      text = candidate;
      break;
    }
  }
  if (text === null) throw new Error(`snapshot would exceed the ${SIZE_BUDGET_BYTES / 1024} KB budget even at ${COARSE_CELL}° cells; nothing written`);

  const tmp = `${OUT}.tmp`;
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, OUT);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }

  const sum = (a) => a.reduce((x, y) => x + y, 0);
  console.log(`Wrote data/fires-snapshot.json (${Math.round(Buffer.byteLength(text, 'utf8') / 1024)} KB, grid plan ${plan}: ${['0.25° all', '0.5° for periods 2+', '0.5° all'][plan]}).`);
  for (const r of results) {
    const s = r.source;
    console.log(
      `  ${s.id.padEnd(13)} read ${String(s.rowsRead).padStart(6)}  confident ${String(s.rowsConfident).padStart(6)}  in 7 periods ${String(s.rowsInPeriods).padStart(6)}  after ref ${String(s.rowsAfterReference).padStart(5)}  last-modified ${s.lastModified ?? 'n/a'}  latest ${s.latestDetection}`,
    );
  }
  console.log(`  last 24 h: ${ctx.total.count[0]} detections, ${Math.round(ctx.total.frp[0])} MW summed FRP; 7 periods: ${sum(ctx.total.count)} detections.`);
  console.log(`  countries: ${countryList.slice(0, 6).map((c) => `${c.iso3} ${sum(c.count)}`).join(', ')}`);
  console.log(`  top 24 h clusters: ${clusters24h.slice(0, 5).map((c) => `${c.name} (${c.count[0]})`).join('; ')}`);
  console.log(`  country assignment: ${JSON.stringify(countries.stats)}; history days ${history.length} (${history[0]?.date ?? '-'} to ${history.at(-1)?.date ?? '-'}).`);
  console.log(`Done in ${((Date.now() - startedMs) / 1000).toFixed(1)} s.`);
}

main().catch((err) => {
  console.error(`refresh-fires failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Nothing was written; the previous data/fires-snapshot.json (if any) is unchanged.');
  process.exit(1);
});
