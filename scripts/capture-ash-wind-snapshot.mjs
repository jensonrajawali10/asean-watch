#!/usr/bin/env node
// Captures data/ash-wind-snapshot.json: MODELLED hourly wind at 700, 500 and 300 hPa (about 3, 5.5 and
// 9 km) at each watched volcano's Smithsonian GVP summit point, from Open-Meteo (CC BY 4.0). Used by
// src/lib/ashDrift.ts for the illustrative ash-drift lines when the live request fails.
// Variables (verified 2026-10-14): wind_speed_{700,500,300}hPa, wind_direction_{700,500,300}hPa (FROM, °), m/s.
// Request: the Forecast API (forecast_days=3, UTC). If it refuses (e.g. its hourly rate limit), the same
// variables for the same days come from Open-Meteo's Historical Forecast API, which archives the same
// models' forecasts; the endpoint used is recorded in `source` and `requestUrl`.
// Fail safe: any download, shape or value problem writes nothing and keeps the previous file (exit 1).
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'data', 'ash-wind-snapshot.json');
const LEVELS = ['700', '500', '300'];
const VARS = LEVELS.flatMap((l) => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`]);
const DAYS = 3;

async function volcanoes() {
  const watches = JSON.parse(await readFile(path.join(ROOT, 'data', 'watches.json'), 'utf8'));
  const catalog = JSON.parse(await readFile(path.join(ROOT, 'data', 'volcanoes.json'), 'utf8'));
  const out = [];
  for (const w of watches) {
    if (w.hazard !== 'volcano' || !w.volcanoId) continue;
    const v = catalog.find((c) => c.id === w.volcanoId);
    if (!v || !Number.isFinite(v.lat) || !Number.isFinite(v.lon)) throw new Error(`no GVP summit for ${w.volcanoId}`);
    out.push({ volcanoId: v.id, name: v.name, lat: v.lat, lon: v.lon });
  }
  if (out.length === 0) throw new Error('no volcano watches');
  return out;
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) throw new Error(`HTTP ${res.status}${json?.reason ? `: ${json.reason}` : ''}`);
  return json;
}

async function main() {
  const startedMs = Date.now();
  const vs = await volcanoes();
  const loc = `latitude=${vs.map((v) => v.lat).join(',')}&longitude=${vs.map((v) => v.lon).join(',')}`;
  const common = `hourly=${VARS.join(',')}&wind_speed_unit=ms&timezone=GMT`;
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?${loc}&${common}&forecast_days=${DAYS}`;
  const archiveUrl =
    `https://historical-forecast-api.open-meteo.com/v1/forecast?${loc}&${common}` +
    `&start_date=${day(startedMs)}&end_date=${day(startedMs + (DAYS - 1) * 86400000)}`;
  let json;
  let source = 'Open-Meteo Forecast API';
  let requestUrl = forecastUrl;
  try {
    json = await fetchJson(forecastUrl);
  } catch (err) {
    console.warn(`Forecast API refused (${err instanceof Error ? err.message : err}); using the Historical Forecast API.`);
    json = await fetchJson(archiveUrl);
    source = 'Open-Meteo Historical Forecast API (archived forecasts of the same models)';
    requestUrl = archiveUrl;
  }
  const list = Array.isArray(json) ? json : [json];
  if (list.length !== vs.length) throw new Error(`expected ${vs.length} locations, got ${list.length}`);
  const series = list.map((e, i) => {
    const h = e?.hourly;
    if (!h || !Array.isArray(h.time) || h.time.length < 24) throw new Error(`location ${i}: no hourly data`);
    for (const l of LEVELS) {
      if (e.hourly_units?.[`wind_speed_${l}hPa`] !== 'm/s') throw new Error(`location ${i}: ${l} hPa speed unit is not m/s`);
    }
    const times = h.time.map((t) => {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) throw new Error(`bad time ${t}`);
      return `${t}:00Z`;
    });
    const wind = {};
    for (const l of LEVELS) {
      const speed = h[`wind_speed_${l}hPa`];
      const dir = h[`wind_direction_${l}hPa`];
      if (!Array.isArray(speed) || !Array.isArray(dir) || speed.length !== times.length || dir.length !== times.length) {
        throw new Error(`location ${i}: ${l} hPa series missing`);
      }
      speed.forEach((s, k) => {
        if (!Number.isFinite(s) || s < 0 || s > 150 || !Number.isFinite(dir[k])) throw new Error(`location ${i}: bad ${l} hPa value at ${times[k]}`);
      });
      wind[l] = { speed, dir };
    }
    return { ...vs[i], gridLat: e.latitude, gridLon: e.longitude, times, wind };
  });
  const retrievedAt = new Date(startedMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out = {
    about:
      'MODELLED hourly wind at 700, 500 and 300 hPa at each watched volcano summit (Smithsonian GVP point), m/s, direction FROM in degrees. ' +
      'Captured by scripts/capture-ash-wind-snapshot.mjs for the illustrative ash-drift lines. Not an ash advisory or hazard zone.',
    source,
    sourceUrl: 'https://open-meteo.com/en/docs',
    requestUrl,
    model: 'Open-Meteo best match (global weather models)',
    retrievedAt,
    attribution: 'Weather data by Open-Meteo.com (CC BY 4.0), pressure-level winds, best-match global weather model.',
    licence: 'CC BY 4.0 (https://open-meteo.com/en/licence); free tier is non-commercial.',
    levels: LEVELS.map((l) => `${l} hPa`),
    volcanoes: series,
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
  const t = series[0].times;
  console.log(`Wrote data/ash-wind-snapshot.json (${Math.round(Buffer.byteLength(body) / 1024)} KB): ${series.length} volcanoes, ${t[0]} to ${t[t.length - 1]}, ${source}, retrieved ${retrievedAt}.`);
}

main().catch((err) => {
  console.error(`capture-ash-wind-snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Nothing was written; the previous data/ash-wind-snapshot.json is unchanged.');
  process.exit(1);
});
