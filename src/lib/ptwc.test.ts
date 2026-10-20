import { beforeEach, describe, expect, it } from 'vitest';
import { resetConnectorCaches } from './liveLoad';
import { loadPtwc, loadPtwcSnapshot, parsePtwc, PTWC_CLIENT_TIMEOUT_MS, PTWC_ISSUER, PTWC_NATIONAL_AUTHORITIES_NOTE } from './ptwc';
import { capUrlFromAtom, handlePtwcRequest, PTWC_UPSTREAM_BUDGET_MS, resetPtwcProxyState } from './ptwcProxy';

// Trimmed real PTWC Atom feed and CAP document (retrieved 2026-10-14; signature block removed).
const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" xmlns:georss="http://www.georss.org/georss">
    <id>urn:uuid:59ee47c7-2be5-4fa4-8b8f-6758d3980fd1</id><title>        TSUNAMI INFORMATION STATEMENT NUMBER   1        </title>
    <updated>2026-10-13T12:34:39Z</updated>
    <author>
      <name>NWS PACIFIC TSUNAMI WARNING CENTER HONOLULU HI</name>
<uri>https://www.tsunami.gov/</uri>
    </author>
<link type="application/atom+xml" rel="self" title="self" href="https://www.tsunami.gov/events/xml/PAAQAtom.xml"/>
   <entry>
    <title>CENTRAL MID-ATLANTIC RIDGE</title><updated>2026-10-13T12:34:39Z</updated>
<geo:lat>-0.196</geo:lat>
<geo:long>-19.231</geo:long>
<summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">
     <strong>Category:</strong> Information<br/><strong>Bulletin Issue Time: </strong> 2026.10.13 12:34:39 UTC <br/><strong>Preliminary Magnitude: </strong>6.8(Mwp)<br/>
 </div></summary>
    <id>urn:uuid:ab382467-73a8-4fd2-bd72-8e2e7e1d78a5</id><link rel="related" title="CapXML document" href="https://www.tsunami.gov/events/PHEB/2026/10/13/26286001/1/WECA42/PHEBCAP.xml" type="application/cap+xml" />
<link rel="alternate" title="Bulletin" href="https://www.tsunami.gov/events/PHEB/2026/10/13/26286001/1/WECA42/WECA42.txt" type="application/xml" />
</entry>
</feed>`;
const CAP = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>PHEB-1-26286001</identifier>
  <sender>ntwc@noaa.gov</sender>
  <sent>2026-10-13T12:34:39-00:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <info>
    <event>Tsunami Information</event>
    <severity>Minor</severity>
    <onset>2026-10-13T12:34:39-00:00</onset>
    <expires>2026-10-13T13:34:39-00:00</expires>
    <senderName>NWS PACIFIC TSUNAMI WARNING CENTER HONOLULU HI</senderName>
    <headline>  </headline>
    <instruction>  N/A </instruction>
    <area>
      <areaDesc>CENTRAL MID-ATLANTIC RIDGE</areaDesc>
      <circle>-0.196,-19.231 0.0</circle>
    </area>
  </info>
</alert>`;
const CAP_URL = 'https://www.tsunami.gov/events/PHEB/2026/10/13/26286001/1/WECA42/PHEBCAP.xml';
const payload = (over: Record<string, unknown> = {}) => ({
  atomUrl: 'https://www.tsunami.gov/events/xml/PHEBAtom.xml', atom: ATOM, capUrl: CAP_URL, cap: CAP, retrievedAt: '2026-10-13T12:40:00Z', ...over,
});

beforeEach(() => {
  resetConnectorCaches();
  resetPtwcProxyState();
});

