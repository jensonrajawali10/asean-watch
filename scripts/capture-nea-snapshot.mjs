#!/usr/bin/env node
// Capture a real NEA snapshot for offline fallback: node scripts/capture-nea-snapshot.mjs
// Fetches the four NEA real-time endpoints on data.gov.sg (no key, no dependencies) and writes
// data/nea-snapshot.json with the raw responses untouched. Owned by the logic builder.
// If any endpoint fails, or answers without usable readings (data.gov.sg can return 200 with code 0
// and empty readings), nothing is written and the script exits with code 1, so a good snapshot is
// never replaced by a bad one (checks: scripts/lib/neaSnapshotCheck.mjs). Written atomically.
import { writeFileAtomic } from './lib/atomicWrite.mjs';
import { neaSnapshotProblems } from './lib/neaSnapshotCheck.mjs';

const BASE = 'https://api-open.data.gov.sg/v2/real-time/api';
const ENDPOINTS = {
  windDirection: `${BASE}/wind-direction`,
  windSpeed: `${BASE}/wind-speed`,
  psi: `${BASE}/psi`,
  pm25: `${BASE}/pm25`,
};
const TIMEOUT_MS = 15000;
const OUT = new URL('../data/nea-snapshot.json', import.meta.url);

async function fetchRaw(name, url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`);
  const body = await res.json();
  if (body && typeof body === 'object' && 'code' in body && body.code !== 0) {
    throw new Error(`${name}: API returned code ${body.code} (${body.errorMsg || 'no message'})`);
  }
  return body;
}

async function main() {
  const names = Object.keys(ENDPOINTS);
  const bodies = await Promise.all(names.map((n) => fetchRaw(n, ENDPOINTS[n])));
  const responses = Object.fromEntries(names.map((n, i) => [n, bodies[i]]));
  const problems = neaSnapshotProblems(responses);
  if (problems.length > 0) throw new Error(`unusable response (${problems.join('; ')}); the previous snapshot is kept`);
  const capturedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const snapshot = {
    capturedAt,
    source:
      'NEA real-time weather and air quality via data.gov.sg: ' +
      'https://api-open.data.gov.sg/v2/real-time/api/{wind-direction,wind-speed,psi,pm25}',
    licence:
      'Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence). Contains ' +
      'information from Wind Direction across Singapore, Wind Speed across Singapore, Pollutant ' +
      `Standards Index (PSI) and PM2.5 accessed on ${capturedAt.slice(0, 10)} from data.gov.sg which ` +
      'is made available under the terms of the Singapore Open Data Licence version 1.0 ' +
      'https://data.gov.sg/open-data-licence',
    responses,
  };
  await writeFileAtomic(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote data/nea-snapshot.json (capturedAt ${capturedAt}).`);
}

main().catch((err) => {
  console.error(`NEA snapshot NOT written: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
