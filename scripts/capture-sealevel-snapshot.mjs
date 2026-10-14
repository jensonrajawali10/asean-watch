#!/usr/bin/env node
// Capture the IOC Sea Level Station Monitoring Facility snapshot: npm run refresh:sealevel
// 1. Station list (service.php?query=stationlist&showall=all, ~2.4 MB) filtered to the APAC box
//    (lat -50..60, lon 90E..150W across the dateline) and to water-level sensors in metres
//    (battery, atmospheric-pressure, DART "prt" and feet-unit rows removed), one row per code+sensor.
// 2. The last 24 h for five Indonesian gauges, kept at the real samples on each 10-minute mark.
// Raw, unvalidated gauge data on each station's own datum; not a tsunami warning.
// Fail-safe: if the station list fails nothing is written; a station whose readings fail keeps its
// previous sample. No dependencies.
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/sealevel-snapshot.json', import.meta.url);
const BASE = 'https://www.ioc-sealevelmonitoring.org/service.php';
const WATER = ['rad', 'prs', 'pwl', 'wls', 'bub', 'flt', 'enc', 'aqu', 'ecs', 'ra2', 'pr1', 'pr2', 'ras', 'bwl', 'stp', 'bub1'];
const SAMPLE_STATIONS = ['cili', 'prig', 'pada', 'bitu', 'ambon'];
const KEEP = ['Code', 'Location', 'country', 'countryname', 'Lat', 'Lon', 'sensor', 'rate', 'units', 'lasttime'];

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function inBox(lat, lon) {
  const e = ((lon % 360) + 360) % 360;
  return lat >= -50 && lat <= 60 && e >= 90 && e <= 210;
}
function ioc(ms) {
  return new Date(ms).toISOString().slice(0, 19);
}

async function getJson(url, timeoutMs) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function main() {
  let previous = {};
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    // first run
  }
  const listUrl = `${BASE}?query=stationlist&showall=all`;
  const list = await getJson(listUrl, 90000);
  if (!Array.isArray(list) || list.length < 100) throw new Error('station list: unexpected payload');
  const seen = new Set();
  const rows = [];
  for (const r of list) {
    const lat = Number(r.Lat);
    const lon = Number(r.Lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBox(lat, lon)) continue;
    if (!WATER.includes(r.sensor) || r.units !== 'M') continue;
    const key = `${r.Code}|${r.sensor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(Object.fromEntries(KEEP.map((k) => [k, r[k] ?? null])));
  }
  const listRetrievedAt = iso(Date.now());
  console.log(`refresh:sealevel: ${rows.length} APAC water-level sensor rows, ${new Set(rows.map((r) => r.Code)).size} stations`);

  const samples = { ...(previous.samples ?? {}) };
  const end = Date.now();
  for (const code of SAMPLE_STATIONS) {
    const sensor = WATER.find((s) => rows.some((r) => r.Code === code && r.sensor === s));
    if (!sensor) {
      console.warn(`refresh:sealevel: ${code} has no water-level sensor in the list; skipped`);
      continue;
    }
    const url =
      `${BASE}?query=data&code=${code}&timestart=${ioc(end - 24 * 3600000)}&timestop=${ioc(end)}` +
      `&format=json&includesensors[]=${sensor}`;
    try {
      const data = await getJson(url, 60000);
      if (!Array.isArray(data)) throw new Error('not an array');
      const kept = data
        .filter((d) => d.sensor === sensor && Number.isFinite(d.slevel) && d.slevel !== -999 && /:[0-5]0:00$/.test(d.stime))
        .map((d) => ({ slevel: Math.round(d.slevel * 10000) / 10000, stime: d.stime, sensor: d.sensor }));
      if (kept.length === 0) throw new Error('no samples');
      samples[code] = { url, sensor, retrievedAt: iso(Date.now()), raw: kept };
      console.log(`refresh:sealevel: ${code} (${sensor}) ${kept.length} samples on 10-minute marks of ${data.length}`);
    } catch (err) {
      console.warn(`refresh:sealevel: ${code} failed (${err instanceof Error ? err.message : err}); keeping the previous sample`);
    }
  }

  const snapshot = {
    capturedAt: iso(Date.now()),
    source: 'IOC Sea Level Station Monitoring Facility (VLIZ/IOC), https://www.ioc-sealevelmonitoring.org/service.php',
    licence:
      'Flanders Marine Institute (VLIZ); Intergovernmental Oceanographic Commission (IOC) (2026): Sea level station ' +
      `monitoring facility. Accessed at https://www.ioc-sealevelmonitoring.org on ${listRetrievedAt.slice(0, 10)} at VLIZ. ` +
      'DOI: 10.14284/482. Data are provided as received, without quality control (IOC disclaimer).',
    note: 'Raw, unvalidated tide-gauge data on each station datum, including the normal tide. Not a tsunami warning.',
    stationList: { url: listUrl, retrievedAt: listRetrievedAt, raw: rows },
    samples,
  };
  await writeFile(OUT, `${JSON.stringify(snapshot)}\n`, 'utf8');
  console.log('refresh:sealevel: wrote data/sealevel-snapshot.json');
}

main().catch((err) => {
  console.error(`refresh:sealevel: ${err instanceof Error ? err.message : err}; snapshot left unchanged`);
  process.exitCode = 1;
});
