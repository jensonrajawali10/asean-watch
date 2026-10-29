import { beforeEach, describe, expect, it } from 'vitest';
import { resetConnectorCaches } from './liveLoad';
import {
  loadVaac,
  loadVaacSnapshot,
  parseVaac,
  vaaDtg,
  vaaFields,
  vaaPosition,
  vaaToWarning,
  vaaVolcano,
  VAA_AVIATION_NOTE,
  VAA_LEVEL_GLOSS,
  VAAC_TOKYO_ISSUER,
} from './vaac';
import type { VaacBuildData } from './vaacRelay';
import { VAAC_REASON_TEXT } from './vaacRelay';
import { handleVaacRequest, resetVaacProxy, VAAC_RETRY_MS, VAAC_TTL_MS } from './vaacProxy';
import { buildVaacData, extractVaaText, parseVaacList, selectRecent } from '../../scripts/lib/vaacBuild.mjs';
import { findAshAdvisory } from './volcanoOfficial';
import { officialLevelFor } from './warningsView';
import { isSoutheastAsia } from '../components/shell/alerts';
import { buildSourceCatalogue } from './sourceCatalogue';

// Real Tokyo VAAC advisories (JMA, retrieved 2026-10-30 from https://www.data.jma.go.jp/vaac/data/vaac_list.html).
const SAKURAJIMA = `FVFE01 RJTD 291145
VA ADVISORY
DTG: 20261029/1145Z
VAAC: TOKYO
VOLCANO: SAKURAJIMA (AIRA CALDERA) 282080
PSN: N3136 E13039
AREA: JAPAN
SOURCE ELEV: 1117M AMSL
ADVISORY NR: 2026/332
INFO SOURCE: JMA HIMAWARI-9
ERUPTION DETAILS: ERUPTED AT 20261029/1129Z FL110 EXTD NE
OBS VA DTG: 29/1130Z
OBS VA CLD: VA NOT IDENTIFIABLE FM SATELLITE DATA WIND FL110 240/27KT
FCST VA CLD +6 HR: NOT AVBL
FCST VA CLD +12 HR: NOT AVBL
FCST VA CLD +18 HR: NOT AVBL
RMK: WE WILL ISSUE FURTHER ADVISORY IF VA IS DETECTED IN SATELLITE
IMAGERY.
NXT ADVISORY: NO FURTHER ADVISORIES=`;
// An open series with multi-line ash clouds (trimmed: the +12 HR and RMK lines shortened).
const SHEVELUCH = `FVFE01 RJTD 160000
VA ADVISORY
DTG: 20261016/0000Z
VAAC: TOKYO
VOLCANO: SHEVELUCH 300270
PSN: N5639 E16122
AREA: RUSSIA
SOURCE ELEV: 3283M AMSL
ADVISORY NR: 2026/357
INFO SOURCE: KVERT KBGS UHPP HIMAWARI-9
ERUPTION DETAILS: POSS ERUPTION OBS AT 20261015/2220Z FL140 EXTD N
OBS VA DTG: 15/2310Z
OBS VA CLD: SFC/FL270 N6048 E15910 - N6051 E15958 - N6028 E15958 -
N6032 E15913 MOV NW 35KT SFC/FL140 N5638 E16120 - N5654 E16049 -
N5714 E16105 - N5655 E16134 MOV N 20KT
FCST VA CLD +6 HR: 16/0510Z SFC/FL290 N6235 E15958 - N6200 E15932 -
N6155 E15722 - N6155 E15445 - N6235 E15722
FCST VA CLD +18 HR: NO VA EXP
RMK: NEW VA OBS IN SATELLITE IMAGERY.
NXT ADVISORY: 20261016/0600Z=`;
const KANLAON = `FVFE01 RJTD 172226
VA ADVISORY
DTG: 20261017/2226Z
VAAC: TOKYO
VOLCANO: KANLAON 272020
PSN: N1025 E12308
AREA: PHILIPPINES
SOURCE ELEV: 2435M AMSL
ADVISORY NR: 2026/265
INFO SOURCE: HIMAWARI-9 PHIVOLCS
ERUPTION DETAILS: ERUPTION AT 20261017/2202Z FL090 EXTD SW REPORTED
NXT ADVISORY: NO FURTHER ADVISORIES=`;
// Synthetic (not a real advisory): another VAAC's text must never be relayed under JMA's licence.
const OTHER_VAAC = `VA ADVISORY
DTG: 20261029/1700Z
VAAC: DARWIN
VOLCANO: TEST VOLCANO 999991
AREA: INDONESIA
NXT ADVISORY: NO LATER THAN 20261029/2300Z=`;