describe('parsePtwc', () => {
  it('relays the PTWC product verbatim as an official tsunami message', () => {
    const { warnings, bulletinUrl, note } = parsePtwc(payload(), { dataMode: 'live', retrievedAt: '2026-10-13T12:40:00Z' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      id: 'ptwc:PHEB-1-26286001',
      issuer: PTWC_ISSUER,
      issuerUrl: 'https://www.tsunami.gov/',
      authority: 'official',
      hazard: 'tsunami',
      product: 'TSUNAMI INFORMATION STATEMENT NUMBER 1',
      level: 'Tsunami Information',
      headline: 'TSUNAMI INFORMATION STATEMENT NUMBER 1',
      areaDescription: 'CENTRAL MID-ATLANTIC RIDGE',
      location: { lat: -0.196, lon: -19.231 },
      issuedAt: '2026-10-13T12:34:39Z',
      expiresAt: '2026-10-13T13:34:39Z',
      ended: false,
      instruction: null,
      language: 'en',
      sourceUrl: CAP_URL,
      dataMode: 'live',
    });
    expect(bulletinUrl).toBe('https://www.tsunami.gov/events/PHEB/2026/10/13/26286001/1/WECA42/WECA42.txt');
    expect(note).toContain(PTWC_NATIONAL_AUTHORITIES_NOTE);
    expect(note).toMatch(/for national authorities/);
  });

  it('marks it ended once the CAP expiry has passed at retrieval', () => {
    const [w] = parsePtwc(payload(), { dataMode: 'historical', retrievedAt: '2026-10-14T11:47:39Z' }).warnings;
    expect(w.ended).toBe(true);
    expect(w.dataMode).toBe('historical');
  });

  it('falls back to the Atom entry when the CAP document is missing', () => {
    const [w] = parsePtwc(payload({ cap: null, capUrl: null }), { dataMode: 'live', retrievedAt: '2026-10-13T12:40:00Z' }).warnings;
    expect(w.level).toBe('Information');
    expect(w.issuedAt).toBe('2026-10-13T12:34:39Z');
    expect(w.location).toEqual({ lat: -0.196, lon: -19.231 });
    expect(w.sourceUrl).toBe('https://www.tsunami.gov/events/xml/PHEBAtom.xml');
  });

  it('rejects a non-feed payload (e.g. the SPA index.html in vite dev)', () => {
    expect(() => parsePtwc('<!doctype html>', { dataMode: 'live', retrievedAt: 'x' })).toThrow();
  });
});

