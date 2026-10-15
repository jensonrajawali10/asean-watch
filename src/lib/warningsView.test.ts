// Tests for the official-warning view helpers, on real items from the bundled snapshots
// (data/warnings-snapshot.json, data/ptwc-snapshot.json) wherever the snapshot has the case.
import { describe, expect, it } from 'vitest';
import type { OfficialWarning } from '../types';
import { compareWarnings, loadWarningsSnapshot } from './warnings';
import { loadPtwcSnapshot } from './ptwc';
import { mergeWarnings } from './warningsView';

const FEED = loadWarningsSnapshot();
const PTWC = loadPtwcSnapshot();

/** The landing view's "newest 20" (OfficialWarnings LIST_CAP). */
const LIST_CAP = 20;

describe('mergeWarnings (H1)', () => {
  const merged = mergeWarnings(FEED.warnings, PTWC.warnings);

  it('keeps every item from both sources', () => {
    expect(FEED.warnings.length).toBeGreaterThan(LIST_CAP);
    expect(PTWC.warnings).toHaveLength(1);
    expect(merged).toHaveLength(FEED.warnings.length + PTWC.warnings.length);
  });

  it('puts the PTWC message, newer than every feed item, first and so inside the newest 20', () => {
    const ptwc = PTWC.warnings[0];
    // Real data: PTWC issued 2026-10-13T12:34:39Z; the newest feed item (DSDA Jakarta) 07:40Z.
    expect(ptwc.issuedAt).toBe('2026-10-13T12:34:39Z');
    expect(FEED.warnings[0].issuedAt).toBe('2026-10-13T07:40:00Z');
    expect(merged[0].id).toBe(ptwc.id);
    expect(merged.slice(0, LIST_CAP).map((w) => w.id)).toContain(ptwc.id);
  });

  it('orders exactly as loadOfficialWarnings does (issuedAt descending, no issue time last)', () => {
    expect(merged).toEqual([...merged].sort(compareWarnings));
    const firstUndated = merged.findIndex((w) => w.issuedAt === null);
    expect(firstUndated).toBeGreaterThan(0);
    expect(merged.slice(firstUndated).every((w) => w.issuedAt === null)).toBe(true);
  });

  it('does not reorder or mutate its inputs', () => {
    const before = FEED.warnings.map((w) => w.id);
    const ptwcFirst: OfficialWarning[] = [...PTWC.warnings, ...FEED.warnings.slice(0, 3)];
    mergeWarnings(FEED.warnings, ptwcFirst);
    expect(FEED.warnings.map((w) => w.id)).toEqual(before);
    expect(ptwcFirst[0].id).toBe(PTWC.warnings[0].id);
  });
});
