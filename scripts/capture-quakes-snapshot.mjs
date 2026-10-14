#!/usr/bin/env node
// Capture real earthquake snapshots for offline fallback: npm run refresh:quakes
// USGS FDSN (APAC / W Pacific box across the dateline, M4.5+, past 7 days), BMKG gempaterkini and
// BMKG InaTEWS datagempa. Raw responses are kept (USGS trimmed to the fields src/lib/quakesLive.ts
// reads). Fail-safe: a feed that fails keeps its previous snapshot entry; if nothing new was fetched,
// the file is left untouched. No dependencies.
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/quakes-snapshot.json', import.meta.url);
const TIMEOUT_MS = 30000;
const now = Date.now();
const start = new Date(Math.floor((now - 7 * 86400000) / 3600000) * 3600000).toISOString().slice(0, 19);
const FEEDS = {
  'usgs-quakes':
    'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=-50&maxlatitude=60' +
    `&minlongitude=90&maxlongitude=210&minmagnitude=4.5&starttime=${start}&orderby=time`,
  'bmkg-gempaterkini': 'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json',
  'bmkg-datagempa': 'https://bmkg-content-inatews.storage.googleapis.com/datagempa.json',
};
const KEEP = ['mag', 'place', 'time', 'updated', 'url', 'tsunami', 'status', 'magType', 'type', 'title'];

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function trim(id, body) {
  if (id !== 'usgs-quakes') return body;
  if (!body || !Array.isArray(body.features)) throw new Error('USGS: not a FeatureCollection');
  return {
    type: 'FeatureCollection',
    metadata: { generated: body.metadata?.generated, url: body.metadata?.url, count: body.metadata?.count },
    features: body.features.map((f) => ({
      type: 'Feature',
      id: f.id,
      properties: Object.fromEntries(KEEP.filter((k) => k in f.properties).map((k) => [k, f.properties[k]])),
      geometry: f.geometry,
    })),
  };
}

async function main() {
  let previous = { feeds: {} };
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    // first run
  }
  const feeds = { ...(previous.feeds ?? {}) };
  let fresh = 0;
  for (const [id, url] of Object.entries(FEEDS)) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      feeds[id] = { url, retrievedAt: iso(Date.now()), raw: trim(id, await res.json()) };
      fresh += 1;
      console.log(`refresh:quakes: ${id} ok`);
    } catch (err) {
      console.warn(`refresh:quakes: ${id} failed (${err instanceof Error ? err.message : err}); keeping the previous entry`);
    }
  }
  if (fresh === 0) {
    console.warn('refresh:quakes: nothing fetched; snapshot left unchanged');
    process.exitCode = 1;
    return;
  }
  const snapshot = {
    capturedAt: iso(Date.now()),
    source: 'USGS FDSN event service; BMKG Data Terbuka gempaterkini; BMKG InaTEWS datagempa',
    licence:
      'USGS earthquake data are U.S. public domain. BMKG data: credit BMKG as the source ("Sumber data: BMKG"), ' +
      'per https://data.bmkg.go.id/gempabumi/ (60 requests per minute per IP).',
    note: 'HISTORICAL snapshot for offline fallback. USGS "tsunami" flag is not a tsunami warning.',
    feeds,
  };
  await writeFile(OUT, `${JSON.stringify(snapshot)}\n`, 'utf8');
  console.log(`refresh:quakes: wrote data/quakes-snapshot.json (${fresh}/${Object.keys(FEEDS).length} feeds fresh)`);
}

main().catch((err) => {
  console.error(`refresh:quakes: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