const URL_SAKURAJIMA = 'https://www.data.jma.go.jp/vaac/data/TextData/2026/20261029_28208001_0332_Text.html';
const URL_SHEVELUCH = 'https://www.data.jma.go.jp/vaac/data/TextData/2026/20261016_30027000_0357_Text.html';
const URL_KANLAON = 'https://www.data.jma.go.jp/vaac/data/TextData/2026/20261017_27202000_0265_Text.html';

const NOW_29_OCT = Date.parse('2026-10-29T20:00:00Z');
const build = (advisories: VaacBuildData['advisories'], retrievedAt = '2026-10-29T20:00:00Z'): VaacBuildData => ({
  source: 'Tokyo Volcanic Ash Advisory Center (Japan Meteorological Agency)',
  licence: 'Source: Japan Meteorological Agency website',
  listUrl: 'https://www.data.jma.go.jp/vaac/data/vaac_list.html',
  retrievedAt,
  windowHours: 24,
  listRows: 245,
  listUpdated: 'Updated at 11:45 UTC, 29 October 2026',
  advisories,
});
const adv = (text: string, url: string, over: Partial<VaacBuildData['advisories'][number]> = {}) => ({
  url,
  listedAt: '2026-10-29T11:45:00Z',
  volcano: 'X',
  area: 'X',
  number: 'X',
  text,
  ...over,
});
const live = { dataMode: 'live' as const, retrievedAt: '2026-10-29T20:00:00Z' };

beforeEach(() => {
  resetConnectorCaches();
  resetVaacProxy();
});

describe('reading a VA advisory by its ICAO labels', () => {
  it('keeps every field word for word and joins continuation lines', () => {
    const f = vaaFields(SHEVELUCH);
    expect(f.VOLCANO).toBe('SHEVELUCH 300270');
    expect(f['ADVISORY NR']).toBe('2026/357');
    expect(f['OBS VA CLD']).toBe(
      'SFC/FL270 N6048 E15910 - N6051 E15958 - N6028 E15958 -\nN6032 E15913 MOV NW 35KT SFC/FL140 N5638 E16120 - N5654 E16049 -\nN5714 E16105 - N5655 E16134 MOV N 20KT',
    );
    expect(f['FCST VA CLD +18 HR']).toBe('NO VA EXP');
    expect(f['NXT ADVISORY']).toBe('20261016/0600Z=');
  });

  it('reads the DTG, position and volcano number, and refuses what does not read', () => {
    expect(vaaDtg('20261029/1145Z')).toBe('2026-10-29T11:45:00Z');
    expect(vaaDtg('20261332/1145Z')).toBeNull();
    expect(vaaDtg('29/1130Z')).toBeNull();
    expect(vaaPosition('N3136 E13039')).toEqual({ lat: 31.6, lon: 130.65 });
    expect(vaaPosition('S0732 E11027')).toEqual({ lat: -7.5333, lon: 110.45 });
    expect(vaaPosition('UNKNOWN')).toBeNull();
    expect(vaaPosition('N3175 E13039')).toBeNull();
    expect(vaaVolcano('SAKURAJIMA (AIRA CALDERA) 282080')).toEqual({ name: 'SAKURAJIMA (AIRA CALDERA)', gvp: '282080' });
    expect(vaaVolcano('UNNAMED')).toEqual({ name: 'UNNAMED', gvp: null });
  });
});

