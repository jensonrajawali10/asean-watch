import { beforeEach, describe, expect, it } from 'vitest';
import firmsJson from '../../data/real/firms.json';
import quakesJson from '../../data/real/quakes.json';
import metaJson from '../../data/real/meta.json';
import { bundledWatchFixtures, currentWatchFixtures, refreshLiveWatch, resetWatchFixtures } from './watchLive';
import { resetConnectorCaches } from './liveLoad';

const bundled = bundledWatchFixtures().fixtures;

/** The bundled rows as a later relay build would send them. */
function build(retrievedAt: string) {
  const meta = { ...(metaJson as Record<string, unknown>), retrievedAt, window: { ...(metaJson as { window: object }).window, end: retrievedAt } };
  return { firms: firmsJson, quakes: quakesJson, meta, scenarioWindow: { start: (metaJson as { window: { start: string } }).window.start, end: retrievedAt } };
}

function relay(body: unknown, status = 200) {
  let calls = 0;
  const fn = (async () => {
    calls += 1;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

describe('live watch-area evidence (src/lib/watchLive.ts)', () => {
  beforeEach(() => {
    resetConnectorCaches();
    resetWatchFixtures();
  });

  it('starts from the bundled snapshot, every record historical', () => {
    expect(bundled).not.toBeNull();
    expect(currentWatchFixtures()).toBe(bundled);
    expect(bundled!.snapshot.dataMode).toBe('historical');
    expect(bundled!.observations.length).toBeGreaterThan(0);
    expect(bundled!.observations.every((o) => o.dataMode === 'historical')).toBe(true);
  });

  it('switches to the relay build: same rules, every record and watch marked live, the new window', async () => {
    const later = '2030-01-01T06:00:00Z';
    const status = await refreshLiveWatch({ fetchImpl: relay({ available: true, stale: false, data: build(later) }).fn });
    expect(status.status).toBe('live');
    const live = currentWatchFixtures()!;
    expect(live).not.toBe(bundled);
    expect(live.snapshot.dataMode).toBe('live');
    expect(live.snapshot.retrievedAt).toBe(later);
    expect(live.observations.length).toBe(bundled!.observations.length);
    expect(live.observations.every((o) => o.dataMode === 'live')).toBe(true);
    expect(live.incidents.every((i) => i.dataMode === 'live' && i.scenarioWindow.end === later)).toBe(true);
    expect(live.replaySteps.length).toBeGreaterThan(0);
  });

  it('keeps the bundled snapshot when the relay is unavailable', async () => {
    const r = relay({ available: false, checkedAt: '2026-10-29T08:00:00Z', reason: 'timeout', message: 'NASA FIRMS, USGS or BMKG did not answer in time' });
    const status = await refreshLiveWatch({ fetchImpl: r.fn });
    expect(status.status).toBe('snapshot');
    expect(currentWatchFixtures()).toBe(bundled);
  });

  it('keeps the bundled snapshot when the relay sends something unreadable', async () => {
    await refreshLiveWatch({ fetchImpl: relay({ available: true, stale: false, data: { firms: {}, meta: {} } }).fn });
    expect(currentWatchFixtures()).toBe(bundled);
    await refreshLiveWatch({ fetchImpl: relay({ available: true, stale: false, data: { ...build('2030-01-01T06:00:00Z'), meta: { broken: true } } }).fn });
    expect(currentWatchFixtures()).toBe(bundled);
  });

  it('never moves backwards to an older build', async () => {
    await refreshLiveWatch({ fetchImpl: relay({ available: true, stale: false, data: build('2020-01-01T00:00:00Z') }).fn });
    expect(currentWatchFixtures()).toBe(bundled);
  });
});
