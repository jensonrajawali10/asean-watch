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
//
// The building itself lives in scripts/lib/firesBuild.mjs, which the live relay GET /api/fires also runs
// (src/lib/firesProxy.ts). This script adds the file I/O: it reads the inputs and writes the result.

import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildFireSnapshot, utf8Bytes } from './lib/firesBuild.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'data', 'fires-snapshot.json');
const REGION_PATH = path.join(ROOT, 'data', 'region.geojson');
const ADMIN_PATH = path.join(ROOT, 'data', 'fire-admin-lookup.json');

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const { text, plan, results, total, countryList, clusters24h, countryStats, history, startedMs } = await buildFireSnapshot({
    region: JSON.parse(await readFile(REGION_PATH, 'utf8')),
    adminLookup: JSON.parse(await readFile(ADMIN_PATH, 'utf8')),
    previous: await readPrevious(),
    log: (line) => console.log(line),
  });

  const tmp = `${OUT}.tmp`;
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, OUT);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }

  const sum = (a) => a.reduce((x, y) => x + y, 0);
  console.log(`Wrote data/fires-snapshot.json (${Math.round(utf8Bytes(text) / 1024)} KB, grid plan ${plan}: ${['0.25° all', '0.5° for periods 2+', '0.5° all'][plan]}).`);
  for (const r of results) {
    const s = r.source;
    console.log(
      `  ${s.id.padEnd(13)} read ${String(s.rowsRead).padStart(6)}  confident ${String(s.rowsConfident).padStart(6)}  in 7 periods ${String(s.rowsInPeriods).padStart(6)}  after ref ${String(s.rowsAfterReference).padStart(5)}  last-modified ${s.lastModified ?? 'n/a'}  latest ${s.latestDetection}`,
    );
  }
  console.log(`  last 24 h: ${total.count[0]} detections, ${Math.round(total.frp[0])} MW summed FRP; 7 periods: ${sum(total.count)} detections.`);
  console.log(`  countries: ${countryList.slice(0, 6).map((c) => `${c.iso3} ${sum(c.count)}`).join(', ')}`);
  console.log(`  top 24 h clusters: ${clusters24h.slice(0, 5).map((c) => `${c.name} (${c.count[0]})`).join('; ')}`);
  console.log(`  country assignment: ${JSON.stringify(countryStats)}; history days ${history.length} (${history[0]?.date ?? '-'} to ${history.at(-1)?.date ?? '-'}).`);
  console.log(`Done in ${((Date.now() - startedMs) / 1000).toFixed(1)} s.`);
}

main().catch((err) => {
  console.error(`refresh-fires failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Nothing was written; the previous data/fires-snapshot.json (if any) is unchanged.');
  process.exit(1);
});