describe('vaaToWarning', () => {
  it('relays a Tokyo advisory verbatim as an official aviation advisory, never a volcano level', () => {
    const w = vaaToWarning({ text: SAKURAJIMA, url: URL_SAKURAJIMA }, live);
    expect(w).toMatchObject({
      id: 'vaac-tokyo:282080:20261029T1145Z',
      issuer: VAAC_TOKYO_ISSUER,
      issuerUrl: 'https://www.data.jma.go.jp/vaac/data/vaac_list.html',
      authority: 'official',
      hazard: 'ash',
      product: 'VA ADVISORY',
      level: 'VA ADVISORY',
      levelGloss: VAA_LEVEL_GLOSS,
      headline: 'VOLCANO: SAKURAJIMA (AIRA CALDERA) 282080',
      areaDescription: 'JAPAN',
      areas: [{ name: 'SAKURAJIMA (AIRA CALDERA)', level: null, lat: 31.6, lon: 130.65 }],
      location: { lat: 31.6, lon: 130.65 },
      issuedAt: '2026-10-29T11:45:00Z',
      expiresAt: null,
      instruction: null,
      language: 'en',
      sourceUrl: URL_SAKURAJIMA,
      dataMode: 'live',
      retrievedAt: '2026-10-29T20:00:00Z',
    });
    // The whole text, exactly as issued.
    expect(w?.text).toBe(SAKURAJIMA);
  });

  it("is ended only by the issuer's own NO FURTHER ADVISORIES", () => {
    expect(vaaToWarning({ text: SAKURAJIMA, url: URL_SAKURAJIMA }, live)?.ended).toBe(true);
    expect(vaaToWarning({ text: SHEVELUCH, url: URL_SHEVELUCH }, live)?.ended).toBe(false);
  });

  it("never relays another VAAC's text, or anything that is not a VA advisory", () => {
    expect(vaaToWarning({ text: OTHER_VAAC, url: URL_SAKURAJIMA }, live)).toBeNull();
    expect(vaaToWarning({ text: SAKURAJIMA.replace('VA ADVISORY\n', ''), url: URL_SAKURAJIMA }, live)).toBeNull();
    expect(vaaToWarning({ text: SAKURAJIMA.replace('DTG: 20261029/1145Z', 'DTG: soon'), url: URL_SAKURAJIMA }, live)).toBeNull();
  });
});

describe('parseVaac (the 24-hour window and one advisory per volcano)', () => {
  it('keeps only advisories issued in the 24 hours before the clock, newest first', () => {
    const b = build([adv(SAKURAJIMA, URL_SAKURAJIMA), adv(SHEVELUCH, URL_SHEVELUCH), adv(KANLAON, URL_KANLAON)]);
    const r = parseVaac(b, { ...live, nowMs: NOW_29_OCT });
    expect(r.warnings.map((w) => w.id)).toEqual(['vaac-tokyo:282080:20261029T1145Z']);
    const oct18 = parseVaac(b, { ...live, nowMs: Date.parse('2026-10-18T06:00:00Z') });
    expect(oct18.warnings.map((w) => w.areas[0].name)).toEqual(['KANLAON']);
    const oct16 = parseVaac(b, { ...live, nowMs: Date.parse('2026-10-16T23:59:00Z') });
    expect(oct16.warnings.map((w) => [w.areas[0].name, w.ended])).toEqual([['SHEVELUCH', false]]);
    // An old capture shows nothing current; the caller says so, never "all clear".
    expect(parseVaac(b, { ...live, nowMs: Date.parse('2026-11-05T00:00:00Z') }).warnings).toEqual([]);
  });

  it('keeps the newest advisory of a series and drops texts from anywhere but JMA', () => {
    const earlier = SAKURAJIMA.replace('DTG: 20261029/1145Z', 'DTG: 20261029/1115Z').replace('NO FURTHER ADVISORIES=', '20261029/1745Z=');
    const b = build([adv(earlier, URL_SAKURAJIMA), adv(SAKURAJIMA, URL_SAKURAJIMA), adv(SAKURAJIMA, 'https://example.org/vaa.html')]);
    const r = parseVaac(b, { ...live, nowMs: NOW_29_OCT });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].issuedAt).toBe('2026-10-29T11:45:00Z');
  });

  it('throws on something that is not a VAAC build', () => {
    expect(() => parseVaac({ advisories: 'none' }, { ...live, nowMs: NOW_29_OCT })).toThrow(/not a VAAC build/);
  });
});

