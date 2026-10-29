// The Tokyo VAAC advisory builder, shared by scripts/capture-vaac-snapshot.mjs (writes
// data/vaac-snapshot.json) and the live relay GET /api/vaac (src/lib/vaacProxy.ts). No file or console
// I/O here: the caller passes a fetch.
//
// What it does: reads the Tokyo VAAC advisory list (one HTML table, about 170 KB, back about two months),
// keeps the newest advisory per volcano issued in the last 24 hours, and fetches each one's text page. The
// text between JMA's "VAA Text Start" and "VAA Text End" markers is kept word for word: only the HTML line
// breaks become newlines, entities are decoded and trailing spaces dropped. Parsing the text into fields
// happens in the browser (src/lib/vaac.ts).
//
// Only advisories that say "VAAC: TOKYO" are kept. JMA's site also mirrors some VAAC Darwin advisories
// (its "Darwin VAAC Backup" page); their text is the Bureau of Meteorology's, which JMA's licence does not
// cover, so they are never fetched.
//
// All or nothing: if the list or any selected text page fails, the build throws and nothing is returned.
// A partial answer could leave out an advisory without saying so.
//
// Terms: JMA Website Terms of Use, Public Data License (Version 1.0), compatible with CC BY 4.0; the source
// must be cited (https://www.jma.go.jp/jma/en/copyright.html).

export const VAAC_TOKYO_LIST_URL = 'https://www.data.jma.go.jp/vaac/data/vaac_list.html';
export const VAAC_TOKYO_SOURCE = 'Tokyo Volcanic Ash Advisory Center (Japan Meteorological Agency)';
export const VAAC_TOKYO_LICENCE =
  'Source: Japan Meteorological Agency website (https://www.data.jma.go.jp/vaac/data/vaac_list.html). ' +
  'JMA Website Terms of Use: Public Data License (Version 1.0), compatible with CC BY 4.0.';
/** Advisories issued within this many hours of the build are kept (the newest per volcano). */
export const VAAC_WINDOW_HOURS = 24;
/** At most this many text pages per build (one per volcano; a busy day has a handful). */
export const VAAC_MAX_ADVISORIES = 12;
const USER_AGENT = 'asean-watch refresh:vaac script (Tokyo VAAC advisories, relayed verbatim with source citation)';
const HOST = 'www.data.jma.go.jp';
/** The only pages fetched besides the list: "TextData/2026/20261029_28208001_0332_Text.html". */
const TEXT_PATH = /^TextData\/\d{4}\/\d{8}_\d{8}_\d{4}_Text\.html$/;
const MAX_LIST_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
/** The list's rows sort on a hidden "2026/10/29 11:45:00" cell (UTC, as the visible cell beside it says). */
const LIST_TIME = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[name.toLowerCase()] ?? m;
  });
}

function cellText(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * The advisory rows of the list page: [{ listedAt, volcano, area, number, path }], in page order. Rows
 * without a text link or a readable time are skipped.
 */
export function parseVaacList(html) {
  const rows = [];
  for (const tr of html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 6) continue;
    const t = LIST_TIME.exec(cellText(cells[0]));
    if (!t) continue;
    const ms = Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +t[6]);
    const path = /href\s*=\s*"([^"]+)"/i.exec(cells[5])?.[1] ?? null;
    if (!Number.isFinite(ms) || !path || !TEXT_PATH.test(path)) continue;
    rows.push({ listedAt: iso(ms), volcano: cellText(cells[2]), area: cellText(cells[3]), number: cellText(cells[4]), path });
  }
  return rows;
}

