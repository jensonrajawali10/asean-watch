import { beforeEach, describe, expect, it } from 'vitest';
import {
  OPEN_METEO_BACKOFF_MS,
  OPEN_METEO_FEED_SPECS,
  OPEN_METEO_RATE_LIMIT_MAX,
  OPEN_METEO_RETRY_MS,
  OPEN_METEO_STALE_MAX_MS,
  OPEN_METEO_TTL_MS,
  OPEN_METEO_UNAVAILABLE_MESSAGE,
  handleOpenMeteoRequest,
  resetOpenMeteoProxyState,
} from './openMeteoProxy';
import { OPEN_METEO_FEEDS, parseOpenMeteoRelay, type OpenMeteoFeed } from './openMeteoRelay';
import { gridAxes } from './windField';
import { AQ_PLACES } from './airQuality';
import { RIVER_POINTS } from './floodModel';
import { ashWindPoints } from './ashDrift';

const T0 = Date.parse('2026-10-21T12:00:00Z');

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`https://asean-watch.vercel.app${path}`, { headers: { host: 'asean-watch.vercel.app' }, ...init });
}

/** A well-formed Open-Meteo multi-location answer for a feed (one entry per location). */
function bodyFor(feed: OpenMeteoFeed): unknown[] {
  return Array.from({ length: OPEN_METEO_FEED_SPECS[feed].locations() }, (_, i) => ({ latitude: i, longitude: i, hourly: { time: [] } }));
}

type Reply = Response | Error | (() => Response);

function upstream(reply: (url: string) => Reply) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = reply(String(url));
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r() : r;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const okFor = (url: string) => {
  const feed = url.includes('air-quality') ? 'aq' : url.includes('flood-api') ? 'flood' : url.includes('wind_speed_700hPa') ? 'ash' : 'wind';
  return new Response(JSON.stringify(bodyFor(feed)), { status: 200 });
};

