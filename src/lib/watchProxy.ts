// Server side of GET /api/watch (bundled into api/_lib/watch-core.js by scripts/build-api.mjs). Why it
// exists: src/lib/watchRelay.ts.
//
// The relay takes no parameters. It runs the same builder as scripts/refresh-data.mjs
// (scripts/lib/watchDataBuild.mjs) for the watch areas in the bundled data/watches.json. Caching,
// fallback and the request checks are the shared cached-build relay (src/lib/buildRelay.ts).
import { buildWatchData } from '../../scripts/lib/watchDataBuild.mjs';
import watches from '../../data/watches.json';
import { createBuildRelay } from './buildRelay';
import type { BuildRelayContext } from './buildRelay';
import { WATCH_REASON_TEXT } from './watchRelay';
import type { WatchData } from './watchRelay';
import { clientIpFrom } from './proxyCommon';

export { clientIpFrom };

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
export const WATCH_TTL_MS = 3 * HOUR_MS;
export const WATCH_STALE_MAX_MS = 24 * HOUR_MS;
export const WATCH_RETRY_MS = 10 * MINUTE_MS;
/** Whole budget for the downloads; the Vercel function allows 60 s (vercel.json). */
export const WATCH_UPSTREAM_TIMEOUT_MS = 45 * 1000;
export const WATCH_RATE_LIMIT_MAX = 20;
export const WATCH_RATE_LIMIT_WINDOW_MS = MINUTE_MS;
/** Browsers keep an answer this long at most. */
export const WATCH_BROWSER_MAX_AGE_S = 600;
const USER_AGENT = 'asean-watch /api/watch relay (open-data watch-area evidence for a prototype)';

export interface WatchContext extends BuildRelayContext {
  /** The builder (tests pass a stub). */
  build?: typeof buildWatchData;
}

const relay = createBuildRelay<WatchContext>({
  name: 'watch',
  key: 'data',
  ttlMs: WATCH_TTL_MS,
  staleMaxMs: WATCH_STALE_MAX_MS,
  retryMs: WATCH_RETRY_MS,
  browserMaxAgeS: WATCH_BROWSER_MAX_AGE_S,
  rateLimitMax: WATCH_RATE_LIMIT_MAX,
  rateLimitWindowMs: WATCH_RATE_LIMIT_WINDOW_MS,
  reasonText: WATCH_REASON_TEXT,
  async build({ now, fetchImpl }, ctx) {
    const built = await (ctx.build ?? buildWatchData)({
      watches,
      fetchImpl,
      now,
      timeoutMs: WATCH_UPSTREAM_TIMEOUT_MS,
      userAgent: USER_AGENT,
    });
    const data: WatchData = { firms: built.firms, quakes: built.quakes, meta: built.meta, scenarioWindow: built.scenarioWindow };
    return JSON.stringify(data);
  },
});

export const handleWatchRequest = relay.handle;
/** Forget every cached build, backoff and rate-limit count (tests). */
export const resetWatchProxy = relay.reset;
