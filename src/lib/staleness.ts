// Stale-data handling (docs/ROADMAP.md, "Reliable ingestion"): every source's expected update interval in
// one table, and the age maths and plain words that flag evidence older than that interval and official
// feeds that have gone quiet. Pure: an age is computed only against the `nowMs` the caller passes (App's
// shared page clock, useNowMs); without it nothing is judged. docs/DATA_AND_LIMITATIONS.md ("Expected
// update intervals") mirrors UPDATE_INTERVALS row for row, with the reasons and the providers' own pages.
//
// Contract (docs/CONTRACT.md): an old or quiet source is never an all-clear. The words say how old the data
// is and, for official feeds, send people to the issuer; they never say "no warnings" or "all clear", and a
// saved copy is never described as current.
import type { WarningFeedStatus } from '../types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A time this far ahead of the page clock is still read as "just now" (clocks differ a little). */
export const FUTURE_TOLERANCE_MS = 5 * MINUTE_MS;

/**
 * - `data`: measurements or model output; flagged "Older than expected".
 * - `feed`: an official (or aggregator) feed this page asks every 5 minutes; flagged "Feed quiet".
 * - `copy`: a copy recorded once from a public page that no refresh updates; flagged "Older than expected"
 *   and sent to the issuer.
 */
export type IntervalKind = 'data' | 'feed' | 'copy';

export interface UpdateInterval {
  id: string;
  /** The source, as the Sources section names it. */
  source: string;
  /** Plain words after "usually", e.g. "hourly", "every 3 h". */
  usually: string;
  /** How often a newer update is expected. */
  everyMs: number;
  /** Allowance on top of everyMs before the age is flagged (publishing delay, pass timing, caches). */
  graceMs: number;
  /** Which of the times the data carries is checked. */
  clock: string;
  /** Why this interval and this allowance, in one or two sentences. */
  why: string;
  /** The provider's own page for its update cadence; null when it publishes none. */
  docUrl: string | null;
  kind: IntervalKind;
}

