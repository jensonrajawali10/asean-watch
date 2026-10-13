// Builds data/region.geojson: the locally bundled basemap for the regional map.
//
//   npm run build:region
//
// Reads the Natural Earth 1:50m Admin 0 countries from the world-atlas package
// (TopoJSON), keeps the 11 ASEAN members plus the neighbouring countries that can
// appear in the map frame, rounds coordinates to 3 decimals and writes GeoJSON.
// No network access: everything comes from node_modules.
//
// The frame maths below mirrors src/components/RegionMap.tsx (VIEW_W, VIEW_H,
// VIEW_PAD and the Mercator fit to the ASEAN members). Keep them in sync.

import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as topojson from 'topojson-client';
import { geoArea, geoMercator } from 'd3-geo';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ATLAS_DIR = resolve(ROOT, 'node_modules/world-atlas');
const OUT = resolve(ROOT, 'data/region.geojson');

const ATTRIBUTION =
  'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com. ' +
  'Country geometry via the world-atlas npm package (v2.0.2).';
const SOURCE = 'Natural Earth 1:50m Admin 0 countries via world-atlas';

const SIZE_BUDGET_BYTES = 1.5 * 1024 * 1024;
const DECIMALS = 3;

/** ISO 3166-1 numeric codes. */
const ASEAN = {
  '096': 'Brunei',
  '116': 'Cambodia',
  '360': 'Indonesia',
  '418': 'Laos',
  '458': 'Malaysia',
  '104': 'Myanmar',
  '608': 'Philippines',
  '702': 'Singapore',
  '764': 'Thailand',
  '626': 'Timor-Leste',
  '704': 'Vietnam',
};

/** Context countries that must always be present, whether or not the frame test picks them. */
const REQUIRED_CONTEXT = {
  156: 'China',
  158: 'Taiwan',
  356: 'India',
  '050': 'Bangladesh',
  598: 'Papua New Guinea',
  '036': 'Australia',
};

// Map frame, mirrored from RegionMap.tsx.
const VIEW_W = 1000;
const VIEW_H = 640;
const VIEW_PAD = 28;

// The map uses preserveAspectRatio="xMidYMid meet" with overflow visible, so a
// container that is taller or wider than 1000:640 reveals geography beyond the
// viewBox in one direction only. Support container aspect ratios from 1.0 (tall)
// to 2.2 (wide) and include every country with a vertex in that visible area.
const MIN_ASPECT = 1.0;
const MAX_ASPECT = 2.2;

function loadCountries(file) {
  const topology = JSON.parse(readFileSync(resolve(ATLAS_DIR, file), 'utf8'));
  return topojson.feature(topology, topology.objects.countries).features;
}

const pad3 = (id) => (id == null ? null : String(id).padStart(3, '0'));

const countries50 = loadCountries('countries-50m.json');
const countries110 = loadCountries('countries-110m.json');

// --- 1. Verify the ids we rely on exist -------------------------------------------------------
const byId50 = new Map();
for (const f of countries50) {
  const id = pad3(f.id);
  if (!byId50.has(id)) byId50.set(id, []);
  byId50.get(id).push(f);
}

const missing = [];
for (const [id, name] of [...Object.entries(ASEAN), ...Object.entries(REQUIRED_CONTEXT)]) {
  const key = pad3(id);
  if (!byId50.has(key)) missing.push(`${key} ${name}`);
}
if (missing.length) {
  console.warn(`[build-region] MISSING from countries-50m.json: ${missing.join(', ')}`);
  if (missing.some((m) => m.startsWith('702'))) {
    console.warn(
      '[build-region] Singapore polygon absent: RegionMap.tsx draws Singapore as a labelled point marker instead.',
    );
  }
} else {
  console.log('[build-region] All ASEAN members and required context countries found at 1:50m.');
}

// --- 2. Compute the visible frame (same projection as the component) --------------------------
const aseanFeatures = countries50.filter((f) => pad3(f.id) in ASEAN);
const projection = geoMercator().fitExtent(
  [
    [VIEW_PAD, VIEW_PAD],
    [VIEW_W - VIEW_PAD, VIEW_H - VIEW_PAD],
  ],
  { type: 'FeatureCollection', features: aseanFeatures },
);

// Tall container: extra rows above and below the viewBox.
const extraY = (VIEW_W / MIN_ASPECT - VIEW_H) / 2;
// Wide container: extra columns left and right of the viewBox.
const extraX = (VIEW_H * MAX_ASPECT - VIEW_W) / 2;

function lonLatBox(x0, y0, x1, y1) {
  const [w, n] = projection.invert([x0, y0]);
  const [e, s] = projection.invert([x1, y1]);
  return { w, e, s, n };
}
const visibleBoxes = [
  lonLatBox(0, -extraY, VIEW_W, VIEW_H + extraY),
  lonLatBox(-extraX, 0, VIEW_W + extraX, VIEW_H),
];
const fmt = (b) => `lon ${b.w.toFixed(1)}..${b.e.toFixed(1)}, lat ${b.s.toFixed(1)}..${b.n.toFixed(1)}`;
console.log(`[build-region] Base frame:  ${fmt(lonLatBox(0, 0, VIEW_W, VIEW_H))}`);
console.log(`[build-region] Tall reveal: ${fmt(visibleBoxes[0])}`);
console.log(`[build-region] Wide reveal: ${fmt(visibleBoxes[1])}`);

function* positions(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) for (const ring of poly) yield* ring;
}

function isVisible(feature) {
  if (!feature.geometry) return false;
  for (const [lon, lat] of positions(feature.geometry)) {
    for (const b of visibleBoxes) {
      if (lon >= b.w && lon <= b.e && lat >= b.s && lat <= b.n) return true;
    }
  }
  return false;
}