describe('loadVaac (relay first, then the HISTORICAL snapshot)', () => {
  const relayAnswer = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it('relays the live build with the LIVE status', async () => {
    const r = await loadVaac({
      fetchImpl: relayAnswer({ available: true, stale: false, data: build([adv(SAKURAJIMA, URL_SAKURAJIMA)]) }),
      snapshot: null,
      nowMs: NOW_29_OCT,
    });
    expect(r.status).toMatchObject({ feedId: 'vaac-tokyo', issuer: VAAC_TOKYO_ISSUER, status: 'live', retrievedAt: '2026-10-29T20:00:00Z' });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].dataMode).toBe('live');
    expect(r.note).toContain(VAA_AVIATION_NOTE);
    expect(r.note).toMatch(/not an all-clear/);
  });

  it('falls back to the HISTORICAL snapshot with the reason when the relay is unavailable', async () => {
    const r = await loadVaac({
      fetchImpl: relayAnswer({ available: false, checkedAt: '2026-10-29T20:00:00Z', reason: 'timeout', message: VAAC_REASON_TEXT.timeout }),
      snapshot: build([adv(SAKURAJIMA, URL_SAKURAJIMA)], '2026-10-29T19:00:00Z'),
      nowMs: NOW_29_OCT,
    });
    expect(r.status.status).toBe('snapshot');
    expect(r.status.message).toContain(VAAC_REASON_TEXT.timeout);
    expect(r.status.message).toContain('HISTORICAL snapshot captured 2026-10-29T19:00:00Z');
    expect(r.warnings[0].dataMode).toBe('historical');
  });

  it('says the feed is unavailable, never "no advisories", when there is neither relay nor snapshot', async () => {
    const failing = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    const r = await loadVaac({ fetchImpl: failing, snapshot: null, nowMs: NOW_29_OCT });
    expect(r.warnings).toEqual([]);
    expect(r.status.status).toBe('unavailable');
    expect(r.status.message).toBe(`Official feed unavailable: check ${VAAC_TOKYO_ISSUER} directly`);
  });

  it('reads the bundled snapshot offline, and an old one shows no advisory as current', () => {
    const r = loadVaacSnapshot(build([adv(SAKURAJIMA, URL_SAKURAJIMA)]), Date.parse('2026-11-05T00:00:00Z'));
    expect(r.status.status).toBe('snapshot');
    expect(r.warnings).toEqual([]);
    expect(() => loadVaacSnapshot()).not.toThrow();
  });
});

