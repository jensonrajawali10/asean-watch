// Server side of GET /api/sg?feed=wind-direction|wind-speed|psi|pm25|flood-alerts (bundled into
// api/_lib/sg-core.js by scripts/build-api.mjs). Why it exists: src/lib/sgRelay.ts.
//
// Strict relay: the client names a feed and nothing else; the upstream URL is one of the five fixed
// data.gov.sg URLs in SG_UPSTREAM. Same-site requests only and a per-IP rate limit.
//
// Caching, so data.gov.sg sees a few requests a minute however many people visit:
// - Each feed is kept for its TTL (NEA updates wind every minute or so and PSI and PM2.5 hourly; PUB
//   flood alerts are kept only a minute) at this instance and at the CDN (s-maxage).
// - After a 429 from data.gov.sg the host is left alone for 30 seconds (its window is a few seconds).
// - Meanwhile, and on any upstream failure, the last good copy is served with stale: true (up to 30
//   minutes, 10 for flood alerts); without one the answer is a 200 { available: false, reason } that
//   the browser shows as "Live feed unavailable (…)" beside its bundled HISTORICAL snapshot. Never a
//   non-2xx for an upstream problem, so a throttled data.gov.sg never prints a console error.
import { isSgFeed, SG_REASON_TEXT, SG_UPSTREAM, type SgFeed, type SgUnavailableReason } from './sgRelay';
import { clientIpFrom, isoSeconds, json, makeRateLimiter, sameSite } from './proxyCommon';

export { clientIpFrom };

const MINUTE_MS = 60 * 1000;
export const SG_TTL_MS: Record<SgFeed, number> = {
  'wind-direction': 2 * MINUTE_MS,
  'wind-speed': 2 * MINUTE_MS,
  psi: 5 * MINUTE_MS,
  pm25: 5 * MINUTE_MS,
  'flood-alerts': MINUTE_MS,
};
/** The last good copy is served (stale: true) while data.gov.sg fails, for up to this long. */
export const SG_STALE_MAX_MS: Record<SgFeed, number> = {
  'wind-direction': 30 * MINUTE_MS,
  'wind-speed': 30 * MINUTE_MS,
  psi: 30 * MINUTE_MS,
  pm25: 30 * MINUTE_MS,
  'flood-alerts': 10 * MINUTE_MS,
};
/** After a 429 the host is not asked again for this long (or its Retry-After, up to 5 minutes). */
export const SG_BACKOFF_MS = 30 * 1000;
export const SG_BACKOFF_MAX_MS = 5 * MINUTE_MS;
/** After any other failure, that feed is not retried upstream for this long. */
export const SG_RETRY_MS = 30 * 1000;
export const SG_UPSTREAM_TIMEOUT_MS = 6000;
export const SG_RATE_LIMIT_MAX = 60;
export const SG_RATE_LIMIT_WINDOW_MS = MINUTE_MS;
/** Browsers keep an answer this long at most. */
export const SG_BROWSER_MAX_AGE_S = 60;
const SG_HOST = 'api-open.data.gov.sg';
const MAX_BYTES = 2 * 1024 * 1024;

export interface SgContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Server log for upstream failure detail (default console.error). */
  log?: (line: string) => void;
}

const limiter = makeRateLimiter(SG_RATE_LIMIT_MAX, SG_RATE_LIMIT_WINDOW_MS);
const good = new Map<SgFeed, { at: number; text: string }>();
const inflight = new Map<SgFeed, Promise<void>>();
const feedRetryAt = new Map<SgFeed, { until: number; reason: SgUnavailableReason }>();
let hostBackoffUntil = 0;

export function resetSgProxyState(): void {
  limiter.reset();
  good.clear();
  inflight.clear();
  feedRetryAt.clear();
  hostBackoffUntil = 0;
}

