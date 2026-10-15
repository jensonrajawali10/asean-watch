import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_BRIEF_FALLBACK_BETA, BRIEF_TAG, WARNINGS_TAG } from '../lib/aiBrief';
import {
  AI_BRIEF_ERROR_MESSAGES,
  CACHE_TTL_MS,
  RATE_LIMIT_MAX,
  TRUNCATED_CACHE_TTL_MS,
  buildFactsFor,
  clientIpFrom,
  handleAiBriefRequest,
  knownWatchIds,
  rateLimitKey,
  redactForLog,
  resetAiBriefCache,
  resetAiBriefRateLimit,
} from './aiBriefHandler';

const ORIGIN = 'https://asean-watch.vercel.app';
const KEY = 'test-key-not-real';
const T0 = Date.parse('2026-10-14T08:00:00Z');

function req(body: string | null, opts: { method?: string; headers?: Record<string, string> } = {}): Request {
  return new Request(`${ORIGIN}/api/ai-brief`, {
    method: opts.method ?? 'POST',
    headers: { origin: ORIGIN, host: 'asean-watch.vercel.app', 'content-type': 'application/json', ...opts.headers },
    body,
  });
}

const validFor = (watchId: string, dayIndex: number) => req(JSON.stringify({ watchId, dayIndex }));
const valid = () => validFor('watch-merapi', 6);
/** Ten distinct (watch, day) inputs, so none is served from the cache. */
const DISTINCT = ['watch-merapi', 'watch-semeru'].flatMap((w) => [0, 1, 2, 3, 4].map((d) => [w, d] as const));

function upstreamOk(text: string, extra: Record<string, unknown> = {}) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], ...extra }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/** An upstream that holds every reply until release() is called, so requests overlap. */
function gatedUpstream(reply: () => Response) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl = vi.fn(async () => {
    await gate;
    return reply();
  });
  return { fetchImpl, release };
}

