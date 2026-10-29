import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WarningFeedStatus } from '../types';
import { loadAqSnapshot } from './airQuality';
import type { AirQualityData } from './airQuality';
import { loadAshWindSnapshot } from './ashDrift';
import { loadFireSnapshot } from './fires';
import { loadFixtures } from './fixtures';
import { bundledFloodSnapshot, loadFloodModelSnapshot } from './floodModel';
import { loadNeaSnapshot } from './nea';
import { loadPtwcSnapshot } from './ptwc';
import { bundledQuakesSnapshot, loadQuakesSnapshot } from './quakesLive';
import { firesSummaryFromSnapshot, headline, situationReport } from './situation';
import type { SituationInput } from './situation';
import { buildSourceCatalogue, olderThanExpected } from './sourceCatalogue';
import {
  FUTURE_TOLERANCE_MS,
  UPDATE_INTERVALS,
  ageWords,
  checkAge,
  feedAge,
  intervalById,
  intervalForSource,
  okSentence,
  olderSentence,
  staleAfterMs,
  trackFeedAnswers,
} from './staleness';
import type { UpdateInterval } from './staleness';
import { loadWarningsSnapshot } from './warnings';
import { loadWindSnapshot } from './windField';

const MIN = 60_000;
const H = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
const rule = (id: string): UpdateInterval => {
  const r = intervalById(id);
  if (!r) throw new Error(`no interval ${id}`);
  return r;
};

/** Words a stale or quiet notice must never use: no all-clear, no "now" for a copy, no banned copy words. */
const BANNED = /all[\s-]clear|no warnings|\bnow\b|real-time|just now|\bsafe\b|nothing to report/i;