describe('GET /api/open-meteo (cached Open-Meteo relay)', () => {
  let clock = T0;
  const now = () => clock;
  const logs: string[] = [];
  const ctx = (fetchImpl: typeof fetch, ip = '203.0.113.9') => ({ clientIp: ip, fetchImpl, now, log: (l: string) => logs.push(l) });
  beforeEach(() => {
    resetOpenMeteoProxyState();
    clock = T0;
    logs.length = 0;
  });

  it('asks only fixed URLs on the three Open-Meteo hosts, with both wind levels in one request', () => {
    const hosts = OPEN_METEO_FEEDS.map((f) => new URL(OPEN_METEO_FEED_SPECS[f].url()).hostname);
    expect(hosts).toEqual(['api.open-meteo.com', 'air-quality-api.open-meteo.com', 'api.open-meteo.com', 'flood-api.open-meteo.com']);
    const wind = new URL(OPEN_METEO_FEED_SPECS.wind.url());
    expect(wind.searchParams.get('hourly')).toBe('wind_speed_10m,wind_direction_10m,wind_speed_925hPa,wind_direction_925hPa');
    expect(wind.searchParams.get('latitude')!.split(',')).toHaveLength(gridAxes().lats.length * gridAxes().lons.length);
    expect(OPEN_METEO_FEED_SPECS.aq.locations()).toBe(gridAxes().lats.length * gridAxes().lons.length + AQ_PLACES.length);
    expect(OPEN_METEO_FEED_SPECS.ash.locations()).toBe(ashWindPoints().length);
    expect(OPEN_METEO_FEED_SPECS.flood.locations()).toBe(RIVER_POINTS.length * 25);
  });

  it('relays the answer as received, with the fetch time and CDN cache headers', async () => {
    const up = upstream(okFor);
    const res = await handleOpenMeteoRequest(req('/api/open-meteo?feed=ash'), ctx(up.fn));
    expect(res.status).toBe(200);
    const payload = parseOpenMeteoRelay(await res.json(), 'ash');
    expect(payload).toEqual({ feed: 'ash', retrievedAt: '2026-10-21T12:00:00Z', stale: false, raw: bodyFor('ash') });
    expect(up.calls).toHaveLength(1);
    expect(up.calls[0].url).toBe(OPEN_METEO_FEED_SPECS.ash.url());
    expect(up.calls[0].init?.redirect).toBe('error');
    expect(res.headers.get('cache-control')).toBe('public, max-age=600, s-maxage=7200, stale-while-revalidate=7200, stale-if-error=86400');
  });

  it('serves its copy for the rest of the TTL (shorter s-maxage), then fetches again', async () => {
    const up = upstream(okFor);
    await handleOpenMeteoRequest(req('/api/open-meteo?feed=flood'), ctx(up.fn));
    clock = T0 + OPEN_METEO_TTL_MS.flood - 30 * 60 * 1000;
    const later = await handleOpenMeteoRequest(req('/api/open-meteo?feed=flood'), ctx(up.fn));
    expect(up.calls).toHaveLength(1);
    expect(later.headers.get('cache-control')).toMatch(/^public, max-age=600, s-maxage=1800, /);
    expect(parseOpenMeteoRelay(await later.json(), 'flood')!.retrievedAt).toBe('2026-10-21T12:00:00Z');
    clock = T0 + OPEN_METEO_TTL_MS.flood;
    await handleOpenMeteoRequest(req('/api/open-meteo?feed=flood'), ctx(up.fn));
    expect(up.calls).toHaveLength(2);
  });

  it('shares one upstream request between concurrent visitors', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const up = upstream(okFor);
    const slow = (async (url: string, init?: RequestInit) => {
      await gate;
      return up.fn(url, init);
    }) as unknown as typeof fetch;
    const all = Promise.all([1, 2, 3].map((i) => handleOpenMeteoRequest(req('/api/open-meteo?feed=wind'), ctx(slow, `198.51.100.${i}`))));
    release();
    const answers = await all;
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(up.calls).toHaveLength(1);
  });

  it('after a 429 it leaves that host alone for 5 minutes and answers 503 when it has no copy', async () => {
    const up = upstream(() => new Response('{"error":true,"reason":"Minutely API request limit exceeded"}', { status: 429 }));
    const res = await handleOpenMeteoRequest(req('/api/open-meteo?feed=wind'), ctx(up.fn));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'upstream_unavailable', message: OPEN_METEO_UNAVAILABLE_MESSAGE });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('retry-after')).toBe('300');
    expect(logs.join('\n')).toContain('upstream HTTP 429');
    // Same host (api.open-meteo.com): the ash feed waits too; the other hosts do not.
    clock = T0 + OPEN_METEO_BACKOFF_MS - 1000;
    expect((await handleOpenMeteoRequest(req('/api/open-meteo?feed=ash'), ctx(up.fn))).status).toBe(503);
    expect(up.calls).toHaveLength(1);
    const other = upstream(okFor);
    expect((await handleOpenMeteoRequest(req('/api/open-meteo?feed=aq'), ctx(other.fn))).status).toBe(200);
    clock = T0 + OPEN_METEO_BACKOFF_MS;
    const recovered = upstream(okFor);
    expect((await handleOpenMeteoRequest(req('/api/open-meteo?feed=wind'), ctx(recovered.fn))).status).toBe(200);
    expect(recovered.calls).toHaveLength(1);
  });

  it('honours a Retry-After from Open-Meteo (capped at an hour)', async () => {
    const up = upstream(() => new Response('{}', { status: 429, headers: { 'retry-after': '900' } }));
    const res = await handleOpenMeteoRequest(req('/api/open-meteo?feed=aq'), ctx(up.fn));
    expect(res.headers.get('retry-after')).toBe('900');
    clock = T0 + 899_000;
    await handleOpenMeteoRequest(req('/api/open-meteo?feed=aq'), ctx(up.fn));
    expect(up.calls).toHaveLength(1);
  });

  it('while Open-Meteo fails, serves its last good copy (stale: true) for a minute at a time, up to 24 h', async () => {
    await handleOpenMeteoRequest(req('/api/open-meteo?feed=aq'), ctx(upstream(okFor).fn));
    clock = T0 + OPEN_METEO_TTL_MS.aq + 1;
    const down = upstream(() => new Response('bad gateway', { status: 502 }));
    const res = await handleOpenMeteoRequest(req('/api/open-meteo?feed=aq'), ctx(down.fn));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    expect(parseOpenMeteoRelay(await res.json(), 'aq')).toMatchObject({ retrievedAt: '2026-10-21T12:00:00Z', stale: true });
    // Any failure: the feed is not retried upstream for a minute.
    clock += OPEN_METEO_RETRY_MS - 1;
    await handleOpenMeteoRequest(req('/api/open-meteo?feed=aq'), ctx(down.fn));
    expect(down.calls).toHaveLength(1);
    clock = T0 + OPEN_METEO_STALE_MAX_MS;
    expect((await handleOpenMeteoRequest(req('/api/open-meteo?feed=aq'), ctx(down.fn))).status).toBe(503);
  });

  it('never caches an answer of the wrong shape, and keeps upstream detail out of the response', async () => {
    const cases: Reply[] = [
      new Response('{"error":true,"reason":"Cannot initialize WeatherVariable"}', { status: 400 }),
      new Response('[{"latitude":1}]', { status: 200 }),
      new Response('<html>', { status: 200 }),
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
    ];
    for (const reply of cases) {
      resetOpenMeteoProxyState();
      const res = await handleOpenMeteoRequest(req('/api/open-meteo?feed=wind'), ctx(upstream(() => reply).fn));
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).not.toMatch(/WeatherVariable|latitude|html|timeout/i);
    }
    expect(logs.some((l) => l.includes('upstream HTTP 400'))).toBe(true);
    expect(logs.some((l) => l.includes('1 locations, expected 390'))).toBe(true);
  });

  it('refuses anything but ?feed=<one of the four>, other methods and cross-site requests, and rate-limits per IP', async () => {
    const up = upstream(okFor);
    for (const path of ['/api/open-meteo', '/api/open-meteo?feed=', '/api/open-meteo?feed=temperature', '/api/open-meteo?feed=wind&latitude=1', '/api/open-meteo?url=https://evil.example/']) {
      expect((await handleOpenMeteoRequest(req(path), ctx(up.fn))).status).toBe(400);
    }
    expect((await handleOpenMeteoRequest(req('/api/open-meteo?feed=wind', { method: 'POST' }), ctx(up.fn))).status).toBe(405);
    const cross = req('/api/open-meteo?feed=wind', { headers: { host: 'asean-watch.vercel.app', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    expect((await handleOpenMeteoRequest(cross, ctx(up.fn))).status).toBe(403);
    expect(up.calls).toHaveLength(0);
    for (let i = 0; i < OPEN_METEO_RATE_LIMIT_MAX; i++) await handleOpenMeteoRequest(req('/api/open-meteo?feed=ash'), ctx(up.fn));
    const limited = await handleOpenMeteoRequest(req('/api/open-meteo?feed=ash'), ctx(up.fn));
    expect(limited.status).toBe(429);
    expect(up.calls).toHaveLength(1);
  });
});
