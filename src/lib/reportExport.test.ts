import { describe, expect, it } from 'vitest';
import type { OfficialWarning, WarningFeedStatus } from '../types';
import { loadAqSnapshot } from './airQuality';
import { loadAshWindSnapshot } from './ashDrift';
import { loadFixtures } from './fixtures';
import { loadFloodModelSnapshot } from './floodModel';
import { loadNeaSnapshot } from './nea';
import { loadPtwcSnapshot } from './ptwc';
import { loadQuakesSnapshot } from './quakesLive';
import {
  DEFAULT_EXPORT_SECTIONS,
  EXPORT_SECTIONS,
  buildReportMarkdown,
  buildReportText,
  composeReport,
  mdEscape,
  reportFilename,
  toMarkdown,
  wrapText,
} from './reportExport';
import type { ComposeInput } from './reportExport';
import { cityHazeTable, situationReport } from './situation';
import type { SituationInput } from './situation';
import { buildSourceCatalogue, groupSources } from './sourceCatalogue';
import { hazeSourcesFromFixtures } from './transport';
import { loadWarningsSnapshot } from './warnings';
import { loadWindSnapshot } from './windField';

const fx = loadFixtures();
const ws = loadWarningsSnapshot();
const ptwc = loadPtwcSnapshot();

/** A message whose verbatim text contains Markdown syntax, to prove escaping keeps it verbatim. */
const TRICKY: OfficialWarning = {
  id: 'tricky',
  issuer: 'BMKG InaTEWS',
  issuerUrl: 'https://inatews.bmkg.go.id/',
  authority: 'official',
  hazard: 'tsunami',
  product: 'Warning Tsunami',
  level: 'AWAS',
  levelGloss: null,
  headline: 'Peringatan | *Dini* Tsunami_uji [1] #2',
  areaDescription: 'Contoh',
  areas: [],
  location: null,
  issuedAt: '2026-10-14T05:00:00Z',
  expiresAt: null,
  ended: false,
  instruction: 'Segera menjauhi pantai.\n1. Ikuti arahan BPBD.',
  language: 'id',
  sourceUrl: 'https://example.invalid/feed.xml',
  dataMode: 'live',
  retrievedAt: '2026-10-14T05:10:00Z',
};

const FEEDS: WarningFeedStatus[] = [...ws.feeds, ptwc.status];

const input: SituationInput = {
  airQuality: loadAqSnapshot(),
  wind10m: loadWindSnapshot('10m'),
  wind925: loadWindSnapshot('925hPa'),
  hazeSources: hazeSourcesFromFixtures(fx),
  hotspotSnapshot: fx.snapshot,
  nea: loadNeaSnapshot(),
  warnings: [...ws.warnings, ...ptwc.warnings, TRICKY],
  warningFeeds: FEEDS,
  ashWind: loadAshWindSnapshot(),
  riverFlow: loadFloodModelSnapshot(),
  quakes: loadQuakesSnapshot(),
};

const report = situationReport(input);
const compose: ComposeInput = {
  report,
  cityTable: cityHazeTable(input.airQuality),
  warnings: input.warnings,
  catalogue: buildSourceCatalogue(input),
  incidentBrief: { title: 'Merapi, day 7', text: 'ASEAN WATCH - INCIDENT BRIEF\n=====\nbody line' },
};
const ALL = EXPORT_SECTIONS.map((s) => s.key);