describe('the Tokyo VAAC builder (scripts/lib/vaacBuild.mjs)', () => {
  // Trimmed real list rows (the first cell is the hidden UTC sort key).
  const row = (time: string, volcano: string, area: string, nr: string, path: string) =>
    `<tr class="mtx" id=tr0 style=" background-color: rgb(255,255,205);"><td style="DISPLAY: none">${time}</td><td>x</td><td>${volcano}</td><td>${area}</td><td><font size=2 color="black">${nr}</font></td>
<td id="bluelink" align="center"><a href="${path}">Text</a></td>
<td align="center">-</td>
<td id="vagi_bluelink" align="center">-</td>
<td id="vagfn_bluelink" align="center">-</td>
<td align="center">-</td>
</tr>`;
  const LIST = `<html><head><title>Tokyo VAAC | Volcanic Ash Advisories</title></head><body>
<div class="update-time">Updated at 11:45 UTC, 29 October 2026</div><table><tbody>
${row('2026/10/29 11:45:00', 'SAKURAJIMA (AIRA CALDERA)', 'JAPAN', '2026/332', 'TextData/2026/20261029_28208001_0332_Text.html')}
${row('2026/10/29 11:15:00', 'SAKURAJIMA (AIRA CALDERA)', 'JAPAN', '2026/331', 'TextData/2026/20261029_28208001_0331_Text.html')}
${row('2026/10/29 06:22:00', 'SHEVELUCH', 'RUSSIA', '2026/361', 'TextData/2026/20261029_30027000_0361_Text.html')}
${row('2026/10/17 22:26:00', 'KANLAON', 'PHILIPPINES', '2026/265', 'TextData/2026/20261017_27202000_0265_Text.html')}
${row('2026/10/29 10:00:00', 'ELSEWHERE', 'JAPAN', '2026/1', 'https://example.org/evil.html')}
</tbody></table></body></html>`;
  const textPage = (text: string) =>
    `<html><body><div class="mtx">\n\t\t<!-- VAA Text Start -->${text.split('\n').join(' <BR>')}<BR><!-- VAA Text End -->\n</div></body></html>`;

  it('reads the list rows and refuses links off the text-page pattern', () => {
    const rows = parseVaacList(LIST);
    expect(rows.map((r) => r.number)).toEqual(['2026/332', '2026/331', '2026/361', '2026/265']);
    expect(rows[0]).toEqual({
      listedAt: '2026-10-29T11:45:00Z',
      volcano: 'SAKURAJIMA (AIRA CALDERA)',
      area: 'JAPAN',
      number: '2026/332',
      path: 'TextData/2026/20261029_28208001_0332_Text.html',
    });
    const picked = selectRecent(rows, { now: NOW_29_OCT });
    expect(picked.map((r) => r.number)).toEqual(['2026/332', '2026/361']);
  });

  it('keeps the advisory text word for word (line breaks, no trailing spaces)', () => {
    expect(extractVaaText(textPage(SAKURAJIMA))).toBe(SAKURAJIMA);
    expect(() => extractVaaText('<html>no block</html>')).toThrow(/no VAA text block/);
    expect(() => extractVaaText('<!-- VAA Text Start -->hello<!-- VAA Text End -->')).toThrow(/not a VA advisory/);
  });

  it('fetches only the list and its JMA text pages, and skips any text not issued by Tokyo', async () => {
    const asked: string[] = [];
    const pages: Record<string, string> = {
      'https://www.data.jma.go.jp/vaac/data/vaac_list.html': LIST,
      'https://www.data.jma.go.jp/vaac/data/TextData/2026/20261029_28208001_0332_Text.html': textPage(SAKURAJIMA),
      'https://www.data.jma.go.jp/vaac/data/TextData/2026/20261029_30027000_0361_Text.html': textPage(OTHER_VAAC),
    };
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return pages[url] ? new Response(pages[url], { status: 200 }) : new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const data = await buildVaacData({ fetchImpl, now: NOW_29_OCT });
    expect(asked.sort()).toEqual(Object.keys(pages).sort());
    expect(data.advisories.map((a) => a.number)).toEqual(['2026/332']);
    expect(data.advisories[0].text).toBe(SAKURAJIMA);
    expect(data).toMatchObject({ retrievedAt: '2026-10-29T20:00:00Z', windowHours: 24, listRows: 4, listUpdated: 'Updated at 11:45 UTC, 29 October 2026' });
  });

  it('is all or nothing: one failed text page fails the build', async () => {
    const fetchImpl = (async (url: string) =>
      url.endsWith('vaac_list.html') ? new Response(LIST, { status: 200 }) : new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(buildVaacData({ fetchImpl, now: NOW_29_OCT })).rejects.toThrow(/HTTP 503/);
  });
});

describe('GET /api/vaac (cached relay)', () => {
  const T0 = NOW_29_OCT;
  let now = T0;
  const clock = () => now;
  const quiet = () => {};
  const req = (path = '/api/vaac', init: RequestInit = {}) =>
    new Request(`https://asean-watch.vercel.app${path}`, { headers: { host: 'asean-watch.vercel.app' }, ...init });
  function builder(reply: () => Error | null) {
    const calls: number[] = [];
    const b = (async (input: { now?: number }) => {
      calls.push(input.now ?? 0);
      const err = reply();
      if (err) throw err;
      return build([adv(SAKURAJIMA, URL_SAKURAJIMA)]);
    }) as unknown as NonNullable<Parameters<typeof handleVaacRequest>[1]['build']>;
    return { build: b, calls };
  }

  beforeEach(() => {
    now = T0;
  });

  it('answers { available, stale, data } and keeps the build for ten minutes', async () => {
    const b = builder(() => null);
    const res = await handleVaacRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(`public, max-age=300, s-maxage=${VAAC_TTL_MS / 1000}, stale-while-revalidate=3600`);
    const body = (await res.json()) as { available: boolean; data: VaacBuildData };
    expect(body.available).toBe(true);
    expect(body.data.advisories[0].text).toBe(SAKURAJIMA);
    now = T0 + VAAC_TTL_MS - 1000;
    await handleVaacRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(b.calls).toHaveLength(1);
  });

  it('answers 200 { available: false } with a fixed reason on failure, and waits before retrying', async () => {
    const b = builder(() => new Error('https://www.data.jma.go.jp/vaac/data/vaac_list.html: HTTP 503'));
    const res = await handleVaacRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(await res.json()).toMatchObject({ available: false, reason: 'upstream_http', message: VAAC_REASON_TEXT.upstream_http });
    now = T0 + VAAC_RETRY_MS - 1000;
    await handleVaacRequest(req(), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet });
    expect(b.calls).toHaveLength(1);
  });

  it('takes no parameters and refuses cross-site requests', async () => {
    const b = builder(() => null);
    expect((await handleVaacRequest(req('/api/vaac?url=https://example.org'), { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet })).status).toBe(400);
    const cross = req('/api/vaac', { headers: { host: 'asean-watch.vercel.app', origin: 'https://example.org' } });
    expect((await handleVaacRequest(cross, { clientIp: '1.1.1.1', now: clock, build: b.build, log: quiet })).status).toBe(403);
    expect(b.calls).toHaveLength(0);
  });
});

