// Two honesty fixes (HANDOFF follow-ups, 2026-11-03): the haze place table never calls an out-of-date live
// model run "now", and the record inspector never presents the kept strongest hotspots of a capped haze day
// as every hotspot of that day.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadAqSnapshot } from '../lib/airQuality';
import type { HotspotMember } from '../lib/fixtures';
import HazeAirSection from './analyst/HazeAirSection';
import { MembersTable } from './RecordInspector';

const props = { nea: null, onFlyTo: () => {}, onSelectCity: () => {} };

describe('Haze & air: the "now" words follow the model run age', () => {
  it('a fresh live run says "Worst now"; one past the CAMS interval says "Worst at model hour" and why', async () => {
    const snap = await loadAqSnapshot();
    expect(snap).not.toBeNull();
    const fresh = renderToStaticMarkup(createElement(HazeAirSection, { ...props, airQuality: { ...snap!, dataMode: 'live', retrievedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') } }));
    expect(fresh).toContain('Worst now');
    expect(fresh).toContain('the live run, fetched this session');

    const old = renderToStaticMarkup(createElement(HazeAirSection, { ...props, airQuality: { ...snap!, dataMode: 'live', retrievedAt: '2020-01-01T00:00:00Z' } }));
    expect(old).not.toContain('Worst now');
    expect(old).toContain('Worst at model hour');
    expect(old).toContain('not current conditions. Older than expected');

    const saved = renderToStaticMarkup(createElement(HazeAirSection, { ...props, airQuality: { ...snap!, dataMode: 'historical' } }));
    expect(saved).toContain('Worst at snapshot hour');
  });
});

describe('Record inspector: kept hotspots of a capped haze day', () => {
  const member = (i: number): HotspotMember => ({
    id: `m${i}`,
    observedAt: '2026-10-22T05:30:00Z',
    latitude: -2.5,
    longitude: 114,
    distanceKm: null,
    frp: 100 - i,
    confidence: 'nominal',
    confidenceLabel: 'nominal',
  } as unknown as HotspotMember);
  const ten = Array.from({ length: 10 }, (_, i) => member(i));

  it('says the list is the strongest kept when the record counts more', () => {
    const html = renderToStaticMarkup(createElement(MembersTable, { members: ten, counted: 19861 }));
    expect(html).toContain('The 10 strongest hotspots, kept for review (the record counts 19,861 confident detections)');
    expect(html).not.toContain('Hotspots in this record (10)');
  });

  it('keeps the plain heading when every hotspot is listed', () => {
    expect(renderToStaticMarkup(createElement(MembersTable, { members: ten, counted: 10 }))).toContain('Hotspots in this record (10)');
    expect(renderToStaticMarkup(createElement(MembersTable, { members: ten, counted: null }))).toContain('Hotspots in this record (10)');
  });
});
