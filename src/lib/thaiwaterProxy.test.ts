import { beforeEach, describe, expect, it } from 'vitest';
import {
  THAIWATER_BACKOFF_MAX_MS,
  THAIWATER_BACKOFF_MS,
  THAIWATER_RATE_LIMIT_MAX,
  THAIWATER_RETRY_MS,
  THAIWATER_STALE_MAX_MS,
  THAIWATER_TTL_MS,
  THAIWATER_UPSTREAM_TIMEOUT_MS,
  handleThaiWaterRequest,
  resetThaiWaterProxyState,
} from './thaiwaterProxy';
import { THAIWATER_REASON_TEXT, THAIWATER_RELAY_PATH, THAIWATER_UPSTREAM_URL } from './thaiwaterRelay';
import { FEEDS, relayedThaiWater } from './warnings';

const T0 = Date.parse('2026-11-02T16:10:00Z');

function req(path: string = THAIWATER_RELAY_PATH, init: RequestInit = {}): Request {
  return new Request(`https://asean-watch.vercel.app${path}`, { headers: { host: 'asean-watch.vercel.app' }, ...init });
}

/** A ThaiWater waterlevel_load answer, in ThaiWater's own field order and spacing. */
const OK_BODY =
  '{"waterlevel_data":{"result":"OK","data":[{"id":1,"waterlevel_datetime":"2026-11-02 23:00","waterlevel_msl":"4.97","situation_level":5}]},' +
  '"scale":{"result":"OK","data":{"scale":[]}},"province":{"result":"OK","data":[]}}';

type Reply = Response | Error;

function upstream(reply: (url: string) => Reply) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = reply(String(url));
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = () => new Response(OK_BODY, { status: 200 });

