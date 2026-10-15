// A wall clock shared by every component that decides something by time (a warning's expiry, the
// "last 24 h" quakes, the Himawari frame, the ash-drift start). One timer for the whole page, ticking on
// the refresh cadence (src/lib/refreshLoop.ts), so the rail, the review panel and the map always agree.
import { useSyncExternalStore } from 'react';
import { startRefreshLoop } from './refreshLoop';
import type { RefreshLoopOptions } from './refreshLoop';

export interface Clock {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

/** A clock that reads `now` when the first listener subscribes and on every refresh-loop tick. */
export function createClock(opts: RefreshLoopOptions & { now?: () => number } = {}): Clock {
  const now = opts.now ?? Date.now;
  const listeners = new Set<() => void>();
  let value = now();
  let stop: (() => void) | null = null;
  const tick = () => {
    value = now();
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!stop) {
        value = now();
        stop = startRefreshLoop(tick, opts);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && stop) {
          stop();
          stop = null;
        }
      };
    },
    getSnapshot: () => value,
  };
}

const PAGE_CLOCK = createClock();

/** Epoch ms, refreshed every 5 minutes, when the page becomes visible and when the browser comes back online. */
export function useNowMs(): number {
  return useSyncExternalStore(PAGE_CLOCK.subscribe, PAGE_CLOCK.getSnapshot, PAGE_CLOCK.getSnapshot);
}