describe('composeReport / toMarkdown', () => {
  const md = buildReportMarkdown(compose, ALL, { periodLabel: '14 to 15 Oct 2026', analystName: 'A. Analyst', organisation: 'Haze Watch Assoc.' });

  it('has a header, the disclaimer top and bottom, freshness, gaps and a numbered citation list', () => {
    expect(md.startsWith('# ASEAN Watch situation report\n')).toBe(true);
    expect(md).toContain('- Period: 14 to 15 Oct 2026');
    expect(md).toContain('- Prepared by: A. Analyst, Haze Watch Assoc.');
    expect(md.match(/Not an official warning service; follow the issuing agency\./g)?.length).toBe(2);
    expect(md).not.toContain('ASEAN Watch is not an official warning service');
    expect(md).toContain('## Data freshness and gaps');
    expect(md).toContain('### What this report cannot see');
    expect(md).toContain('## Sources cited');
    expect(md).toMatch(/\n1\. CAMS global atmospheric composition forecast/);
  });

  it('numbers citations by first use, and every [n] in the text has an entry', () => {
    const doc = composeReport(compose, ALL, {});
    const max = doc.citations.length;
    expect(max).toBeGreaterThan(5);
    const refs = [...md.matchAll(/\\\[(\d+(?:, \d+)*)\\\]/g)].flatMap((m) => m[1].split(', ').map(Number));
    expect(refs.length).toBeGreaterThan(0);
    for (const n of refs) expect(n >= 1 && n <= max).toBe(true);
    expect(new Set(doc.citations.map((c) => c.id)).size).toBe(max);
  });

  it('includes the full city table, the transport section, every message and the brief', () => {
    expect(md).toContain('### Every tracked place (modelled CAMS PM2.5, µg/m³)');
    expect(md).toContain('| Palangka Raya (ID) |');
    expect(md).toContain('### Smoke transport toward Singapore');
    expect(md).toContain('### Every relayed message, verbatim');
    expect(md).toContain('```text\nASEAN WATCH - INCIDENT BRIEF\n=====\nbody line\n```');
    expect(md).toContain('## Sources and methods');
    expect(md).toContain('### Official');
  });

  it('keeps official text verbatim: escaping changes only how characters are written', () => {
    const escaped = mdEscape(TRICKY.headline);
    expect(escaped).toBe('Peringatan \\| \\*Dini\\* Tsunami\\_uji \\[1\\] \\#2');
    expect(escaped.replace(/\\(.)/g, '$1')).toBe(TRICKY.headline);
    expect(md).toContain(escaped);
    // The instruction is quoted line by line, and a leading "1." does not become a list.
    expect(md).toContain('> Segera menjauhi pantai.\n> 1\\. Ikuti arahan BPBD.');
  });

  it('leaves URLs intact as autolinks', () => {
    expect(mdEscape('See https://data.gov.sg/datasets/d_534cf203023b51f51f879145ccc56ff9/view.')).toBe(
      'See <https://data.gov.sg/datasets/d_534cf203023b51f51f879145ccc56ff9/view>.',
    );
  });

  it('follows the section choice and the fixed order', () => {
    const only = buildReportMarkdown(compose, ['warnings', 'situation'], {});
    expect(only.indexOf('## Situation summary')).toBeLessThan(only.indexOf('## Official warnings by hazard'));
    expect(only).not.toContain('## Haze and air quality');
    expect(only).not.toContain('## Sources and methods');
    expect(only).not.toContain('Watch-area brief');
    expect(only).toContain('## Data freshness and gaps');
    expect(only).not.toContain('Prepared by');
    expect(only).not.toContain('Composed:');
  });

  it('skips the brief when none was generated, and is deterministic', () => {
    const a = buildReportMarkdown({ ...compose, incidentBrief: null }, DEFAULT_EXPORT_SECTIONS, {});
    const b = buildReportMarkdown({ ...compose, incidentBrief: null }, DEFAULT_EXPORT_SECTIONS, {});
    expect(a).toBe(b);
    expect(a).not.toContain('Watch-area brief');
  });

  it('writes the compose time only when given', () => {
    expect(buildReportMarkdown(compose, ['situation'], { generatedAt: '2026-10-15T08:00:00Z' })).toContain('- Composed: 2026-10-15 08:00 UTC');
  });

  it('renders a well-formed table', () => {
    const doc = { title: 't', citations: [], blocks: [{ kind: 'table' as const, columns: ['A', 'B'], numeric: [false, true], rows: [['x|y', '2']] }] };
    expect(toMarkdown(doc)).toBe('| A | B |\n| --- | ---: |\n| x\\|y | 2 |\n');
  });
});

