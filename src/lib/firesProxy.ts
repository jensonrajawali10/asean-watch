// Server side of GET /api/fires (bundled into api/_lib/fires-core.js by scripts/build-api.mjs). Why it
// exists: src/lib/firesRelay.ts.
//
// The relay takes no parameters. It runs the same builder as scripts/refresh-fires.mjs
// (scripts/lib/firesBuild.mjs) on the four fixed FIRMS South East Asia 7-day CSVs, carrying the
// complete-day history forward from the bundled data/fires-snapshot.json. Same-site requests only and a
// per-IP rate limit.
//
// Caching, so FIRMS sees a few downloads a day however many people visit:
// - A build is kept for FIRES_TTL_MS at this instance and at the CDN (s-maxage, plus a short
//   stale-while-revalidate so a visitor rarely waits for a rebuild). FIRMS files gain a pass every few
//   hours, so a fresher copy would add little.
// - On a failed build the last good one is served with stale: true (up to FIRES_STALE_MAX_MS); without
//   one the answer is a 200 { available: false, reason }, and the browser keeps its bundled HISTORICAL
//   snapshot. A failure is not retried upstream for FIRES_RETRY_MS.
import { buildFireSnapshot } from '../../scripts/lib/firesBuild.mjs';
import regionText from '../../data/region.geojson?raw';
import adminLookup from '../../data/fire-admin-lookup.json';
import bundledSnapshot from '../../data/fires-snapshot.json';
import { FIRES_REASON_TEXT, type FiresUnavailableReason } from './firesRelay';
import { clientIpFrom, isoSeconds, json, makeRateLimiter, sameSite } from './proxyCommon';

export { clientIpFrom };

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
export const FIRES_TTL_MS = 3 * HOUR_MS;
export const FIRES_STALE_MAX_MS = 24 * HOUR_MS;
export const FIRES_RETRY_MS = 10 * MINUTE_MS;
/** Whole budget for the four downloads; the Vercel function allows 60 s (vercel.json). */
export const FIRES_UPSTREAM_TIMEOUT_MS = 45 * 1000;
export const FIRES_RATE_LIMIT_MAX = 20;
export const FIRES_RATE_LIMIT_WINDOW_MS = MINUTE_MS;
/** Browsers keep an answer this long at most. */
export const FIRES_BROWSER_MAX_AGE_S = 600;
const USER_AGENT = 'asean-watch /api/fires relay (open-data fire map for a prototype)';

export interface FiresContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Server log for build failure detail (default console.error). */
  log?: (line: string) => void;
  /** The builder (tests pass a stub). */
  build?: typeof buildFireSnapshot;
}

const limiter = makeRateLimiter(FIRES_RATE_LIMIT_MAX, FIRES_RATE_LIMIT_WINDOW_MS);
let good: { at: number; text: string } | null = null;
let inflight: Promise<void> | null = null;
let retryAt: { until: number; reason: FiresUnavailableReason } | null = null;
let region: unknown = null;

/** Forget every cached build, backoff and rate-limit count (tests). */
export function resetFiresProxy(): void {
  good = null;
  inflight = null;
  retryAt = null;
  limiter.reset();
}

function classify(err: unknown): FiresUnavailableReason {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/timeout|timed out|aborted/i.test(text)) return 'timeout';
  if (/HTTP \d{3}/.test(text)) return 'upstream_http';
  if (/request failed/i.test(text)) return 'network';
  return 'bad_answer';
}

function answer(entry: { text: string }, stale: boolean, cacheControl: string): Response {
  return new Response(`{"available":true,"stale":${stale},"snapshot":${entry.text}}`, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': cacheControl },
  });
}

export async function handleFiresRequest(request: Request, ctx: FiresContext): Promise<Response> {
  const now = ctx.now ?? Date.now;
  const log = ctx.log ?? console.error;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
    if (new URL(request.url).search !== '') return json(400, { error: 'bad_request', message: 'This relay takes no parameters.' });
    if (!sameSite(request)) return json(403, { error: 'forbidden', message: 'Cross-site requests are not accepted.' });
    const retryAfter = limiter.check(ctx.clientIp || 'unknown', now());
    if (retryAfter > 0) return json(429, { error: 'rate_limited', retryAfterSeconds: retryAfter }, { 'retry-after': String(retryAfter) });

    const age = (e: { at: number } | null) => (e ? now() - e.at : Infinity);
    const fresh = (e: { at: number } | null) => age(e) >= 0 && age(e) < FIRES_TTL_MS;
    let failure: { reason: FiresUnavailableReason; detail: string } | null = null;

    if (!fresh(good)) {
      if (retryAt && now() < retryAt.until) {
        failure = { reason: retryAt.reason, detail: `retry after ${isoSeconds(retryAt.until)}` };
      } else {
        if (!inflight) {
          region ??= JSON.parse(regionText) as unknown;
          inflight = (ctx.build ?? buildFireSnapshot)({
            region,
            adminLookup,
            previous: good ? JSON.parse(good.text) : bundledSnapshot,
            fetchImpl: ctx.fetchImpl ?? fetch,
            now: now(),
            timeoutMs: FIRES_UPSTREAM_TIMEOUT_MS,
            userAgent: USER_AGENT,
          })
            .then((built) => {
              good = { at: now(), text: built.text };
              retryAt = null;
            })
            .finally(() => {
              inflight = null;
            });
        }
        try {
          await inflight;
        } catch (err) {
          const reason = classify(err);
          retryAt = { until: now() + FIRES_RETRY_MS, reason };
          failure = { reason, detail: err instanceof Error ? err.message : String(err) };
        }
      }
    }

    if (good && fresh(good)) {
      const left = Math.max(60, Math.ceil((FIRES_TTL_MS - age(good)) / 1000));
      return answer(good, false, `public, max-age=${Math.min(FIRES_BROWSER_MAX_AGE_S, left)}, s-maxage=${left}, stale-while-revalidate=3600`);
    }
    const why = failure ?? { reason: 'network' as const, detail: 'no answer' };
    log(`fires: ${why.reason}: ${why.detail.replace(/\s+/g, ' ').slice(0, 300)}`);
    if (good && age(good) >= 0 && age(good) < FIRES_STALE_MAX_MS) {
      // FIRMS is failing: the last good build, five minutes at a time, so recovery shows soon.
      return answer(good, true, 'public, max-age=300, s-maxage=300');
    }
    return json(
      200,
      { available: false, checkedAt: isoSeconds(now()), reason: why.reason, message: FIRES_REASON_TEXT[why.reason] },
      { 'cache-control': 'public, max-age=60, s-maxage=300' },
    );
  } catch (err) {
    log(`fires: internal error: ${err instanceof Error ? err.message : String(err)}`);
    return json(500, { error: 'internal_error' }, { 'cache-control': 'no-store' });
  }
}
