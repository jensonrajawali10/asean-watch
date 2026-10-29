#!/usr/bin/env node
// Refreshes the real-data snapshot in data/real/. Plain Node 20+, no dependencies.
// Run: npm run refresh:data   (or: node scripts/refresh-data.mjs)
//
// Sources (all open, no key):
//   NASA FIRMS 7-day South East Asia CSVs: VIIRS 375 m (Suomi NPP, NOAA-20, NOAA-21) and MODIS C6.1.
//     About 8 MB each, so they are streamed and filtered line by line, never held whole.
//   USGS FDSN event query (GeoJSON) for one box around every watch area.
//   BMKG earthquake lists: Data Terbuka gempaterkini.json (latest 15 M 5.0+) and gempadirasakan.json
//     (latest 15 felt), and InaTEWS live30event.xml (latest located events, all magnitudes).
//
// Keeps rows inside the 7-day window (the last 7 UTC days, today included up to the retrieval time)
// and near a watch in data/watches.json: within COLLECT_*_RADIUS_KM of a volcano summit, or inside a
// haze box. The collection radii are wider than the watch rules in src/lib/watchRules.ts, which
// decide what is shown and what is an anomaly. This script makes no anomaly decisions. Inside a haze
// box only the strongest few rows per satellite per UTC day are kept; every row there is still counted,
// in the hazeDayTotals of data/real/firms.json, so the snapshot stays small in a heavy fire season.
//
// Writes data/real/firms.json, data/real/quakes.json, data/real/meta.json and the scenarioWindow of
// every watch in data/watches.json. All or nothing: if any download or parse fails, nothing is
// written, the previous snapshot stays in place, and the script exits with code 1. The four files are
// written through scripts/lib/atomicWrite.mjs (temp files, backups, renames): if a rename fails
// part-way, the files already replaced are restored from their backups, and the script says so, or
// says exactly which backups to restore by hand if that also fails.
//
// The collecting itself lives in scripts/lib/watchDataBuild.mjs, which the live relay GET /api/watch also
// runs (src/lib/watchProxy.ts). This script adds the file I/O: it reads data/watches.json and writes the result.

import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AtomicWriteError, writeAllOrNothing } from './lib/atomicWrite.mjs';
import { buildWatchData } from './lib/watchDataBuild.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WATCHES_PATH = path.join(ROOT, 'data', 'watches.json');
const OUT_DIR = path.join(ROOT, 'data', 'real');

async function main() {
  const watches = JSON.parse(await readFile(WATCHES_PATH, 'utf8'));
  const { files, updatedWatches, snapshotBytes, sources, check, startedMs } = await buildWatchData({ watches, log: (line) => console.log(line) });

  await mkdir(OUT_DIR, { recursive: true });
  const { leftover } = await writeAllOrNothing([
    [path.join(OUT_DIR, 'firms.json'), files.firms],
    [path.join(OUT_DIR, 'quakes.json'), files.quakes],
    [path.join(OUT_DIR, 'meta.json'), files.meta],
    [WATCHES_PATH, `${JSON.stringify(updatedWatches, null, 2)}
`],
  ]);

  console.log(`Wrote data/real/ (${Math.round(snapshotBytes / 1024)} KB) and the scenarioWindow in data/watches.json.`);
  for (const f of leftover) console.warn(`  note: could not remove the backup ${path.relative(ROOT, f)}; it is safe to delete.`);
  for (const s of sources) {
    console.log(`  ${s.id.padEnd(22)} read ${String(s.rowsRead).padStart(6)}  kept ${String(s.rowsKept).padStart(4)}  last-modified ${s.lastModified ?? 'n/a'}`);
  }
  console.log(`  live30event UTC check: ${check.live30eventTimesAreUtc.matchedWithin10sAnd100km} of ${check.live30eventTimesAreUtc.feltEventsInPeriod} felt events matched`);
  console.log(`Done in ${((Date.now() - startedMs) / 1000).toFixed(1)} s.`);
}

main().catch((err) => {
  console.error(`refresh-data failed: ${err instanceof Error ? err.message : String(err)}`);
  const state = err instanceof AtomicWriteError ? err.state : 'unchanged';
  if (state === 'restore-failed') {
    console.error('PARTLY WRITTEN: data/real/ and data/watches.json now mix old and new files. Restore by hand:');
    for (const { backup, target } of err.kept) console.error(`  rename ${path.relative(ROOT, backup)} to ${path.relative(ROOT, target)}`);
    console.error('Then run npm run refresh:data again.');
  } else if (state === 'restored') {
    console.error('The files replaced before the failure were restored; the previous snapshot in data/real/ and data/watches.json is unchanged.');
  } else {
    console.error('Nothing was written; the previous snapshot in data/real/ and data/watches.json is unchanged.');
  }
  process.exit(1);
});