describe('UPDATE_INTERVALS (the documented table)', () => {
  it('has unique ids and complete, positive rows', () => {
    expect(new Set(UPDATE_INTERVALS.map((r) => r.id)).size).toBe(UPDATE_INTERVALS.length);
    for (const r of UPDATE_INTERVALS) {
      expect(r.everyMs, r.id).toBeGreaterThan(0);
      expect(r.graceMs, r.id).toBeGreaterThanOrEqual(0);
      expect(r.source.length, r.id).toBeGreaterThan(5);
      expect(r.usually.length, r.id).toBeGreaterThan(3);
      expect(r.clock.length, r.id).toBeGreaterThan(5);
      expect(r.why.length, r.id).toBeGreaterThan(20);
      if (r.docUrl !== null) expect(r.docUrl, r.id).toMatch(/^https:\/\//);
      expect(['data', 'feed', 'copy']).toContain(r.kind);
    }
  });

  it('flags after the interval plus its allowance', () => {
    expect(staleAfterMs(rule('nea-haze'))).toBe(2 * H);
    expect(staleAfterMs(rule('official-feed'))).toBe(H);
    expect(staleAfterMs(rule('fires-relay'))).toBe(4.5 * H);
    expect(staleAfterMs(rule('watch-relay'))).toBe(4.5 * H);
    expect(staleAfterMs(rule('usgs-quakes'))).toBe(H);
    expect(staleAfterMs(rule('magma-copy'))).toBe(12 * H);
  });

  it('is mirrored row for row in docs/DATA_AND_LIMITATIONS.md', () => {
    const doc = readFileSync(new URL('../../docs/DATA_AND_LIMITATIONS.md', import.meta.url), 'utf8');
    const section = doc.slice(doc.indexOf('## Expected update intervals'));
    expect(section.length).toBeGreaterThan(100);
    for (const r of UPDATE_INTERVALS) {
      const row = section.split('\n').find((line) => line.startsWith(`| \`${r.id}\``));
      expect(row, `doc row for ${r.id}`).toBeDefined();
      expect(row).toContain(r.usually);
      if (r.docUrl) expect(row).toContain(r.docUrl);
    }
  });

  it('maps every Sources entry with a time to an interval, or says why not', () => {
    const fx = loadFixtures();
    const ws = loadWarningsSnapshot();
    const cat = buildSourceCatalogue({
      airQuality: null,
      wind10m: null,
      wind925: null,
      hotspotSnapshot: fx.snapshot,
      nea: loadNeaSnapshot(),
      warningFeeds: [...ws.feeds, loadPtwcSnapshot().status],
      fires: firesSummaryFromSnapshot(loadFireSnapshot() as NonNullable<ReturnType<typeof loadFireSnapshot>>),
      ashWind: loadAshWindSnapshot(),
    });
    // No expected update: a link, map tiles, a bundled catalogue or station list, or a browser computation.
    const none = new Set(['asmc', 'ioc-sea-level', 'trajectories', 'gibs-himawari', 'gibs-truecolour', 'nus-crisp', 'gvp', 'geoboundaries', 'natural-earth', 'basemaps']);
    for (const e of cat) {
      if (none.has(e.id)) expect(intervalForSource(e.id), e.id).toBeNull();
      else expect(intervalForSource(e.id), e.id).not.toBeNull();
    }
    expect(intervalForSource('feed:bmkg-inatews')?.id).toBe('official-feed');
    expect(intervalForSource('feed:ptwc')?.id).toBe('official-feed');
    expect(intervalForSource('feed:gdacs')?.id).toBe('official-feed');
    expect(intervalForSource('feed:magma-level-list')?.id).toBe('magma-copy');
    expect(intervalForSource('quakes:bmkg-gempaterkini')?.id).toBe('bmkg-quakes');
    expect(intervalForSource('quakes:usgs-quakes')?.id).toBe('usgs-quakes');
    expect(intervalForSource('firms:firms-viirs-snpp')?.id).toBe('watch-relay');
    expect(intervalForSource('something-new')).toBeNull();
  });
});

describe('ageWords', () => {
  it('rounds down to whole units so it never overstates', () => {
    expect(ageWords(0)).toBe('under 1 min');
    expect(ageWords(MIN - 1)).toBe('under 1 min');
    expect(ageWords(MIN)).toBe('1 min');
    expect(ageWords(H - 1)).toBe('59 min');
    expect(ageWords(H)).toBe('1 h');
    expect(ageWords(9 * H + 59 * MIN)).toBe('9 h');
    expect(ageWords(48 * H - 1)).toBe('47 h');
    expect(ageWords(48 * H)).toBe('2 days');
    expect(ageWords(Number.NaN)).toBe('under 1 min');
  });
});

describe('checkAge: the boundaries', () => {
  const nea = rule('nea-haze');
  const now = Date.parse('2026-10-30T12:00:00Z');
  const at = (ageMs: number) => iso(now - ageMs);

  it('is fine up to and including interval + allowance, older one millisecond after', () => {
    expect(checkAge(nea, at(0), now)?.state).toBe('ok');
    expect(checkAge(nea, at(H), now)?.state).toBe('ok');
    expect(checkAge(nea, at(2 * H), now)?.state).toBe('ok');
    const justPast = checkAge(nea, new Date(now - 2 * H - 1).toISOString(), now);
    expect(justPast?.state).toBe('older');
    expect(justPast?.ageMs).toBe(2 * H + 1);
  });

  it('reads a time a little ahead of the page clock as age 0, and refuses to judge one far ahead', () => {
    expect(checkAge(nea, iso(now + FUTURE_TOLERANCE_MS), now)).toMatchObject({ state: 'ok', ageMs: 0 });
    expect(checkAge(nea, new Date(now + FUTURE_TOLERANCE_MS + 1).toISOString(), now)).toBeNull();
  });

  it('judges nothing without a page clock, a time or a parseable time', () => {
    expect(checkAge(nea, at(10 * H), undefined)).toBeNull();
    expect(checkAge(nea, at(10 * H), null)).toBeNull();
    expect(checkAge(nea, at(10 * H), Number.NaN)).toBeNull();
    expect(checkAge(nea, null, now)).toBeNull();
    expect(checkAge(nea, 'not a time', now)).toBeNull();
    expect(checkAge(null, at(10 * H), now)).toBeNull();
  });

  it('holds a quiet feed as "checking" while the page asks it again; data ignores the flag', () => {
    const feed = rule('official-feed');
    expect(checkAge(feed, at(3 * H), now, { checking: true })?.state).toBe('checking');
    expect(checkAge(feed, at(3 * H), now, { checking: false })?.state).toBe('older');
    expect(checkAge(feed, at(10 * MIN), now, { checking: true })?.state).toBe('ok');
    expect(checkAge(nea, at(3 * H), now, { checking: true })?.state).toBe('older');
  });
});

describe('wording', () => {
  it('says how old the data is and how often it usually updates', () => {
    expect(olderSentence(rule('nea-haze'), 9 * H)).toBe('Older than expected: last update 9 h ago, usually hourly.');
    expect(olderSentence(rule('fires-relay'), 3 * 24 * H)).toBe('Older than expected: last update 3 days ago, usually every 3 h.');
    expect(okSentence(rule('nea-haze'), 20 * MIN)).toBe('Last update 20 min ago; usually hourly.');
  });

  it('calls a feed quiet, says messages may be missing and sends people to the issuer', () => {
    expect(olderSentence(rule('official-feed'), 3 * H, 'BMKG')).toBe(
      'Feed quiet for 3 h: no update has reached this page, so messages may be missing. Check BMKG directly.',
    );
    expect(okSentence(rule('official-feed'), 2 * MIN)).toBe('Feed answered 2 min ago; this page asks every 5 min.');
  });

  it('sends people to the issuer for an old recorded copy', () => {
    expect(olderSentence(rule('magma-copy'), 3 * 24 * H, 'PVMBG MAGMA Indonesia')).toBe(
      'Older than expected: recorded 3 days ago, usually updated every 6 h. Check PVMBG MAGMA Indonesia directly.',
    );
  });

  it('never words a stale or quiet source as an all-clear or as current', () => {
    for (const r of UPDATE_INTERVALS) {
      for (const age of [0, 30 * MIN, 5 * H, 4 * 24 * H]) {
        expect(olderSentence(r, age, 'BMKG'), r.id).not.toMatch(BANNED);
        expect(okSentence(r, age), r.id).not.toMatch(BANNED);
      }
    }
  });

  it('gives a short form for chips', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    expect(checkAge(rule('cams-pm25'), iso(now - 16 * H), now)?.short).toBe('Older than expected · 16 h');
    expect(checkAge(rule('official-feed'), iso(now - 2 * H), now)?.short).toBe('Feed quiet · 2 h');
  });
});

