import { beforeEach, describe, expect, it } from 'vitest';
import { WATCH_RETRY_MS, WATCH_TTL_MS, handleWatchRequest, resetWatchProxy } from './watchProxy';
import { WATCH_REASON_TEXT } from './watchRelay';
import bundledWatches from '../../data/watches.json';

const T0 = Date.parse('2026-10-29T08:00:00Z');

function req(path = '/api/watch', init: RequestInit = {}): Request {
  return new Request(`https://asean-watch.vercel.app${path}`, { headers: { host: 'asean-watch.vercel.app' }, ...init });
}

/** A stand-in for scripts/lib/watchDataBuild.mjs: records its inputs and returns (or throws) what it is told. */
function builder(reply: () => Error | null) {
  const calls: { watches: unknown; timeoutMs?: number }[] = [];
  const build = (async (input: { watches: unknown; timeoutMs?: number; now?: number }) => {
    calls.push({ watches: input.watches, timeoutMs: input.timeoutMs });
    const err = reply();
    if (err) throw err;
    const at = new Date(input.now ?? T0).toISOString();
    return {
      files: { firms: '', quakes: '', meta: '' },
      firms: { about: 'firms', rows: [{ file: 'modis' }] },
      quakes: { about: 'quakes', rows: [] },
      meta: { retrievedAt: at, window: { start: '2026-10-23T00:00:00Z', end: at, days: 7 }, sources: [] },
      scenarioWindow: { start: '2026-10-23T00:00:00Z', end: at },
      updatedWatches: [],
      snapshotBytes: 1,
      startedMs: input.now ?? T0,
    };
  }) as unknown as NonNullable<Parameters<typeof handleWatchRequest>[1]['build']>;
  return { build, calls };
}

describe('GET /api/watch (cached watch-area evidence relay)', () => {
  let now = T0;
  const clock = () => now;
  const quiet = () => {};

  beforeEach(() => {
    now = T0;
    resetWatchProxy();
  });

  it('builds for the bundled watch areas within the function budget and answers { available, stale, data }', async () => {
    const b = builder(() => null);
    const res = await handleWatchRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(`public, max-age=600, s-maxage=${WATCH_TTL_MS / 1000}, stale-while-revalidate=3600`);
    const body = (await res.json()) as { available: boolean; stale: boolean; data: Record<string, unknown> };
    expect(body.available).toBe(true);
    expect(body.stale).toBe(false);
    expect(Object.keys(body.data).sort()).toEqual(['firms', 'meta', 'quakes', 'scenarioWindow']);
    expect(body.data.scenarioWindow).toEqual({ start: '2026-10-23T00:00:00Z', end: new Date(T0).toISOString() });
    expect(b.calls[0].watches).toBe(bundledWatches);
    expect(b.calls[0].timeoutMs).toBeLessThan(60_000);
  });

  it('serves the cached build for the TTL, then rebuilds', async () => {
    const b = builder(() => null);
    await handleWatchRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    now = T0 + WATCH_TTL_MS - 1000;
    await handleWatchRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(b.calls).toHaveLength(1);
    now = T0 + WATCH_TTL_MS + 1;
    await handleWatchRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(b.calls).toHaveLength(2);
  });

  it('answers 200 { available: false } naming the sources when a download fails, and waits before retrying', async () => {
    const b = builder(() => new Error('https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json: HTTP 503'));
    const res = await handleWatchRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ available: false, reason: 'upstream_http', message: WATCH_REASON_TEXT.upstream_http });
    now = T0 + WATCH_RETRY_MS - 1000;
    await handleWatchRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(b.calls).toHaveLength(1);
  });

  it('refuses parameters and cross-site requests without building', async () => {
    const b = builder(() => null);
    const ctx = { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet };
    expect((await handleWatchRequest(req('/api/watch?area=x'), ctx)).status).toBe(400);
    const cross = req('/api/watch', { headers: { host: 'asean-watch.vercel.app', origin: 'https://evil.example' } });
    expect((await handleWatchRequest(cross, ctx)).status).toBe(403);
    expect(b.calls).toHaveLength(0);
  });
});