// --- 3. Select features ------------------------------------------------------------------------
const selected = [];
const skipped = [];
for (const f of countries50) {
  const id = pad3(f.id);
  const isAsean = id !== null && id in ASEAN;
  const required = id !== null && id in REQUIRED_CONTEXT;
  if (!isAsean && !required && !isVisible(f)) continue;
  if (id === null) {
    // Natural Earth units without an ISO code (e.g. Indian Ocean Territories) are not countries.
    skipped.push(f.properties.name);
    continue;
  }
  selected.push({ feature: f, id, asean: isAsean });
}
if (skipped.length) {
  console.log(`[build-region] Skipped units without an ISO numeric code: ${skipped.join(', ')}`);
}

// --- 4. Round coordinates, keeping rings valid on the sphere -----------------------------------
const FOUR_PI = 4 * Math.PI;
const TINY_SR = 1e-9; // ~0.04 km²; anything smaller vanishes at any zoom we use.
const factor = 10 ** DECIMALS;
const round = (v) => Math.round(v * factor) / factor;

let droppedRings = 0;
let reversedRings = 0;

function cleanRing(ring, isHole) {
  const out = [];
  for (const [lon, lat] of ring) {
    const p = [round(lon), round(lat)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length > 1) {
    const [a, b] = [out[0], out[out.length - 1]];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  }
  if (out.length < 4) {
    droppedRings++;
    return null;
  }
  // d3-geo winding: an exterior ring on its own encloses a small area (< 2π sr);
  // a hole on its own encloses the rest of the sphere. Rounding can flip or collapse
  // tiny rings, and a flipped exterior ring would paint the whole map.
  const area = geoArea({ type: 'Polygon', coordinates: [out] });
  const enclosed = Math.min(area, FOUR_PI - area);
  if (enclosed < TINY_SR) {
    droppedRings++;
    return null;
  }
  const looksExterior = area < 2 * Math.PI;
  if (looksExterior === isHole) {
    out.reverse();
    reversedRings++;
  }
  return out;
}

function cleanGeometry(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const cleaned = [];
  for (const poly of polys) {
    const exterior = cleanRing(poly[0], false);
    if (!exterior) continue;
    const holes = poly
      .slice(1)
      .map((r) => cleanRing(r, true))
      .filter(Boolean);
    cleaned.push([exterior, ...holes]);
  }
  if (cleaned.length === 0) return null;
  return cleaned.length === 1
    ? { type: 'Polygon', coordinates: cleaned[0] }
    : { type: 'MultiPolygon', coordinates: cleaned };
}

function toOutputFeature({ feature, id, asean }, geometrySource = feature) {
  const geometry = cleanGeometry(geometrySource.geometry);
  if (!geometry) return null;
  return {
    type: 'Feature',
    properties: { name: feature.properties.name, iso_n3: id, asean },
    geometry,
  };
}

function serialise(features, source) {
  const header = {
    type: 'FeatureCollection',
    attribution: ATTRIBUTION,
    source,
  };
  const head = JSON.stringify(header).slice(0, -1); // drop closing brace
  const body = features.map((f) => JSON.stringify(f)).join(',\n');
  return `${head},"features":[\n${body}\n]}\n`;
}

// Context first, members last, so member outlines draw on top. Alphabetical within each group.
selected.sort((a, b) => Number(a.asean) - Number(b.asean) || a.feature.properties.name.localeCompare(b.feature.properties.name));

let features = selected.map((s) => toOutputFeature(s)).filter(Boolean);
let source = SOURCE;
let text = serialise(features, source);

// --- 5. Size budget: coarsen far context countries to 1:110m if needed ------------------------
if (Buffer.byteLength(text) > SIZE_BUDGET_BYTES) {
  const byId110 = new Map(countries110.map((f) => [pad3(f.id), f]));
  const baseFrame = lonLatBox(0, 0, VIEW_W, VIEW_H);
  const coarsened = [];
  features = selected
    .map((s) => {
      // Keep 1:50m for members and anything whose geometry reaches the base viewBox.
      const nearCountries = s.asean || [...positions(s.feature.geometry)].some(
        ([lon, lat]) => lon >= baseFrame.w && lon <= baseFrame.e && lat >= baseFrame.s && lat <= baseFrame.n,
      );
      const coarse = byId110.get(s.id);
      if (nearCountries || !coarse) return toOutputFeature(s);
      coarsened.push(s.feature.properties.name);
      return toOutputFeature(s, coarse);
    })
    .filter(Boolean);
  source = `${SOURCE} (1:110m for far context countries: ${coarsened.join(', ')})`;
  text = serialise(features, source);
  console.log(`[build-region] Over budget; coarsened to 1:110m: ${coarsened.join(', ')}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);

const members = features.filter((f) => f.properties.asean).map((f) => f.properties.name);
const context = features.filter((f) => !f.properties.asean).map((f) => `${f.properties.name} (${f.properties.iso_n3})`);
const bytes = statSync(OUT).size;
console.log(`[build-region] ASEAN members (${members.length}): ${members.join(', ')}`);
console.log(`[build-region] Context (${context.length}): ${context.join(', ')}`);
console.log(`[build-region] Rings dropped after rounding: ${droppedRings}; winding repaired: ${reversedRings}`);
console.log(
  `[build-region] Wrote ${OUT} — ${(bytes / 1024).toFixed(1)} KB (${bytes} bytes)` +
    (bytes > SIZE_BUDGET_BYTES ? ' — WARNING: over the 1.5 MB budget' : ''),
);
if (members.length !== Object.keys(ASEAN).length) {
  console.warn(`[build-region] Expected ${Object.keys(ASEAN).length} ASEAN members, wrote ${members.length}.`);
  process.exitCode = 1;
}
