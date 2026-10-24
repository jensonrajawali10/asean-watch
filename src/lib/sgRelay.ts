// Shared by the browser loaders (nea.ts for NEA wind and haze, warnings.ts for PUB flood alerts) and the
// server relay (src/lib/sgProxy.ts, api/sg.ts): the relay path, its feeds, its answer and the fixed
// visitor-facing reasons. No logic beyond parsing, so the browser bundle carries none of the server code.
//
// Why a relay: data.gov.sg answers about six keyless requests every few seconds per IP, then HTTP 429,
// and a 429 carries no CORS header, so the browser printed "blocked by CORS policy" errors and the
// app fell back to its snapshots. One page load makes five requests, so a second tab or a quick
// reload was enough. The relay keeps each feed at the Vercel CDN for a minute or two, so data.gov.sg
// sees a few requests a minute however many people visit, and a throttled upstream reaches the
// browser as a 200 { available: false } (never a console error) beside the bundled HISTORICAL
// snapshot.

export const SG_RELAY_PATH = '/api/sg';
export const SG_FEEDS = ['wind-direction', 'wind-speed', 'psi', 'pm25', 'flood-alerts'] as const;
export type SgFeed = (typeof SG_FEEDS)[number];

/** The one upstream URL per feed (data.gov.sg real-time API v2, no key). */
export const SG_UPSTREAM: Record<SgFeed, string> = {
  'wind-direction': 'https://api-open.data.gov.sg/v2/real-time/api/wind-direction',
  'wind-speed': 'https://api-open.data.gov.sg/v2/real-time/api/wind-speed',
  psi: 'https://api-open.data.gov.sg/v2/real-time/api/psi',
  pm25: 'https://api-open.data.gov.sg/v2/real-time/api/pm25',
  'flood-alerts': 'https://api-open.data.gov.sg/v2/real-time/api/weather/flood-alerts',
};

export function isSgFeed(x: unknown): x is SgFeed {
  return typeof x === 'string' && (SG_FEEDS as readonly string[]).includes(x);
}

export function sgRelayUrl(feed: SgFeed): string {
  return `${SG_RELAY_PATH}?feed=${feed}`;
}

export type SgUnavailableReason = 'rate_limited' | 'timeout' | 'upstream_http' | 'bad_answer' | 'network';

/** Fixed, visitor-facing reasons (never upstream detail). */
export const SG_REASON_TEXT: Record<SgUnavailableReason, string> = {
  rate_limited: 'data.gov.sg rate limited',
  timeout: 'data.gov.sg did not answer in time',
  upstream_http: 'data.gov.sg returned an error',
  bad_answer: 'data.gov.sg did not return the expected data',
  network: 'data.gov.sg could not be reached',
};

/** Reasons a browser should treat as passing: it backs off for a minute instead of asking again. */
export const SG_TRANSIENT_REASONS: readonly SgUnavailableReason[] = ['rate_limited', 'timeout', 'network'];

export type SgPayload =
  | {
      available: true;
      feed: SgFeed;
      /** ISO 8601 UTC time the relay fetched it from data.gov.sg. */
      retrievedAt: string;
      /** True while data.gov.sg is failing and the relay serves its last good copy. */
      stale: boolean;
      /** data.gov.sg's answer as received. */
      raw: unknown;
    }
  | { available: false; feed: SgFeed; checkedAt: string; reason: SgUnavailableReason; message: string };

/** A relay answer that says the feed is unavailable, with its fixed reason. */
export class SgUnavailable extends Error {
  reason: SgUnavailableReason;
  transient: boolean;
  constructor(reason: SgUnavailableReason) {
    super(SG_REASON_TEXT[reason]);
    this.reason = reason;
    this.transient = SG_TRANSIENT_REASONS.includes(reason);
  }
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * A relay answer for `feed` -> data.gov.sg's body and the time the relay fetched it. Throws SgUnavailable
 * when the relay says the feed is unavailable, and Error when the answer is not a relay answer.
 */
export function unwrapSgRelay(json: unknown, feed: SgFeed): { raw: unknown; retrievedAt: string } {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('the data.gov.sg relay answer was not in the expected shape');
  const r = json as Record<string, unknown>;
  if (r.feed !== feed) throw new Error('the data.gov.sg relay answered for another feed');
  if (r.available === true && typeof r.retrievedAt === 'string' && ISO_Z.test(r.retrievedAt) && 'raw' in r) {
    return { raw: r.raw, retrievedAt: r.retrievedAt };
  }
  if (r.available === false) {
    const reason = typeof r.reason === 'string' && r.reason in SG_REASON_TEXT ? (r.reason as SgUnavailableReason) : 'bad_answer';
    throw new SgUnavailable(reason);
  }
  throw new Error('the data.gov.sg relay answer was not in the expected shape');
}
