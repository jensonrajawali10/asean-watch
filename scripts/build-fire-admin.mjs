#!/usr/bin/env node
// Builds data/fire-admin-lookup.json: the place-name lookup scripts/refresh-fires.mjs uses to roll FIRMS
// hotspots up by first-level region and to name fire clusters. Read by the script only; never bundled.
// Run once (and again only when boundaries change): npm run build:fire-admin
//
// What it stores, per country (points only, no polygons):
//   IDN: every regency/city (ADM2) centre from data/idn-adm2-centroids.json (geoBoundaries IDN ADM2,
//        CC BY 3.0 IGO) with its province, found by point-in-polygon against geoBoundaries IDN ADM1.
//        geoBoundaries IDN ADM1 is the 2017 OSM layout (34 provinces), so the 2022 Papua split (Laws 14,
//        15, 16 and 29 of 2022) is applied by regency name: South, Central, Highland and Southwest Papua.
//   MYS: every district (ADM2) centre from geoBoundaries MYS ADM2 with its state, found the same way
//        against geoBoundaries MYS ADM1.
//   THA, VNM, KHM, LAO, MMR, PHL, BRN, TLS, PNG: first-level unit (ADM1) centres from geoBoundaries, used only
//        to name clusters ("around <unit>, <country>"), never for rollups.
// A hotspot is later given the region of the NEAREST point inside its country: an approximation, labelled
// as such everywhere it is shown.
//
// Point = area-weighted centroid of the unit's largest polygon; if that falls outside the polygon, the
// nearest interior point on a horizontal scan (the method of scripts/build-idn-centroids.mjs).
// Licences and sources are read from each geoBoundaries API response and stored in the output.
// Fail safe: any download, licence or shape problem writes nothing and keeps the previous file (exit 1).
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'data', 'fire-admin-lookup.json');
const IDN_ADM2 = path.join(ROOT, 'data', 'idn-adm2-centroids.json');
const API = 'https://www.geoboundaries.org/api/current/gbOpen';
const OPEN_LICENCE = /Creative Commons|Open Data Commons Open Database|Public Domain/i;
const MAX_BYTES = 120 * 1024;
/** ADM1 centres for naming clusters: the other ASEAN members plus Papua New Guinea (large fires next to Merauke). */
const NAME_ONLY = ['THA', 'VNM', 'KHM', 'LAO', 'MMR', 'PHL', 'BRN', 'TLS', 'PNG'];

const r3 = (x) => Math.round(x * 1000) / 1000;

/** geoBoundaries English province names to the names used elsewhere in the app (src/lib/places.ts). */
const IDN_PROVINCE_NAME = {
  'Bangka-Belitung Islands': 'Bangka Belitung Islands',
  'Jakarta Special Capital Region': 'Jakarta',
  'Special Region of Yogyakarta': 'Yogyakarta',
};

/** 2022 Papua split by regency (ADM2) name. Regencies not listed stay in Papua or West Papua. */
const PAPUA_2022 = {
  'South Papua': ['Merauke', 'Boven Digoel', 'Mappi', 'Asmat'],
  'Central Papua': ['Nabire', 'Paniai', 'Mimika', 'Dogiyai', 'Deiyai', 'Intan Jaya', 'Puncak', 'Puncak Jaya'],
  'Highland Papua': ['Jayawijaya', 'Lanny Jaya', 'Mamberamo Tengah', 'Nduga', 'Pegunungan Bintang', 'Tolikara', 'Yahukimo', 'Yalimo'],
  'Southwest Papua': ['Sorong', 'Kota Sorong', 'Raja Ampat', 'Sorong Selatan', 'Maybrat', 'Tambrauw'],
};
/** Display fixes for name-only ADM1 units: drop Thailand's "Province" suffix; fix one source misspelling (Myanmar). */
const ADM1_DISPLAY_FIX = { Saigang: 'Sagaing' };
const adm1Display = (raw, iso3) => {
  const n = raw.trim().replace(/\s+Province$/, '');
  const fixed = ADM1_DISPLAY_FIX[n] ?? n;
  // Papua New Guinea provinces are bare words ("Western", "Gulf"); add "Province" so the name reads as a place.
  return iso3 === 'PNG' && !/Region|District/.test(fixed) ? `${fixed} Province` : fixed;
};
const PAPUA_BY_REGENCY = new Map(Object.entries(PAPUA_2022).flatMap(([prov, list]) => list.map((r) => [r, prov])));

// ---------------------------------------------------------------------------
// Geometry

function polygonsOf(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`unsupported geometry ${geometry?.type}`);
}

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

