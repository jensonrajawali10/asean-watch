// Shared by the browser loaders (windField, airQuality, ashDrift, floodModel) and the server relay
// (src/lib/openMeteoProxy.ts, api/open-meteo.ts): the relay path, its feeds and its answer.
//
// Why a relay: Open-Meteo's free API allows 600 calls a minute per IP, and a multi-location request
// counts once per location. A first page load asked for about 1,300 (two 390-point wind grids, the
// air-quality grid, the volcano summits, the river cells) within a second, so the later requests got
// HTTP 429. The relay batches the two wind levels into one request and caches every feed at the
// Vercel CDN, so a visitor's browser never calls Open-Meteo directly and Open-Meteo sees a few
// requests an hour in all. When the relay cannot answer, each loader falls back to its bundled
// snapshot, labelled HISTORICAL.

export const OPEN_METEO_RELAY_PATH = '/api/open-meteo';
export const OPEN_METEO_FEEDS = ['wind', 'aq', 'ash', 'flood'] as const;
export type OpenMeteoFeed = (typeof OPEN_METEO_FEEDS)[number];

export function isOpenMeteoFeed(x: unknown): x is OpenMeteoFeed {
  return typeof x === 'string' && (OPEN_METEO_FEEDS as readonly string[]).includes(x);
}

export function openMeteoRelayUrl(feed: OpenMeteoFeed): string {
  return `${OPEN_METEO_RELAY_PATH}?feed=${feed}`;
}

/** The relay's 200 answer: Open-Meteo's response as received, and when the relay fetched it. */
export interface OpenMeteoRelayPayload {
  feed: OpenMeteoFeed;
  /** ISO 8601 UTC time the relay fetched it from Open-Meteo. */
  retrievedAt: string;
  /** True when Open-Meteo is failing and the relay is serving its last good copy. */
  stale: boolean;
  raw: unknown;
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Validate a relay answer for `feed`; null when it is not one. */
export function parseOpenMeteoRelay(json: unknown, feed: OpenMeteoFeed): OpenMeteoRelayPayload | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  if (r.feed !== feed || typeof r.retrievedAt !== 'string' || !ISO_Z.test(r.retrievedAt) || !('raw' in r)) return null;
  return { feed, retrievedAt: r.retrievedAt, stale: r.stale === true, raw: r.raw };
}

/** A non-2xx answer from the relay (429 or 503 carry Retry-After when the relay knows it). */
export class OpenMeteoRelayError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(status: number, retryAfterMs: number | null) {
    super(status === 429 ? 'rate limited' : `HTTP ${status}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** GET one feed from the relay. Throws OpenMeteoRelayError on a non-2xx answer, Error on a bad one. */
export async function fetchOpenMeteoRelay(feed: OpenMeteoFeed, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<OpenMeteoRelayPayload> {
  const res = await fetchImpl(openMeteoRelayUrl(feed), { signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    const s = Number(res.headers?.get?.('retry-after'));
    throw new OpenMeteoRelayError(res.status, Number.isFinite(s) && s > 0 ? s * 1000 : null);
  }
  const payload = parseOpenMeteoRelay(await res.json(), feed);
  if (!payload) throw new Error('the relay answer was not in the expected shape');
  return payload;
}
