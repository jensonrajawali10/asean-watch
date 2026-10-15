import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPtwcProxyState } from '../lib/ptwcProxy';
import { PTWC_UNAVAILABLE_MESSAGE, clientIpFrom, handlePtwcRequest } from './ptwcHandler';

const ATOM = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>PTWC</title></feed>';
const req = () => new Request('https://aw.example/api/ptwc', { headers: { host: 'aw.example', 'sec-fetch-site': 'same-origin' } });

function captureLog(): string[] {
  const logged: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
  return logged;
}

beforeEach(() => resetPtwcProxyState());
afterEach(() => vi.restoreAllMocks());

describe('handlePtwcRequest (server entry)', () => {
  it('answers an upstream HTTP error with a fixed message and logs the detail', async () => {
    const logged = captureLog();
    const down = vi.fn(async () => new Response('Service Unavailable', { status: 503 }));
    const res = await handlePtwcRequest(req(), { clientIp: '198.51.100.1', fetchImpl: down });
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'upstream_unavailable', message: PTWC_UNAVAILABLE_MESSAGE });
    expect(text).not.toContain('503');
    expect(logged).toEqual(['ptwc: HTTP 502 upstream_unavailable: upstream HTTP 503']);
  });

  it('does not echo network or timeout error text', async () => {
    const logged = captureLog();
    for (const err of [
      new TypeError('fetch failed: getaddrinfo ENOTFOUND www.tsunami.gov'),
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    ]) {
      resetPtwcProxyState();
      const res = await handlePtwcRequest(req(), { clientIp: '198.51.100.2', fetchImpl: vi.fn(async () => Promise.reject(err)) });
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: 'upstream_unavailable', message: PTWC_UNAVAILABLE_MESSAGE });
      expect(text).not.toMatch(/ENOTFOUND|getaddrinfo|aborted|timeout/i);
    }
    expect(logged[0]).toContain('getaddrinfo ENOTFOUND www.tsunami.gov');
    expect(logged[1]).toContain('aborted due to timeout');
  });

  it('passes successes and client errors through unchanged', async () => {
    const ok = vi.fn(async () => new Response(ATOM, { status: 200 }));
    const res = await handlePtwcRequest(req(), { clientIp: '198.51.100.3', fetchImpl: ok, now: () => 1000 });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=60');
    expect(await res.json()).toMatchObject({ atom: ATOM, capUrl: null, cap: null });

    const params = await handlePtwcRequest(new Request('https://aw.example/api/ptwc?url=x'), { clientIp: 'a', fetchImpl: ok });
    expect(params.status).toBe(400);
    expect(await params.json()).toEqual({ error: 'bad_request', message: 'This endpoint takes no parameters.' });
  });

  it('re-exports the client IP helper used by api/ptwc.ts', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }))).toBe('198.51.100.9');
  });
});
