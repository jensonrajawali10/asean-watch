#!/usr/bin/env node
// Captures the bundled modelled air-quality snapshot data/aq-snapshot.json: CAMS global PM2.5 via the
// Open-Meteo Air Quality API (CC BY 4.0). Same request as src/lib/airQuality.ts: the 1° wind grid
// (lat -6..8, lon 95..120, 390 points) then the places below, hourly pm2_5, past_days=1,
// forecast_days=3, UTC. Stored every 3 h, 1 decimal, to keep the bundle small (about 70 KB).
// MODELLED context only: never evidence, never NEA PSI, never an official advisory.
// Fail safe: any download, shape, unit or value problem writes nothing and keeps the previous
// snapshot (exit code 1). Written via a temp file and rename.
// Keep PLACES identical to AQ_PLACES in src/lib/airQuality.ts (a test checks the snapshot against it).
import { rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'data', 'aq-snapshot.json');
const SPEC = { minLat: -6, maxLat: 8, minLon: 95, maxLon: 120, stepDeg: 1 };
const STORE_EVERY_HOURS = 3;
const PLACES = [
  { id: 'singapore', name: 'Singapore', country: 'SG', lat: 1.3521, lon: 103.8198, kind: 'city' },
  { id: 'kuala-lumpur', name: 'Kuala Lumpur', country: 'MY', lat: 3.1412, lon: 101.6865, kind: 'city' },
  { id: 'ipoh', name: 'Ipoh', country: 'MY', lat: 4.5841, lon: 101.0829, kind: 'city' },
  { id: 'george-town', name: 'George Town', country: 'MY', lat: 5.4112, lon: 100.3354, kind: 'city' },
  { id: 'kuching', name: 'Kuching', country: 'MY', lat: 1.55, lon: 110.3333, kind: 'city' },
  { id: 'pekanbaru', name: 'Pekanbaru', country: 'ID', lat: 0.5167, lon: 101.4417, kind: 'city' },
  { id: 'jambi', name: 'Jambi', country: 'ID', lat: -1.6, lon: 103.6167, kind: 'city' },
  { id: 'palembang', name: 'Palembang', country: 'ID', lat: -2.9167, lon: 104.7458, kind: 'city' },
  { id: 'pontianak', name: 'Pontianak', country: 'ID', lat: -0.0319, lon: 109.325, kind: 'city' },
  { id: 'palangka-raya', name: 'Palangka Raya', country: 'ID', lat: -2.2083, lon: 113.9167, kind: 'city' },
  { id: 'medan', name: 'Medan', country: 'ID', lat: 3.5833, lon: 98.6667, kind: 'city' },
  { id: 'jakarta', name: 'Jakarta', country: 'ID', lat: -6.2146, lon: 106.8451, kind: 'city' },
  { id: 'bangkok', name: 'Bangkok', country: 'TH', lat: 13.754, lon: 100.5014, kind: 'city' },
  { id: 'chiang-mai', name: 'Chiang Mai', country: 'TH', lat: 18.7904, lon: 98.9847, kind: 'city' },
  { id: 'hat-yai', name: 'Hat Yai', country: 'TH', lat: 7.0084, lon: 100.4767, kind: 'city' },
  { id: 'hanoi', name: 'Hanoi', country: 'VN', lat: 21.0245, lon: 105.8412, kind: 'city' },
  { id: 'phnom-penh', name: 'Phnom Penh', country: 'KH', lat: 11.5625, lon: 104.916, kind: 'city' },
  { id: 'manila', name: 'Manila', country: 'PH', lat: 14.6042, lon: 120.9822, kind: 'city' },
  { id: 'cebu', name: 'Cebu', country: 'PH', lat: 10.3167, lon: 123.8907, kind: 'city' },
  { id: 'dumai', name: 'Dumai (Riau peatlands)', country: 'ID', lat: 1.6671, lon: 101.4432, kind: 'fire-area' },
  { id: 'kayu-agung', name: 'Kayu Agung (Ogan Komering Ilir)', country: 'ID', lat: -3.392, lon: 104.8306, kind: 'fire-area' },
  { id: 'ketapang', name: 'Ketapang (West Kalimantan)', country: 'ID', lat: -1.8386, lon: 109.9773, kind: 'fire-area' },
  { id: 'pulang-pisau', name: 'Pulang Pisau (Central Kalimantan)', country: 'ID', lat: -2.7671, lon: 114.2406, kind: 'fire-area' },
];