function inPolygon(lon, lat, poly) {
  if (!inRing(lon, lat, poly[0])) return false;
  for (let h = 1; h < poly.length; h += 1) if (inRing(lon, lat, poly[h])) return false;
  return true;
}

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

function unitPoint(geometry) {
  let best = null;
  for (const poly of polygonsOf(geometry)) {
    const outer = poly[0];
    if (!Array.isArray(outer) || outer.length < 4) continue;
    const s = ringStats(outer);
    if (!best || s.area > best.s.area) best = { s, outer };
  }
  if (!best) throw new Error('no usable polygon');
  let { lon, lat } = best.s;
  if (!inRing(lon, lat, best.outer)) {
    const p = scanInterior(lon, lat, best.outer);
    if (p) ({ lon, lat } = p);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('non-finite centre');
  return { lat: r3(lat), lon: r3(lon) };
}

/** Squared planar distance (deg², lon scaled by cos lat) from a point to a segment. */
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

/** ADM1 units as { name, polys, bbox }; a point goes to the containing unit, else the nearest edge. */
function adm1Index(features, nameOf) {
  return features.map((f) => {
    const polys = polygonsOf(f.geometry);
    let minX = 180;
    let minY = 90;
    let maxX = -180;
    let maxY = -90;
    for (const p of polys) for (const [x, y] of p[0]) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { name: nameOf(f), polys, bbox: [minX, minY, maxX, maxY] };
  });
}

function assignAdm1(units, lon, lat) {
  for (const u of units) {
    const [x0, y0, x1, y1] = u.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (u.polys.some((p) => inPolygon(lon, lat, p))) return { name: u.name, method: 'inside' };
  }
  const k = Math.cos((lat * Math.PI) / 180);
  let best = { name: null, d2: Infinity };
  for (const u of units) {
    for (const p of u.polys) {
      const ring = p[0];
      for (let i = 1; i < ring.length; i += 1) {
        const d2 = segDist2(lon, lat, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1], k);
        if (d2 < best.d2) best = { name: u.name, d2 };
      }
    }
  }
  return { name: best.name, method: 'nearest-edge', km: Math.sqrt(best.d2) * 111.32 };
}