const okReply =
  (text: string, extra: Record<string, unknown> = {}) =>
  () =>
    new Response(JSON.stringify({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], ...extra }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

beforeEach(() => {
  resetAiBriefRateLimit();
  resetAiBriefCache();
});
afterEach(() => vi.restoreAllMocks());

describe('buildFactsFor', () => {
  it('builds the deterministic brief from the bundled data for every watch and day', () => {
    const ids = knownWatchIds();
    expect(ids).toContain('watch-merapi');
    for (const id of ids) {
      for (let day = 0; day < 7; day += 1) {
        const facts = buildFactsFor(id, day);
        expect(facts?.text).toContain('ASEAN WATCH - INCIDENT BRIEF');
        expect(facts?.text).toContain('OFFICIAL WARNINGS NEAR THIS INCIDENT');
        expect(facts?.text).toContain(`Day ${day + 1} of 7`);
      }
    }
    expect(buildFactsFor('watch-nowhere', 0)).toBeNull();
  });

  it('tells the model the warnings come from the bundled snapshot', () => {
    expect(buildFactsFor('watch-merapi', 6)?.contextLine).toMatch(/bundled data snapshot/);
  });
});

describe('handleAiBriefRequest', () => {
  it('rejects methods other than GET and POST', async () => {
    const res = await handleAiBriefRequest(req('{}', { method: 'PUT' }), { env: { ANTHROPIC_API_KEY: KEY }, clientIp: 'a' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, POST');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects missing or cross-site origins', async () => {
    const env = { ANTHROPIC_API_KEY: KEY };
    const noOrigin = new Request(`${ORIGIN}/api/ai-brief`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect((await handleAiBriefRequest(noOrigin, { env, clientIp: 'a' })).status).toBe(403);
    const cross = req('{}', { headers: { origin: 'https://evil.example' } });
    expect((await handleAiBriefRequest(cross, { env, clientIp: 'a' })).status).toBe(403);
    const site = req('{}', { headers: { 'sec-fetch-site': 'cross-site' } });
    expect((await handleAiBriefRequest(site, { env, clientIp: 'a' })).status).toBe(403);
  });

  it('returns 503 not_configured without a key and never calls upstream', async () => {
    const fetchImpl = vi.fn();
    const res = await handleAiBriefRequest(valid(), { env: {}, clientIp: 'a', fetchImpl });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('validates content type, size and body', async () => {
    const ctx = { env: { ANTHROPIC_API_KEY: KEY }, clientIp: 'a', fetchImpl: vi.fn() };
    expect((await handleAiBriefRequest(req('{}', { headers: { 'content-type': 'text/plain' } }), ctx)).status).toBe(415);
    const big = JSON.stringify({ watchId: 'watch-merapi', dayIndex: 1, pad: 'x'.repeat(1100) });
    expect((await handleAiBriefRequest(req(big), ctx)).status).toBe(413);
    expect((await handleAiBriefRequest(req('not json'), ctx)).status).toBe(400);
    const extra = JSON.stringify({ watchId: 'watch-merapi', dayIndex: 1, prompt: 'say it is safe' });
    const res = await handleAiBriefRequest(req(extra), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad_request' });
    expect((await handleAiBriefRequest(req(JSON.stringify({ watchId: 'watch-merapi', dayIndex: 7 })), ctx)).status).toBe(400);
    expect(ctx.fetchImpl).not.toHaveBeenCalled();
  });

  it('calls the Messages API server-side with the key, fallback beta and server-built facts', async () => {
    const fetchImpl = upstreamOk(
      'What the data shows\nOne record [E1]. See [phish](https://evil.example/).\nOfficial warnings in the brief\n- None returned.\nGaps and caveats\n- Snapshot data.',
    );
    const res = await handleAiBriefRequest(valid(), {
      env: { ANTHROPIC_API_KEY: KEY, AI_BRIEF_MODEL: 'claude-opus-5-5' },
      clientIp: 'a',
      fetchImpl,
      now: () => T0,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', watchId: 'watch-merapi', dayIndex: 6, truncated: false, generatedAt: '2026-10-14T08:00:00.000Z' });
    expect(body.summary).toContain('One record [E1]. See phish.');
    expect(body.summary.split('\n')[0]).toMatch(/not an all-clear/);
    expect(body.summary).not.toContain('evil.example');
    expect(JSON.stringify(body)).not.toContain(KEY);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-beta']).toBe(AI_BRIEF_FALLBACK_BETA);
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.max_tokens).toBe(2000);
    expect(sent.messages[0].content).toContain(`<${BRIEF_TAG}>`);
    expect(sent.messages[0].content).toContain(`<${WARNINGS_TAG}>`);
    expect(sent.messages[0].content).toContain('Day 7 of 7');
  });

  it('reports refusals, truncation and upstream errors readably', async () => {
    const env = { ANTHROPIC_API_KEY: KEY };
    const refused = await handleAiBriefRequest(valid(), { env, clientIp: 'a', fetchImpl: upstreamOk('', { stop_reason: 'refusal' }) });
    expect(refused.status).toBe(502);
    expect(await refused.json()).toMatchObject({ error: 'refused' });

    const cut = await handleAiBriefRequest(valid(), { env, clientIp: 'b', fetchImpl: upstreamOk('What the data shows\nPartial', { stop_reason: 'max_tokens' }) });
    expect(await cut.json()).toMatchObject({ truncated: true });

    resetAiBriefCache();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const down = vi.fn(async () => new Response('{"type":"error"}', { status: 529 }));
    const res = await handleAiBriefRequest(valid(), { env, clientIp: 'c', fetchImpl: down });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_error' });
  });

  it('rate-limits each IP to RATE_LIMIT_MAX model calls per hour', async () => {
    const ctx = { env: { ANTHROPIC_API_KEY: KEY }, clientIp: '203.0.113.9', fetchImpl: upstreamOk('What the data shows\nx'), now: () => T0 };
    for (const [w, d] of DISTINCT) expect((await handleAiBriefRequest(validFor(w, d), ctx)).status).toBe(200);
    const limited = await handleAiBriefRequest(validFor('watch-sinabung', 0), ctx);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited.json()).toMatchObject({ error: 'rate_limited' });
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect((await handleAiBriefRequest(validFor('watch-sinabung', 0), { ...ctx, clientIp: '203.0.113.10' })).status).toBe(200);
    const later = await handleAiBriefRequest(validFor('watch-sinabung', 1), { ...ctx, now: () => T0 + 61 * 60 * 1000 });
    expect(later.status).toBe(200);
  });

  it('checks the rate limit only after validation, so invalid requests use no quota', async () => {
    const ctx = { env: { ANTHROPIC_API_KEY: KEY }, clientIp: '203.0.113.20', fetchImpl: upstreamOk('What the data shows\nx'), now: () => T0 };
    for (let i = 0; i < RATE_LIMIT_MAX + 5; i += 1) {
      expect((await handleAiBriefRequest(req(JSON.stringify({ watchId: 'watch-merapi', dayIndex: 9 })), ctx)).status).toBe(400);
      expect((await handleAiBriefRequest(req('{}', { headers: { 'content-type': 'text/plain' } }), ctx)).status).toBe(415);
    }
    expect((await handleAiBriefRequest(valid(), ctx)).status).toBe(200);
  });

  it('caches successful summaries per data snapshot, model, watch and day for about 6 hours', async () => {
    const fetchImpl = upstreamOk('What the data shows\nOne record [E1].');
    let now = T0;
    const ctx = { env: { ANTHROPIC_API_KEY: KEY }, clientIp: '203.0.113.30', fetchImpl, now: () => now };
    const first = await handleAiBriefRequest(valid(), ctx);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-ai-brief-cache')).toBe('miss');
    expect(first.headers.get('cache-control')).toBe('public, s-maxage=21600');
    const firstBody = await first.json();

    now = T0 + 60 * 60 * 1000;
    const second = await handleAiBriefRequest(valid(), { ...ctx, clientIp: '198.51.100.7' });
    expect(second.status).toBe(200);
    expect(second.headers.get('x-ai-brief-cache')).toBe('hit');
    expect(second.headers.get('cache-control')).toBe('public, s-maxage=21600');
    expect(await second.json()).toEqual(firstBody);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Another day is another input; another model is another key.
    expect((await handleAiBriefRequest(validFor('watch-merapi', 5), ctx)).headers.get('x-ai-brief-cache')).toBe('miss');
    const opus = await handleAiBriefRequest(valid(), { ...ctx, env: { ...ctx.env, AI_BRIEF_MODEL: 'claude-opus-5-5' } });
    expect(opus.headers.get('x-ai-brief-cache')).toBe('miss');
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    // Expired after the TTL.
    expect(CACHE_TTL_MS).toBe(6 * 60 * 60 * 1000);
    now = T0 + CACHE_TTL_MS + 1;
    expect((await handleAiBriefRequest(valid(), ctx)).headers.get('x-ai-brief-cache')).toBe('miss');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('serves cache hits without using rate-limit quota and never caches failures', async () => {
    const ctx = { env: { ANTHROPIC_API_KEY: KEY }, clientIp: '203.0.113.40', fetchImpl: upstreamOk('What the data shows\nx'), now: () => T0 };
    for (let i = 0; i < RATE_LIMIT_MAX + 5; i += 1) expect((await handleAiBriefRequest(valid(), ctx)).status).toBe(200);
    expect(ctx.fetchImpl).toHaveBeenCalledTimes(1);

    const refused = upstreamOk('', { stop_reason: 'refusal' });
    const r1 = await handleAiBriefRequest(validFor('watch-semeru', 2), { ...ctx, clientIp: 'x', fetchImpl: refused });
    expect(r1.status).toBe(502);
    expect(r1.headers.get('cache-control')).toBe('no-store');
    await handleAiBriefRequest(validFor('watch-semeru', 2), { ...ctx, clientIp: 'x', fetchImpl: refused });
    expect(refused).toHaveBeenCalledTimes(2);
  });

  it('accepts GET ?watchId&dayIndex with the same validation, cache and same-site check', async () => {
    const fetchImpl = upstreamOk('What the data shows\nx [E1]');
    const ctx = { env: { ANTHROPIC_API_KEY: KEY }, clientIp: '203.0.113.50', fetchImpl, now: () => T0 };
    const get = (qs: string, headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) =>
      new Request(`${ORIGIN}/api/ai-brief?${qs}`, { method: 'GET', headers: { host: 'asean-watch.vercel.app', ...headers } });
    const ok = await handleAiBriefRequest(get('watchId=watch-merapi&dayIndex=6'), ctx);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('public, s-maxage=21600');
    expect(await ok.json()).toMatchObject({ watchId: 'watch-merapi', dayIndex: 6 });
    // Same cache as POST.
    expect((await handleAiBriefRequest(valid(), ctx)).headers.get('x-ai-brief-cache')).toBe('hit');
    expect((await handleAiBriefRequest(get('watchId=watch-merapi&dayIndex=6', { origin: ORIGIN }), ctx)).status).toBe(200);
    expect((await handleAiBriefRequest(get('watchId=watch-merapi&dayIndex=6&prompt=x'), ctx)).status).toBe(400);
    expect((await handleAiBriefRequest(get('watchId=watch-merapi&dayIndex=8'), ctx)).status).toBe(400);
    expect((await handleAiBriefRequest(get('watchId=watch-merapi&dayIndex=6', {}), ctx)).status).toBe(403);
    expect((await handleAiBriefRequest(get('watchId=watch-merapi&dayIndex=6', { 'sec-fetch-site': 'cross-site' }), ctx)).status).toBe(403);
    expect((await handleAiBriefRequest(get('watchId=watch-merapi&dayIndex=6', { origin: 'https://evil.example' }), ctx)).status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads the client IP from the platform headers', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1');
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '1.1.1.1' }))).toBe('198.51.100.2');
    expect(clientIpFrom(new Headers())).toBe('unknown');
  });
});

describe('rateLimitKey', () => {
  it('keys IPv4 by address and IPv4-mapped IPv6 by the IPv4 address', () => {
    expect(rateLimitKey('203.0.113.9')).toBe('203.0.113.9');
    expect(rateLimitKey(' 203.0.113.9 ')).toBe('203.0.113.9');
    expect(rateLimitKey('203.0.113.9:51234')).toBe('203.0.113.9');
    expect(rateLimitKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(rateLimitKey('::FFFF:203.0.113.9')).toBe('203.0.113.9');
    expect(rateLimitKey('::ffff:cb00:7109')).toBe('203.0.113.9');
    expect(rateLimitKey('0:0:0:0:0:ffff:cb00:7109')).toBe('203.0.113.9');
    expect(rateLimitKey('[::ffff:203.0.113.9]:443')).toBe('203.0.113.9');
  });

  it('keys IPv6 by its /64 prefix, whatever the spelling', () => {
    const key = '2001:db8:1:2::/64';
    for (const ip of [
      '2001:db8:1:2::1',
      '2001:db8:1:2::abcd',
      '2001:DB8:1:2:ffff:ffff:ffff:ffff',
      '2001:0db8:0001:0002:0000:0000:0000:0001',
      '[2001:db8:1:2::1]:8443',
      '2001:db8:1:2::1%eth0',
      '2001:db8:1:2:a:b:1.2.3.4',
    ]) {
      expect(rateLimitKey(ip), ip).toBe(key);
    }
    expect(rateLimitKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitKey('2001:db8::')).toBe('2001:db8:0:0::/64');
  });

  it('keys anything unparseable as given, trimmed, lower-cased and capped', () => {
    expect(rateLimitKey('')).toBe('unknown');
    expect(rateLimitKey('unknown')).toBe('unknown');
    expect(rateLimitKey('local')).toBe('local');
    expect(rateLimitKey('2001:db8::1::2')).toBe('2001:db8::1::2');
    expect(rateLimitKey('1:2:3:4:5:6:7:8:9')).toBe('1:2:3:4:5:6:7:8:9');
    expect(rateLimitKey('999.1.1.1')).toBe('999.1.1.1');
    expect(rateLimitKey('X'.repeat(200))).toBe('x'.repeat(64));
  });
});

describe('handleAiBriefRequest cost controls', () => {
  const env = { ANTHROPIC_API_KEY: KEY };

  it('rate-limits a whole IPv6 /64 as one client', async () => {
    const fetchImpl = upstreamOk('What the data shows\nx');
    let i = 0;
    for (const [w, d] of DISTINCT) {
      i += 1;
      const res = await handleAiBriefRequest(validFor(w, d), { env, clientIp: `2001:db8:1:2::${i.toString(16)}`, fetchImpl, now: () => T0 });
      expect(res.status).toBe(200);
    }
    const sameSlash64 = await handleAiBriefRequest(validFor('watch-sinabung', 0), { env, clientIp: '2001:db8:1:2:ffff::1', fetchImpl, now: () => T0 });
    expect(sameSlash64.status).toBe(429);
    const otherSlash64 = await handleAiBriefRequest(validFor('watch-sinabung', 0), { env, clientIp: '2001:db8:1:3::1', fetchImpl, now: () => T0 });
    expect(otherSlash64.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(RATE_LIMIT_MAX + 1);
  });

  it('counts IPv4-mapped IPv6 and plain IPv4 for the same address together', async () => {
    const fetchImpl = upstreamOk('What the data shows\nx');
    for (const [w, d] of DISTINCT) {
      expect((await handleAiBriefRequest(validFor(w, d), { env, clientIp: '::ffff:198.51.100.20', fetchImpl, now: () => T0 })).status).toBe(200);
    }
    expect((await handleAiBriefRequest(validFor('watch-sinabung', 0), { env, clientIp: '198.51.100.20', fetchImpl, now: () => T0 })).status).toBe(429);
  });

  it('makes one paid call for many simultaneous identical misses, and shares its answer', async () => {
    const { fetchImpl, release } = gatedUpstream(okReply('What the data shows\nOne record [E1].'));
    const pending = Array.from({ length: 20 }, (_, i) =>
      handleAiBriefRequest(validFor('watch-merapi', 3), { env, clientIp: `198.51.100.${i + 1}`, fetchImpl, now: () => T0 }),
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    release();
    const responses = await Promise.all(pending);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(responses.map((r) => r.status)).toEqual(new Array(20).fill(200));
    const tags = responses.map((r) => r.headers.get('x-ai-brief-cache'));
    expect(tags.filter((t) => t === 'miss')).toHaveLength(1);
    expect(tags.filter((t) => t === 'shared')).toHaveLength(19);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    for (const b of bodies) expect(b).toEqual(bodies[0]);
    expect(bodies[0]).toMatchObject({ watchId: 'watch-merapi', dayIndex: 3, truncated: false });

    // Once it lands, the answer is in the cache: no further call.
    const after = await handleAiBriefRequest(validFor('watch-merapi', 3), { env, clientIp: '198.51.100.99', fetchImpl, now: () => T0 });
    expect(after.headers.get('x-ai-brief-cache')).toBe('hit');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shares a failed in-flight call too, then lets the next request try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fetchImpl, release } = gatedUpstream(() => new Response('{"type":"error"}', { status: 529 }));
    const pending = Array.from({ length: 5 }, (_, i) =>
      handleAiBriefRequest(validFor('watch-semeru', 1), { env, clientIp: `203.0.113.${i + 1}`, fetchImpl, now: () => T0 }),
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    release();
    const responses = await Promise.all(pending);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const r of responses) {
      expect(r.status).toBe(502);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toMatchObject({ error: 'upstream_error' });
    }
    // Failures are not cached and the in-flight entry is gone.
    await handleAiBriefRequest(validFor('watch-semeru', 1), { env, clientIp: '203.0.113.50', fetchImpl, now: () => T0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('lets a client whose quota is used up join a call already in flight, at no cost', async () => {
    const busy = upstreamOk('What the data shows\nx');
    for (const [w, d] of DISTINCT) {
      expect((await handleAiBriefRequest(validFor(w, d), { env, clientIp: '192.0.2.7', fetchImpl: busy, now: () => T0 })).status).toBe(200);
    }
    const { fetchImpl, release } = gatedUpstream(okReply('What the data shows\nShared [E1].'));
    const leader = handleAiBriefRequest(validFor('watch-sinabung', 4), { env, clientIp: '192.0.2.8', fetchImpl, now: () => T0 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const follower = handleAiBriefRequest(validFor('watch-sinabung', 4), { env, clientIp: '192.0.2.7', fetchImpl, now: () => T0 });
    release();
    const [a, b] = await Promise.all([leader, follower]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers.get('x-ai-brief-cache')).toBe('shared');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // A new paid call for that client is still refused.
    expect((await handleAiBriefRequest(validFor('watch-sinabung', 5), { env, clientIp: '192.0.2.7', fetchImpl, now: () => T0 })).status).toBe(429);
  });

  it('serves repeats of a cut-off answer from a short cache, still marked truncated, then asks again', async () => {
    let now = T0;
    let stop = 'max_tokens';
    const fetchImpl = vi.fn(async () => okReply('What the data shows\nPartial [E1]', { stop_reason: stop })());
    const ask = (ip: string) => handleAiBriefRequest(validFor('watch-semeru', 6), { env, clientIp: ip, fetchImpl, now: () => now });
    const shortCache = `public, s-maxage=${TRUNCATED_CACHE_TTL_MS / 1000}`;

    const first = await ask('198.51.100.1');
    expect(first.headers.get('x-ai-brief-cache')).toBe('miss');
    expect(first.headers.get('cache-control')).toBe(shortCache);
    expect(await first.json()).toMatchObject({ truncated: true });
    for (let i = 2; i <= 5; i += 1) {
      now = T0 + i * 60 * 1000;
      const again = await ask(`198.51.100.${i}`);
      expect(again.headers.get('x-ai-brief-cache')).toBe('hit');
      expect(again.headers.get('cache-control')).toBe(shortCache);
      expect(await again.json()).toMatchObject({ truncated: true });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // After the short window it asks again; a complete answer then gets the normal 6-hour cache.
    expect(TRUNCATED_CACHE_TTL_MS).toBeLessThan(CACHE_TTL_MS);
    now = T0 + TRUNCATED_CACHE_TTL_MS + 1;
    stop = 'end_turn';
    const fresh = await ask('198.51.100.6');
    expect(fresh.headers.get('x-ai-brief-cache')).toBe('miss');
    expect(fresh.headers.get('cache-control')).toBe(`public, s-maxage=${CACHE_TTL_MS / 1000}`);
    expect(await fresh.json()).toMatchObject({ truncated: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 60 * 60 * 1000;
    const later = await ask('198.51.100.7');
    expect(later.headers.get('x-ai-brief-cache')).toBe('hit');
    expect(await later.json()).toMatchObject({ truncated: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never puts the key in a response or a log line', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const responses = [
      await handleAiBriefRequest(validFor('watch-merapi', 0), { env, clientIp: 'a', fetchImpl: vi.fn(async () => new Response('{}', { status: 401 })) }),
      await handleAiBriefRequest(validFor('watch-merapi', 1), {
        env,
        clientIp: 'a',
        fetchImpl: vi.fn(async () => Promise.reject(new TypeError(`bad header ${KEY}`))),
      }),
      await handleAiBriefRequest(validFor('watch-merapi', 2), { env, clientIp: 'a', fetchImpl: upstreamOk('What the data shows\nx') }),
    ];
    for (const r of responses) expect(await r.text()).not.toContain(KEY);
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) expect(line).not.toContain(KEY);
  });
});

describe('handleAiBriefRequest error messages', () => {
  const env = { ANTHROPIC_API_KEY: KEY };
  function captureLog(): string[] {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    return logged;
  }

  it('answers upstream HTTP errors with a fixed message and logs the detail without the key', async () => {
    const logged = captureLog();
    const cases: Array<[number, string]> = [
      [401, AI_BRIEF_ERROR_MESSAGES.upstream],
      [400, AI_BRIEF_ERROR_MESSAGES.upstream],
      [403, AI_BRIEF_ERROR_MESSAGES.upstream],
      [500, AI_BRIEF_ERROR_MESSAGES.upstream],
      [429, AI_BRIEF_ERROR_MESSAGES.busy],
      [529, AI_BRIEF_ERROR_MESSAGES.busy],
    ];
    for (const [status, expected] of cases) {
      resetAiBriefCache();
      const upstreamBody = JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: `invalid x-api-key ${KEY} (billing state: overdue)` },
      });
      const fetchImpl = vi.fn(async () => new Response(upstreamBody, { status, headers: { 'request-id': 'req_011CTest' } }));
      const res = await handleAiBriefRequest(valid(), { env, clientIp: `198.51.100.${status % 250}`, fetchImpl });
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: 'upstream_error', message: expected });
      for (const leak of [String(status), 'authentication_error', 'billing', 'x-api-key', 'req_011CTest', KEY]) {
        expect(text).not.toContain(leak);
      }
    }
    const line = logged.find((l) => l.includes('upstream HTTP 401'));
    expect(line).toContain('authentication_error: invalid x-api-key [redacted] (billing state: overdue)');
    expect(line).toContain('request-id req_011CTest');
    for (const l of logged) expect(l).not.toContain(KEY);
  });

  it('answers network failures and internal errors with fixed messages; the exception text stays in the log', async () => {
    const logged = captureLog();
    const net = await handleAiBriefRequest(valid(), {
      env,
      clientIp: 'a',
      fetchImpl: vi.fn(async () => Promise.reject(new TypeError('fetch failed: getaddrinfo ENOTFOUND api.anthropic.com'))),
    });
    expect(await net.json()).toEqual({ error: 'upstream_error', message: AI_BRIEF_ERROR_MESSAGES.unreachable });
    expect(logged.join('\n')).toContain('TypeError: fetch failed: getaddrinfo ENOTFOUND api.anthropic.com');

    const notJson = await handleAiBriefRequest(validFor('watch-merapi', 5), {
      env,
      clientIp: 'a',
      fetchImpl: vi.fn(async () => new Response('<html>proxy error</html>', { status: 200 })),
    });
    expect(notJson.status).toBe(500);
    const body = await notJson.json();
    expect(body).toEqual({ error: 'internal_error', message: AI_BRIEF_ERROR_MESSAGES.internal });
    expect(logged.some((l) => l.startsWith('ai-brief: internal error: SyntaxError'))).toBe(true);
  });

  it('redacts the key and Anthropic-shaped keys from log text', () => {
    expect(redactForLog(`a ${KEY} b ${KEY}`, ` ${KEY} `)).toBe('a [redacted] b [redacted]');
    expect(redactForLog('key sk-ant-api03-AbC_d-9 here')).toBe('key [redacted] here');
    expect(redactForLog('two\nlines')).toBe('two lines');
    expect(redactForLog('x'.repeat(2000))).toHaveLength(500);
  });
});
