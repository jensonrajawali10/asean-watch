// Server side of GET /api/thaiwater (bundled into api/_lib/thaiwater-core.js by scripts/build-api.mjs).
// Why it exists: src/lib/thaiwaterRelay.ts.
//
// Strict relay: the client sends no parameters (any query string is refused) and the upstream URL is the
// one fixed THAIWATER_UPSTREAM_URL. Same-site requests only and a per-IP rate limit.
//
// Caching, so ThaiWater sees a few requests an hour however many people visit:
// - The list is kept for 10 minutes at this instance and at the CDN (s-maxage). ThaiWater publishes no
//   update interval for waterlevel_load; its readings are hourly (751 of 768 gauges were stamped on the hour
//   in the answer fetched 2 Nov 2026 16:11 UTC, the newest 11 minutes old), so a 10-minute copy shows each
//   new hour's readings within 10 minutes.
// - After a 429 the host is left alone for 2 minutes (or its Retry-After, up to 15).
// - Meanwhile, and on any upstream failure, the last good copy is served with stale: true (up to 6 hours;
//   its readings age on the page, src/lib/staleness.ts); without one the answer is a 200
//   { available: false, reason } that the browser shows as "Live feed unavailable (…)" beside its bundled
//   HISTORICAL snapshot. Never a non-2xx for an upstream problem, so a throttled ThaiWater never prints a
//   console error.
import { THAIWATER_REASON_TEXT, THAIWATER_UPSTREAM_URL, type ThaiWaterUnavailableReason } from './thaiwaterRelay';
import { clientIpFrom, isoSeconds, json, makeRateLimiter, sameSite } from './proxyCommon';

export { clientIpFrom, THAIWATER_UPSTREAM_URL };

const MINUTE_MS = 60 * 1000;
export const THAIWATER_TTL_MS = 10 * MINUTE_MS;
/** The last good copy is served (stale: true) while ThaiWater fails, for up to this long. */
export const THAIWATER_STALE_MAX_MS = 6 * 60 * MINUTE_MS;
/** After a 429 the host is not asked again for this long (or its Retry-After, up to 15 minutes). */
export const THAIWATER_BACKOFF_MS = 2 * MINUTE_MS;
export const THAIWATER_BACKOFF_MAX_MS = 15 * MINUTE_MS;
/** After any other failure, upstream is not retried for this long. */
export const THAIWATER_RETRY_MS = MINUTE_MS;
/** Under the browser's 8 s per-feed limit (src/lib/warnings.ts), so the visitor gets the relay's answer. */
export const THAIWATER_UPSTREAM_TIMEOUT_MS = 7000;
export const THAIWATER_RATE_LIMIT_MAX = 30;
export const THAIWATER_RATE_LIMIT_WINDOW_MS = MINUTE_MS;
/** Browsers keep an answer this long at most. */
export const THAIWATER_BROWSER_MAX_AGE_S = 60;
const THAIWATER_HOST = 'api-v3.thaiwater.net';
/** The list is about 1.3 MB; Vercel answers at most 4.5 MB. */
const MAX_BYTES = 4 * 1024 * 1024;

export interface ThaiWaterContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Server log for upstream failure detail (default console.error). */
  log?: (line: string) => void;
}

const limiter = makeRateLimiter(THAIWATER_RATE_LIMIT_MAX, THAIWATER_RATE_LIMIT_WINDOW_MS);
let good: { at: number; text: string } | null = null;
let inflight: Promise<void> | null = null;
let retryAt: { until: number; reason: ThaiWaterUnavailableReason } | null = null;
let hostBackoffUntil = 0;

export function resetThaiWaterProxyState(): void {
  limiter.reset();
  good = null;
  inflight = null;
  retryAt = null;
  hostBackoffUntil = 0;
}

