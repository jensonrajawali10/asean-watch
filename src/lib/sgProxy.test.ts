import { beforeEach, describe, expect, it } from 'vitest';
import {
  SG_BACKOFF_MS,
  SG_RATE_LIMIT_MAX,
  SG_RETRY_MS,
  SG_STALE_MAX_MS,
  SG_TTL_MS,
  handleSgRequest,
  resetSgProxyState,
} from './sgProxy';
import { SG_FEEDS, SG_REASON_TEXT, SG_UPSTREAM, SgUnavailable, unwrapSgRelay, type SgFeed } from './sgRelay';

const T0 = Date.parse('2026-10-24T08:00:00Z');

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`https://asean-watch.vercel.app${path}`, { headers: { host: 'asean-watch.vercel.app' }, ...init });
}

/** A data.gov.sg v2 success for a feed. */
function okBody(feed: SgFeed): string {
  return JSON.stringify({ code: 0, data: { feed, readings: [] }, errorMsg: '' });
}

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

const feedOf = (url: string) => (Object.entries(SG_UPSTREAM).find(([, u]) => u === url)?.[0] ?? 'psi') as SgFeed;
const ok = (url: string) => new Response(okBody(feedOf(url)), { status: 200 });

describe('GET /api/sg (cached data.gov.sg relay)', () => {
  let clock = T0;
  const now = () => clock;
  const logs: string[] = [];
  const ctx = (fetchImpl: typeof fetch, ip = '203.0.113.9') => ({ clientIp: ip, fetchImpl, now, log: (l: string) => logs.push(l) });
  beforeEach(() => {
    resetSgProxyState();
    clock = T0;
    logs.length = 0;
  });

  it('asks only the five fixed data.gov.sg URLs', () => {
    for (const feed of SG_FEEDS) {
      const u = new URL(SG_UPSTREAM[feed]);
      expect(u.protocol).toBe('https:');
      expect(u.hostname).toBe('api-open.data.gov.sg');
      expect(u.pathname.startsWith('/v2/real-time/api/')).toBe(true);
    }
    expect(SG_UPSTREAM['flood-alerts']).toBe('https://api-open.data.gov.sg/v2/real-time/api/weather/flood-alerts');
  });

  it('relays the answer as received, with the fetch time and CDN cache headers', async () => {
    const up = upstream(ok);
    const res = await handleSgRequest(req('/api/sg?feed=psi'), ctx(up.fn));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ available: true, feed: 'psi', retrievedAt: '2026-10-24T08:00:00Z', stale: false });
    expect(unwrapSgRelay(body, 'psi')).toEqual({ raw: JSON.parse(okBody('psi')), retrievedAt: '2026-10-24T08:00:00Z' });
    expect(up.calls).toHaveLength(1);
    expect(up.calls[0].url).toBe(SG_UPSTREAM.psi);
    expect(up.calls[0].init?.redirect).toBe('error');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
  });

  it('keeps each feed for its TTL (flood alerts a minute), then fetches again', async () => {
    const up = upstream(ok);
    await handleSgRequest(req('/api/sg?feed=flood-alerts'), ctx(up.fn));
    clock = T0 + SG_TTL_MS['flood-alerts'] - 1;
    await handleSgRequest(req('/api/sg?feed=flood-alerts'), ctx(up.fn));
    expect(up.calls).toHaveLength(1);
    clock = T0 + SG_TTL_MS['flood-alerts'];
    await handleSgRequest(req('/api/sg?feed=flood-alerts'), ctx(up.fn));
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
    const all = Promise.all([1, 2, 3].map((i) => handleSgRequest(req('/api/sg?feed=wind-direction'), ctx(slow, `198.51.100.${i}`))));
    release();
    expect((await all).map((r) => r.status)).toEqual([200, 200, 200]);
    expect(up.calls).toHaveLength(1);
  });

  it('a 429 from data.gov.sg is a 200 { available: false } (never a console error), and the host is left alone for 30 s', async () => {
    const up = upstream(() => new Response('{"code":429}', { status: 429 }));
    const res = await handleSgRequest(req('/api/sg?feed=wind-speed'), ctx(up.fn));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ available: false, feed: 'wind-speed', checkedAt: '2026-10-24T08:00:00Z', reason: 'rate_limited', message: SG_REASON_TEXT.rate_limited });
    expect(() => unwrapSgRelay(body, 'wind-speed')).toThrow(SgUnavailable);
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=30');
    expect(logs.join('\n')).toContain('upstream HTTP 429');
    // Every feed shares the host backoff.
    clock = T0 + SG_BACKOFF_MS - 1000;
    expect(await (await handleSgRequest(req('/api/sg?feed=pm25'), ctx(up.fn))).json()).toMatchObject({ available: false, reason: 'rate_limited' });
    expect(up.calls).toHaveLength(1);
    clock = T0 + SG_BACKOFF_MS;
    const recovered = upstream(ok);
    expect(await (await handleSgRequest(req('/api/sg?feed=pm25'), ctx(recovered.fn))).json()).toMatchObject({ available: true, feed: 'pm25' });
  });

  it('while data.gov.sg fails, serves its last good copy (stale: true), up to 30 minutes (10 for flood alerts)', async () => {
    await handleSgRequest(req('/api/sg?feed=flood-alerts'), ctx(upstream(ok).fn));
    clock = T0 + SG_TTL_MS['flood-alerts'];
    const down = upstream(() => new Response('bad gateway', { status: 502 }));
    const res = await handleSgRequest(req('/api/sg?feed=flood-alerts'), ctx(down.fn));
    expect(await res.json()).toMatchObject({ available: true, retrievedAt: '2026-10-24T08:00:00Z', stale: true });
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=30');
    // Any other failure: the feed is not retried upstream for 30 seconds.
    clock += SG_RETRY_MS - 1;
    await handleSgRequest(req('/api/sg?feed=flood-alerts'), ctx(down.fn));
    expect(down.calls).toHaveLength(1);
    clock = T0 + SG_STALE_MAX_MS['flood-alerts'];
    expect(await (await handleSgRequest(req('/api/sg?feed=flood-alerts'), ctx(down.fn))).json()).toMatchObject({ available: false, reason: 'upstream_http' });
  });

  it('never caches an answer that is not a data.gov.sg success, and keeps upstream detail out of the response', async () => {
    const cases: [Reply, string][] = [
      [new Response('{"code":4,"errorMsg":"Invalid date"}', { status: 200 }), 'bad_answer'],
      [new Response('<html>maintenance</html>', { status: 200 }), 'bad_answer'],
      [new Response('nope', { status: 500 }), 'upstream_http'],
      [Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'timeout'],
      [new TypeError('fetch failed'), 'network'],
    ];
    for (const [reply, reason] of cases) {
      resetSgProxyState();
      const res = await handleSgRequest(req('/api/sg?feed=psi'), ctx(upstream(() => reply).fn));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({ available: false, reason });
      expect(text).not.toMatch(/Invalid date|maintenance|aborted|fetch failed/);
    }
    expect(logs.some((l) => l.includes('code 4'))).toBe(true);
  });

  it('refuses anything but ?feed=<one of the five>, other methods and cross-site requests, and rate-limits per IP', async () => {
    const up = upstream(ok);
    for (const path of ['/api/sg', '/api/sg?feed=', '/api/sg?feed=rainfall', '/api/sg?feed=psi&date=2026-10-01', '/api/sg?url=https://evil.example/']) {
      expect((await handleSgRequest(req(path), ctx(up.fn))).status).toBe(400);
    }
    expect((await handleSgRequest(req('/api/sg?feed=psi', { method: 'POST' }), ctx(up.fn))).status).toBe(405);
    const cross = req('/api/sg?feed=psi', { headers: { host: 'asean-watch.vercel.app', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    expect((await handleSgRequest(cross, ctx(up.fn))).status).toBe(403);
    expect(up.calls).toHaveLength(0);
    for (let i = 0; i < SG_RATE_LIMIT_MAX; i++) await handleSgRequest(req('/api/sg?feed=psi'), ctx(up.fn));
    expect((await handleSgRequest(req('/api/sg?feed=psi'), ctx(up.fn))).status).toBe(429);
    expect(up.calls).toHaveLength(1);
  });
});

describe('unwrapSgRelay', () => {
  it('accepts only a relay answer for the feed asked for', () => {
    const good = { available: true, feed: 'pm25', retrievedAt: '2026-10-24T08:00:00Z', stale: false, raw: { code: 0, data: {} } };
    expect(unwrapSgRelay(good, 'pm25').retrievedAt).toBe('2026-10-24T08:00:00Z');
    expect(() => unwrapSgRelay(good, 'psi')).toThrow('another feed');
    expect(() => unwrapSgRelay({ ...good, retrievedAt: 'today' }, 'pm25')).toThrow('expected shape');
    expect(() => unwrapSgRelay({ code: 0, data: {} }, 'pm25')).toThrow();
    expect(() => unwrapSgRelay(null, 'pm25')).toThrow('expected shape');
  });

  it('turns { available: false } into SgUnavailable with the fixed reason, passing or not', () => {
    const down = (reason: string) => ({ available: false, feed: 'psi', checkedAt: '2026-10-24T08:00:00Z', reason, message: 'ignored' });
    const err = (reason: string) => {
      try {
        unwrapSgRelay(down(reason), 'psi');
      } catch (e) {
        return e as SgUnavailable;
      }
      throw new Error('did not throw');
    };
    expect(err('rate_limited')).toMatchObject({ message: 'data.gov.sg rate limited', transient: true });
    expect(err('timeout').transient).toBe(true);
    expect(err('upstream_http').transient).toBe(false);
    expect(err('<script>')).toMatchObject({ reason: 'bad_answer', message: SG_REASON_TEXT.bad_answer });
  });
});