describe('trackFeedAnswers and feedAge', () => {
  const base: WarningFeedStatus = { feedId: 'bmkg-inatews', issuer: 'BMKG', issuerUrl: 'https://www.bmkg.go.id/', status: 'live', retrievedAt: '2026-10-30T11:55:00Z', message: null };
  const now = Date.parse('2026-10-30T12:00:00Z');

  it('keeps the newest live answer when a later refresh falls back to the snapshot', () => {
    const first = trackFeedAnswers([base], {});
    expect(first.feeds[0].lastAnswerAt).toBe('2026-10-30T11:55:00Z');
    const fallback = trackFeedAnswers([{ ...base, status: 'snapshot', retrievedAt: '2026-10-27T07:10:00Z' }], first.known);
    expect(fallback.feeds[0].lastAnswerAt).toBe('2026-10-30T11:55:00Z');
    // An older cached copy never moves the answer back.
    const older = trackFeedAnswers([{ ...base, status: 'cached', retrievedAt: '2026-10-30T11:00:00Z' }], fallback.known);
    expect(older.feeds[0].lastAnswerAt).toBe('2026-10-30T11:55:00Z');
  });

  it('sets nothing for a feed that has not answered live', () => {
    const t = trackFeedAnswers([{ ...base, status: 'snapshot', retrievedAt: '2026-10-27T07:10:00Z' }], {});
    expect(t.feeds[0].lastAnswerAt).toBeUndefined();
    expect(t.known).toEqual({});
  });

  it('counts quiet from the last answer, not from the snapshot shown after one failed refresh', () => {
    const afterFailure: WarningFeedStatus = { ...base, status: 'snapshot', retrievedAt: '2026-10-27T07:10:00Z', lastAnswerAt: '2026-10-30T11:55:00Z' };
    expect(feedAge(afterFailure, now)?.state).toBe('ok');
    const neverAnswered: WarningFeedStatus = { ...base, status: 'snapshot', retrievedAt: '2026-10-27T07:10:00Z' };
    const quiet = feedAge(neverAnswered, now);
    expect(quiet?.state).toBe('older');
    expect(quiet?.text).toBe('Feed quiet for 3 days: no update has reached this page, so messages may be missing. Check BMKG directly.');
    expect(feedAge(neverAnswered, now, true)?.state).toBe('checking');
  });

  it('leaves an unavailable feed to its own "Official feed unavailable" sentence', () => {
    expect(feedAge({ ...base, status: 'unavailable', retrievedAt: null }, now)).toBeNull();
  });
});