/** The newest row per volcano listed within the window before `now`, newest first, at most `max`. */
export function selectRecent(rows, { now, windowHours = VAAC_WINDOW_HOURS, max = VAAC_MAX_ADVISORIES }) {
  const from = now - windowHours * 3_600_000;
  const seen = new Set();
  const out = [];
  for (const r of [...rows].sort((a, b) => b.listedAt.localeCompare(a.listedAt))) {
    const ms = Date.parse(r.listedAt);
    // Ten minutes of clock skew allowed at the near end.
    if (!(ms > from && ms <= now + 600_000)) continue;
    const key = `${r.volcano}|${r.area}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The advisory text of one text page, word for word: the block between JMA's markers, with <BR> as a
 * newline, tags removed, entities decoded and trailing spaces dropped. Throws if the block is missing or is
 * not a VA advisory.
 */
export function extractVaaText(html) {
  const m = /<!--\s*VAA Text Start\s*-->([\s\S]*?)<!--\s*VAA Text End\s*-->/i.exec(html);
  if (!m) throw new Error('no VAA text block');
  const text = decodeEntities(m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
  if (!/^VA ADVISORY$/m.test(text) || !/^DTG:/m.test(text)) throw new Error('the text block is not a VA advisory');
  return text;
}

/** The issuing VAAC as the text states it, e.g. "TOKYO"; null when the line is missing. */
export function vaacOf(text) {
  return /^VAAC:\s*(.+)$/m.exec(text)?.[1].trim() ?? null;
}

async function fetchText(url, ctx, maxBytes) {
  const left = ctx.deadline - Date.now();
  if (left <= 0) throw new Error(`${url}: timed out (whole budget used)`);
  let res;
  try {
    res = await ctx.fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(left), headers: { 'User-Agent': ctx.userAgent } });
  } catch (err) {
    throw new Error(`${url}: request failed (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > maxBytes) throw new Error(`${url}: answer too large`);
  return text;
}

/**
 * Build the advisory set: { source, licence, listUrl, retrievedAt, windowHours, listRows, listUpdated,
 * advisories: [{ url, listedAt, volcano, area, number, text }] }. Throws on any failure.
 */
export async function buildVaacData({ fetchImpl = fetch, now = Date.now(), timeoutMs = 20_000, userAgent = USER_AGENT, log = () => {} } = {}) {
  const ctx = { fetchImpl, userAgent, deadline: Date.now() + timeoutMs };
  const html = await fetchText(VAAC_TOKYO_LIST_URL, ctx, MAX_LIST_BYTES);
  if (!/Volcanic Ash Advisories/i.test(html)) throw new Error('the Tokyo VAAC list page did not have the expected title');
  const rows = parseVaacList(html);
  if (rows.length === 0) throw new Error('no advisory rows on the Tokyo VAAC list');
  const picked = selectRecent(rows, { now });
  const listUpdated = /class="update-time"[^>]*>([^<]+)</i.exec(html)?.[1].trim() ?? null;
  log(`vaac: ${rows.length} rows listed, ${picked.length} volcano(es) with an advisory in the last ${VAAC_WINDOW_HOURS} h`);

  const fetched = await Promise.all(
    picked.map(async (r) => {
      const url = new URL(r.path, VAAC_TOKYO_LIST_URL);
      if (url.hostname !== HOST || url.protocol !== 'https:') throw new Error(`text link not allowed: ${r.path}`);
      const text = extractVaaText(await fetchText(url.toString(), ctx, MAX_TEXT_BYTES));
      return { url: url.toString(), listedAt: r.listedAt, volcano: r.volcano, area: r.area, number: r.number, text };
    }),
  );
  const advisories = fetched.filter((a) => {
    const vaac = vaacOf(a.text);
    if (vaac === 'TOKYO') return true;
    log(`vaac: skipped ${a.url}: issued by VAAC ${vaac ?? '(not stated)'}, not Tokyo`);
    return false;
  });
  return {
    source: VAAC_TOKYO_SOURCE,
    licence: VAAC_TOKYO_LICENCE,
    listUrl: VAAC_TOKYO_LIST_URL,
    retrievedAt: iso(now),
    windowHours: VAAC_WINDOW_HOURS,
    listRows: rows.length,
    listUpdated,
    advisories,
  };
}