describe('toPlainText', () => {
  const txt = buildReportText(compose, ALL, { analystName: 'A. Analyst' });

  it('keeps the structure and the disclaimer', () => {
    expect(txt.startsWith('ASEAN WATCH SITUATION REPORT\n')).toBe(true);
    expect(txt).toContain('SOURCES CITED');
    expect(txt).toContain('Not an official warning service; follow the issuing agency.');
    expect(txt).not.toContain('\\|');
  });

  it('wraps at 100 columns except for unbreakable words and the verbatim brief', () => {
    const long = txt.split('\n').filter((l) => l.length > 100);
    for (const l of long) expect(/\S{60,}/.test(l) || l.startsWith('ASEAN WATCH - INCIDENT')).toBe(true);
  });

  it('wraps with a hanging indent', () => {
    expect(wrapText('one two three', '  - ', '    ')).toEqual(['  - one two three']);
    const lines = wrapText('word '.repeat(30).trim(), '  - ', '    ');
    expect(lines.length).toBe(2);
    expect(lines[1].startsWith('    word')).toBe(true);
  });
});

describe('reportFilename', () => {
  it('names the file after the model hour', () => {
    expect(reportFilename(report, 'md')).toBe('asean-watch-situation_20261014-0600.md');
    expect(reportFilename({ anchorISO: null }, 'txt')).toBe('asean-watch-situation_undated.txt');
    expect(reportFilename({ anchorISO: null }, 'txt', { generatedAt: '2026-10-15T08:30:00Z' })).toBe('asean-watch-situation_20261015-0830.txt');
  });
});

describe('buildSourceCatalogue', () => {
  const cat = buildSourceCatalogue(input);

  it('lists every source in group order with a licence, a link and its limitations', () => {
    const groups = groupSources(cat).map((g) => g.group);
    expect(groups).toEqual(['Official', 'Measured', 'Modelled', 'Imagery', 'Reference']);
    for (const e of cat) {
      expect(e.licence.length).toBeGreaterThan(3);
      expect(e.url).toMatch(/^https:\/\//);
      expect(Array.isArray(e.limitations)).toBe(true);
    }
    const ids = cat.map((e) => e.id);
    for (const id of ['asmc', 'nea', 'cams', 'wind-925', 'wind-10m', 'ash-wind', 'glofas', 'trajectories', 'gibs-himawari', 'nus-crisp', 'ioc-sea-level']) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mirrors each official feed status, never hiding an unavailable feed', () => {
    const withDown = buildSourceCatalogue({ ...input, warningFeeds: [{ ...FEEDS[0], status: 'unavailable', retrievedAt: null }] });
    const down = withDown.find((e) => e.id === `feed:${FEEDS[0].feedId}`);
    expect(down?.mode).toBe('UNAVAILABLE');
    expect(down?.modeNote).toBe(`Official feed unavailable: check ${FEEDS[0].issuer} directly.`);
    expect(cat.find((e) => e.id === 'feed:magma-level-list')?.mode).toBe('RECORDED COPY');
    expect(cat.find((e) => e.id === 'feed:gdacs')?.group).toBe('Modelled');
    expect(cat.find((e) => e.id === 'cams')?.mode).toBe('SNAPSHOT');
    expect(cat.find((e) => e.id === 'asmc')?.mode).toBe('LINK ONLY');
  });

  it('lists each FIRMS sensor file with its own times', () => {
    const firms = cat.filter((e) => e.id.startsWith('firms:'));
    expect(firms.length).toBe(4);
    expect(firms.every((e) => e.retrievedAt === '2026-10-13T07:26:44Z' && e.modeNote?.startsWith('File last modified'))).toBe(true);
  });
});
