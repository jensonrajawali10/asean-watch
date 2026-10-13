#!/usr/bin/env node
// Capture a real snapshot of the official-warning feeds: node scripts/capture-warnings-snapshot.mjs
// Writes data/warnings-snapshot.json: { capturedAt, note, feeds: { [feedId]: { retrievedAt, urls, raw, error } } }.
// Raw payloads are stored as returned (XML as text, JSON as parsed). Two feeds are row-filtered to keep the
// bundle small, with every kept row untouched: ThaiWater keeps gauges at situation level >= 4 plus all of
// Phra Nakhon Si Ayutthaya province, and GDACS keeps events inside the Asia-Pacific box used by warnings.ts.
// A feed that fails keeps its previous snapshot entry, so a good capture is never replaced by a bad one.
// Owned by the logic builder. No dependencies.
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/warnings-snapshot.json', import.meta.url);
const TIMEOUT_MS = 20000;
const UA = { 'user-agent': 'asean-watch-snapshot (hackathon prototype; contact via repo owner)' };

const BMKG = 'https://bmkg-content-inatews.storage.googleapis.com';
const JMA = 'https://www.jma.go.jp/bosai';

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function inApac(lat, lon) {
  return lat >= -50 && lat <= 55 && ((lon >= 60 && lon <= 180) || (lon >= -180 && lon <= -140));
}

async function get(url, kind) {
  const res = await fetch(url, { headers: { accept: kind === 'json' ? 'application/json' : '*/*', ...UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return kind === 'json' ? res.json() : res.text();
}

const now = Date.now();
const gdacsUrl =
  'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TS;VO;FL;TC' +
  `&fromDate=${isoDay(now - 30 * 86400000)}&toDate=${isoDay(now)}&alertlevel=green;orange;red`;

const FEEDS = {
  'bmkg-inatews': async () => {
    const url = `${BMKG}/last30tsunamievent.xml`;
    return { urls: [url], raw: await get(url, 'text') };
  },
  'bmkg-gempa': async () => {
    const url = `${BMKG}/datagempa.json`;
    return { urls: [url], raw: await get(url, 'json') };
  },
  'jma-tsunami': async () => {
    const listUrl = `${JMA}/tsunami/data/list.json`;
    const list = await get(listUrl, 'json');
    const latest = [...list].sort((a, b) => String(b.rdt).localeCompare(String(a.rdt)))[0];
    if (!latest) return { urls: [listUrl], raw: { list, detail: null } };
    const detailUrl = `${JMA}/tsunami/data/${latest.json}`;
    return { urls: [listUrl, detailUrl], raw: { list, detail: await get(detailUrl, 'json') } };
  },
  'jma-volcano': async () => {
    const warningUrl = `${JMA}/volcano/data/warning.json`;
    const listUrl = `${JMA}/volcano/const/volcano_list.json`;
    const [warning, volcanoList] = await Promise.all([get(warningUrl, 'json'), get(listUrl, 'json')]);
    return { urls: [warningUrl, listUrl], raw: { warning, volcanoList } };
  },
  'geonet-val': async () => {
    const url = 'https://api.geonet.org.nz/volcano/val';
    return { urls: [url], raw: await get(url, 'json') };
  },
  'nws-tsunami': async () => {
    const url =
      'https://api.weather.gov/alerts/active?area=GU,MP,AS,HI&event=Tsunami%20Warning,Tsunami%20Advisory,Tsunami%20Watch';
    return { urls: [url], raw: await get(url, 'json') };
  },
  gdacs: async () => {
    const body = await get(gdacsUrl, 'json');
    const features = Array.isArray(body?.features) ? body.features : [];
    const kept = features.filter((f) => {
      const c = f?.geometry?.coordinates;
      return Array.isArray(c) && inApac(Number(c[1]), Number(c[0]));
    });
    return { urls: [gdacsUrl], raw: { ...body, features: kept } };
  },
  thaiwater: async () => {
    const url = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load';
    const body = await get(url, 'json');
    const rows = body?.waterlevel_data?.data ?? [];
    const kept = rows.filter((r) => (r?.situation_level ?? 0) >= 4 || r?.geocode?.province_code === '14');
    return {
      urls: [url],
      raw: { waterlevel_data: { ...body.waterlevel_data, data: kept }, scale: body.scale },
    };
  },
  'dsda-jakarta': async () => {
    const url = 'https://poskobanjir.dsdadki.web.id/xmldata.xml';
    return { urls: [url], raw: await get(url, 'text') };
  },
  'pub-flood': async () => {
    const url = 'https://api-open.data.gov.sg/v2/real-time/api/weather/flood-alerts';
    return { urls: [url], raw: await get(url, 'json') };
  },
};

async function main() {
  let previous = { feeds: {} };
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    // first capture
  }
  const capturedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const feeds = {};
  for (const [id, run] of Object.entries(FEEDS)) {
    const retrievedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    try {
      const { urls, raw } = await run();
      feeds[id] = { retrievedAt, urls, raw, error: null };
      const size = JSON.stringify(raw).length;
      console.log(`ok    ${id.padEnd(14)} ${String(size).padStart(8)} chars  ${urls.join(' ')}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kept = previous.feeds?.[id];
      feeds[id] = kept && kept.raw ? kept : { retrievedAt: null, urls: [], raw: null, error: message };
      console.log(`FAIL  ${id.padEnd(14)} ${message}${kept && kept.raw ? ' (kept previous snapshot entry)' : ''}`);
    }
  }
  const snapshot = {
    capturedAt,
    note:
      'Real official-warning feed payloads captured for offline fallback. Shown as HISTORICAL with their ' +
      'original times; never as current. Relayed verbatim; follow each issuer.',
    feeds,
  };
  await writeFile(OUT, `${JSON.stringify(snapshot)}\n`, 'utf8');
  console.log(`Wrote data/warnings-snapshot.json (capturedAt ${capturedAt}).`);
}

main().catch((err) => {
  console.error(`Warnings snapshot NOT written: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
