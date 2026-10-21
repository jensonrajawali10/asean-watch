// Server side of GET /api/open-meteo?feed=wind|aq|ash|flood (bundled into api/_lib/open-meteo-core.js by
// scripts/build-api.mjs). Why it exists: src/lib/openMeteoRelay.ts.
//
// Strict relay: the client names a feed and nothing else; the upstream URL is built here from the same
// code the snapshots and the browser use (windField, airQuality, ashDrift, floodModel), on the three
// Open-Meteo hosts only. Same-site requests only and a per-IP rate limit.
//
// Caching, so Open-Meteo sees a few requests an hour however many people visit:
// - The Vercel CDN keeps each answer for the rest of its TTL (s-maxage), then serves it stale while it
//   revalidates in the background (stale-while-revalidate), and on an error (stale-if-error).
// - This instance keeps the last good answer per feed. Model runs change every few hours (GloFAS daily),
//   so TTLs are 2 h (6 h for river flow).
// - After a 429 from an Open-Meteo host, that host is not asked again for 5 minutes (or its Retry-After,
//   up to an hour). Meanwhile, and on any upstream failure, the last good answer up to 24 h old is
//   served with stale: true; without one the answer is 503 and the browser shows its bundled snapshot,
//   labelled HISTORICAL.
import { AQ_PLACES, buildAqUrl } from './airQuality';
import { ashWindPoints, buildAshWindUrl } from './ashDrift';
import { floodApiUrl, NEIGHBOURHOOD, RIVER_POINTS } from './floodModel';
import { isOpenMeteoFeed, type OpenMeteoFeed } from './openMeteoRelay';
import { clientIpFrom, isoSeconds, json, makeRateLimiter, sameSite } from './proxyCommon';
import { buildWindUrl, gridAxes, WIND_RELAY_LEVELS } from './windField';

export { clientIpFrom };

export const OPEN_METEO_HOSTS = ['api.open-meteo.com', 'air-quality-api.open-meteo.com', 'flood-api.open-meteo.com'] as const;
const HOUR_MS = 60 * 60 * 1000;
export const OPEN_METEO_TTL_MS: Record<OpenMeteoFeed, number> = { wind: 2 * HOUR_MS, aq: 2 * HOUR_MS, ash: 2 * HOUR_MS, flood: 6 * HOUR_MS };
/** CDN: serve a stale answer while revalidating (2 h) and while the relay errors (24 h). */
export const OPEN_METEO_SWR_S = 2 * 60 * 60;
export const OPEN_METEO_SIE_S = 24 * 60 * 60;
/** Browsers keep an answer 10 minutes (reloads cost nothing). */
export const OPEN_METEO_BROWSER_MAX_AGE_S = 600;
/** The last good answer is served (stale: true) while Open-Meteo fails, for up to this long. */
export const OPEN_METEO_STALE_MAX_MS = 24 * HOUR_MS;
export const OPEN_METEO_BACKOFF_MS = 5 * 60 * 1000;
export const OPEN_METEO_BACKOFF_MAX_MS = HOUR_MS;
/** After any other failure, that feed is not retried upstream for a minute. */
export const OPEN_METEO_RETRY_MS = 60 * 1000;
export const OPEN_METEO_UPSTREAM_TIMEOUT_MS = 20_000;
export const OPEN_METEO_RATE_LIMIT_MAX = 60;
export const OPEN_METEO_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;

export const OPEN_METEO_UNAVAILABLE_MESSAGE = 'Open-Meteo is not answering; the app shows its bundled snapshot.';

interface FeedSpec {
  url: () => string;
  /** Number of locations Open-Meteo must answer with (one array entry each, in request order). */
  locations: () => number;
}

const gridPoints = () => gridAxes().lats.length * gridAxes().lons.length;

export const OPEN_METEO_FEED_SPECS: Record<OpenMeteoFeed, FeedSpec> = {
  // Both wind levels in one request: Open-Meteo counts locations, not variables (up to 10).
  wind: { url: () => buildWindUrl(gridAxes().lats, gridAxes().lons, 3, WIND_RELAY_LEVELS), locations: gridPoints },
  aq: { url: () => buildAqUrl(gridAxes(), AQ_PLACES), locations: () => gridPoints() + AQ_PLACES.length },
  ash: { url: () => buildAshWindUrl(ashWindPoints()), locations: () => ashWindPoints().length },
  flood: { url: () => floodApiUrl(RIVER_POINTS), locations: () => RIVER_POINTS.length * (2 * NEIGHBOURHOOD + 1) ** 2 },
};

export interface OpenMeteoContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Server log for upstream failure detail (default console.error). */
  log?: (line: string) => void;
}

const limiter = makeRateLimiter(OPEN_METEO_RATE_LIMIT_MAX, OPEN_METEO_RATE_LIMIT_WINDOW_MS);
const good = new Map<OpenMeteoFeed, { at: number; text: string }>();
const inflight = new Map<OpenMeteoFeed, Promise<void>>();
const hostBackoff = new Map<string, number>();
const feedRetryAt = new Map<OpenMeteoFeed, number>();

export function resetOpenMeteoProxyState(): void {
  limiter.reset();
  good.clear();
  inflight.clear();
  hostBackoff.clear();
  feedRetryAt.clear();
}

class UpstreamError extends Error {
  retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null = null) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** The answer as Open-Meteo sent it, after checking it is JSON with one entry per location. */
