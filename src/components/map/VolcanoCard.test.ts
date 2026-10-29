import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadAshWindSnapshot } from '../../lib/ashDrift';
import { buildEruptionScenario } from '../../lib/eruptionScenario';
import { magmaRecords } from '../../lib/warnings';
import { MAGMA_KRB_MAP, VAAC_DARWIN, findMagmaLevel, volcanoOfficialLinks } from '../../lib/volcanoOfficial';
import EruptionScenarioPanel from '../analyst/EruptionScenarioPanel';
import VolcanoCard from './VolcanoCard';
import { vaaToWarning } from '../../lib/vaac';

const merapi = { id: 'watch-merapi', title: 'Merapi', volcanoId: 'gvp-263250', locationName: 'North of Yogyakarta, Central Java, Indonesia', hazard: 'volcano' as const };
const krakatau = { id: 'watch-anak-krakatau', title: 'Anak Krakatau', volcanoId: 'gvp-262000', locationName: 'Krakatau caldera, Sunda Strait, Indonesia', hazard: 'volcano' as const };
const riau = { id: 'watch-riau-haze', title: 'Riau peatland hotspots', volcanoId: null, locationName: 'Riau', hazard: 'wildfire' as const };
const snap = loadAshWindSnapshot()!;
const now = Date.parse(snap.retrievedAt);
const magma = magmaRecords().warnings;
const noop = () => {};

/** Text the map card must never carry (workspace material or our own advice). */
const FORBIDDEN = [/evacuat/i, /Review needed/, /Check observation/, /anomal/i, /watch rule/i, /—/];