describe('in the Sources catalogue and the Overview', () => {
  const fx = loadFixtures();
  const ws = loadWarningsSnapshot();
  const nea = loadNeaSnapshot();
  const neaReading = nea?.haze?.observedAt ?? nea?.observedAt ?? '';

  it('flags NEA by its own reading time, in plain words', () => {
    const now = Date.parse(neaReading) + 9 * H + 5 * MIN;
    const cat = buildSourceCatalogue({ airQuality: null, nea, nowMs: now });
    const e = cat.find((x) => x.id === 'nea');
    expect(e?.age?.state).toBe('older');
    expect(e?.age?.text).toBe('Older than expected: last update 9 h ago, usually hourly.');
    expect(olderThanExpected(cat).map((x) => x.id)).toContain('nea');
  });

  it('judges nothing without the page clock', () => {
    const cat = buildSourceCatalogue({ airQuality: null, nea, warningFeeds: ws.feeds, hotspotSnapshot: fx.snapshot });
    expect(cat.every((e) => !e.age)).toBe(true);
  });

  it('calls a never-answered official feed quiet, but not while the page is asking it again', () => {
    const feed = ws.feeds.find((f) => f.feedId === 'bmkg-inatews');
    if (!feed?.retrievedAt) throw new Error('bundled BMKG feed missing');
    const now = Date.parse(feed.retrievedAt) + 30 * H;
    const quiet = buildSourceCatalogue({ airQuality: null, warningFeeds: [feed], nowMs: now }).find((e) => e.id === 'feed:bmkg-inatews');
    expect(quiet?.age?.state).toBe('older');
    expect(quiet?.age?.text).toMatch(/^Feed quiet for 30 h: .* Check BMKG\b.* directly\.$/);
    const checking = buildSourceCatalogue({ airQuality: null, warningFeeds: [feed], nowMs: now, warningFeedsChecking: true }).find((e) => e.id === 'feed:bmkg-inatews');
    expect(checking?.age?.state).toBe('checking');
  });

  it('dates the regional fire view by its build time, not the newest detection', async () => {
    const snap = loadFireSnapshot();
    if (!snap) throw new Error('bundled fire snapshot missing');
    const fires = firesSummaryFromSnapshot(snap);
    expect(fires.retrievedAt).toBe(snap.retrievedAt);
    // 2 h after the build: fine, although the all-sensor reference time is older than 4.5 h.
    const now = Date.parse(snap.retrievedAt) + 2 * H;
    expect(now - Date.parse(snap.reference)).toBeGreaterThan(4.5 * H);
    const e = buildSourceCatalogue({ airQuality: null, fires, nowMs: now }).find((x) => x.id === 'fires');
    expect(e?.age?.state).toBe('ok');
  });

  it('adds the sentence to the Overview freshness lines and lists quiet feeds one by one', async () => {
    const aq = (await loadAqSnapshot()) as AirQualityData;
    const flood = loadFloodModelSnapshot(await bundledFloodSnapshot());
    const input: SituationInput = {
      airQuality: aq,
      wind10m: await loadWindSnapshot('10m'),
      wind925: await loadWindSnapshot('925hPa'),
      hotspotSnapshot: fx.snapshot,
      nea,
      warningFeeds: [...ws.feeds, loadPtwcSnapshot().status],
      ashWind: loadAshWindSnapshot(),
      riverFlow: flood,
      quakes: loadQuakesSnapshot(await bundledQuakesSnapshot()),
      nowMs: Date.parse(aq.retrievedAt) + 5 * 24 * H,
    };
    const r = situationReport(input);
    const cams = r.freshness.find((f) => f.source.startsWith('CAMS'));
    expect(cams?.age?.state).toBe('older');
    expect(cams?.text).toMatch(/Older than expected: last update \d+ days ago, usually every 12 h\.$/);
    const feedsLine = r.freshness.find((f) => f.source === 'Official warning feeds');
    expect(feedsLine?.text).toMatch(/feeds are quiet or older than expected \(below\)\.$/);
    const quietLines = r.freshness.filter((f) => f.basis !== 'MODELLED' && f.basis !== 'MEASURED' && f.age?.state === 'older');
    expect(quietLines.length).toBeGreaterThan(0);
    for (const q of quietLines) {
      expect(q.text).toMatch(/directly\.$/);
      expect(q.text).not.toMatch(BANNED);
    }
    const magma = r.freshness.find((f) => f.mode === 'RECORDED' && f.age);
    expect(magma?.text).toMatch(/older than expected: recorded \d+ days ago, usually updated every 6 h\. Check .* directly\.$/);
    // The same input without the page clock adds no age sentence at all.
    const plain = situationReport({ ...input, nowMs: undefined });
    expect(plain.freshness.some((f) => /Older than expected|Feed quiet/i.test(f.text))).toBe(false);
  });
});

