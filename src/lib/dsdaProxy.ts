// Server side of GET /api/dsda (bundled into api/_lib/dsda-core.js by scripts/build-api.mjs).
// Jakarta DSDA's Posko Banjir floodgate XML, fetched server-side so a broken DSDA certificate never
// reaches the visitor's console as net::ERR_CERT_AUTHORITY_INVALID. Since about 8 Oct 2026 the host
// has presented a certificate signed by its own Fortinet firewall, which neither browsers nor Node
// trust. TLS verification stays ON: we never relay data we cannot authenticate. While the
// certificate is untrusted, the answer is a 200 { available: false, reason, message } that the
// client shows as "Live feed unavailable (…)" beside the bundled HISTORICAL snapshot. Once DSDA fixes
// the certificate the live feed comes back on its own.
// Only the fixed URL below is ever fetched; the client sends no parameters (any query string is
// refused). Same-site requests only, a per-IP rate limit and short CDN caching.
import { DSDA_REASON_TEXT, DSDA_XML_URL, type DsdaPayload, type DsdaUnavailableReason } from './dsdaRelay';
import { clientIpFrom, isoSeconds, json, makeRateLimiter, sameSite } from './proxyCommon';

export { clientIpFrom, DSDA_XML_URL };

const MAX_BYTES = 2 * 1024 * 1024;
export const DSDA_UPSTREAM_TIMEOUT_MS = 8000;
export const DSDA_RATE_LIMIT_MAX = 30;
export const DSDA_RATE_LIMIT_WINDOW_MS = 60 * 1000;
/** DSDA updates the gates about hourly; a live copy is reused for 5 minutes. */
export const DSDA_UPSTREAM_CACHE_MS = 5 * 60 * 1000;
/** A failed upstream is not retried for 15 minutes (per instance and at the CDN). */
export const DSDA_FAILURE_CACHE_MS = 15 * 60 * 1000;

export interface DsdaContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Server log for the failure detail (default console.error). */
  log?: (line: string) => void;
}

const limiter = makeRateLimiter(DSDA_RATE_LIMIT_MAX, DSDA_RATE_LIMIT_WINDOW_MS);
let last: { at: number; payload: DsdaPayload } | null = null;
let inflight: Promise<DsdaPayload> | null = null;

export function resetDsdaProxyState(): void {
  limiter.reset();
  last = null;
  inflight = null;
}

/** Node/undici TLS verification failures carry an OpenSSL code on the error or its cause. */
const TLS_CODE = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ERR_TLS/i;

export function classifyDsdaError(err: unknown): DsdaUnavailableReason {
  const codes: string[] = [];
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    const rec = e as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    if (typeof rec.code === 'string') codes.push(rec.code);
    if (rec.name === 'TimeoutError' || rec.name === 'AbortError') return 'timeout';
    if (typeof rec.message === 'string' && /certificate/i.test(rec.message)) return 'certificate';
    e = rec.cause;
  }
  return codes.some((c) => TLS_CODE.test(c)) ? 'certificate' : 'network';
}

class UpstreamError extends Error {
  reason: DsdaUnavailableReason;
  constructor(reason: DsdaUnavailableReason, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

async function fetchUpstream(ctx: DsdaContext, nowMs: number): Promise<DsdaPayload> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  try {
    let res: Response;
    try {
      res = await fetchImpl(DSDA_XML_URL, {
        redirect: 'error',
        headers: { accept: 'application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(DSDA_UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      throw new UpstreamError(classifyDsdaError(err), err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }
    if (!res.ok) throw new UpstreamError('upstream_http', `HTTP ${res.status}`);
    const xml = await res.text();
    if (xml.length > MAX_BYTES) throw new UpstreamError('not_floodgate_xml', 'document too large');
    if (!xml.includes('SP_GET_LAST_STATUS_PINTU_AIR')) throw new UpstreamError('not_floodgate_xml', 'no SP_GET_LAST_STATUS_PINTU_AIR rows');
    return { available: true, url: DSDA_XML_URL, retrievedAt: isoSeconds(nowMs), xml };
  } catch (err) {
    const reason = err instanceof UpstreamError ? err.reason : 'network';
    const detail = err instanceof Error ? err.message : String(err);
    (ctx.log ?? console.error)(`dsda: ${reason}: ${detail.replace(/\s+/g, ' ').slice(0, 300)}`);
    return { available: false, url: DSDA_XML_URL, checkedAt: isoSeconds(nowMs), reason, message: DSDA_REASON_TEXT[reason] };
  }
}

function cacheSeconds(p: DsdaPayload, ageMs: number): number {
  const ttl = p.available ? DSDA_UPSTREAM_CACHE_MS : DSDA_FAILURE_CACHE_MS;
  return Math.max(30, Math.ceil((ttl - ageMs) / 1000));
}

export async function handleDsdaRequest(request: Request, ctx: DsdaContext): Promise<Response> {
  const now = ctx.now ?? Date.now;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
    if (new URL(request.url).search !== '') return json(400, { error: 'bad_request', message: 'This endpoint takes no parameters.' });
    if (!sameSite(request)) return json(403, { error: 'forbidden', message: 'Cross-site requests are not accepted.' });
    const retryAfter = limiter.check(ctx.clientIp || 'unknown', now());
    if (retryAfter > 0) return json(429, { error: 'rate_limited', retryAfterSeconds: retryAfter }, { 'retry-after': String(retryAfter) });

    // The latest outcome is reused: a live copy for 5 minutes, a failure for 15 (the backoff).
    let entry = last;
    const age = entry ? now() - entry.at : Infinity;
    if (!entry || age < 0 || age >= (entry.payload.available ? DSDA_UPSTREAM_CACHE_MS : DSDA_FAILURE_CACHE_MS)) {
      if (!inflight) {
        const started = now();
        inflight = fetchUpstream(ctx, started).finally(() => {
          inflight = null;
        });
      }
      entry = { at: now(), payload: await inflight };
      last = entry;
    }
    const s = cacheSeconds(entry.payload, now() - entry.at);
    return json(200, entry.payload, { 'cache-control': `public, max-age=${Math.min(s, 60)}, s-maxage=${s}` });
  } catch {
    return json(500, { error: 'internal_error' }, { 'cache-control': 'no-store' });
  }
}