describe('GET /api/thaiwater (cached ThaiWater relay)', () => {
  let clock = T0;
  const now = () => clock;
  const logs: string[] = [];
  const ctx = (fetchImpl: typeof fetch, ip = '203.0.113.9') => ({ clientIp: ip, fetchImpl, now, log: (l: string) => logs.push(l) });
  beforeEach(() => {
    resetThaiWaterProxyState();
    clock = T0;
    logs.length = 0;
  });

  it('asks only the one fixed ThaiWater URL, the one the items cite', () => {
    const u = new URL(THAIWATER_UPSTREAM_URL);
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('api-v3.thaiwater.net');
    expect(u.search).toBe('');
    expect(THAIWATER_UPSTREAM_URL).toBe(FEEDS.thaiwater.url);
    // The relay answers inside the browser's 8 s per-feed limit (src/lib/warnings.ts).
    expect(THAIWATER_UPSTREAM_TIMEOUT_MS).toBeLessThan(8000);
  });

  it('relays the answer as received, with the fetch time and CDN cache headers', async () => {
    const up = upstream(ok);
    const res = await handleThaiWaterRequest(req(), ctx(up.fn));
    expect(res.status).toBe(200);
    const text = await res.text();
    // Inserted as is, never re-serialised: ThaiWater's own text appears byte for byte.
    expect(text).toBe(`{"available":true,"retrievedAt":"2026-11-02T16:10:00Z","stale":false,"raw":${OK_BODY}}`);
    expect(relayedThaiWater(JSON.parse(text))).toMatchObject({ raw: JSON.parse(OK_BODY), retrievedAt: '2026-11-02T16:10:00Z' });
    expect(up.calls).toHaveLength(1);
    expect(up.calls[0].url).toBe(THAIWATER_UPSTREAM_URL);
    expect(up.calls[0].init?.redirect).toBe('error');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=600');
  });

  it('keeps the list for 10 minutes, counting the CDN time down, then fetches again', async () => {
    const up = upstream(ok);
    await handleThaiWaterRequest(req(), ctx(up.fn));
    clock = T0 + THAIWATER_TTL_MS - 120_000;
    const later = await handleThaiWaterRequest(req(), ctx(up.fn));
    expect(later.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=120');
    clock = T0 + THAIWATER_TTL_MS - 1;
    await handleThaiWaterRequest(req(), ctx(up.fn));
    expect(up.calls).toHaveLength(1);
    clock = T0 + THAIWATER_TTL_MS;
    await handleThaiWaterRequest(req(), ctx(up.fn));
    expect(up.calls).toHaveLength(2);
  });

  it('shares one upstream request between concurrent visitors', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const up = upstream(ok);
    const slow = (async (url: string, init?: RequestInit) => {
      await gate;
      return up.fn(url, init);
    }) as unknown as typeof fetch;
    const all = Promise.all([1, 2, 3].map((i) => handleThaiWaterRequest(req(), ctx(slow, `198.51.100.${i}`))));
    release();
    expect((await all).map((r) => r.status)).toEqual([200, 200, 200]);
    expect(up.calls).toHaveLength(1);
  });

  it('a 429 from ThaiWater is a 200 { available: false } (never a console error), and the host is left alone for 2 minutes', async () => {
    const up = upstream(() => new Response('Too Many Requests', { status: 429 }));
    const res = await handleThaiWaterRequest(req(), ctx(up.fn));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ available: false, checkedAt: '2026-11-02T16:10:00Z', reason: 'rate_limited', message: THAIWATER_REASON_TEXT.rate_limited });
    expect(() => relayedThaiWater(body)).toThrow(/^ThaiWater rate limited$/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=30');
    expect(logs.join('\n')).toContain('upstream HTTP 429');
    clock = T0 + THAIWATER_BACKOFF_MS - 1000;
    expect(await (await handleThaiWaterRequest(req(), ctx(up.fn))).json()).toMatchObject({ available: false, reason: 'rate_limited' });
    expect(up.calls).toHaveLength(1);
    clock = T0 + THAIWATER_BACKOFF_MS;
    const recovered = upstream(ok);
    expect(await (await handleThaiWaterRequest(req(), ctx(recovered.fn))).json()).toMatchObject({ available: true, stale: false });
  });

  it("honours ThaiWater's Retry-After, up to 15 minutes", async () => {
    const up = upstream(() => new Response('', { status: 429, headers: { 'retry-after': '300' } }));
    await handleThaiWaterRequest(req(), ctx(up.fn));
    clock = T0 + 300_000 - 1;
    await handleThaiWaterRequest(req(), ctx(up.fn));
    expect(up.calls).toHaveLength(1);
    clock = T0 + 300_000;
    await handleThaiWaterRequest(req(), ctx(up.fn));
    expect(up.calls).toHaveLength(2);

    resetThaiWaterProxyState();
    clock = T0;
    const long = upstream(() => new Response('', { status: 429, headers: { 'retry-after': '86400' } }));
    await handleThaiWaterRequest(req(), ctx(long.fn));
    clock = T0 + THAIWATER_BACKOFF_MAX_MS - 1;
    await handleThaiWaterRequest(req(), ctx(long.fn));
    expect(long.calls).toHaveLength(1);
    clock = T0 + THAIWATER_BACKOFF_MAX_MS;
    await handleThaiWaterRequest(req(), ctx(long.fn));
    expect(long.calls).toHaveLength(2);
  });

  it('while ThaiWater fails or throttles, serves its last good copy (stale: true), up to 6 hours', async () => {
    await handleThaiWaterRequest(req(), ctx(upstream(ok).fn));
    clock = T0 + THAIWATER_TTL_MS;
    const throttled = upstream(() => new Response('', { status: 429 }));
    const res = await handleThaiWaterRequest(req(), ctx(throttled.fn));
    expect(await res.json()).toMatchObject({ available: true, retrievedAt: '2026-11-02T16:10:00Z', stale: true });
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');

    clock = T0 + THAIWATER_TTL_MS + THAIWATER_BACKOFF_MS;
    const down = upstream(() => new Response('bad gateway', { status: 502 }));
    expect(await (await handleThaiWaterRequest(req(), ctx(down.fn))).json()).toMatchObject({ available: true, stale: true });
    // Any other failure: upstream is not retried for a minute.
    clock += THAIWATER_RETRY_MS - 1;
    await handleThaiWaterRequest(req(), ctx(down.fn));
    expect(down.calls).toHaveLength(1);
    clock = T0 + THAIWATER_STALE_MAX_MS - 1;
    expect(await (await handleThaiWaterRequest(req(), ctx(down.fn))).json()).toMatchObject({ available: true, stale: true });
    clock = T0 + THAIWATER_STALE_MAX_MS;
    expect(await (await handleThaiWaterRequest(req(), ctx(down.fn))).json()).toMatchObject({ available: false, reason: 'upstream_http' });
  });

  it('never caches an answer that is not a water-level list, and keeps upstream detail out of the response', async () => {
    const cases: [Reply, string][] = [
      [new Response('{"result":"FAIL","message":"Internal maintenance"}', { status: 200 }), 'bad_answer'],
      [new Response('{"waterlevel_data":{"result":"OK","data":null}}', { status: 200 }), 'bad_answer'],
      [new Response('[]', { status: 200 }), 'bad_answer'],
      [new Response('<html>maintenance</html>', { status: 200 }), 'bad_answer'],
      [new Response('nope', { status: 503 }), 'upstream_http'],
      [Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'timeout'],
      [new TypeError('fetch failed'), 'network'],
    ];
    for (const [reply, reason] of cases) {
      resetThaiWaterProxyState();
      const res = await handleThaiWaterRequest(req(), ctx(upstream(() => reply).fn));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({ available: false, reason, message: THAIWATER_REASON_TEXT[reason as keyof typeof THAIWATER_REASON_TEXT] });
      expect(text).not.toMatch(/maintenance|aborted|fetch failed|FAIL/);
    }
    expect(logs.some((l) => l.includes('no waterlevel_data.data list'))).toBe(true);
  });

  it('refuses any query string, other methods and cross-site requests, and rate-limits per IP', async () => {
    const up = upstream(ok);
    for (const path of ['/api/thaiwater?province=10', '/api/thaiwater?url=https://evil.example/', '/api/thaiwater?x']) {
      expect((await handleThaiWaterRequest(req(path), ctx(up.fn))).status).toBe(400);
    }
    expect((await handleThaiWaterRequest(req(THAIWATER_RELAY_PATH, { method: 'POST' }), ctx(up.fn))).status).toBe(405);
    const cross = req(THAIWATER_RELAY_PATH, { headers: { host: 'asean-watch.vercel.app', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    expect((await handleThaiWaterRequest(cross, ctx(up.fn))).status).toBe(403);
    expect(up.calls).toHaveLength(0);
    for (let i = 0; i < THAIWATER_RATE_LIMIT_MAX; i++) await handleThaiWaterRequest(req(), ctx(up.fn));
    expect((await handleThaiWaterRequest(req(), ctx(up.fn))).status).toBe(429);
    expect(up.calls).toHaveLength(1);
  });
});

describe('relayedThaiWater', () => {
  it('accepts only a relay answer with its fetch time', () => {
    const good = { available: true, retrievedAt: '2026-11-02T16:10:00Z', stale: false, raw: { waterlevel_data: { data: [] } } };
    expect(relayedThaiWater(good)).toMatchObject({ raw: good.raw, retrievedAt: '2026-11-02T16:10:00Z' });
    expect(() => relayedThaiWater({ ...good, retrievedAt: 'today' })).toThrow('did not return');
    expect(() => relayedThaiWater({ waterlevel_data: { data: [] } })).toThrow('did not return');
    expect(() => relayedThaiWater(null)).toThrow('expected shape');
  });

  it('only the fixed reasons reach the visitor', () => {
    expect(() => relayedThaiWater({ available: false, reason: 'timeout', message: 'upstream detail' })).toThrow(/^ThaiWater did not answer in time$/);
    expect(() => relayedThaiWater({ available: false, reason: '<script>', message: 'upstream detail' })).toThrow(
      'the ThaiWater relay did not return its water-level list',
    );
  });
});
