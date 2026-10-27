import { beforeEach, describe, expect, it } from 'vitest';
import { FIRES_RETRY_MS, FIRES_STALE_MAX_MS, FIRES_TTL_MS, handleFiresRequest, resetFiresProxy } from './firesProxy';
import { FIRES_REASON_TEXT } from './firesRelay';
import bundledSnapshot from '../../data/fires-snapshot.json';

const T0 = Date.parse('2026-10-27T06:00:00Z');

function req(path = '/api/fires', init: RequestInit = {}): Request {
  return new Request(`https://asean-watch.vercel.app${path}`, { headers: { host: 'asean-watch.vercel.app' }, ...init });
}

/** A stand-in for scripts/lib/firesBuild.mjs: records its inputs and returns (or throws) what it is told. */
function builder(reply: () => string | Error) {
  const calls: { previous: unknown; timeoutMs?: number }[] = [];
  const build = (async (input: { previous?: unknown; timeoutMs?: number }) => {
    calls.push({ previous: input.previous, timeoutMs: input.timeoutMs });
    const r = reply();
    if (r instanceof Error) throw r;
    return { text: r, plan: 0, results: [], startedMs: T0 };
  }) as unknown as NonNullable<Parameters<typeof handleFiresRequest>[1]['build']>;
  return { build, calls };
}

const SNAP = (retrievedAt: string) => JSON.stringify({ schema: 1, retrievedAt, history: { days: [] } });

describe('GET /api/fires (cached FIRMS fire relay)', () => {
  let now = T0;
  const clock = () => now;
  const quiet = () => {};

  beforeEach(() => {
    now = T0;
    resetFiresProxy();
  });

  it('builds once, serves the build from cache for the TTL, and lets the CDN keep it', async () => {
    const b = builder(() => SNAP('2026-10-27T06:00:00Z'));
    const first = await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe(`public, max-age=600, s-maxage=${FIRES_TTL_MS / 1000}, stale-while-revalidate=3600`);
    const body = (await first.json()) as { available: boolean; stale: boolean; snapshot: { retrievedAt: string } };
    expect(body).toMatchObject({ available: true, stale: false, snapshot: { retrievedAt: '2026-10-27T06:00:00Z' } });

    now = T0 + FIRES_TTL_MS - 120_000;
    const again = await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(again.headers.get('cache-control')).toBe('public, max-age=120, s-maxage=120, stale-while-revalidate=3600');
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0].timeoutMs).toBeLessThan(60_000);
  });

  it('carries the bundled snapshot history forward on the first build, then its own', async () => {
    const b = builder(() => SNAP(new Date(now).toISOString()));
    await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(b.calls[0].previous).toBe(bundledSnapshot);
    now = T0 + FIRES_TTL_MS + 1;
    await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(b.calls[1].previous).toMatchObject({ retrievedAt: new Date(T0).toISOString() });
  });

  it('shares one build between concurrent requests', async () => {
    const b = builder(() => SNAP('2026-10-27T06:00:00Z'));
    const [a, c] = await Promise.all([
      handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet }),
      handleFiresRequest(req(), { clientIp: '2.2.2.2', now: clock, build: b.build, log: quiet }),
    ]);
    expect([a.status, c.status]).toEqual([200, 200]);
    expect(b.calls).toHaveLength(1);
  });

  it('answers 200 { available: false } with a fixed reason when the first build fails, and waits before retrying', async () => {
    const b = builder(() => new Error('https://firms.modaps.eosdis.nasa.gov/x.csv: HTTP 503'));
    const res = await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ available: false, reason: 'upstream_http', message: FIRES_REASON_TEXT.upstream_http });
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');

    now = T0 + FIRES_RETRY_MS - 1000;
    await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(b.calls).toHaveLength(1);
    now = T0 + FIRES_RETRY_MS + 1000;
    await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(b.calls).toHaveLength(2);
  });

  it('classifies timeouts, network failures and bad files', async () => {
    const cases: [Error, string][] = [
      [Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'timeout'],
      [new Error('https://firms.modaps.eosdis.nasa.gov/x.csv: request failed (fetch failed)'), 'network'],
      [new Error('https://firms.modaps.eosdis.nasa.gov/x.csv: unexpected CSV header, missing frp'), 'bad_answer'],
    ];
    for (const [err, reason] of cases) {
      resetFiresProxy();
      const res = await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: builder(() => err).build, log: quiet });
      expect(await res.json()).toMatchObject({ available: false, reason });
    }
  });

  it('serves the last good build as stale while FIRMS fails, up to the stale limit', async () => {
    let fail = false;
    const b = builder(() => (fail ? new Error('x: HTTP 500') : SNAP('2026-10-27T06:00:00Z')));
    await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    fail = true;
    now = T0 + FIRES_TTL_MS + 1;
    const stale = await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(await stale.json()).toMatchObject({ available: true, stale: true });
    expect(stale.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');

    now = T0 + FIRES_STALE_MAX_MS + 1;
    const gone = await handleFiresRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(await gone.json()).toMatchObject({ available: false });
  });

  it('refuses parameters, other methods and cross-site requests without building', async () => {
    const b = builder(() => SNAP('2026-10-27T06:00:00Z'));
    const ctx = { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet };
    expect((await handleFiresRequest(req('/api/fires?url=https://evil.example'), ctx)).status).toBe(400);
    expect((await handleFiresRequest(req('/api/fires', { method: 'POST' }), ctx)).status).toBe(405);
    const cross = req('/api/fires', { headers: { host: 'asean-watch.vercel.app', 'sec-fetch-site': 'cross-site' } });
    expect((await handleFiresRequest(cross, ctx)).status).toBe(403);
    expect(b.calls).toHaveLength(0);
  });

  it('rate limits one IP', async () => {
    const b = builder(() => SNAP('2026-10-27T06:00:00Z'));
    let last = 200;
    for (let i = 0; i < 25; i += 1) last = (await handleFiresRequest(req(), { clientIp: '9.9.9.9', now: clock, build: b.build, log: quiet })).status;
    expect(last).toBe(429);
  });
});