class UpstreamError extends Error {
  reason: ThaiWaterUnavailableReason;
  retryAfterMs: number | null;
  constructor(reason: ThaiWaterUnavailableReason, detail: string, retryAfterMs: number | null = null) {
    super(detail);
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

/** ThaiWater's answer as received, after checking it is a water-level list ({ waterlevel_data: { data: [] } }). */
async function fetchUpstream(fetchImpl: typeof fetch): Promise<string> {
  const url = new URL(THAIWATER_UPSTREAM_URL);
  if (url.protocol !== 'https:' || url.hostname !== THAIWATER_HOST) throw new UpstreamError('bad_answer', 'not a ThaiWater URL');
  let res: Response;
  let text: string;
  try {
    res = await fetchImpl(url.toString(), {
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(THAIWATER_UPSTREAM_TIMEOUT_MS),
    });
    if (res.status === 429) {
      const s = Number(res.headers.get('retry-after'));
      throw new UpstreamError(
        'rate_limited',
        'upstream HTTP 429',
        Number.isFinite(s) && s > 0 ? Math.min(s * 1000, THAIWATER_BACKOFF_MAX_MS) : THAIWATER_BACKOFF_MS,
      );
    }
    if (!res.ok) throw new UpstreamError('upstream_http', `upstream HTTP ${res.status}`);
    // The time limit covers the 1.3 MB body too.
    text = await res.text();
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    const name = err instanceof Error ? err.name : '';
    const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
    throw new UpstreamError(reason, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
  if (text.length > MAX_BYTES) throw new UpstreamError('bad_answer', 'upstream answer too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UpstreamError('bad_answer', 'upstream answer is not JSON');
  }
  const body = parsed as { waterlevel_data?: { data?: unknown } } | null;
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !Array.isArray(body.waterlevel_data?.data)) {
    throw new UpstreamError('bad_answer', 'upstream answer has no waterlevel_data.data list');
  }
  return text;
}

function relayBody(at: number, stale: boolean, text: string): string {
  // The upstream text is inserted as is (it parsed as JSON above), so it is never re-serialised.
  return `{"available":true,"retrievedAt":"${isoSeconds(at)}","stale":${stale},"raw":${text}}`;
}

function answer(body: string, cacheControl: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': cacheControl },
  });
}

export async function handleThaiWaterRequest(request: Request, ctx: ThaiWaterContext): Promise<Response> {
  const now = ctx.now ?? Date.now;
  const log = ctx.log ?? console.error;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
    if (new URL(request.url).search !== '') return json(400, { error: 'bad_request', message: 'This relay takes no parameters.' });
    if (!sameSite(request)) return json(403, { error: 'forbidden', message: 'Cross-site requests are not accepted.' });
    const retryAfter = limiter.check(ctx.clientIp || 'unknown', now());
    if (retryAfter > 0) return json(429, { error: 'rate_limited', retryAfterSeconds: retryAfter }, { 'retry-after': String(retryAfter) });

    const age = (e: { at: number } | null) => (e ? now() - e.at : Infinity);
    const fresh = (e: { at: number } | null) => age(e) >= 0 && age(e) < THAIWATER_TTL_MS;
    let failure: { reason: ThaiWaterUnavailableReason; detail: string } | null = null;

    if (!fresh(good)) {
      if (now() < hostBackoffUntil) {
        failure = { reason: 'rate_limited', detail: `host backoff until ${isoSeconds(hostBackoffUntil)}` };
      } else if (retryAt && now() < retryAt.until) {
        failure = { reason: retryAt.reason, detail: `retry after ${isoSeconds(retryAt.until)}` };
      } else {
        if (!inflight) {
          inflight = fetchUpstream(ctx.fetchImpl ?? fetch)
            .then((text) => {
              good = { at: now(), text };
              retryAt = null;
            })
            .finally(() => {
              inflight = null;
            });
        }
        try {
          await inflight;
        } catch (err) {
          const reason = err instanceof UpstreamError ? err.reason : 'network';
          if (err instanceof UpstreamError && err.retryAfterMs !== null) hostBackoffUntil = now() + err.retryAfterMs;
          else retryAt = { until: now() + THAIWATER_RETRY_MS, reason };
          failure = { reason, detail: err instanceof Error ? err.message : String(err) };
        }
      }
    }

    if (good && fresh(good)) {
      const left = Math.max(30, Math.ceil((THAIWATER_TTL_MS - age(good)) / 1000));
      return answer(relayBody(good.at, false, good.text), `public, max-age=${Math.min(THAIWATER_BROWSER_MAX_AGE_S, left)}, s-maxage=${left}`);
    }
    const why = failure ?? { reason: 'network' as const, detail: 'no answer' };
    log(`thaiwater: ${why.reason}: ${why.detail.replace(/\s+/g, ' ').slice(0, 300)}`);
    if (good && age(good) >= 0 && age(good) < THAIWATER_STALE_MAX_MS) {
      // ThaiWater is failing: the last good copy, for a minute at a time, so recovery shows quickly.
      return answer(relayBody(good.at, true, good.text), 'public, max-age=60, s-maxage=60');
    }
    return json(
      200,
      { available: false, checkedAt: isoSeconds(now()), reason: why.reason, message: THAIWATER_REASON_TEXT[why.reason] },
      { 'cache-control': 'public, max-age=30, s-maxage=30' },
    );
  } catch (err) {
    log(`thaiwater: internal error: ${err instanceof Error ? err.message : String(err)}`);
    return json(500, { error: 'internal_error' }, { 'cache-control': 'no-store' });
  }
}
