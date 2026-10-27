// The fire snapshot the app shows: the bundled data/fires-snapshot.json first (so the map draws offline
// and at once), replaced by a fresh build from the /api/fires relay when it answers (src/lib/firesRelay.ts).
// A failed or unavailable relay keeps the bundled snapshot, which the UI dates as a saved copy; it is
// never read as "no fires". Components read it with useFireSnapshot().
import { useSyncExternalStore } from 'react';
import { loadFireSnapshot, parseFireSnapshot } from './fires';
import type { FireSnapshot } from './fires';
import { FIRES_RELAY_PATH } from './firesRelay';
import { isRecord, loadLiveFirst } from './liveLoad';
import type { ConnectorStatus } from '../types';

/**
 * Client timeout for /api/fires. A cold relay downloads about 30 MB from FIRMS before it answers, so this is
 * above its 45 s upstream budget; meanwhile the bundled snapshot is on screen.
 */
export const FIRES_CLIENT_TIMEOUT_MS = 55000;
/** A tab that stays open asks again this often (the relay itself rebuilds every few hours). */
export const FIRES_REFRESH_MS = 30 * 60 * 1000;

let current: FireSnapshot | null = loadFireSnapshot();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(): FireSnapshot | null {
  return current;
}

/** The fire snapshot on screen now: live when the relay has answered, else the bundled one. */
export function currentFireSnapshot(): FireSnapshot | null {
  return current;
}

export function useFireSnapshot(): FireSnapshot | null {
  return useSyncExternalStore(subscribe, read, read);
}

class RelayUnavailable extends Error {}

/**
 * Ask /api/fires for a fresh snapshot and, when it gives a valid one, show it. Returns the connector
 * status. Never throws.
 */
export async function refreshLiveFires(opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; proxyUrl?: string }): Promise<ConnectorStatus> {
  const bundled = loadFireSnapshot();
  const r = await loadLiveFirst<unknown>({
    sourceId: 'firms-fires',
    sourceName: 'NASA FIRMS',
    fetchImpl: opts?.fetchImpl,
    timeoutMs: opts?.timeoutMs ?? FIRES_CLIENT_TIMEOUT_MS,
    retrievedAtOf: (v) => (isRecord(v) && typeof v.retrievedAt === 'string' ? v.retrievedAt : ''),
    live: async (get) => {
      const payload = await get(opts?.proxyUrl ?? FIRES_RELAY_PATH, 'json');
      if (!isRecord(payload) || payload.available !== true) {
        throw new RelayUnavailable(isRecord(payload) && typeof payload.message === 'string' ? payload.message : 'relay unavailable');
      }
      // Checked here so a malformed build never reaches the sessionStorage cache.
      if (!parseFireSnapshot(payload.snapshot)) throw new RelayUnavailable('the relay returned an unreadable snapshot');
      return payload.snapshot;
    },
    snapshot: () => (bundled ? { value: null, retrievedAt: bundled.retrievedAt } : null),
  });
  if (r.status.status === 'live' || r.status.status === 'cached') {
    const parsed = parseFireSnapshot(r.value);
    // Only ever move forward: a cached copy older than what is on screen is ignored.
    if (parsed && (!current || parsed.retrievedAt >= current.retrievedAt)) {
      current = { ...parsed, origin: 'live' };
      for (const listener of listeners) listener();
    }
  }
  return r.status;
}

/** Tests: put the bundled snapshot back. */
export function resetFireSnapshot(): void {
  current = loadFireSnapshot();
  for (const listener of listeners) listener();
}
