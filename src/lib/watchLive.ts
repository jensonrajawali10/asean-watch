// The watch-area evidence the app shows: the bundled snapshot first (data/real/*.json, so the app works
// offline and at once), replaced by a fresh build from the /api/watch relay when it answers
// (src/lib/watchRelay.ts). The relay's rows go through the same rules and validation (buildLiveFixtures),
// and every record from them is marked live. A failed or unavailable relay keeps the bundled snapshot,
// which the UI labels HISTORICAL with its capture time. Components read it with useWatchFixtures().
import { useSyncExternalStore } from 'react';
import { buildLiveFixtures, loadFixtures } from './fixtures';
import type { RealFixtures } from './fixtures';
import { isRecord, loadLiveFirst } from './liveLoad';
import { WATCH_RELAY_PATH } from './watchRelay';
import type { WatchData } from './watchRelay';
import type { ConnectorStatus } from '../types';

/**
 * Client timeout for /api/watch. A cold relay downloads about 30 MB from FIRMS plus the USGS and BMKG feeds
 * before it answers, so this is above its 45 s upstream budget; meanwhile the bundled snapshot is on screen.
 */
export const WATCH_CLIENT_TIMEOUT_MS = 55000;
/** A tab that stays open asks again this often (the relay itself rebuilds every few hours). */
export const WATCH_REFRESH_MS = 30 * 60 * 1000;

function loadBundled(): { fixtures: RealFixtures | null; error: string | null } {
  try {
    return { fixtures: loadFixtures(), error: null };
  } catch (err) {
    return { fixtures: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const bundled = loadBundled();
let current: RealFixtures | null = bundled.fixtures;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(): RealFixtures | null {
  return current;
}

/** The bundled snapshot's fixtures (null if it could not be built) and the load error, if any. */
export function bundledWatchFixtures(): { fixtures: RealFixtures | null; error: string | null } {
  return bundled;
}

/** The evidence on screen now: live when the relay has answered, else the bundled snapshot. */
export function currentWatchFixtures(): RealFixtures | null {
  return current;
}

export function useWatchFixtures(): RealFixtures | null {
  return useSyncExternalStore(subscribe, read, read);
}

class RelayUnavailable extends Error {}

function isWatchData(x: unknown): x is WatchData {
  return (
    isRecord(x) &&
    isRecord(x.meta) &&
    isRecord(x.firms) &&
    isRecord(x.quakes) &&
    isRecord(x.scenarioWindow) &&
    typeof x.scenarioWindow.start === 'string' &&
    typeof x.scenarioWindow.end === 'string'
  );
}

/** A usable build: its metadata read, replay days made, and at least one watch area. */
function usable(f: RealFixtures): boolean {
  return f.snapshot.retrievedAt !== '' && f.replaySteps.length > 0 && f.incidents.length > 0;
}

/**
 * Ask /api/watch for a fresh build and, when it gives a usable one, show it. Returns the connector
 * status. Never throws.
 */
export async function refreshLiveWatch(opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; proxyUrl?: string }): Promise<ConnectorStatus> {
  const r = await loadLiveFirst<unknown>({
    sourceId: 'watch-evidence',
    sourceName: 'NASA FIRMS, USGS and BMKG (watch areas)',
    fetchImpl: opts?.fetchImpl,
    timeoutMs: opts?.timeoutMs ?? WATCH_CLIENT_TIMEOUT_MS,
    retrievedAtOf: (v) => (isWatchData(v) && isRecord(v.meta) && typeof v.meta.retrievedAt === 'string' ? v.meta.retrievedAt : ''),
    live: async (get) => {
      const payload = await get(opts?.proxyUrl ?? WATCH_RELAY_PATH, 'json');
      if (!isRecord(payload) || payload.available !== true) {
        throw new RelayUnavailable(isRecord(payload) && typeof payload.message === 'string' ? payload.message : 'relay unavailable');
      }
      // Checked here so an unreadable build never reaches the sessionStorage cache.
      if (!isWatchData(payload.data) || !usable(buildLiveFixtures(payload.data))) throw new RelayUnavailable('the relay returned unreadable data');
      return payload.data;
    },
    snapshot: () => (bundled.fixtures ? { value: null, retrievedAt: bundled.fixtures.snapshot.retrievedAt } : null),
  });
  if ((r.status.status === 'live' || r.status.status === 'cached') && isWatchData(r.value)) {
    const built = buildLiveFixtures(r.value);
    // Only ever move forward: a cached copy older than what is on screen is ignored.
    if (usable(built) && (!current || built.snapshot.retrievedAt >= current.snapshot.retrievedAt)) {
      current = built;
      for (const listener of listeners) listener();
    }
  }
  return r.status;
}

/** Tests: put the bundled snapshot back. */
export function resetWatchFixtures(): void {
  current = bundled.fixtures;
  for (const listener of listeners) listener();
}
