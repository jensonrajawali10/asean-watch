// Official warnings (every feed in warnings.ts), the PTWC latest product and the Tokyo VAAC ash advisories, kept fresh: loaded at mount,
// then every 5 minutes, when the page becomes visible and when the browser comes back online (the
// cadence in refreshLoop.ts). The current lists stay on screen until a new result arrives. Both loaders
// never throw and fall back per feed to the bundled HISTORICAL snapshot, so a failed refresh is shown as
// a snapshot with its own capture time, never as "no warnings".
import { useEffect, useState } from 'react';
import { loadOfficialWarnings, loadWarningsSnapshot } from './warnings';
import type { OfficialWarningsResult } from './warnings';
import { loadPtwc, loadPtwcSnapshot } from './ptwc';
import type { PtwcResult } from './ptwc';
import { loadVaac, loadVaacSnapshot } from './vaac';
import type { VaacResult } from './vaac';
import { startRefreshLoop } from './refreshLoop';

export interface OfficialWarningsState {
  /** Official feeds (warnings, feed statuses, gauges): the bundled snapshot until the first load settles. */
  feed: OfficialWarningsResult;
  /** PTWC latest product: the bundled snapshot until the first load settles. */
  ptwc: PtwcResult;
  /** Tokyo VAAC ash advisories (aviation): the bundled snapshot until the first load settles. */
  vaac: VaacResult;
  /** True until the first official-feeds load settles. */
  loading: boolean;
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

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      Promise.all([
        loadOfficialWarnings()
          .then((result) => {
            if (alive) setFeed(result);
          })
          .catch((err: unknown) => console.error('Official warnings could not be loaded:', err))
          .finally(() => {
            if (alive) setLoading(false);
          }),
        loadPtwc()
          .then((result) => {
            if (alive) setPtwc(result);
          })
          .catch((err: unknown) => console.error('PTWC could not be loaded:', err)),
        loadVaac()
          .then((result) => {
            if (alive) setVaac(result);
          })
          .catch((err: unknown) => console.error('Tokyo VAAC advisories could not be loaded:', err)),
      ]);
    const stop = startRefreshLoop(refresh, { immediate: true });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  return { feed, ptwc, vaac, loading };
}