/** The table. docs/DATA_AND_LIMITATIONS.md lists the same rows. */
export const UPDATE_INTERVALS: readonly UpdateInterval[] = [
  {
    id: 'nea-haze',
    source: 'NEA Singapore PSI and PM2.5 (data.gov.sg)',
    usually: 'hourly',
    everyMs: HOUR_MS,
    graceMs: HOUR_MS,
    clock: "NEA's own reading time",
    why:
      'The PSI and PM2.5 readings are hourly values: data.gov.sg updates them hourly from NEA (its feeds refresh every ' +
      '15 min). The extra hour covers a late hourly reading; this page reads NEA once per visit, so a tab left open ages too.',
    docUrl: 'https://guide.data.gov.sg/developer-guide/real-time-apis',
    kind: 'data',
  },
  {
    id: 'cams-pm25',
    source: 'CAMS PM2.5 forecast (Open-Meteo Air Quality API)',
    usually: 'every 12 h',
    everyMs: 12 * HOUR_MS,
    graceMs: 3 * HOUR_MS,
    clock: 'the time the model run was fetched from Open-Meteo',
    why:
      'CAMS runs its global forecast twice a day. A copy fetched more than 12 h ago has missed at least one run; the 3 h ' +
      "allowance covers this site's 2 h relay cache and a run that Open-Meteo publishes late.",
    docUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    kind: 'data',
  },
  {
    id: 'open-meteo-wind',
    source: 'Wind grids and summit winds (Open-Meteo Forecast API)',
    usually: 'every 6 h',
    everyMs: 6 * HOUR_MS,
    graceMs: 3 * HOUR_MS,
    clock: 'the time the model run was fetched from Open-Meteo',
    why:
      "Open-Meteo lists ECMWF IFS and GFS as updated every 6 h (ICON and JMA every 3 h) and gives no cadence for its best-match " +
      "blend, so the slower 6 h is used. The 3 h allowance covers this site's 2 h relay cache and a run published late.",
    docUrl: 'https://open-meteo.com/en/docs',
    kind: 'data',
  },
  {
    id: 'glofas',
    source: 'GloFAS river discharge (Open-Meteo Flood API)',
    usually: 'daily',
    everyMs: DAY_MS,
    graceMs: 12 * HOUR_MS,
    clock: 'the time the discharge series was fetched',
    why: "GloFAS issues one forecast a day. The 12 h allowance covers this site's 6 h relay cache and a late daily run.",
    docUrl: 'https://open-meteo.com/en/docs/flood-api',
    kind: 'data',
  },
  {
    id: 'fires-relay',
    source: 'Regional fire view (NASA FIRMS, through /api/fires)',
    usually: 'every 3 h',
    everyMs: 3 * HOUR_MS,
    graceMs: 90 * MINUTE_MS,
    clock: 'the time the relay built its copy from FIRMS',
    why:
      'The relay rebuilds from the FIRMS near-real-time files every 3 h; FIRMS makes global detections available within 3 h ' +
      'of each pass. The 90 min allowance covers the hour the CDN may keep the previous build while it rebuilds and this tab ' +
      'asking every 30 min. The newest detection is not the clock: FIRMS sees most places about twice a day, so on a working ' +
      'day it can be 12 h old.',
    docUrl: 'https://www.earthdata.nasa.gov/data/tools/firms/faq',
    kind: 'data',
  },
  {
    id: 'watch-relay',
    source: 'Watch-area evidence (FIRMS, USGS and BMKG, through /api/watch)',
    usually: 'every 3 h',
    everyMs: 3 * HOUR_MS,
    graceMs: 90 * MINUTE_MS,
    clock: 'the time the relay built its copy',
    why: 'Same relay cadence and allowance as the regional fire view (the two relays share src/lib/buildRelay.ts).',
    docUrl: 'https://www.earthdata.nasa.gov/data/tools/firms/faq',
    kind: 'data',
  },
  {
    id: 'usgs-quakes',
    source: 'USGS earthquakes (FDSN event service)',
    usually: 'every minute',
    everyMs: MINUTE_MS,
    graceMs: 59 * MINUTE_MS,
    clock: 'the time this page fetched the list',
    why:
      'USGS updates its earthquake lists every minute. This page fetches the list once per visit, so it is flagged after an ' +
      'hour: by then a newer earthquake may be missing from the map.',
    docUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
    kind: 'data',
  },
  {
    id: 'bmkg-quakes',
    source: 'BMKG earthquake lists (data.bmkg.go.id)',
    usually: 'within minutes of each earthquake',
    everyMs: MINUTE_MS,
    graceMs: 59 * MINUTE_MS,
    clock: 'the time this page fetched the list',
    why: 'BMKG updates its earthquake lists whenever an earthquake occurs; same once-per-visit fetch and one-hour allowance as USGS.',
    docUrl: 'https://data.bmkg.go.id/gempabumi/',
    kind: 'data',
  },
  {
    id: 'official-feed',
    source: 'Official warning feeds and GDACS (every feed in the official warnings panel)',
    usually: 'every 5 min',
    everyMs: 5 * MINUTE_MS,
    graceMs: 55 * MINUTE_MS,
    clock: 'the last time the feed answered this page',
    why:
      'Issuers publish when they have a message, so weeks without a new message are normal and say nothing about the feed. ' +
      'What is checked is that the feed answers: this page asks every 5 min, so an hour without an answer is about twelve ' +
      'missed asks in a row.',
    docUrl: null,
    kind: 'feed',
  },
  {
    id: 'magma-copy',
    source: 'PVMBG MAGMA Indonesia volcano levels (recorded copy)',
    usually: 'every 6 h',
    everyMs: 6 * HOUR_MS,
    graceMs: 6 * HOUR_MS,
    clock: 'the time the copy was recorded',
    why:
      'MAGMA reports on each volcano for every 6-hour period, and a level can change in any report. Its API is token-only, ' +
      'so the copy is never refreshed here; after 12 h it is flagged and points to MAGMA.',
    docUrl: 'https://magma.esdm.go.id/',
    kind: 'copy',
  },
];

const BY_ID = new Map(UPDATE_INTERVALS.map((r) => [r.id, r]));

export function intervalById(id: string): UpdateInterval | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The interval for a Sources entry (src/lib/sourceCatalogue.ts ids). Null for sources with no expected update:
 * links, map tiles, bundled reference data, and values computed in the browser.
 */
export function intervalForSource(sourceId: string): UpdateInterval | null {
  if (sourceId === 'feed:magma-level-list') return intervalById('magma-copy');
  if (sourceId.startsWith('feed:')) return intervalById('official-feed');
  if (sourceId === 'nea') return intervalById('nea-haze');
  if (sourceId === 'cams') return intervalById('cams-pm25');
  if (sourceId === 'wind-925' || sourceId === 'wind-10m' || sourceId === 'ash-wind') return intervalById('open-meteo-wind');
  if (sourceId === 'glofas') return intervalById('glofas');
  if (sourceId === 'fires') return intervalById('fires-relay');
  if (sourceId === 'firms' || sourceId.startsWith('firms:')) return intervalById('watch-relay');
  if (sourceId === 'quakes:usgs-quakes') return intervalById('usgs-quakes');
  if (sourceId.startsWith('quakes:bmkg')) return intervalById('bmkg-quakes');
  return null;
}

/** The age past which a source is flagged. */
export function staleAfterMs(interval: Pick<UpdateInterval, 'everyMs' | 'graceMs'>): number {
  return interval.everyMs + interval.graceMs;
}

