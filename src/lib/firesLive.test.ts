import { beforeEach, describe, expect, it } from 'vitest';
import bundledJson from '../../data/fires-snapshot.json';
import { fireSourceRefs, loadFireSnapshot } from './fires';
import { currentFireSnapshot, refreshLiveFires, resetFireSnapshot } from './firesLive';
import { resetConnectorCaches } from './liveLoad';

const bundled = loadFireSnapshot();

/** The bundled snapshot with a later retrieval time, as the relay would build it. */
const fresher = { ...(bundledJson as Record<string, unknown>), retrievedAt: '2030-01-01T00:00:00Z' };

function relay(body: unknown, status = 200) {
  let calls = 0;
  const fn = (async () => {
    calls += 1;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

describe('live fires (src/lib/firesLive.ts)', () => {
  beforeEach(() => {
    resetConnectorCaches();
    resetFireSnapshot();
  });

  it('starts from the bundled snapshot', () => {
    expect(bundled).not.toBeNull();
    expect(currentFireSnapshot()).toBe(bundled);
    expect(currentFireSnapshot()?.origin).toBeUndefined();
  });

  it('switches to the relay build, marked live, and labels its sources LIVE', async () => {
    const r = relay({ available: true, stale: false, snapshot: fresher });
    const status = await refreshLiveFires({ fetchImpl: r.fn });
    expect(status.status).toBe('live');
    const snap = currentFireSnapshot();
    expect(snap?.origin).toBe('live');
    expect(snap?.retrievedAt).toBe('2030-01-01T00:00:00Z');
    expect(fireSourceRefs(snap!).filter((s) => s.mode?.includes('MEASURED')).every((s) => s.mode === 'LIVE · MEASURED')).toBe(true);
  });

  it('keeps the bundled snapshot when the relay is unavailable', async () => {
    const r = relay({ available: false, checkedAt: '2026-10-27T06:00:00Z', reason: 'timeout', message: 'NASA FIRMS did not answer in time' });
    const status = await refreshLiveFires({ fetchImpl: r.fn });
    expect(status.status).toBe('snapshot');
    expect(currentFireSnapshot()).toBe(bundled);
    expect(fireSourceRefs(bundled!).some((s) => s.mode === 'SNAPSHOT · MEASURED')).toBe(true);
  });

  it('keeps the bundled snapshot when the relay sends something unreadable', async () => {
    const r = relay({ available: true, stale: false, snapshot: { schema: 1, retrievedAt: 'soon' } });
    await refreshLiveFires({ fetchImpl: r.fn });
    expect(currentFireSnapshot()).toBe(bundled);
  });

  it('never moves backwards to an older build', async () => {
    const older = { ...(bundledJson as Record<string, unknown>), retrievedAt: '2020-01-01T00:00:00Z' };
    await refreshLiveFires({ fetchImpl: relay({ available: true, stale: false, snapshot: older }).fn });
    expect(currentFireSnapshot()).toBe(bundled);
  });
});