describe('where an ash advisory shows, and where it never does', () => {
  const sakurajima = vaaToWarning({ text: SAKURAJIMA, url: URL_SAKURAJIMA }, live)!;
  const kanlaon = vaaToWarning({ text: KANLAON, url: URL_KANLAON }, live)!;

  it('matches the volcano card by GVP number or name', () => {
    expect(findAshAdvisory([kanlaon, sakurajima], { volcanoId: 'gvp-282080', title: 'Sakurajima' })).toBe(sakurajima);
    expect(findAshAdvisory([kanlaon, sakurajima], { volcanoId: null, title: 'Kanlaon' })).toBe(kanlaon);
    expect(findAshAdvisory([kanlaon, sakurajima], { volcanoId: 'gvp-263250', title: 'Merapi' })).toBeNull();
  });

  it('is never taken for a volcano alert level', () => {
    const watch = { hazard: 'volcano' as const, volcanoId: 'gvp-282080', title: 'Sakurajima', lat: 31.6, lon: 130.65 };
    expect(officialLevelFor(watch, [sakurajima], NOW_29_OCT)).toBeNull();
  });

  it('is listed under Southeast Asia only when its AREA is an ASEAN country', () => {
    expect(isSoutheastAsia(kanlaon)).toBe(true);
    expect(isSoutheastAsia(sakurajima)).toBe(false);
  });

  it('puts Tokyo VAAC in Sources with its licence, and VAAC Darwin as a link only', () => {
    const r = loadVaacSnapshot(build([adv(SAKURAJIMA, URL_SAKURAJIMA)]), NOW_29_OCT);
    const entries = buildSourceCatalogue({ warningFeeds: [r.status] } as unknown as Parameters<typeof buildSourceCatalogue>[0]);
    const tokyo = entries.find((e) => e.id === 'feed:vaac-tokyo');
    expect(tokyo?.licence).toMatch(/Public Data License/);
    expect(tokyo?.mode).toBe('SNAPSHOT');
    const darwin = entries.find((e) => e.id === 'vaac-darwin');
    expect(darwin).toMatchObject({ group: 'Official', mode: 'LINK ONLY', url: 'https://www.bom.gov.au/aviation/volcanic-ash/darwin-va-advisory.shtml' });
    expect(darwin?.limitations.join(' ')).toMatch(/not an all-clear/);
  });
});