/** "under 1 min", "45 min", "9 h", "3 days": whole units, rounded down, so the words never overstate an age. */
export function ageWords(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE_MS) return 'under 1 min';
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min`;
  if (ms < 48 * HOUR_MS) return `${Math.floor(ms / HOUR_MS)} h`;
  return `${Math.floor(ms / DAY_MS)} days`;
}

/**
 * - `ok`: within the expected interval and its allowance.
 * - `older`: past it ("Older than expected", or "Feed quiet" for a feed).
 * - `checking`: a feed past it while this page is asking it again; judged once the answer is in.
 */
export type AgeState = 'ok' | 'older' | 'checking';

export interface AgeCheck {
  interval: UpdateInterval;
  /** The time checked (ISO 8601 UTC). */
  at: string;
  /** now − at, never negative. */
  ageMs: number;
  state: AgeState;
  /** One or two plain sentences. */
  text: string;
  /** A few words for a chip or a narrow screen, e.g. "Older than expected · 9 h". */
  short: string;
}

export interface AgeCheckOptions {
  /** The issuer to send people to (feeds and recorded copies). */
  issuer?: string | null;
  /** True while this page is asking the feed again: a feed past its interval reads "checking", not "quiet". */
  checking?: boolean;
}

/** The sentence for an age past the expected interval. Never an all-clear; feeds and copies point to the issuer. */
export function olderSentence(interval: UpdateInterval, ageMs: number, issuer?: string | null): string {
  const age = ageWords(ageMs);
  const who = issuer?.trim() || 'the issuer';
  if (interval.kind === 'feed') {
    return `Feed quiet for ${age}: no update has reached this page, so messages may be missing. Check ${who} directly.`;
  }
  if (interval.kind === 'copy') {
    return `Older than expected: recorded ${age} ago, usually updated ${interval.usually}. Check ${who} directly.`;
  }
  return `Older than expected: last update ${age} ago, usually ${interval.usually}.`;
}

/** The sentence for an age within the expected interval. */
export function okSentence(interval: UpdateInterval, ageMs: number): string {
  const age = ageWords(ageMs);
  if (interval.kind === 'feed') return `Feed answered ${age} ago; this page asks ${interval.usually}.`;
  if (interval.kind === 'copy') return `Recorded ${age} ago; usually updated ${interval.usually}.`;
  return `Last update ${age} ago; usually ${interval.usually}.`;
}

/**
 * The age of one source against its expected interval. Null when it cannot be judged: no page clock, no
 * time, an unparseable time, or a time well ahead of the page clock (one of the clocks is wrong).
 * Flagged only when the age is strictly past everyMs + graceMs.
 */
export function checkAge(
  interval: UpdateInterval | null | undefined,
  at: string | null | undefined,
  nowMs: number | null | undefined,
  opts: AgeCheckOptions = {},
): AgeCheck | null {
  if (!interval || !at || typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const raw = nowMs - t;
  if (raw < -FUTURE_TOLERANCE_MS) return null;
  const ageMs = Math.max(0, raw);
  const past = ageMs > staleAfterMs(interval);
  if (!past) return { interval, at, ageMs, state: 'ok', text: okSentence(interval, ageMs), short: `${ageWords(ageMs)} old` };
  if (interval.kind === 'feed' && opts.checking) {
    return { interval, at, ageMs, state: 'checking', text: `Asking the feed again; last answer ${ageWords(ageMs)} ago.`, short: 'Checking' };
  }
  const short = interval.kind === 'feed' ? `Feed quiet · ${ageWords(ageMs)}` : `Older than expected · ${ageWords(ageMs)}`;
  return { interval, at, ageMs, state: 'older', text: olderSentence(interval, ageMs, opts.issuer), short };
}

/**
 * An official feed's age, counted from its last live answer on this page, else from its retrieval or capture
 * time. Null when the feed is unavailable (it already says "Official feed unavailable: check <issuer>
 * directly") or there is no page clock.
 */
export function feedAge(f: WarningFeedStatus, nowMs: number | null | undefined, checking = false): AgeCheck | null {
  if (f.status === 'unavailable') return null;
  return checkAge(intervalForSource(`feed:${f.feedId}`), f.lastAnswerAt ?? f.retrievedAt, nowMs, { issuer: f.issuer, checking });
}

/**
 * Carries each feed's newest live answer across refreshes (WarningFeedStatus.lastAnswerAt): a live or cached
 * status moves it forward, and a later fall-back to the snapshot keeps it, so one failed refresh does not
 * read as days of silence. `known` maps feedId to that time; returns the feeds with lastAnswerAt set and
 * the updated map.
 */
export function trackFeedAnswers(
  feeds: readonly WarningFeedStatus[],
  known: Readonly<Record<string, string>>,
): { feeds: WarningFeedStatus[]; known: Record<string, string> } {
  const next: Record<string, string> = { ...known };
  const out = feeds.map((f) => {
    const answered = (f.status === 'live' || f.status === 'cached') && f.retrievedAt && Number.isFinite(Date.parse(f.retrievedAt)) ? f.retrievedAt : null;
    const before = next[f.feedId] ?? null;
    if (answered && (!before || Date.parse(answered) > Date.parse(before))) next[f.feedId] = answered;
    const last = next[f.feedId] ?? null;
    return last ? { ...f, lastAnswerAt: last } : f;
  });
  return { feeds: out, known: next };
}

/** Lower-cases the first letter, for a sentence embedded after a colon. */
export function inSentence(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
