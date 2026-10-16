import { describe, expect, it } from 'vitest';
import { SECTIONS, buildHash, isSectionId, parseHash } from './workspace';

describe('workspace sections', () => {
  it('lists the nine sections of docs/UX_V3.md in taskbar order', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['situation', 'haze', 'fires', 'volcanoes', 'warnings', 'water', 'report', 'sources', 'layers']);
  });

  it('recognises section ids only', () => {
    expect(isSectionId('fires')).toBe(true);
    expect(isSectionId('map')).toBe(false);
    expect(isSectionId(null)).toBe(false);
  });
});

describe('parseHash', () => {
  it('reads a section and a selection', () => {
    expect(parseHash('#ws=volcanoes&sel=watch-merapi')).toEqual({ ws: 'volcanoes', sel: 'watch-merapi' });
    expect(parseHash('ws=fires')).toEqual({ ws: 'fires', sel: null });
  });

  it('keeps the legacy #incident= link working as a selection', () => {
    expect(parseHash('#incident=watch-riau')).toEqual({ ws: null, sel: 'watch-riau' });
  });

  it('ignores unknown sections and empty values', () => {
    expect(parseHash('#ws=nope&sel=%20')).toEqual({ ws: null, sel: null });
    expect(parseHash('')).toEqual({ ws: null, sel: null });
    expect(parseHash('#')).toEqual({ ws: null, sel: null });
  });
});

describe('buildHash', () => {
  it('round-trips and stays empty when nothing is set', () => {
    expect(buildHash({ ws: null, sel: null })).toBe('');
    expect(buildHash({ ws: 'warnings', sel: null })).toBe('#ws=warnings');
    expect(parseHash(buildHash({ ws: 'water', sel: 'watch-merapi' }))).toEqual({ ws: 'water', sel: 'watch-merapi' });
  });
});

describe('map selection in the hash', () => {
  it('keeps watch areas plain and prefixes the other kinds', async () => {
    const { selectionFromSel, selToHash } = await import('./workspace');
    expect(selectionFromSel('watch-merapi')).toEqual({ kind: 'area', id: 'watch-merapi' });
    expect(selectionFromSel('city:singapore')).toEqual({ kind: 'city', id: 'singapore' });
    expect(selectionFromSel('warning:bmkg:abc')).toEqual({ kind: 'warning', id: 'bmkg:abc' });
    expect(selectionFromSel('city:')).toEqual({ kind: 'area', id: 'city:' });
    expect(selectionFromSel(null)).toBeNull();
    expect(selToHash({ kind: 'area', id: 'watch-riau' })).toBe('watch-riau');
    expect(selToHash({ kind: 'fire', id: 'riau-1' })).toBe('fire:riau-1');
    expect(selToHash(null)).toBeNull();
  });

  it('round-trips through the hash', async () => {
    const { selectionFromSel, selToHash } = await import('./workspace');
    const sel = { kind: 'warning', id: 'jma:volcano/123 456' } as const;
    expect(selectionFromSel(parseHash(buildHash({ ws: 'warnings', sel: selToHash(sel) })).sel)).toEqual(sel);
  });

  it('compares selections by kind and id', async () => {
    const { sameSelection } = await import('./workspace');
    expect(sameSelection({ kind: 'city', id: 'a' }, { kind: 'city', id: 'a' })).toBe(true);
    expect(sameSelection({ kind: 'city', id: 'a' }, { kind: 'area', id: 'a' })).toBe(false);
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection(null, { kind: 'city', id: 'a' })).toBe(false);
  });
});