describe('findMagmaLevel', () => {
  it('finds the bundled MAGMA record by GVP number and by name', () => {
    const m = findMagmaLevel(magma, merapi);
    expect(m?.level).toMatch(/^Level (I|II|III|IV) \(/);
    expect(m?.issuer).toMatch(/MAGMA/);
    expect(findMagmaLevel(magma, { volcanoId: null, title: 'Anak Krakatau' })?.areas[0].name).toBe('Anak Krakatau');
    expect(findMagmaLevel(magma, { volcanoId: 'gvp-000000', title: 'Nowhere' })).toBeNull();
    expect(findMagmaLevel(null, merapi)).toBeNull();
  });
  it('links the agency hazard map per volcano and VAAC Darwin', () => {
    expect(volcanoOfficialLinks('gvp-263250').hazardMap).toBe(MAGMA_KRB_MAP['gvp-263250']);
    expect(volcanoOfficialLinks('gvp-999999').hazardMap.url).toMatch(/peta-kawasan-rawan-bencana$/);
    expect(volcanoOfficialLinks('gvp-263250').vaac.url).toBe(VAAC_DARWIN.url);
    for (const l of volcanoOfficialLinks('gvp-263250').all) expect(l.url).toMatch(/^https:\/\//);
  });
});

describe('VolcanoCard', () => {
  it('shows the official level verbatim, the scenario and the hazard-map note, and nothing from the workspace', () => {
    const level = findMagmaLevel(magma, merapi)!;
    const html = renderToStaticMarkup(
      createElement(VolcanoCard, { watch: merapi, level, ashWind: snap, nowMs: now, onPlayScenario: noop, onOpenWorkspace: noop, onClose: noop }),
    );
    expect(html).toContain(level.level);
    expect(html).toContain('OFFICIAL LEVEL');
    expect(html).toContain('If it erupted now');
    expect(html).toContain('MODELLED SCENARIO');
    expect(html).toMatch(/Ash at about [0-9.–]+ km would drift/); // the direction follows the bundled winds
    expect(html).toContain('Rings show distance only; the agency&#x27;s hazard map is the authority');
    expect(html).toContain(MAGMA_KRB_MAP['gvp-263250'].url);
    expect(html).toContain(VAAC_DARWIN.url);
    expect(html).toContain('Play ash scenario');
    expect(html).toContain('Open full data');
    expect(html).toContain('Not a prediction, a dispersion model or a VAAC advisory');
    for (const re of FORBIDDEN) expect(html).not.toMatch(re);
  });

  it('says when the level or the winds are missing, and hides the play button without a scenario', () => {
    const html = renderToStaticMarkup(createElement(VolcanoCard, { watch: merapi, level: null, ashWind: null, nowMs: now, onPlayScenario: noop, onOpenWorkspace: noop }));
    expect(html).toContain('Not retrieved');
    expect(html).toContain('not an all-clear');
    expect(html).toContain('Ash scenario unavailable');
    expect(html).not.toContain('Play ash scenario');
  });

  it('always links VAAC Darwin as link only, saying why and that none shown is not an all-clear', () => {
    const html = renderToStaticMarkup(createElement(VolcanoCard, { watch: merapi, level: null, ashWind: snap, nowMs: now, onOpenWorkspace: noop }));
    expect(html).toContain('Ash in the air (aviation advisories)');
    expect(html).toContain(VAAC_DARWIN.url);
    expect(html).toContain('linked only');
    expect(html).toContain('None shown here is not an all-clear');
    expect(html).not.toContain('Ash advisory (aviation)');
  });

  it('shows a relayed ash advisory for the volcano as an aviation fact, never as its level', () => {
    // Real Tokyo VAAC advisory (JMA, 29 Oct 2026), trimmed to the lines the card reads.
    const text = [
      'FVFE01 RJTD 291145',
      'VA ADVISORY',
      'DTG: 20261029/1145Z',
      'VAAC: TOKYO',
      'VOLCANO: SAKURAJIMA (AIRA CALDERA) 282080',
      'PSN: N3136 E13039',
      'AREA: JAPAN',
      'NXT ADVISORY: NO FURTHER ADVISORIES=',
    ].join('\n');
    const url = 'https://www.data.jma.go.jp/vaac/data/TextData/2026/20261029_28208001_0332_Text.html';
    const ashAdvisory = vaaToWarning({ text, url }, { dataMode: 'live', retrievedAt: '2026-10-29T20:00:00Z' });
    const sakurajima = { id: 'x', title: 'Sakurajima', volcanoId: 'gvp-282080', locationName: 'Kagoshima, Japan', hazard: 'volcano' as const };
    const html = renderToStaticMarkup(createElement(VolcanoCard, { watch: sakurajima, level: null, ashAdvisory, ashWind: null, nowMs: now, onOpenWorkspace: noop }));
    expect(html).toContain('Ash advisory (aviation)');
    expect(html).toContain('VA ADVISORY');
    expect(html).toContain('Tokyo VAAC · issued 29 Oct, 11:45 UTC · series ended (NO FURTHER ADVISORIES) · not a public warning');
    expect(html).toContain(url);
    // The level fact still says the level was not retrieved.
    expect(html).toContain('Not retrieved');
  });

  it('uses a scenario passed in (the one the plume draws) and the toggle label while playing', () => {
    const scenario = buildEruptionScenario(snap, krakatau.volcanoId, now, { name: 'Anak Krakatau' });
    const html = renderToStaticMarkup(
      createElement(VolcanoCard, { watch: krakatau, level: findMagmaLevel(magma, krakatau), scenario, nowMs: 0, playing: true, onPlayScenario: noop, onOpenWorkspace: noop }),
    );
    expect(html).toContain('Stop ash scenario');
    expect(html).toContain('Sunda Strait');
  });
});

describe('EruptionScenarioPanel', () => {
  it('lists each volcano with its verbatim level, the per-height table, the method and the sources', () => {
    const html = renderToStaticMarkup(
      createElement(EruptionScenarioPanel, { watches: [merapi, krakatau, riau], ashWind: snap, nowMs: now, warnings: magma, onPlayScenario: noop }),
    );
    expect(html).toContain('If it erupted now: ash scenario by height');
    expect(html).toContain('Merapi');
    expect(html).toContain('Anak Krakatau');
    expect(html).not.toContain('Riau peatland');
    expect(html).toContain(findMagmaLevel(magma, merapi)!.level);
    expect(html).toContain('500 hPa');
    expect(html).toContain('24 h');
    expect(html).toContain('Heffter');
    expect(html).toContain('Not a VAAC advisory');
    expect(html).toContain('peta-kawasan-rawan-bencana');
    for (const re of [/evacuat/i, /—/]) expect(html).not.toMatch(re);
  });
});
