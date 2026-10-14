#!/usr/bin/env node
// Builds data/idn-adm2-centroids.json: one point per Indonesian regency or city (ADM2), used to place
// BMKG InaTEWS tsunami warning areas (<wzarea>) on the map at their district centre (approximate).
// Source: geoBoundaries gbOpen IDN ADM2 (https://www.geoboundaries.org/api/current/gbOpen/IDN/ADM2/),
// licence CC BY 3.0 IGO, source data BPS (Statistics Indonesia), WFP and OCHA ROAP. The licence and
// source are read from the API response and stored in the output, not hard-coded.
// Point = area-weighted centroid of the district's largest polygon (its main landmass, so island
// districts do not land in the sea between islands). When that centroid falls outside the polygon
// (a strongly concave shape), the polygon's interior point nearest to it along a horizontal scan is
// used instead. The ADM2 file has no province field, so none is stored.
// Fail safe: any download, licence or shape problem writes nothing and keeps the previous file (exit 1).
import { rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'data', 'idn-adm2-centroids.json');
const API = 'https://www.geoboundaries.org/api/current/gbOpen/IDN/ADM2/';
const MAX_BYTES = 60 * 1024;

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Planar signed area (deg², lon scaled by cos(lat0)) and centroid of a closed ring. */
function ringStats(ring) {
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
  const k = Math.cos(lat0);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][0] * k;
    const y0 = ring[j][1];
    const x1 = ring[i][0] * k;
    const y1 = ring[i][1];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-12) return { area: 0, lon: ring[0][0], lat: ring[0][1] };
  return { area: Math.abs(a), lon: cx / (6 * a) / k, lat: cy / (6 * a) };
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Midpoint of the widest inside span on the horizontal line through `lat`, nearest to `lon`. */
function scanInterior(lon, lat, ring) {
  const xs = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat) xs.push(((xj - xi) * (lat - yi)) / (yj - yi) + xi);
  }
  xs.sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    if (best === null || Math.abs(mid - lon) < Math.abs(best - lon)) best = mid;
  }
  return best === null ? null : { lon: best, lat };
}

function districtPoint(geometry) {
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!polys || polys.length === 0) throw new Error(`unsupported geometry ${geometry?.type}`);
  let best = null;
  for (const poly of polys) {
    const outer = poly[0];
    if (!Array.isArray(outer) || outer.length < 4) continue;
    const s = ringStats(outer);
    if (!best || s.area > best.s.area) best = { s, outer };
  }
  if (!best) throw new Error('no usable polygon');
  let { lon, lat } = best.s;
  let method = 'centroid';
  if (!inRing(lon, lat, best.outer)) {
    const p = scanInterior(lon, lat, best.outer);
    if (p) {
      lon = p.lon;
      lat = p.lat;
      method = 'interior';
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -12 || lat > 7 || lon < 94 || lon > 142) {
    throw new Error(`point outside Indonesia: ${lat}, ${lon}`);
  }
  return { lat: r3(lat), lon: r3(lon), method };
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  const startedMs = Date.now();
  const meta = await getJson(API);
  const licence = String(meta.boundaryLicense ?? '');
  if (!/CC BY 3\.0 IGO|Creative Commons Attribution 3\.0 Intergovernmental/i.test(licence)) {
    throw new Error(`unexpected licence "${licence}"; review it before bundling`);
  }
  const geomUrl = meta.simplifiedGeometryGeoJSON;
  if (typeof geomUrl !== 'string' || !geomUrl.startsWith('https://')) throw new Error('no simplifiedGeometryGeoJSON URL');
  const gj = await getJson(geomUrl);
  if (!Array.isArray(gj.features) || gj.features.length < 400) throw new Error(`expected about 500 districts, got ${gj.features?.length}`);
  let interior = 0;
  const districts = gj.features.map((f, i) => {
    const name = typeof f.properties?.shapeName === 'string' ? f.properties.shapeName.trim() : '';
    if (!name) throw new Error(`feature ${i} has no shapeName`);
    const p = districtPoint(f.geometry);
    if (p.method === 'interior') interior++;
    return { name, lat: p.lat, lon: p.lon };
  });
  districts.sort((a, b) => a.name.localeCompare(b.name));
  const retrievedAt = new Date(startedMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out = {
    about:
      'Indonesian regency and city (ADM2) centre points for placing BMKG InaTEWS tsunami warning areas. ' +
      'Point = area-weighted centroid of the largest polygon (interior point when that falls outside). Approximate; not a boundary. ' +
      'The source has no province field. Built by scripts/build-idn-centroids.mjs.',
    source: `geoBoundaries gbOpen ${meta.boundaryID ?? 'IDN-ADM2'} (${meta.boundaryYearRepresented ?? 'n/a'}), from ${meta.boundarySource ?? 'n/a'}`,
    sourceUrl: API,
    geometryUrl: geomUrl,
    licence,
    licenceSource: meta.licenseSource ?? null,
    attribution: `District centres derived from geoBoundaries (Runfola et al. 2020, www.geoboundaries.org), IDN ADM2 from ${meta.boundarySource ?? 'BPS'}; ${licence}.`,
    retrievedAt,
    count: districts.length,
    districts,
  };
  const body = `${JSON.stringify(out)}\n`;
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_BYTES) throw new Error(`output is ${bytes} bytes, over ${MAX_BYTES}`);
  const tmp = `${OUT}.tmp`;
  try {
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, OUT);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  console.log(`Wrote data/idn-adm2-centroids.json (${Math.round(bytes / 1024)} KB): ${districts.length} districts (${interior} interior fallbacks), licence ${licence}.`);
}

main().catch((err) => {
  console.error(`build-idn-centroids failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Nothing was written; the previous data/idn-adm2-centroids.json is unchanged.');
  process.exit(1);
});