// ---------------------------------------------------------------------------
// geoBoundaries

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function boundaries(iso3, level) {
  const apiUrl = `${API}/${iso3}/${level}/`;
  const meta = await getJson(apiUrl);
  const licence = String(meta.boundaryLicense ?? '');
  if (!OPEN_LICENCE.test(licence)) throw new Error(`${iso3} ${level}: unexpected licence "${licence}"; review it first`);
  const geomUrl = meta.simplifiedGeometryGeoJSON;
  if (typeof geomUrl !== 'string' || !geomUrl.startsWith('https://')) throw new Error(`${iso3} ${level}: no simplifiedGeometryGeoJSON URL`);
  const gj = await getJson(geomUrl);
  if (!Array.isArray(gj.features) || gj.features.length === 0) throw new Error(`${iso3} ${level}: no features`);
  for (const [i, f] of gj.features.entries()) {
    if (typeof f.properties?.shapeName !== 'string' || !f.properties.shapeName.trim()) throw new Error(`${iso3} ${level}: feature ${i} has no shapeName`);
  }
  return {
    features: gj.features,
    source: {
      id: String(meta.boundaryID ?? `${iso3}-${level}`),
      iso3,
      level,
      apiUrl,
      geometryUrl: geomUrl,
      licence,
      boundarySource: String(meta.boundarySource ?? ''),
      year: String(meta.boundaryYearRepresented ?? ''),
      units: gj.features.length,
    },
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const retrievedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const sources = [];
  const countries = {};

  // Indonesia: existing ADM2 centres + ADM1 by point-in-polygon + 2022 Papua split.
  const idnAdm2 = JSON.parse(await readFile(IDN_ADM2, 'utf8'));
  if (!Array.isArray(idnAdm2.districts) || idnAdm2.districts.length < 400) throw new Error('data/idn-adm2-centroids.json has too few districts');
  sources.push({
    id: 'idn-adm2-centroids',
    iso3: 'IDN',
    level: 'ADM2',
    apiUrl: idnAdm2.sourceUrl,
    geometryUrl: idnAdm2.geometryUrl,
    licence: idnAdm2.licence,
    boundarySource: idnAdm2.source,
    year: '2020',
    units: idnAdm2.districts.length,
    note: 'Centres from data/idn-adm2-centroids.json (scripts/build-idn-centroids.mjs).',
  });
  const idn1 = await boundaries('IDN', 'ADM1');
  sources.push(idn1.source);
  const idnUnits = adm1Index(idn1.features, (f) => IDN_PROVINCE_NAME[f.properties.shapeName.trim()] ?? f.properties.shapeName.trim());
  let idnEdge = 0;
  let papuaSplit = 0;
  countries.IDN = idnAdm2.districts.map((d) => {
    const a = assignAdm1(idnUnits, d.lon, d.lat);
    if (!a.name) throw new Error(`IDN: no province for ${d.name}`);
    if (a.method !== 'inside') idnEdge += 1;
    let adm1 = a.name;
    const split = PAPUA_BY_REGENCY.get(d.name);
    if (split && (adm1 === 'Papua' || adm1 === 'West Papua')) {
      adm1 = split;
      papuaSplit += 1;
    }
    return { name: d.name, adm1, lat: d.lat, lon: d.lon };
  });
  const listed = new Set([...PAPUA_BY_REGENCY.keys()]);
  const found = new Set(countries.IDN.filter((d) => listed.has(d.name)).map((d) => d.name));
  const missing = [...listed].filter((n) => !found.has(n));
  if (missing.length) throw new Error(`IDN: Papua split regencies not found by name: ${missing.join(', ')}`);

  // Malaysia: ADM2 centres + ADM1 by point-in-polygon.
  const mys2 = await boundaries('MYS', 'ADM2');
  const mys1 = await boundaries('MYS', 'ADM1');
  sources.push(mys2.source, mys1.source);
  const mysUnits = adm1Index(mys1.features, (f) => f.properties.shapeName.trim());
  let mysEdge = 0;
  countries.MYS = mys2.features.map((f) => {
    const p = unitPoint(f.geometry);
    const a = assignAdm1(mysUnits, p.lon, p.lat);
    if (!a.name) throw new Error(`MYS: no state for ${f.properties.shapeName}`);
    if (a.method !== 'inside') mysEdge += 1;
    return { name: f.properties.shapeName.trim(), adm1: a.name, lat: p.lat, lon: p.lon };
  });

  // Name-only ADM1 centres for the other ASEAN members.
  for (const iso3 of NAME_ONLY) {
    const b = await boundaries(iso3, 'ADM1');
    sources.push(b.source);
    countries[iso3] = b.features.map((f) => {
      const p = unitPoint(f.geometry);
      return { name: null, adm1: adm1Display(f.properties.shapeName, iso3), lat: p.lat, lon: p.lon };
    });
  }

  const out = {
    about:
      'Place-name lookup for scripts/refresh-fires.mjs, built by scripts/build-fire-admin.mjs. Points only. IDN and MYS list ' +
      'ADM2 centres (regency/city, district) with their first-level region (province, state) found by point-in-polygon; ' +
      'IDN applies the 2022 Papua split by regency name. Other countries list ADM1 centres (name: null) used only to name ' +
      'clusters. A hotspot takes the region of the nearest point in its country: approximate, not a boundary.',
    retrievedAt,
    method: {
      point: 'Area-weighted centroid of the largest polygon; nearest interior point when the centroid falls outside.',
      adm1: 'Point-in-polygon against geoBoundaries ADM1 (simplified); nearest edge when the point falls just outside.',
      papua2022: PAPUA_2022,
      counts: { idnNearestEdge: idnEdge, idnPapuaSplit: papuaSplit, mysNearestEdge: mysEdge },
    },
    attribution:
      'Boundaries derived from geoBoundaries (Runfola et al. 2020, www.geoboundaries.org). Each source keeps its own licence ' +
      '(listed in sources): CC BY 3.0 IGO, CC BY 3.0, CC BY 4.0, public domain, or ODbL 1.0 (© OpenStreetMap contributors).',
    sources,
    countries,
  };
  const text = `${JSON.stringify(out)}\n`;
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`output would be ${Buffer.byteLength(text)} bytes, over ${MAX_BYTES}`);
  const tmp = `${OUT}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, OUT).catch(async (err) => {
    await rm(tmp, { force: true });
    throw err;
  });
  const n = Object.entries(countries).map(([k, v]) => `${k} ${v.length}`).join(', ');
  console.log(`Wrote data/fire-admin-lookup.json (${Math.round(Buffer.byteLength(text) / 1024)} KB): ${n}.`);
  console.log(`  IDN: ${idnEdge} centres placed by nearest province edge; ${papuaSplit} moved to the 2022 Papua provinces. MYS: ${mysEdge} by nearest edge.`);
}

main().catch((err) => {
  console.error(`build-fire-admin failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Nothing was written; the previous data/fire-admin-lookup.json (if any) is unchanged.');
  process.exit(1);
});
