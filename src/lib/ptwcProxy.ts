// Server side of GET /api/ptwc (bundled into api/_lib/ptwc-core.js by scripts/build-api.mjs).
// tsunami.gov sends no CORS headers, so this strict proxy fetches ONLY:
//   1. the fixed PTWC Atom feed https://www.tsunami.gov/events/xml/PHEBAtom.xml, and
//   2. the CAP document that feed links, only if it is https://www.tsunami.gov/events/PHEB/.../PHEBCAP.xml.
// The client sends no URL and no parameters (any query string is refused). Same-site requests only,
// a per-IP rate limit, a 60 s upstream cache and short cache headers. It returns the two documents
// as received; parsing happens in src/lib/ptwc.ts.
export const PTWC_ATOM_URL = 'https://www.tsunami.gov/events/xml/PHEBAtom.xml';
export const PTWC_ALLOWED_HOST = 'www.tsunami.gov';
const CAP_PATH = /^\/events\/PHEB\/\d{4}\/\d{2}\/\d{2}\/[0-9A-Za-z]+\/\d+\/[0-9A-Za-z]+\/PHEBCAP\.xml$/;
const MAX_BYTES = 512 * 1024;
export const PTWC_RATE_LIMIT_MAX = 30;
export const PTWC_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PTWC_UPSTREAM_CACHE_MS = 60 * 1000;
/**
 * One overall upstream budget for the Atom feed plus its CAP document. It stays well under the client's
 * timeout (PTWC_CLIENT_TIMEOUT_MS in src/lib/ptwc.ts), so a slow tsunami.gov still gets an answer to the
 * client instead of the client giving up and showing the HISTORICAL snapshot. When the Atom feed used
 * most of it, the CAP is skipped: the Atom entry still carries the category, time and region.
 */
export const PTWC_UPSTREAM_BUDGET_MS = 7000;
/** The CAP document is only requested when at least this much of the budget is left. */
export const PTWC_MIN_CAP_BUDGET_MS = 1000;

export interface PtwcPayload {
  atomUrl: string;
  atom: string;
  capUrl: string | null;
  cap: string | null;
  retrievedAt: string;
}

export interface PtwcContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Override PTWC_UPSTREAM_BUDGET_MS (tests). */
  budgetMs?: number;
}

/** The CAP link in the Atom feed, if it is on the allow-listed host and path; https enforced. */
export function capUrlFromAtom(atom: string): string | null {
  const links = atom.match(/<link\b[^>]*>/gi) ?? [];
  for (const link of links) {
    if (!/title\s*=\s*["']CapXML document["']/i.test(link) && !/application\/cap\+xml/i.test(link)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(link)?.[1];
    if (!href) continue;
    let u: URL;
    try {
      u = new URL(href.trim());
    } catch {
      continue;
    }
    if (u.hostname !== PTWC_ALLOWED_HOST || u.username || u.password || u.port || u.search || u.hash) continue;
    if (!CAP_PATH.test(u.pathname)) continue;
    return `https://${PTWC_ALLOWED_HOST}${u.pathname}`;
  }
  return null;
}

const hits = new Map<string, number[]>();
let upstream: { at: number; payload: PtwcPayload } | null = null;

export function resetPtwcProxyState(): void {
  hits.clear();
  upstream = null;
}

function rateLimit(ip: string, now: number): number {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < PTWC_RATE_LIMIT_WINDOW_MS);
  if (recent.length >= PTWC_RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    return Math.max(1, Math.ceil((PTWC_RATE_LIMIT_WINDOW_MS - (now - recent[0])) / 1000));
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return 0;
}

/** Same-site only: Sec-Fetch-Site (when sent) must be same-origin/none; Origin (when sent) must match Host. */
function sameSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.split(',')[0].trim().toLowerCase();
  } catch {
    return false;
  }
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra },
  });
}

async function fetchText(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<string> {
  const res = await fetchImpl(url, {
    redirect: 'error',
    headers: { accept: 'application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(Math.max(1, Math.round(timeoutMs))),
  });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('upstream document too large');
  return text;
}

export async function handlePtwcRequest(request: Request, ctx: PtwcContext): Promise<Response> {
  const now = ctx.now ?? Date.now;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
    const url = new URL(request.url);
    if (url.search !== '') return json(400, { error: 'bad_request', message: 'This endpoint takes no parameters.' });
    if (!sameSite(request)) return json(403, { error: 'forbidden', message: 'Cross-site requests are not accepted.' });
    const retryAfter = rateLimit(ctx.clientIp || 'unknown', now());
    if (retryAfter > 0) return json(429, { error: 'rate_limited', retryAfterSeconds: retryAfter }, { 'retry-after': String(retryAfter) });

    if (!upstream || now() - upstream.at >= PTWC_UPSTREAM_CACHE_MS || now() < upstream.at) {
      const fetchImpl = ctx.fetchImpl ?? fetch;
      const budget = ctx.budgetMs ?? PTWC_UPSTREAM_BUDGET_MS;
      const started = Date.now();
      const atom = await fetchText(fetchImpl, PTWC_ATOM_URL, budget);
      if (!/<feed[\s>]/i.test(atom)) throw new Error('upstream is not an Atom feed');
      const capUrl = capUrlFromAtom(atom);
      let cap: string | null = null;
      const left = budget - (Date.now() - started);
      if (capUrl && left >= Math.min(PTWC_MIN_CAP_BUDGET_MS, budget / 2)) {
        try {
          cap = (await fetchText(fetchImpl, capUrl, left)).replace(/<Signature\b[\s\S]*?<\/Signature>/, '');
        } catch {
          cap = null; // the Atom entry still carries the category, time and region
        }
      }
      upstream = { at: now(), payload: { atomUrl: PTWC_ATOM_URL, atom, capUrl, cap, retrievedAt: new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z') } };
    }
    return json(200, upstream.payload, { 'cache-control': 'public, max-age=30, s-maxage=60' });
  } catch (err) {
    return json(502, { error: 'upstream_unavailable', message: err instanceof Error ? err.message : 'upstream failed' }, { 'cache-control': 'no-store' });
  }
}

export function clientIpFrom(headers: Headers, fallback = 'unknown'): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim() || fallback;
  return headers.get('x-real-ip')?.trim() || fallback;
}