async function fetchUpstream(feed: OpenMeteoFeed, fetchImpl: typeof fetch): Promise<string> {
  const spec = OPEN_METEO_FEED_SPECS[feed];
  const url = new URL(spec.url());
  if (url.protocol !== 'https:' || !(OPEN_METEO_HOSTS as readonly string[]).includes(url.hostname)) throw new UpstreamError('not an Open-Meteo URL');
  const res = await fetchImpl(url.toString(), {
    redirect: 'error',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(OPEN_METEO_UPSTREAM_TIMEOUT_MS),
  });
  if (res.status === 429) {
    const s = Number(res.headers.get('retry-after'));
    throw new UpstreamError('upstream HTTP 429', Number.isFinite(s) && s > 0 ? Math.min(s * 1000, OPEN_METEO_BACKOFF_MAX_MS) : OPEN_METEO_BACKOFF_MS);
  }
  if (!res.ok) throw new UpstreamError(`upstream HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new UpstreamError('upstream answer too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UpstreamError('upstream answer is not JSON');
  }
  const n = spec.locations();
  if (!Array.isArray(parsed) || parsed.length !== n) throw new UpstreamError(`upstream answer has ${Array.isArray(parsed) ? parsed.length : 'no'} locations, expected ${n}`);
  return text;
}

function relayBody(feed: OpenMeteoFeed, at: number, stale: boolean, text: string): string {
  // The upstream text is inserted as is (it parsed as JSON above), so it is never re-serialised.
  return `{"feed":"${feed}","retrievedAt":"${isoSeconds(at)}","stale":${stale},"raw":${text}}`;
}

function answer(body: string, cacheControl: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': cacheControl },
  });
}

export async function handleOpenMeteoRequest(request: Request, ctx: OpenMeteoContext): Promise<Response> {
  const now = ctx.now ?? Date.now;
  const log = ctx.log ?? console.error;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
    const url = new URL(request.url);
    const feed = url.searchParams.get('feed');
    if (!isOpenMeteoFeed(feed) || url.search !== `?feed=${feed}`) {
      return json(400, { error: 'bad_request', message: 'Use ?feed=wind, aq, ash or flood, and nothing else.' });
    }
    if (!sameSite(request)) return json(403, { error: 'forbidden', message: 'Cross-site requests are not accepted.' });
    const retryAfter = limiter.check(ctx.clientIp || 'unknown', now());
    if (retryAfter > 0) return json(429, { error: 'rate_limited', retryAfterSeconds: retryAfter }, { 'retry-after': String(retryAfter) });

    const ttl = OPEN_METEO_TTL_MS[feed];
    const fresh = (e: { at: number } | undefined) => e && now() - e.at >= 0 && now() - e.at < ttl;
    const host = new URL(OPEN_METEO_FEED_SPECS[feed].url()).hostname;
    let failure: string | null = null;

    if (!fresh(good.get(feed))) {
      const until = Math.max(hostBackoff.get(host) ?? 0, feedRetryAt.get(feed) ?? 0);
      if (now() < until) {
        failure = `backoff until ${isoSeconds(until)}`;
      } else {
        let p = inflight.get(feed);
        if (!p) {
          p = fetchUpstream(feed, ctx.fetchImpl ?? fetch)
            .then((text) => {
              good.set(feed, { at: now(), text });
              hostBackoff.delete(host);
            })
            .finally(() => inflight.delete(feed));
          inflight.set(feed, p);
        }
        try {
          await p;
        } catch (err) {
          if (err instanceof UpstreamError && err.retryAfterMs !== null) hostBackoff.set(host, now() + err.retryAfterMs);
          else feedRetryAt.set(feed, now() + OPEN_METEO_RETRY_MS);
          failure = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        }
      }
    }

    const entry = good.get(feed);
    if (entry && fresh(entry)) {
      const left = Math.max(60, Math.ceil((ttl - (now() - entry.at)) / 1000));
      return answer(
        relayBody(feed, entry.at, false, entry.text),
        `public, max-age=${Math.min(OPEN_METEO_BROWSER_MAX_AGE_S, left)}, s-maxage=${left}, stale-while-revalidate=${OPEN_METEO_SWR_S}, stale-if-error=${OPEN_METEO_SIE_S}`,
      );
    }
    log(`open-meteo ${feed}: ${(failure ?? 'no answer').replace(/\s+/g, ' ').slice(0, 300)}`);
    if (entry && now() - entry.at < OPEN_METEO_STALE_MAX_MS) {
      // Open-Meteo is failing: the last good answer, for a minute at a time, so recovery shows quickly.
      return answer(relayBody(feed, entry.at, true, entry.text), 'public, max-age=60, s-maxage=60');
    }
    const wait = Math.max(60, Math.ceil((Math.max(hostBackoff.get(host) ?? 0, feedRetryAt.get(feed) ?? 0) - now()) / 1000));
    return json(503, { error: 'upstream_unavailable', message: OPEN_METEO_UNAVAILABLE_MESSAGE }, { 'cache-control': 'no-store', 'retry-after': String(wait) });
  } catch (err) {
    log(`open-meteo: internal error: ${err instanceof Error ? err.message : String(err)}`);
    return json(500, { error: 'internal_error' }, { 'cache-control': 'no-store' });
  }
}