describe('loadPtwc', () => {
  it('live via the same-origin proxy', async () => {
    const f = (async (url: string) => {
      expect(url).toBe('/api/ptwc');
      return new Response(JSON.stringify(payload()), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await loadPtwc({ fetchImpl: f });
    expect(r.status).toMatchObject({ feedId: 'ptwc', status: 'live', retrievedAt: '2026-10-13T12:40:00Z' });
    expect(r.warnings[0].dataMode).toBe('live');
  });

  it('HISTORICAL snapshot when the proxy is missing, then "Official feed unavailable"', async () => {
    const html = (async () => new Response('<!doctype html><html></html>', { status: 200 })) as unknown as typeof fetch;
    const r = await loadPtwc({ fetchImpl: html });
    expect(r.status.status).toBe('snapshot');
    expect(r.warnings[0].dataMode).toBe('historical');
    expect(loadPtwcSnapshot().warnings[0].issuer).toBe(PTWC_ISSUER);

    resetConnectorCaches();
    const none = await loadPtwc({ fetchImpl: html, snapshot: null });
    expect(none.warnings).toEqual([]);
    expect(none.status.status).toBe('unavailable');
    expect(none.status.message).toBe(`Official feed unavailable: check ${PTWC_ISSUER} directly`);
  });
});

describe('ptwc proxy', () => {
  it('only accepts the CAP link on www.tsunami.gov under /events/PHEB/.../PHEBCAP.xml', () => {
    expect(capUrlFromAtom(ATOM)).toBe(CAP_URL);
    const swap = (href: string) => ATOM.replace(CAP_URL, href);
    expect(capUrlFromAtom(swap('https://evil.example/events/PHEB/2026/10/13/26286001/1/WECA42/PHEBCAP.xml'))).toBeNull();
    expect(capUrlFromAtom(swap('https://www.tsunami.gov.evil.example/events/PHEB/2026/10/13/1/1/W/PHEBCAP.xml'))).toBeNull();
    expect(capUrlFromAtom(swap('https://www.tsunami.gov/events/PHEB/../../etc/passwd'))).toBeNull();
    expect(capUrlFromAtom(swap('https://www.tsunami.gov:8443/events/PHEB/2026/10/13/26286001/1/WECA42/PHEBCAP.xml'))).toBeNull();
    expect(capUrlFromAtom(swap('http://www.tsunami.gov/events/PHEB/2026/10/13/26286001/1/WECA42/PHEBCAP.xml'))).toBe(CAP_URL);
  });

  const upstream = (calls: string[]) =>
    (async (url: string) => {
      calls.push(String(url));
      return new Response(String(url).endsWith('PHEBCAP.xml') ? CAP : ATOM, { status: 200 });
    }) as unknown as typeof fetch;

  it('fetches only the fixed feed and its CAP, caches upstream, sets short cache headers', async () => {
    const calls: string[] = [];
    const req = () => new Request('https://aw.example/api/ptwc', { headers: { host: 'aw.example', 'sec-fetch-site': 'same-origin' } });
    const r = await handlePtwcRequest(req(), { clientIp: '1.1.1.1', fetchImpl: upstream(calls), now: () => 1000 });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=60');
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    const body = (await r.json()) as { capUrl: string; atom: string };
    expect(body.capUrl).toBe(CAP_URL);
    expect(calls).toEqual(['https://www.tsunami.gov/events/xml/PHEBAtom.xml', CAP_URL]);
    await handlePtwcRequest(req(), { clientIp: '1.1.1.1', fetchImpl: upstream(calls), now: () => 2000 });
    expect(calls).toHaveLength(2);
  });

  it('refuses parameters, other methods, cross-site callers and floods', async () => {
    const f = upstream([]);
    expect((await handlePtwcRequest(new Request('https://aw.example/api/ptwc?url=https://evil.example'), { clientIp: 'a', fetchImpl: f })).status).toBe(400);
    expect((await handlePtwcRequest(new Request('https://aw.example/api/ptwc', { method: 'POST' }), { clientIp: 'a', fetchImpl: f })).status).toBe(405);
    const cross = new Request('https://aw.example/api/ptwc', { headers: { host: 'aw.example', origin: 'https://evil.example' } });
    expect((await handlePtwcRequest(cross, { clientIp: 'a', fetchImpl: f })).status).toBe(403);
    const site = new Request('https://aw.example/api/ptwc', { headers: { 'sec-fetch-site': 'cross-site' } });
    expect((await handlePtwcRequest(site, { clientIp: 'a', fetchImpl: f })).status).toBe(403);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await handlePtwcRequest(new Request('https://aw.example/api/ptwc'), { clientIp: 'b', fetchImpl: f, now: () => 5000 })).status;
    expect(last).toBe(429);
  });

  it('502 when upstream fails', async () => {
    const down = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
    const r = await handlePtwcRequest(new Request('https://aw.example/api/ptwc'), { clientIp: 'c', fetchImpl: down });
    expect(r.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// Slow tsunami.gov (QC finding L3): the proxy answers within one overall budget, and the client waits
// longer than that budget, so a slow upstream during a real event is not replaced by the snapshot.

describe('ptwc timeouts', () => {
  const req = () => new Request('https://aw.example/api/ptwc', { headers: { host: 'aw.example', 'sec-fetch-site': 'same-origin' } });
  /** Upstream that answers the Atom feed after atomMs and the CAP after capMs, honouring the abort signal. */
  const slow = (atomMs: number, capMs: number, seen: { url: string; aborted: boolean }[]) =>
    ((url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const isCap = String(url).endsWith('PHEBCAP.xml');
        const rec = { url: String(url), aborted: false };
        seen.push(rec);
        const t = setTimeout(() => resolve(new Response(isCap ? CAP : ATOM, { status: 200 })), isCap ? capMs : atomMs);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          rec.aborted = true;
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        });
      })) as unknown as typeof fetch;

  it('the client waits longer than the whole proxy budget', () => {
    expect(PTWC_CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(PTWC_UPSTREAM_BUDGET_MS * 2);
  });

  it('a slow CAP is cut at the budget: the Atom entry is returned on time, CAP null', async () => {
    const seen: { url: string; aborted: boolean }[] = [];
    const budgetMs = 300;
    const t0 = Date.now();
    const r = await handlePtwcRequest(req(), { clientIp: 'a', fetchImpl: slow(100, 5000, seen), budgetMs });
    const took = Date.now() - t0;
    expect(r.status).toBe(200);
    const body = (await r.json()) as { atom: string; cap: string | null; capUrl: string | null };
    expect(body.atom).toContain('<feed');
    expect(body.cap).toBeNull();
    expect(body.capUrl).toBe(CAP_URL);
    expect(seen.find((x) => x.url === CAP_URL)?.aborted).toBe(true);
    expect(took).toBeLessThan(budgetMs + 250);
  });

  it('when the Atom feed used most of the budget, the CAP is not requested at all', async () => {
    const seen: { url: string; aborted: boolean }[] = [];
    const r = await handlePtwcRequest(req(), { clientIp: 'b', fetchImpl: slow(260, 10, seen), budgetMs: 300 });
    expect(r.status).toBe(200);
    expect(seen.map((x) => x.url)).toEqual(['https://www.tsunami.gov/events/xml/PHEBAtom.xml']);
  });

  it('fast upstream: both documents within the budget', async () => {
    const seen: { url: string; aborted: boolean }[] = [];
    const r = await handlePtwcRequest(req(), { clientIp: 'c', fetchImpl: slow(5, 5, seen), budgetMs: 300 });
    expect(((await r.json()) as { cap: string | null }).cap).toContain('<alert');
  });
});