const axis = (a, b) => {
  const out = [];
  for (let x = a; x <= b + 1e-9; x += SPEC.stepDeg) out.push(Math.round(x * 1000) / 1000);
  return out;
};
const lats = axis(SPEC.minLat, SPEC.maxLat);
const lons = axis(SPEC.minLon, SPEC.maxLon);
const la = [];
const lo = [];
for (const lat of lats) for (const lon of lons) {
  la.push(lat);
  lo.push(lon);
}
for (const p of PLACES) {
  la.push(p.lat);
  lo.push(p.lon);
}
const url =
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${la.join(',')}&longitude=${lo.join(',')}` +
  '&hourly=pm2_5&past_days=1&forecast_days=3&timezone=GMT';

const r1 = (x) => Math.round(x * 10) / 10;

async function main() {
  const startedMs = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Open-Meteo air quality HTTP ${res.status}`);
  const json = await res.json();
  const nGrid = lats.length * lons.length;
  if (!Array.isArray(json) || json.length !== nGrid + PLACES.length) throw new Error(`expected ${nGrid + PLACES.length} locations`);
  const hourly = json[0]?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) throw new Error('no hourly.time');
  const keep = [];
  hourly.time.forEach((t, k) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) throw new Error(`bad time ${t}`);
    if (Number(t.slice(11, 13)) % STORE_EVERY_HOURS !== 0) return;
    // Keep only hours where every location has a value (CAMS can end a few hours early).
    if (json.every((e) => Number.isFinite(e?.hourly?.pm2_5?.[k]) && e.hourly.pm2_5[k] >= 0)) keep.push(k);
  });
  if (keep.length < 8) throw new Error(`only ${keep.length} complete 3-hourly times`);
  json.forEach((e, idx) => {
    const unit = e?.hourly_units?.pm2_5;
    if (typeof unit !== 'string' || !/^[µμ]g\/m(³|3)$/.test(unit.trim())) throw new Error(`location ${idx}: unit is ${unit}`);
    if (e?.hourly?.time?.length !== hourly.time.length) throw new Error(`location ${idx}: time axis differs`);
  });
  const times = keep.map((k) => `${hourly.time[k]}:00Z`);
  const pm25 = keep.map((k) => lats.map((_, j) => lons.map((__, i) => r1(json[j * lons.length + i].hourly.pm2_5[k]))));
  const places = PLACES.map((p, n) => ({ ...p, pm25: keep.map((k) => r1(json[nGrid + n].hourly.pm2_5[k])) }));
  const retrievedAt = new Date(startedMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out = {
    about:
      'MODELLED PM2.5 (µg/m³) from the CAMS global atmospheric composition forecast via the Open-Meteo Air Quality API, ' +
      `captured by scripts/capture-aq-snapshot.mjs. Stored every ${STORE_EVERY_HOURS} h. Context only, never evidence; ` +
      'not NEA PSI and not an official advisory.',
    source: 'Open-Meteo Air Quality API',
    sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    requestUrl: url.replace(/latitude=[^&]+&longitude=[^&]+/, 'latitude=<grid+places>&longitude=<grid+places>'),
    model: 'CAMS global atmospheric composition forecast (Copernicus, about 45 km)',
    unit: 'µg/m³',
    retrievedAt,
    attribution: 'Air quality: Open-Meteo.com (CC BY 4.0), CAMS global forecast (Copernicus Atmosphere Monitoring Service).',
    licence: 'CC BY 4.0 (https://open-meteo.com/en/licence); free tier is non-commercial. CAMS data: Copernicus licence.',
    grid: SPEC,
    lats,
    lons,
    times,
    pm25,
    places,
  };
  const body = `${JSON.stringify(out)}\n`;
  const tmp = `${OUT}.tmp`;
  try {
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, OUT);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  console.log(
    `Wrote data/aq-snapshot.json (${Math.round(Buffer.byteLength(body) / 1024)} KB): ${times.length} times ${times[0]} to ${times[times.length - 1]}, retrieved ${retrievedAt}.`,
  );
}

main().catch((err) => {
  console.error(`capture-aq-snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Nothing was written; the previous data/aq-snapshot.json is unchanged.');
  process.exit(1);
});
