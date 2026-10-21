// Water & tsunami section after the design review (2026-10-20): the BMKG tsunami status leads the section,
// an in-force BMKG message comes before PTWC, BMKG's areas are listed most severe first with a "Show all",
// and a PTWC information statement gets the calm card. Built from the bundled snapshots.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OfficialWarning } from '../../types';
import { loadPtwcSnapshot } from '../../lib/ptwc';
import { BUNDLED_WARNINGS_SNAPSHOT, parseBmkgTsunami } from '../../lib/warnings';
import { DEFAULT_LAYERS } from '../map/layerCatalog';
import WaterSection from './WaterSection';
import { BMKG_AREAS_PREVIEW, bmkgAreasBySeverity, isPtwcInformation } from './waterView';

const META = { dataMode: 'historical' as const, retrievedAt: BUNDLED_WARNINGS_SNAPSHOT.feeds['bmkg-inatews'].retrievedAt as string };
const BMKG = parseBmkgTsunami(BUNDLED_WARNINGS_SNAPSHOT.feeds['bmkg-inatews'].raw, META).warnings;
const WITH_AREAS = BMKG.filter((w) => w.areas.length > BMKG_AREAS_PREVIEW).sort((a, b) => (b.issuedAt ?? '').localeCompare(a.issuedAt ?? ''));
const PTWC = loadPtwcSnapshot();
const noop = () => {};
const render = (warnings: OfficialWarning[]) =>
  renderToStaticMarkup(
    createElement(WaterSection, {
      ptwc: PTWC,
      warnings,
      gauges: [],
      tideStations: [],
      tideListRetrievedAt: null,
      riverFlow: null,
      layers: DEFAULT_LAYERS,
      onLayersChange: noop,
      onInspectWarning: noop,
    }),
  );

describe('bmkgAreasBySeverity', () => {
  it('orders the bundled message areas AWAS, SIAGA, WASPADA, keeping BMKG order within a level and every area', () => {
    const areas = WITH_AREAS[0].areas;
    const sorted = bmkgAreasBySeverity(areas);
    expect(sorted).toHaveLength(areas.length);
    expect(new Set(sorted)).toEqual(new Set(areas));
    const rank = { AWAS: 3, SIAGA: 2, WASPADA: 1 } as Record<string, number>;
    const ranks = sorted.map((a) => rank[(a.level ?? '').toUpperCase()] ?? 0);
    expect([...ranks].sort((x, y) => y - x)).toEqual(ranks);
    const siaga = areas.filter((a) => a.level === 'SIAGA');
    expect(sorted.filter((a) => a.level === 'SIAGA')).toEqual(siaga);
  });
});

describe('isPtwcInformation', () => {
  it('is true for the bundled PTWC information statement and false for threat or warning products', () => {
    expect(isPtwcInformation(PTWC.warnings[0].level)).toBe(/information/i.test(PTWC.warnings[0].level));
    expect(isPtwcInformation('Tsunami Information')).toBe(true);
    expect(isPtwcInformation('Tsunami Threat')).toBe(false);
    expect(isPtwcInformation('Tsunami Warning')).toBe(false);
  });
});

describe('WaterSection tsunami status', () => {
  it('bundled snapshot (every BMKG message ended): neutral status, never an all-clear, PTWC first', () => {
    const html = render(BMKG);
    expect(html).toContain('an-tsunami-status');
    expect(html).not.toContain('an-tsunami-status--active');
    expect(html).toContain('None in force in the loaded feed');
    expect(html).toContain('Not an all-clear: check BMKG directly.');
    expect(html.indexOf('PTWC: latest product')).toBeLessThan(html.indexOf('BMKG InaTEWS: tsunami warning areas'));
  });

  it('a BMKG message in force: active status with its verbatim level, BMKG before PTWC', () => {
    const inForce = { ...WITH_AREAS[0], ended: false };
    const html = render([inForce]);
    expect(html).toContain('an-tsunami-status an-tsunami-status--active');
    expect(html).toContain(`${inForce.areas.length} named areas`);
    expect(html).toContain(inForce.level);
    expect(html.indexOf('BMKG InaTEWS: tsunami warning areas')).toBeLessThan(html.indexOf('PTWC: latest product'));
  });

  it('lists the most severe areas first, BMKG_AREAS_PREVIEW of them, with a Show all button', () => {
    const inForce = { ...WITH_AREAS[0], ended: false };
    const html = render([inForce]);
    const rows = html.match(/an-bmkg-level an-bmkg-level--/g) ?? [];
    expect(rows).toHaveLength(BMKG_AREAS_PREVIEW);
    expect(html).toContain(`Show all ${inForce.areas.length} named areas`);
    const first = bmkgAreasBySeverity(inForce.areas)[0];
    expect(html).toContain(first.name);
  });

  it('an ended BMKG message is collapsed behind a disclosure; an in-force one is open', () => {
    const latest = WITH_AREAS[0];
    const ended = render([{ ...latest, ended: true }]);
    expect(ended).toContain('an-ended-details');
    expect(ended).toContain(`Show this ended message verbatim and its ${latest.areas.length} named areas`);
    const open = render([{ ...latest, ended: false }]);
    expect(open).not.toContain('an-ended-details');
  });

  it('other official tsunami messages in force are named in the status strip', () => {
    const jma = { ...WITH_AREAS[0], id: 'jma-tsunami:x', issuer: 'Japan Meteorological Agency', ended: false, expiresAt: null };
    const html = render([...BMKG, jma]);
    expect(html).toContain('Other official tsunami messages in force:');
    expect(html).toContain('Japan Meteorological Agency (1)');
  });
});