class UpstreamError extends Error {
  reason: SgUnavailableReason;
  retryAfterMs: number | null;
  constructor(reason: SgUnavailableReason, detail: string, retryAfterMs: number | null = null) {
    super(detail);
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

/** data.gov.sg's answer as received, after checking it is a successful v2 answer ({ code: 0, data }). */
async function fetchUpstream(feed: SgFeed, fetchImpl: typeof fetch): Promise<string> {
  const url = new URL(SG_UPSTREAM[feed]);
  if (url.protocol !== 'https:' || url.hostname !== SG_HOST) throw new UpstreamError('bad_answer', 'not a data.gov.sg URL');
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(SG_UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
    throw new UpstreamError(reason, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
  if (res.status === 429) {
    const s = Number(res.headers.get('retry-after'));
    throw new UpstreamError('rate_limited', 'upstream HTTP 429', Number.isFinite(s) && s > 0 ? Math.min(s * 1000, SG_BACKOFF_MAX_MS) : SG_BACKOFF_MS);
  }
  if (!res.ok) throw new UpstreamError('upstream_http', `upstream HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new UpstreamError('bad_answer', 'upstream answer too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UpstreamError('bad_answer', 'upstream answer is not JSON');
  }
  const body = parsed as Record<string, unknown> | null;
  if (typeof body !== 'object' || body === null || Array.isArray(body) || body.code !== 0 || typeof body.data !== 'object' || body.data === null) {
    throw new UpstreamError('bad_answer', `upstream answer is not a data.gov.sg success (code ${String(body?.code)})`);
  }
  return text;
}

function relayBody(feed: SgFeed, at: number, stale: boolean, text: string): string {
  // The upstream text is inserted as is (it parsed as JSON above), so it is never re-serialised.
  return `{"available":true,"feed":"${feed}","retrievedAt":"${isoSeconds(at)}","stale":${stale},"raw":${text}}`;
}

function answer(body: string, cacheControl: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': cacheControl },
  });
}

export async function handleSgRequest(request: Request, ctx: SgContext): Promise<Response> {
  const now = ctx.now ?? Date.now;
  const log = ctx.log ?? console.error;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
    const url = new URL(request.url);
    const feed = url.searchParams.get('feed');
    if (!isSgFeed(feed) || url.search !== `?feed=${feed}`) {
      return json(400, { error: 'bad_request', message: 'Use ?feed=wind-direction, wind-speed, psi, pm25 or flood-alerts, and nothing else.' });
    }
    if (!sameSite(request)) return json(403, { error: 'forbidden', message: 'Cross-site requests are not accepted.' });
    const retryAfter = limiter.check(ctx.clientIp || 'unknown', now());
    if (retryAfter > 0) return json(429, { error: 'rate_limited', retryAfterSeconds: retryAfter }, { 'retry-after': String(retryAfter) });

    const ttl = SG_TTL_MS[feed];
    const fresh = (e: { at: number } | undefined) => e !== undefined && now() - e.at >= 0 && now() - e.at < ttl;
    let failure: { reason: SgUnavailableReason; detail: string } | null = null;

    if (!fresh(good.get(feed))) {
      const retry = feedRetryAt.get(feed);
      if (now() < hostBackoffUntil) {
        failure = { reason: 'rate_limited', detail: `host backoff until ${isoSeconds(hostBackoffUntil)}` };
      } else if (retry && now() < retry.until) {
        failure = { reason: retry.reason, detail: `feed retry after ${isoSeconds(retry.until)}` };
      } else {
        let p = inflight.get(feed);
        if (!p) {
          p = fetchUpstream(feed, ctx.fetchImpl ?? fetch)
            .then((text) => {
              good.set(feed, { at: now(), text });
              feedRetryAt.delete(feed);
            })
            .finally(() => inflight.delete(feed));
          inflight.set(feed, p);
        }
        try {
          await p;
        } catch (err) {
          const reason = err instanceof UpstreamError ? err.reason : 'network';
          if (err instanceof UpstreamError && err.retryAfterMs !== null) hostBackoffUntil = now() + err.retryAfterMs;
          else feedRetryAt.set(feed, { until: now() + SG_RETRY_MS, reason });
          failure = { reason, detail: err instanceof Error ? err.message : String(err) };
        }
      }
    }

    const entry = good.get(feed);
    if (entry && fresh(entry)) {
      const left = Math.max(30, Math.ceil((ttl - (now() - entry.at)) / 1000));
      return answer(relayBody(feed, entry.at, false, entry.text), `public, max-age=${Math.min(SG_BROWSER_MAX_AGE_S, left)}, s-maxage=${left}`);
    }
    const why = failure ?? { reason: 'network' as const, detail: 'no answer' };
    log(`sg ${feed}: ${why.reason}: ${why.detail.replace(/\s+/g, ' ').slice(0, 300)}`);
    if (entry && now() - entry.at >= 0 && now() - entry.at < SG_STALE_MAX_MS[feed]) {
      // data.gov.sg is failing: the last good copy, for 30 seconds at a time, so recovery shows quickly.
      return answer(relayBody(feed, entry.at, true, entry.text), 'public, max-age=30, s-maxage=30');
    }
    return json(
      200,
      { available: false, feed, checkedAt: isoSeconds(now()), reason: why.reason, message: SG_REASON_TEXT[why.reason] },
      { 'cache-control': 'public, max-age=30, s-maxage=30' },
    );
  } catch (err) {
    log(`sg: internal error: ${err instanceof Error ? err.message : String(err)}`);
    return json(500, { error: 'internal_error' }, { 'cache-control': 'no-store' });
  }
}
