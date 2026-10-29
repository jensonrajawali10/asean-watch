// A cached relay around a slow build (several downloads turned into one JSON answer), shared by
// GET /api/fires (src/lib/firesProxy.ts) and GET /api/watch (src/lib/watchProxy.ts). Server side only.
//
// - The relay takes no parameters; same-site requests only and a per-IP rate limit.
// - A build is kept for ttlMs at this instance and at the CDN (s-maxage, plus a short
//   stale-while-revalidate so a visitor rarely waits for a rebuild). Concurrent requests share one build.
// - On a failed build the last good one is served with stale: true (up to staleMaxMs); without one the
//   answer is a 200 { available: false, reason, message } with a fixed message, and the browser keeps its
//   bundled HISTORICAL snapshot. A failure is not retried upstream for retryMs.
import { isoSeconds, json, makeRateLimiter, sameSite } from './proxyCommon';

export type BuildFailureReason = 'timeout' | 'upstream_http' | 'bad_answer' | 'network';

export interface BuildRelayOptions<C extends BuildRelayContext = BuildRelayContext> {
  /** Short name for the server log, e.g. "fires". */
  name: string;
  ttlMs: number;
  staleMaxMs: number;
  retryMs: number;
  /** Browsers keep an answer this long at most. */
  browserMaxAgeS: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  /** Fixed, visitor-facing reasons (never upstream detail). */
  reasonText: Record<BuildFailureReason, string>;
  /** Runs the build; resolves to the JSON text placed under `key` in the answer. */
  build(input: { now: number; fetchImpl: typeof fetch; previousText: string | null }, ctx: C): Promise<string>;
  /** The answer's field for the build, e.g. "snapshot". */
  key: string;
}

export interface BuildRelayContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Server log for build failure detail (default console.error). */
  log?: (line: string) => void;
}

/** Sorts a build error into a fixed reason by its message. */
export function classifyBuildError(err: unknown): BuildFailureReason {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/timeout|timed out|aborted/i.test(text)) return 'timeout';
  if (/HTTP \d{3}/.test(text)) return 'upstream_http';
  if (/request failed/i.test(text)) return 'network';
  return 'bad_answer';
}

export function createBuildRelay<C extends BuildRelayContext>(opts: BuildRelayOptions<C>) {
  const limiter = makeRateLimiter(opts.rateLimitMax, opts.rateLimitWindowMs);
  let good: { at: number; text: string } | null = null;
  let inflight: Promise<void> | null = null;
  let retryAt: { until: number; reason: BuildFailureReason } | null = null;

  function answer(entry: { text: string }, stale: boolean, cacheControl: string): Response {
    return new Response(`{"available":true,"stale":${stale},${JSON.stringify(opts.key)}:${entry.text}}`, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': cacheControl },
    });
  }

  async function handle(request: Request, ctx: C): Promise<Response> {
    const now = ctx.now ?? Date.now;
    const log = ctx.log ?? console.error;
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
      if (new URL(request.url).search !== '') return json(400, { error: 'bad_request', message: 'This relay takes no parameters.' });
      if (!sameSite(request)) return json(403, { error: 'forbidden', message: 'Cross-site requests are not accepted.' });
      const retryAfter = limiter.check(ctx.clientIp || 'unknown', now());
      if (retryAfter > 0) return json(429, { error: 'rate_limited', retryAfterSeconds: retryAfter }, { 'retry-after': String(retryAfter) });

      const age = (e: { at: number } | null) => (e ? now() - e.at : Infinity);
      const fresh = (e: { at: number } | null) => age(e) >= 0 && age(e) < opts.ttlMs;
      let failure: { reason: BuildFailureReason; detail: string } | null = null;

      if (!fresh(good)) {
        if (retryAt && now() < retryAt.until) {
          failure = { reason: retryAt.reason, detail: `retry after ${isoSeconds(retryAt.until)}` };
        } else {
          if (!inflight) {
            inflight = opts
              .build({ now: now(), fetchImpl: ctx.fetchImpl ?? fetch, previousText: good?.text ?? null }, ctx)
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
            const reason = classifyBuildError(err);
            retryAt = { until: now() + opts.retryMs, reason };
            failure = { reason, detail: err instanceof Error ? err.message : String(err) };
          }
        }
      }

      if (good && fresh(good)) {
        const left = Math.max(60, Math.ceil((opts.ttlMs - age(good)) / 1000));
        return answer(good, false, `public, max-age=${Math.min(opts.browserMaxAgeS, left)}, s-maxage=${left}, stale-while-revalidate=3600`);
      }
      const why = failure ?? { reason: 'network' as const, detail: 'no answer' };
      log(`${opts.name}: ${why.reason}: ${why.detail.replace(/\s+/g, ' ').slice(0, 300)}`);
      if (good && age(good) >= 0 && age(good) < opts.staleMaxMs) {
        // The sources are failing: the last good build, five minutes at a time, so recovery shows soon.
        return answer(good, true, 'public, max-age=300, s-maxage=300');
      }
      return json(
        200,
        { available: false, checkedAt: isoSeconds(now()), reason: why.reason, message: opts.reasonText[why.reason] },
        { 'cache-control': 'public, max-age=60, s-maxage=300' },
      );
    } catch (err) {
      log(`${opts.name}: internal error: ${err instanceof Error ? err.message : String(err)}`);
      return json(500, { error: 'internal_error' }, { 'cache-control': 'no-store' });
    }
  }

  /** Forget every cached build, backoff and rate-limit count (tests). */
  function reset(): void {
    good = null;
    inflight = null;
    retryAt = null;
    limiter.reset();
  }

  return { handle, reset };
}
