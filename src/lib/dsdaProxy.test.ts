import { beforeEach, describe, expect, it } from 'vitest';
import { DSDA_REASON_TEXT, DSDA_XML_URL } from './dsdaRelay';
import {
  DSDA_FAILURE_CACHE_MS,
  DSDA_RATE_LIMIT_MAX,
  DSDA_UPSTREAM_CACHE_MS,
  classifyDsdaError,
  handleDsdaRequest,
  resetDsdaProxyState,
} from './dsdaProxy';

const XML = '<?xml version="1.0"?><NewDataSet><SP_GET_LAST_STATUS_PINTU_AIR><NAMA_PINTU_AIR>Manggarai</NAMA_PINTU_AIR></SP_GET_LAST_STATUS_PINTU_AIR></NewDataSet>';
const T0 = Date.parse('2026-10-21T12:00:00Z');

function req(path = '/api/dsda', init: RequestInit = {}): Request {
  return new Request(`https://asean-watch.vercel.app${path}`, { headers: { host: 'asean-watch.vercel.app' }, ...init });
}

/** Node's fetch on DSDA today: a TypeError whose cause carries the OpenSSL code. */
function certFailure(): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) });
}

function upstream(reply: () => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return reply();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('GET /api/dsda (Jakarta DSDA floodgate relay)', () => {
  let clock = T0;
  const now = () => clock;
  const logs: string[] = [];
  const ctx = (fetchImpl: typeof fetch) => ({ clientIp: '203.0.113.9', fetchImpl, now, log: (l: string) => logs.push(l) });
  beforeEach(() => {
    resetDsdaProxyState();
    clock = T0;
    logs.length = 0;
  });

  it('fetches only the fixed DSDA URL, with TLS verification left to the runtime and no redirects', async () => {
    const up = upstream(async () => new Response(XML, { status: 200 }));
    const res = await handleDsdaRequest(req(), ctx(up.fn));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true, url: DSDA_XML_URL, retrievedAt: '2026-10-21T12:00:00Z', xml: XML });
    expect(up.calls).toHaveLength(1);
    expect(up.calls[0].url).toBe(DSDA_XML_URL);
    expect(up.calls[0].init?.redirect).toBe('error');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
  });

  it('reuses a live copy for 5 minutes, then fetches again', async () => {
    const up = upstream(async () => new Response(XML, { status: 200 }));
    await handleDsdaRequest(req(), ctx(up.fn));
    clock = T0 + DSDA_UPSTREAM_CACHE_MS - 1000;
    const again = await handleDsdaRequest(req(), ctx(up.fn));
    expect(up.calls).toHaveLength(1);
    expect(again.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=30');
    clock = T0 + DSDA_UPSTREAM_CACHE_MS;
    await handleDsdaRequest(req(), ctx(up.fn));
    expect(up.calls).toHaveLength(2);
  });

  it('answers 200 { available: false, reason: "certificate" } while the certificate is untrusted, and backs off 15 minutes', async () => {
    const up = upstream(async () => {
      throw certFailure();
    });
    const res = await handleDsdaRequest(req(), ctx(up.fn));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ available: false, url: DSDA_XML_URL, checkedAt: '2026-10-21T12:00:00Z', reason: 'certificate', message: DSDA_REASON_TEXT.certificate });
    // The upstream detail goes to the server log only.
    expect(JSON.stringify(body)).not.toContain('UNABLE_TO_VERIFY');
    expect(logs.join('\n')).toContain('dsda: certificate: TypeError: fetch failed');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=900');
    clock = T0 + DSDA_FAILURE_CACHE_MS - 1;
    await handleDsdaRequest(req(), ctx(up.fn));
    expect(up.calls).toHaveLength(1);
    clock = T0 + DSDA_FAILURE_CACHE_MS;
    await handleDsdaRequest(req(), ctx(up.fn));
    expect(up.calls).toHaveLength(2);
  });

  it('classifies the other failures with fixed reasons', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [async () => new Response('oops', { status: 503 }), 'upstream_http'],
      [async () => new Response('<html>maintenance</html>', { status: 200 }), 'not_floodgate_xml'],
      [async () => Promise.reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), 'timeout'],
      [async () => Promise.reject(new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) })), 'network'],
    ];
    for (const [reply, reason] of cases) {
      resetDsdaProxyState();
      const body = (await (await handleDsdaRequest(req(), ctx(upstream(reply).fn))).json()) as { available: boolean; reason: string };
      expect(body).toMatchObject({ available: false, reason });
    }
    expect(classifyDsdaError(Object.assign(new Error('x'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }))).toBe('certificate');
    expect(classifyDsdaError(Object.assign(new Error('x'), { code: 'CERT_HAS_EXPIRED' }))).toBe('certificate');
    expect(classifyDsdaError(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }))).toBe('certificate');
  });

  it('refuses parameters, other methods and cross-site requests, and rate-limits per IP', async () => {
    const up = upstream(async () => new Response(XML, { status: 200 }));
    expect((await handleDsdaRequest(req('/api/dsda?url=https://evil.example/'), ctx(up.fn))).status).toBe(400);
    expect((await handleDsdaRequest(req('/api/dsda', { method: 'POST' }), ctx(up.fn))).status).toBe(405);
    const cross = req('/api/dsda', { headers: { host: 'asean-watch.vercel.app', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    expect((await handleDsdaRequest(cross, ctx(up.fn))).status).toBe(403);
    expect(up.calls).toHaveLength(0);
    for (let i = 0; i < DSDA_RATE_LIMIT_MAX; i++) expect((await handleDsdaRequest(req(), ctx(up.fn))).status).toBe(200);
    const limited = await handleDsdaRequest(req(), ctx(up.fn));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });
});
