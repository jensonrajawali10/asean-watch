#!/usr/bin/env node
// Capture GloFAS river discharge (Open-Meteo Flood API) for the named river points: npm run refresh:flood
// One request: a 5x5 neighbourhood (0.05 deg step) around each point, past 7 days + today + 7 days.
// Keep the point list in step with RIVER_POINTS in src/lib/floodModel.ts. MODELLED data, never a
// warning. Fail-safe: on any failure nothing is written. No dependencies.
import { writeFile } from 'node:fs/promises';

const OUT = new URL('../data/flood-snapshot.json', import.meta.url);
const POINTS = [
  ['mekong-phnom-penh', 11.55, 104.92],
  ['chao-phraya-ayutthaya', 14.35, 100.56],
  ['ciliwung-jakarta', -6.2, 106.85],
  ['kelantan-kota-bharu', 6.12, 102.24],
];

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function main() {
  const lats = [];
  const lons = [];
  for (const [, lat, lon] of POINTS) {
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        lats.push((lat + i * 0.05).toFixed(3));
        lons.push((lon + j * 0.05).toFixed(3));
      }
    }
  }
  const url =
    `https://flood-api.open-meteo.com/v1/flood?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
    '&daily=river_discharge&past_days=7&forecast_days=8';
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body) || body.length !== lats.length) throw new Error('unexpected payload length');
  const raw = body.map((r) => ({
    latitude: r.latitude,
    longitude: r.longitude,
    daily_units: r.daily_units,
    daily: { time: r.daily?.time, river_discharge: r.daily?.river_discharge },
  }));
  const retrievedAt = iso(Date.now());
  const snapshot = {
    capturedAt: retrievedAt,
    source: 'Open-Meteo Flood API (GloFAS v4), https://open-meteo.com/en/docs/flood-api',
    licence:
      'Open-Meteo data CC BY 4.0 (https://open-meteo.com/en/license). Source model: Copernicus Emergency ' +
      'Management Service GloFAS (European Union). MODELLED river discharge, not an observation or warning.',
    points: POINTS.map(([id, lat, lon]) => ({ id, lat, lon })),
    url,
    retrievedAt,
    raw,
  };
  await writeFile(OUT, `${JSON.stringify(snapshot)}\n`, 'utf8');
  console.log(`refresh:flood: wrote data/flood-snapshot.json (${raw.length} cells)`);
}

main().catch((err) => {
  console.error(`refresh:flood: ${err instanceof Error ? err.message : err}; snapshot left unchanged`);
  process.exitCode = 1;
});
