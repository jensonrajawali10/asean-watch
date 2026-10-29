// Server side of GET /api/fires (bundled into api/_lib/fires-core.js by scripts/build-api.mjs). Why it
// exists: src/lib/firesRelay.ts.
//
// The relay takes no parameters. It runs the same builder as scripts/refresh-fires.mjs
// (scripts/lib/firesBuild.mjs) on the four fixed FIRMS South East Asia 7-day CSVs, carrying the
// complete-day history forward from the bundled data/fires-snapshot.json. Caching, fallback and the
// request checks are the shared cached-build relay (src/lib/buildRelay.ts): FIRMS files gain a pass every
// few hours, so a build is kept for FIRES_TTL_MS.
import { buildFireSnapshot } from '../../scripts/lib/firesBuild.mjs';
import regionText from '../../data/region.geojson?raw';
import adminLookup from '../../data/fire-admin-lookup.json';
import bundledSnapshot from '../../data/fires-snapshot.json';
import { createBuildRelay } from './buildRelay';
import type { BuildRelayContext } from './buildRelay';
import { FIRES_REASON_TEXT } from './firesRelay';
import { clientIpFrom } from './proxyCommon';

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

export interface FiresContext extends BuildRelayContext {
  /** The builder (tests pass a stub). */
  build?: typeof buildFireSnapshot;
}

let region: unknown = null;

const relay = createBuildRelay<FiresContext>({
  name: 'fires',
  key: 'snapshot',
  ttlMs: FIRES_TTL_MS,
  staleMaxMs: FIRES_STALE_MAX_MS,
  retryMs: FIRES_RETRY_MS,
  browserMaxAgeS: FIRES_BROWSER_MAX_AGE_S,
  rateLimitMax: FIRES_RATE_LIMIT_MAX,
  rateLimitWindowMs: FIRES_RATE_LIMIT_WINDOW_MS,
  reasonText: FIRES_REASON_TEXT,
  async build({ now, fetchImpl, previousText }, ctx) {
    region ??= JSON.parse(regionText) as unknown;
    const built = await (ctx.build ?? buildFireSnapshot)({
      region,
      adminLookup,
      previous: previousText ? JSON.parse(previousText) : bundledSnapshot,
      fetchImpl,
      now,
      timeoutMs: FIRES_UPSTREAM_TIMEOUT_MS,
      userAgent: USER_AGENT,
    });
    return built.text;
  },
});

export const handleFiresRequest = relay.handle;
/** Forget every cached build, backoff and rate-limit count (tests). */
export const resetFiresProxy = relay.reset;
