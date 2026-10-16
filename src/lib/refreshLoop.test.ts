// The shared refresh cadence (H3, L8) and the page clock built on it (M4), with fake timers and
// stand-ins for document visibility and the window "online" event.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_MS, startRefreshLoop } from './refreshLoop';
import type { OnlineSource, VisibilitySource } from './refreshLoop';
import { createClock } from './useNowMs';
import { resetConnectorCaches } from './liveLoad';
import { BUNDLED_PTWC_SNAPSHOT, loadPtwc } from './ptwc';

class FakeDoc extends EventTarget implements VisibilitySource {
  visibilityState = 'visible';
  set(state: 'visible' | 'hidden') {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}
const fakeWin = () => new EventTarget() as EventTarget & OnlineSource;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-10-15T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startRefreshLoop', () => {
  it('runs at once when asked, then every 5 minutes after each run settles', async () => {
    const doc = new FakeDoc();
    let pending: (() => void) | null = null;
    const run = vi.fn(() => new Promise<void>((resolve) => (pending = resolve)));
    const stop = startRefreshLoop(run, { immediate: true, doc, win: fakeWin() });
    expect(run).toHaveBeenCalledTimes(1);
    // The load takes 8 s; the next run is 5 minutes after it settles, not after it started.
    await vi.advanceTimersByTimeAsync(8000);
    pending!();
    await vi.advanceTimersByTimeAsync(REFRESH_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    pending!();
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it('refreshes when the page becomes visible and when the browser comes back online', async () => {
    const doc = new FakeDoc();
    const win = fakeWin();
    const run = vi.fn();
    const stop = startRefreshLoop(run, { doc, win });
    expect(run).not.toHaveBeenCalled();
    doc.set('hidden');
    expect(run).not.toHaveBeenCalled();
    doc.set('visible');
    expect(run).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not fetch while the page is hidden, and catches up when it is shown', async () => {
    const doc = new FakeDoc();
    const run = vi.fn();
    const stop = startRefreshLoop(run, { doc, win: fakeWin() });
    doc.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    expect(run).not.toHaveBeenCalled();
    doc.set('visible');
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps going after a failed run and stops cleanly', async () => {
    const doc = new FakeDoc();
    const win = fakeWin();
    const run = vi.fn(() => Promise.reject(new Error('offline')));
    const stop = startRefreshLoop(run, { immediate: true, doc, win });
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2);
    doc.set('visible');
    win.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('createClock', () => {
  it('reads the time on subscribe and ticks every 5 minutes, on visibility and on online', async () => {
    const doc = new FakeDoc();
    const win = fakeWin();
    const clock = createClock({ doc, win });
    const listener = vi.fn();
    vi.setSystemTime(Date.parse('2026-10-15T13:00:00Z'));
    const unsubscribe = clock.subscribe(listener);
    expect(clock.getSnapshot()).toBe(Date.parse('2026-10-15T13:00:00Z'));
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(clock.getSnapshot()).toBe(Date.parse('2026-10-15T13:05:00Z'));
    expect(listener).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.parse('2026-10-15T14:00:00Z'));
    doc.set('visible');
    expect(clock.getSnapshot()).toBe(Date.parse('2026-10-15T14:00:00Z'));
    vi.setSystemTime(Date.parse('2026-10-15T14:01:00Z'));
    win.dispatchEvent(new Event('online'));
    expect(clock.getSnapshot()).toBe(Date.parse('2026-10-15T14:01:00Z'));
    unsubscribe();
    vi.setSystemTime(Date.parse('2026-10-15T15:00:00Z'));
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(clock.getSnapshot()).toBe(Date.parse('2026-10-15T14:01:00Z'));
  });
});

describe('refreshing a live loader (H3)', () => {
  it('fetches live again on each 5-minute refresh: the 5-minute cache has expired because the timer starts when the load settles', async () => {
    resetConnectorCaches();
    const LOAD_MS = 8000;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(new Response(JSON.stringify(BUNDLED_PTWC_SNAPSHOT), { status: 200 })), LOAD_MS),
        ),
    );
    const statuses: string[] = [];
    const stop = startRefreshLoop(
      () => loadPtwc({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20000 }).then((r) => statuses.push(r.status.status)),
      { immediate: true, doc: new FakeDoc(), win: fakeWin() },
    );
    await vi.advanceTimersByTimeAsync(LOAD_MS);
    expect(statuses).toEqual(['live']);
    await vi.advanceTimersByTimeAsync(REFRESH_MS + LOAD_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['live', 'live']);
    stop();
    resetConnectorCaches();
  });
});
