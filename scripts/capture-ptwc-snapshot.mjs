#!/usr/bin/env node
// Capture the latest PTWC product for offline fallback: npm run refresh:ptwc
// Fetches ONLY the fixed PTWC Atom feed and the CAP document it links on www.tsunami.gov (the same
// two documents api/ptwc.ts proxies). The CAP XML-DSig <Signature> block is dropped to keep the file
// small; every other byte is as received. The Atom feed holds only the latest product, so this is a
// HISTORICAL example, never a current message. Fail-safe: on any failure nothing is written.
import { writeFile } from 'node:fs/promises';

const OUT = new URL('../data/ptwc-snapshot.json', import.meta.url);
const ATOM_URL = 'https://www.tsunami.gov/events/xml/PHEBAtom.xml';
const CAP_PATH = /^\/events\/PHEB\/\d{4}\/\d{2}\/\d{2}\/[0-9A-Za-z]+\/\d+\/[0-9A-Za-z]+\/PHEBCAP\.xml$/;

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function getText(url) {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

async function main() {
  const atom = await getText(ATOM_URL);
  if (!/<feed[\s>]/.test(atom)) throw new Error('not an Atom feed');
  const link = /<link\b[^>]*title="CapXML document"[^>]*>/i.exec(atom)?.[0] ?? '';
  const href = /href="([^"]+)"/.exec(link)?.[1] ?? null;
  let capUrl = null;
  let cap = null;
  if (href) {
    const u = new URL(href);
    if (u.hostname !== 'www.tsunami.gov' || !CAP_PATH.test(u.pathname)) throw new Error(`CAP link not allowed: ${href}`);
    u.protocol = 'https:';
    capUrl = u.toString();
    cap = (await getText(capUrl)).replace(/<Signature\b[\s\S]*?<\/Signature>/, '');
  }
  const retrievedAt = iso(Date.now());
  const snapshot = {
    capturedAt: retrievedAt,
    source: 'NOAA/NWS Pacific Tsunami Warning Center (PTWC), https://www.tsunami.gov/',
    licence: 'NOAA/NWS public information (U.S. Government work). Credit: NOAA/NWS Pacific Tsunami Warning Center.',
    note: 'HISTORICAL example of the latest PTWC product at capture time. Not a current message.',
    atomUrl: ATOM_URL,
    atom,
    capUrl,
    cap,
    retrievedAt,
  };
  await writeFile(OUT, `${JSON.stringify(snapshot, null, 1)}\n`, 'utf8');
  console.log(`refresh:ptwc: wrote data/ptwc-snapshot.json (CAP: ${capUrl ?? 'none linked'})`);
}

main().catch((err) => {
  console.error(`refresh:ptwc: ${err instanceof Error ? err.message : err}; snapshot left unchanged`);
  process.exitCode = 1;
});