describe('the headline and its chip', () => {
  const times = Array.from({ length: 97 }, (_, k) => iso(Date.parse('2026-10-29T00:00:00Z') + k * H));
  const aq = (retrievedAt: string, dataMode: 'live' | 'historical' = 'live'): AirQualityData => ({
    lats: [0, 1],
    lons: [100, 101],
    times,
    pm25: times.map(() => [
      [0, 0],
      [0, 0],
    ]),
    places: [{ id: 'singapore', name: 'Singapore', country: 'Singapore', lat: 1.35, lon: 103.82, pm25: times.map(() => 20) }] as AirQualityData['places'],
    source: 'Open-Meteo Air Quality API',
    sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    model: 'CAMS global',
    unit: 'µg/m³',
    retrievedAt,
    dataMode,
    attribution: 'Air quality: Open-Meteo.com (CC BY 4.0)',
  });
  const fetched = '2026-10-30T00:10:00Z';

  it('says "Now" for a live run within its interval', () => {
    const h = headline({ airQuality: aq(fetched), nowMs: Date.parse(fetched) + 2 * H });
    expect(h.text.startsWith('Now:')).toBe(true);
    expect(h.age?.state).toBe('ok');
  });

  it('stops saying "Now" once the live run is past its interval, and gives the chip sentence', () => {
    const h = headline({ airQuality: aq(fetched), nowMs: Date.parse(fetched) + 16 * H });
    expect(h.text.startsWith('Older model run, ')).toBe(true);
    expect(h.text).not.toMatch(/\bNow\b/);
    expect(h.age?.state).toBe('older');
    expect(h.age?.text).toBe('Older than expected: last update 16 h ago, usually every 12 h.');
  });

  it('titles the report haze section by the run, not "now", once it is past its interval', () => {
    const title = (hoursLater: number) =>
      situationReport({ airQuality: aq(fetched), nowMs: Date.parse(fetched) + hoursLater * H }).sections.find((s) => s.id === 'haze')?.title;
    expect(title(2)).toBe('Haze and air quality: now and the next 48 h');
    expect(title(16)).toBe("Haze and air quality: the older run's hour and the next 48 h");
  });

  it('keeps the snapshot wording for a saved copy, and flags its age too', () => {
    const h = headline({ airQuality: aq(fetched, 'historical'), nowMs: Date.parse(fetched) + 3 * 24 * H });
    expect(h.text.startsWith('Snapshot run, ')).toBe(true);
    expect(h.age?.text).toBe('Older than expected: last update 3 days ago, usually every 12 h.');
  });

  it('judges nothing without the page clock', () => {
    const h = headline({ airQuality: aq(fetched) });
    expect(h.text.startsWith('Now:')).toBe(true);
    expect(h.age).toBeNull();
  });
});
