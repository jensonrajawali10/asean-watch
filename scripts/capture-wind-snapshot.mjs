#!/usr/bin/env node
// Captures the bundled modelled wind snapshot data/wind-snapshot.json from Open-Meteo (CC BY 4.0).
// Same grid and request as src/lib/windField.ts: 1° over lat -6..8, lon 95..120 (390 points), hourly
// 10 m wind, past_days=1, forecast_days=3, UTC. Stored 3-hourly (u/v in m/s, 2 decimals) to keep the
// bundle small; the app interpolates linearly in time. Fail safe: any download, shape or value problem
// writes nothing and keeps the previous snapshot (exit code 1). Written via a temp file and rename.
// Level argument: none or "10m" writes data/wind-snapshot.json; "925hPa" writes data/wind925-snapshot.json
// (wind_speed_925hPa / wind_direction_925hPa, the particle wind).
import { rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LEVELS = {
  '10m': { speed: 'wind_speed_10m', dir: 'wind_direction_10m', label: '10 m', file: 'wind-snapshot.json' },
  '925hPa': { speed: 'wind_speed_925hPa', dir: 'wind_direction_925hPa', label: '925 hPa', file: 'wind925-snapshot.json' },
};
const LEVEL_KEY = process.argv[2] ?? '10m';
const LEVEL = LEVELS[LEVEL_KEY];
if (!LEVEL) {
  console.error(`Unknown level "${LEVEL_KEY}"; use 10m or 925hPa.`);
  process.exit(1);
}
const OUT = path.join(ROOT, 'data', LEVEL.file);
const SPEC = { minLat: -6, maxLat: 8, minLon: 95, maxLon: 120, stepDeg: 1 };
const STORE_EVERY_HOURS = 3;

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
const url =
  `https://api.open-meteo.com/v1/forecast?latitude=${la.join(',')}&longitude=${lo.join(',')}` +
  `&hourly=${LEVEL.speed},${LEVEL.dir}&wind_speed_unit=ms&past_days=1&forecast_days=3&timezone=GMT`;

const r2 = (x) => {
  const v = Math.round(x * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};

async function main() {
  const startedMs = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json) || json.length !== lats.length * lons.length) throw new Error(`expected ${lats.length * lons.length} locations`);
  const hourly = json[0]?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) throw new Error('no hourly.time');
  const keep = [];
  hourly.time.forEach((t, k) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) throw new Error(`bad time ${t}`);
    if (Number(t.slice(11, 13)) % STORE_EVERY_HOURS === 0) keep.push(k);
  });
  const times = keep.map((k) => `${hourly.time[k]}:00Z`);
  const u = times.map(() => lats.map(() => new Array(lons.length).fill(0)));
  const v = times.map(() => lats.map(() => new Array(lons.length).fill(0)));
  json.forEach((e, idx) => {
    const h = e?.hourly;
    if (e?.hourly_units?.[LEVEL.speed] !== 'm/s') throw new Error(`location ${idx}: speed unit is not m/s`);
    if (!h || h.time?.length !== hourly.time.length) throw new Error(`location ${idx}: time axis differs`);
    const j = Math.floor(idx / lons.length);
    const i = idx % lons.length;
    keep.forEach((k, t) => {
      const s = h[LEVEL.speed]?.[k];
      const d = h[LEVEL.dir]?.[k];
      if (!Number.isFinite(s) || !Number.isFinite(d)) throw new Error(`location ${idx}: missing value at ${hourly.time[k]}`);
      const rad = (d * Math.PI) / 180;
      u[t][j][i] = r2(-s * Math.sin(rad));
      v[t][j][i] = r2(-s * Math.cos(rad));
    });
  });
  const retrievedAt = new Date(startedMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out = {
    about:
      `MODELLED ${LEVEL.label} wind (u east, v north, m/s) from the Open-Meteo Forecast API, captured by scripts/capture-wind-snapshot.mjs. ` +
      `Stored every ${STORE_EVERY_HOURS} h. Context only, never evidence; not a dispersion model.`,
    source: 'Open-Meteo Forecast API',
    sourceUrl: 'https://open-meteo.com/en/docs',
    requestUrl: url.replace(/latitude=[^&]+&longitude=[^&]+/, 'latitude=<grid>&longitude=<grid>'),
    model: 'Open-Meteo best match (global weather models)',
    level: LEVEL.label,
    retrievedAt,
    attribution: 'Weather data by Open-Meteo.com (CC BY 4.0), best-match global weather model.',
    licence: 'CC BY 4.0 (https://open-meteo.com/en/licence); free tier is non-commercial.',
    grid: SPEC,
    lats,
    lons,
    times,
    u,
    v,
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
  console.log(`Wrote data/${LEVEL.file} (${Math.round(Buffer.byteLength(body) / 1024)} KB): ${times.length} times ${times[0]} to ${times[times.length - 1]}, retrieved ${retrievedAt}.`);
}

main().catch((err) => {
  console.error(`capture-wind-snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error(`Nothing was written; the previous data/${LEVEL.file} is unchanged.`);
  process.exit(1);
});
