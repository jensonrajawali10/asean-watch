// One refresh cadence for everything that depends on the wall clock or on live feeds: every 5 minutes,
// at once when the page becomes visible again, and when the browser comes back online. Framework-free
// (the React hooks useNowMs and useOfficialWarnings wrap it), so it is unit-tested with fake timers.

/** The refresh cadence; matches the 5-minute live caches in warnings.ts and liveLoad.ts. */
export const REFRESH_MS = 5 * 60 * 1000;

/** The part of `document` the loop listens to (injectable for tests). */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** The part of `window` the loop listens to (injectable for tests). */
export interface OnlineSource {
  addEventListener(type: 'online', listener: () => void): void;
  removeEventListener(type: 'online', listener: () => void): void;
}

export interface RefreshLoopOptions {
  intervalMs?: number;
  /** Run once at start, before the first interval (default false). */
  immediate?: boolean;
  /** Defaults to the global document / window; null listens to nothing. */
  doc?: VisibilitySource | null;
  win?: OnlineSource | null;
}

/**
 * Calls `run` every intervalMs, counted from when the previous run settled (so a 5-minute live cache has
 * always expired by the next run), at once when the page becomes visible and when the browser comes back
 * online. While the page is hidden the timer only re-arms: nothing is fetched in a background tab, and
 * becoming visible catches up. `run` may return a promise; a rejection or throw is ignored here (the
 * loaders never throw). Returns a stop function.
 */
export function startRefreshLoop(run: () => unknown, opts: RefreshLoopOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? REFRESH_MS;
  const doc = opts.doc !== undefined ? opts.doc : typeof document !== 'undefined' ? document : null;
  const win = opts.win !== undefined ? opts.win : typeof window !== 'undefined' ? window : null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const arm = () => {
    clear();
    if (!stopped) timer = setTimeout(onTimer, intervalMs);
  };
  const fire = () => {
    if (stopped) return;
    clear();
    let result: unknown;
    try {
      result = run();
    } catch {
      result = undefined;
    }
    void Promise.resolve(result)
      .catch(() => undefined)
      .then(arm);
  };
  function onTimer() {
    timer = undefined;
    if (doc?.visibilityState === 'hidden') arm();
    else fire();
  }
  const onVisibility = () => {
    if (doc?.visibilityState === 'visible') fire();
  };
  const onOnline = () => fire();

  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('online', onOnline);
  if (opts.immediate) fire();
  else arm();

  return () => {
    stopped = true;
    clear();
    doc?.removeEventListener('visibilitychange', onVisibility);
    win?.removeEventListener('online', onOnline);
  };
}
