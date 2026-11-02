// Shared by the browser loader (src/lib/warnings.ts) and the server relay (src/lib/thaiwaterProxy.ts,
// api/thaiwater.ts): the relay path, its one upstream URL, its answer and the fixed visitor-facing reasons.
// No logic, so the browser bundle carries none of the server code.
//
// Why a relay: ThaiWater sometimes answers a visitor's browser with HTTP 429, which printed a console error
// and dropped the app to its snapshot (seen on the production checks of 29 Oct 2026). Every open tab asked
// for the whole 1.3 MB gauge list every 5 minutes. The relay keeps one copy at the Vercel CDN for ten
// minutes, so ThaiWater sees a few requests an hour however many people visit, and a throttled upstream
// reaches the browser as a 200 { available: false } (never a console error) beside the bundled HISTORICAL
// snapshot.

export const THAIWATER_RELAY_PATH = '/api/thaiwater';
/** The one upstream document the relay fetches (HII's public water-level list, no key). */
export const THAIWATER_UPSTREAM_URL = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load';

export type ThaiWaterUnavailableReason = 'rate_limited' | 'timeout' | 'upstream_http' | 'bad_answer' | 'network';

/** Fixed, visitor-facing reasons (never upstream detail). */
export const THAIWATER_REASON_TEXT: Record<ThaiWaterUnavailableReason, string> = {
  rate_limited: 'ThaiWater rate limited',
  timeout: 'ThaiWater did not answer in time',
  upstream_http: 'ThaiWater returned an error',
  bad_answer: 'ThaiWater did not return its water-level list',
  network: 'ThaiWater could not be reached',
};

export type ThaiWaterPayload =
  | {
      available: true;
      /** ISO 8601 UTC time the relay fetched it from ThaiWater. */
      retrievedAt: string;
      /** True while ThaiWater is failing and the relay serves its last good copy. */
      stale: boolean;
      /** ThaiWater's answer as received. */
      raw: unknown;
    }
  | { available: false; checkedAt: string; reason: ThaiWaterUnavailableReason; message: string };
