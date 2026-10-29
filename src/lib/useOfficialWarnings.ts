// Official warnings (every feed in warnings.ts), the PTWC latest product and the Tokyo VAAC ash advisories,
// kept fresh: loaded at mount, then every 5 minutes, when the page becomes visible and when the browser comes
// back online (the cadence in refreshLoop.ts). The current lists stay on screen until a new result arrives.
// The loaders never throw and fall back per feed to the bundled HISTORICAL snapshot, so a failed refresh is
// shown as a snapshot with its own capture time, never as "no warnings". Each feed keeps its newest live
// answer (lastAnswerAt, trackFeedAnswers) so "feed quiet" counts from the last real answer, and `checking`
// says a refresh is in flight, so a feed is not called quiet while it is being asked again.
import { useEffect, useRef, useState } from 'react';
import { loadOfficialWarnings, loadWarningsSnapshot } from './warnings';
import type { OfficialWarningsResult } from './warnings';
import { loadPtwc, loadPtwcSnapshot } from './ptwc';
import type { PtwcResult } from './ptwc';
import { loadVaac, loadVaacSnapshot } from './vaac';
import type { VaacResult } from './vaac';
import { startRefreshLoop } from './refreshLoop';
import { trackFeedAnswers } from './staleness';

export interface OfficialWarningsState {
  /** Official feeds (warnings, feed statuses, gauges): the bundled snapshot until the first load settles. */
  feed: OfficialWarningsResult;
  /** PTWC latest product: the bundled snapshot until the first load settles. */
  ptwc: PtwcResult;
  /** Tokyo VAAC ash advisories (aviation): the bundled snapshot until the first load settles. */
  vaac: VaacResult;
  /** True until the first official-feeds load settles. */
  loading: boolean;
  /** True while a load (the first or a refresh) is in flight. */
  checking: boolean;
}

/** Bundled snapshot, so the rail renders before any network reply (never throws). */
function snapshotFeed(): OfficialWarningsResult {
  try {
    return loadWarningsSnapshot();
  } catch (err) {
    console.error('Official warnings snapshot could not be read:', err);
    return { warnings: [], feeds: [], gauges: [] };
  }
}

export function useOfficialWarnings(): OfficialWarningsState {
  const [feed, setFeed] = useState<OfficialWarningsResult>(snapshotFeed);
  const [ptwc, setPtwc] = useState<PtwcResult>(() => loadPtwcSnapshot());
  const [vaac, setVaac] = useState<VaacResult>(() => loadVaacSnapshot());
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(true);
  /** feedId → newest live answer on this page. */
  const answers = useRef<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const remember = (status: OfficialWarningsResult['feeds']) => {
      const t = trackFeedAnswers(status, answers.current);
      answers.current = t.known;
      return t.feeds;
    };
    const refresh = () => {
      setChecking(true);
      return Promise.all([
        loadOfficialWarnings()
          .then((result) => {
            if (alive) setFeed({ ...result, feeds: remember(result.feeds) });
          })
          .catch((err: unknown) => console.error('Official warnings could not be loaded:', err))
          .finally(() => {
            if (alive) setLoading(false);
          }),
        loadPtwc()
          .then((result) => {
            if (alive) setPtwc({ ...result, status: remember([result.status])[0] });
          })
          .catch((err: unknown) => console.error('PTWC could not be loaded:', err)),
        loadVaac()
          .then((result) => {
            if (alive) setVaac({ ...result, status: remember([result.status])[0] });
          })
          .catch((err: unknown) => console.error('Tokyo VAAC advisories could not be loaded:', err)),
      ]).finally(() => {
        if (alive) setChecking(false);
      });
    };
    const stop = startRefreshLoop(refresh, { immediate: true });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  return { feed, ptwc, vaac, loading, checking };
}
