// Server side of GET /api/vaac (bundled into api/_lib/vaac-core.js by scripts/build-api.mjs). Why it
// exists: src/lib/vaacRelay.ts.
//
// The relay takes no parameters. It runs the same builder as scripts/capture-vaac-snapshot.mjs
// (scripts/lib/vaacBuild.mjs), which fetches ONLY the fixed Tokyo VAAC list page and the advisory text
// pages it links on www.data.jma.go.jp. Caching, fallback and the request checks are the shared
// cached-build relay (src/lib/buildRelay.ts).
import { buildVaacData } from '../../scripts/lib/vaacBuild.mjs';
import { createBuildRelay } from './buildRelay';
import type { BuildRelayContext } from './buildRelay';
import { VAAC_REASON_TEXT } from './vaacRelay';
import { clientIpFrom } from './proxyCommon';

export { clientIpFrom };

const MINUTE_MS = 60 * 1000;
/** JMA caches its own VAAC pages for ten minutes (max-age=600). */
export const VAAC_TTL_MS = 10 * MINUTE_MS;
export const VAAC_STALE_MAX_MS = 6 * 60 * MINUTE_MS;
export const VAAC_RETRY_MS = 2 * MINUTE_MS;
/** Whole budget for the list and the text pages; the Vercel function allows 30 s (vercel.json). */
export const VAAC_UPSTREAM_TIMEOUT_MS = 20 * 1000;
export const VAAC_RATE_LIMIT_MAX = 30;
export const VAAC_RATE_LIMIT_WINDOW_MS = MINUTE_MS;
/** Browsers keep an answer this long at most. */
export const VAAC_BROWSER_MAX_AGE_S = 300;
const USER_AGENT = 'asean-watch /api/vaac relay (Tokyo VAAC advisories, relayed verbatim with source citation)';

export interface VaacContext extends BuildRelayContext {
  /** The builder (tests pass a stub). */
  build?: typeof buildVaacData;
}

const relay = createBuildRelay<VaacContext>({
  name: 'vaac',
  key: 'data',
  ttlMs: VAAC_TTL_MS,
  staleMaxMs: VAAC_STALE_MAX_MS,
  retryMs: VAAC_RETRY_MS,
  browserMaxAgeS: VAAC_BROWSER_MAX_AGE_S,
  rateLimitMax: VAAC_RATE_LIMIT_MAX,
  rateLimitWindowMs: VAAC_RATE_LIMIT_WINDOW_MS,
  reasonText: VAAC_REASON_TEXT,
  async build({ now, fetchImpl }, ctx) {
    const data = await (ctx.build ?? buildVaacData)({ fetchImpl, now, timeoutMs: VAAC_UPSTREAM_TIMEOUT_MS, userAgent: USER_AGENT });
    return JSON.stringify(data);
  },
});

export const handleVaacRequest = relay.handle;
/** Forget every cached build, backoff and rate-limit count (tests). */
export const resetVaacProxy = relay.reset;
