// Report composer for the analyst workspace (docs/UX_V3.md section 3, "Report"). Pure: it turns a
// SituationReport (src/lib/situation.ts) plus optional extras into a document model, then renders it as
// Markdown or plain text. No clock reads: the "generated" time is passed in by the caller. Nothing is
// sent anywhere; the analyst name and organisation only go into the text the analyst downloads.
//
// Every export carries: a header, the disclaimer (top and bottom), the data-freshness lines and gaps,
// and a numbered citation list of every source the included sections cite. Official text stays verbatim
// (Markdown escapes only change how characters are written, not what they say).
import type { OfficialWarning } from '../types';
import { compareWarnings } from './warnings';
import { endedLabel } from './warningsView';
import { HAZE_FUTURE_H, SITUATION_DISCLAIMER, pmText, utcStamp, warningModeText, whoMultipleText } from './situation';
import type { CityHazeTable, Citation, ReportBlock, ReportFigure, ReportSection, ReportSectionId, SituationReport } from './situation';
import { groupSources } from './sourceCatalogue';
import type { SourceEntry } from './sourceCatalogue';

export type ExportSectionKey = 'situation' | 'haze' | 'fires' | 'volcanoes' | 'warnings' | 'water' | 'sources' | 'brief';

export const EXPORT_SECTIONS: ReadonlyArray<{ key: ExportSectionKey; label: string; hint: string }> = [
  { key: 'situation', label: 'Situation summary', hint: 'Headline, key figures, what changed, one line per hazard' },
  { key: 'haze', label: 'Haze and air quality', hint: 'Worst places, the full city table, NEA Singapore, smoke transport toward Singapore' },
  { key: 'fires', label: 'Fires', hint: 'Hotspot counts and regions (when a fire summary is loaded)' },
  { key: 'volcanoes', label: 'Volcanoes', hint: 'Official levels verbatim, ash-drift scenario numbers' },
  { key: 'warnings', label: 'Official warnings', hint: 'Every relayed message, verbatim, with feed status' },
  { key: 'water', label: 'Water and tsunami', hint: 'Modelled river flow, tsunami and flood messages' },
  { key: 'sources', label: 'Sources and methods', hint: 'Every feed with its licence, mode, time and limitations' },
  { key: 'brief', label: 'Watch-area brief', hint: 'The deterministic brief for the selected watch area and day' },
];

export const DEFAULT_EXPORT_SECTIONS: readonly ExportSectionKey[] = ['situation', 'haze', 'fires', 'volcanoes', 'warnings', 'water', 'sources'];

export interface ReportMeta {
  /** Free text, e.g. "14 to 15 October 2026". */
  periodLabel?: string | null;
  analystName?: string | null;
  organisation?: string | null;
  /** ISO 8601 UTC time the report was composed (the caller's clock); omitted for a fully deterministic file. */
  generatedAt?: string | null;
}

export interface ComposeInput {
  report: SituationReport;
  /** Full city table (cityHazeTable) for the haze section. */
  cityTable?: CityHazeTable | null;
  /** Every relayed message (App's allWarnings) for the full warnings list. */
  warnings?: readonly OfficialWarning[] | null;
  /** buildSourceCatalogue(...) for the sources section. */
  catalogue?: readonly SourceEntry[] | null;
  /** The per-watch deterministic brief (BriefPanel's text), when one has been generated. */
  incidentBrief?: { title: string; text: string } | null;
}

export type DocBlock =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'p'; text: string; small?: boolean }
  | { kind: 'ul'; items: readonly string[] }
  | { kind: 'ol'; items: readonly string[] }
  | { kind: 'table'; columns: readonly string[]; rows: ReadonlyArray<readonly string[]>; numeric?: readonly boolean[]; caption?: string }
  | { kind: 'quote'; text: string }
  | { kind: 'pre'; text: string }
  | { kind: 'hr' };

export interface ReportDoc {
  title: string;
  blocks: DocBlock[];
  /** Citations in the order they are numbered in the document. */
  citations: Citation[];
}

// ---------------------------------------------------------------------------
// Composition

const SECTION_FOR_KEY: Record<Exclude<ExportSectionKey, 'sources' | 'brief'>, ReportSectionId[]> = {
  situation: ['overview'],
  haze: ['haze', 'transport'],
  fires: ['fires'],
  volcanoes: ['volcanoes'],
  warnings: ['warnings'],
  water: ['water'],
};

function citationLine(c: Citation): string {
  const when = c.time ? `${c.timeKind} ${utcStamp(c.time)}` : c.mode === 'LINK' ? 'linked, not ingested' : 'time not given';
  const parts = [`${c.label}. ${c.basis}, ${c.mode === 'SNAPSHOT' ? 'bundled snapshot' : c.mode === 'RECORDED' ? 'recorded copy' : c.mode.toLowerCase()}, ${when}.`];
  if (c.url) parts.push(c.url);
  if (c.licence) parts.push(c.licence);
  return parts.join(' ');
}

/** Compose the document for the chosen sections. Order follows EXPORT_SECTIONS, whatever order `sections` has. */
export function composeReport(input: ComposeInput, sections: readonly ExportSectionKey[], meta: ReportMeta = {}): ReportDoc {
  const { report } = input;
  const chosen = new Set(sections);
  const blocks: DocBlock[] = [];
  const numbers = new Map<string, number>();
  const byId = new Map(report.citations.map((c) => [c.id, c]));
  const ref = (ids: readonly string[]): string => {
    const nums: number[] = [];
    for (const id of ids) {
      if (!byId.has(id)) continue;
      if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
      nums.push(numbers.get(id) as number);
    }
    const uniq = [...new Set(nums)].sort((a, b) => a - b);
    return uniq.length > 0 ? ` [${uniq.join(', ')}]` : '';
  };

  // Header
  blocks.push({ kind: 'h1', text: report.title });
  const headerItems: string[] = [];
  if (meta.periodLabel?.trim()) headerItems.push(`Period: ${meta.periodLabel.trim()}`);
  const who = [meta.analystName?.trim(), meta.organisation?.trim()].filter((x): x is string => Boolean(x));
  if (who.length > 0) headerItems.push(`Prepared by: ${who.join(', ')}`);
  if (report.anchorISO) {
    headerItems.push(
      `Model hour described: ${utcStamp(report.anchorISO)} (${report.headline.freshness === 'LIVE' ? 'live model run' : 'bundled snapshot run'}, retrieved ${utcStamp(report.headline.asOf)})`,
    );
  } else {
    headerItems.push('Model hour described: none (the air-quality model was not loaded)');
  }
  if (meta.generatedAt) headerItems.push(`Composed: ${utcStamp(meta.generatedAt)}`);
  headerItems.push('Labels: MODELLED = forecast model; MEASURED = stations or satellites; OFFICIAL = relayed verbatim from the issuing agency.');
  blocks.push({ kind: 'ul', items: headerItems });
  blocks.push({ kind: 'quote', text: SITUATION_DISCLAIMER });

  const sectionById = new Map(report.sections.map((s) => [s.id, s]));
  const emitSection = (s: ReportSection, level: 'h2' | 'h3') => {
    blocks.push({ kind: level, text: s.title });
    emitSectionBody(s, blocks, ref);
  };

  for (const { key } of EXPORT_SECTIONS) {
    if (!chosen.has(key)) continue;
    if (key === 'sources') continue; // after the freshness lines
    if (key === 'brief') {
      if (!input.incidentBrief) continue;
      blocks.push({ kind: 'h2', text: `Watch-area brief: ${input.incidentBrief.title}` });
      blocks.push({
        kind: 'p',
        text: 'The deterministic brief for the selected watch area and replay day, exactly as generated by ASEAN Watch (plain text).',
      });
      blocks.push({ kind: 'pre', text: input.incidentBrief.text.replace(/\s+$/, '') });
      continue;
    }
    const ids = SECTION_FOR_KEY[key];
    const secs = ids.map((id) => sectionById.get(id)).filter((s): s is ReportSection => Boolean(s));
    if (secs.length === 0) continue;
    if (key === 'situation') {
      const s = secs[0];
      blocks.push({ kind: 'h2', text: 'Situation summary' });
      blocks.push({ kind: 'p', text: `${report.headline.text}${ref(s.figures.length ? [s.figures[0].cite] : [])}` });
      if (s.figures.length > 0) blocks.push(figuresTable(s.figures, ref));
      const summaries = s.blocks.find((b) => b.kind === 'bullets');
      if (summaries && summaries.kind === 'bullets') blocks.push({ kind: 'ul', items: summaries.items });
      if (report.whatChanged.length > 0) {
        blocks.push({ kind: 'h3', text: 'What changed' });
        blocks.push({ kind: 'ul', items: report.whatChanged });
      }
      const caveat = s.blocks.find((b) => b.kind === 'caveat');
      if (caveat && caveat.kind === 'caveat') blocks.push({ kind: 'p', text: caveat.text, small: true });
      continue;
    }
    if (key === 'haze') {
      blocks.push({ kind: 'h2', text: secs[0].title });
      emitSectionBody(secs[0], blocks, ref);
      if (input.cityTable) blocks.push(...cityTableBlocks(input.cityTable, ref));
      if (secs[1]) emitSection(secs[1], 'h3');
      continue;
    }
    if (key === 'warnings') {
      emitSection(secs[0], 'h2');
      if (input.warnings && input.warnings.length > 0) blocks.push(...fullWarningsBlocks(input.warnings));
      continue;
    }
    for (const s of secs) emitSection(s, 'h2');
  }

  // Freshness and gaps: always.
  blocks.push({ kind: 'h2', text: 'Data freshness and gaps' });
  blocks.push({ kind: 'ul', items: report.freshness.map((f) => f.text) });
  if (report.gaps.length > 0) {
    blocks.push({ kind: 'h3', text: 'What this report cannot see' });
    blocks.push({ kind: 'ul', items: report.gaps });
  }

  if (chosen.has('sources') && input.catalogue && input.catalogue.length > 0) {
    blocks.push(...sourcesBlocks(input.catalogue));
  }

  // Citation list: every source the included text cites, numbered in first-use order.
  const cited = [...numbers.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => byId.get(id) as Citation);
  blocks.push({ kind: 'h2', text: 'Sources cited' });
  if (cited.length > 0) blocks.push({ kind: 'ol', items: cited.map(citationLine) });
  else blocks.push({ kind: 'p', text: 'No sourced figure is included in the sections chosen.' });
  blocks.push({ kind: 'hr' });
  blocks.push({ kind: 'p', text: SITUATION_DISCLAIMER, small: true });
  blocks.push({ kind: 'p', text: 'Generated by ASEAN Watch (https://asean-watch.vercel.app/) from real data; modelled values are context, not observations.', small: true });

  return { title: report.title, blocks, citations: cited };
}

function emitSectionBody(s: ReportSection, blocks: DocBlock[], ref: (ids: readonly string[]) => string): void {
  // The summary is skipped when a paragraph below already opens with it.
  const repeated = s.blocks.some((b) => b.kind === 'paragraph' && b.text.startsWith(s.summary));
  if (!repeated) blocks.push({ kind: 'p', text: s.summary });
  if (s.figures.length > 0) blocks.push(figuresTable(s.figures, ref));
  for (const b of s.blocks) blocks.push(...renderBlock(b, ref));
}

function figuresTable(figures: readonly ReportFigure[], ref: (ids: readonly string[]) => string): DocBlock {
  return {
    kind: 'table',
    columns: ['Figure', 'Value', 'Note', 'Basis', 'Time (UTC)', 'Source'],
    numeric: [false, true, false, false, false, false],
    rows: figures.map((f) => [
      f.label,
      f.unit ? `${f.value} ${f.unit}` : f.value,
      f.note ?? '',
      f.basis,
      f.time ? utcStamp(f.time).replace(' UTC', '') : '—',
      ref([f.cite]).trim() || '—',
    ]),
  };
}

function renderBlock(b: ReportBlock, ref: (ids: readonly string[]) => string): DocBlock[] {
  switch (b.kind) {
    case 'paragraph':
      return [{ kind: 'p', text: `${b.text}${ref(b.cites)}` }];
    case 'bullets': {
      const out: DocBlock[] = [{ kind: 'ul', items: b.items }];
      const r = ref(b.cites);
      if (r) out.push({ kind: 'p', text: `Sources:${r}`, small: true });
      return out;
    }
    case 'table':
      return [{ kind: 'table', columns: b.columns, rows: b.rows, numeric: b.numeric, caption: `${b.caption}${ref(b.cites)}` }];
    case 'caveat':
      return [{ kind: 'p', text: `Note: ${b.text}`, small: true }];
    default:
      return [];
  }
}

function cityTableBlocks(t: CityHazeTable, ref: (ids: readonly string[]) => string): DocBlock[] {
  const run = t.dataMode === 'live' ? 'live run' : 'bundled snapshot run';
  return [
    { kind: 'h3', text: 'Every tracked place (modelled CAMS PM2.5, µg/m³)' },
    {
      kind: 'table',
      caption:
        `MODELLED, ${run} retrieved ${utcStamp(t.retrievedAt)}; model hour ${utcStamp(t.anchorISO)}. "× WHO" divides the 24 h mean up to the model hour by the WHO ` +
        `24-hour guideline (15 µg/m³). Peaks use the run's ${t.stepHours}-hourly values; local times with UTC.${ref(['cams'])}`,
      columns: ['Place', t.dataMode === 'live' ? 'Now' : 'Snapshot hour', 'Band', '24 h mean', '× WHO', '24 h peak (local time)', `${HAZE_FUTURE_H} h peak (local time)`, 'Trend'],
      numeric: [false, true, false, true, true, false, false, false],
      rows: t.rows.map((r) => [
        `${r.name} (${r.country})`,
        pmText(r.now),
        r.nowBand?.label ?? '—',
        pmText(r.mean24hPast),
        whoMultipleText(r.mean24hPast),
        `${pmText(r.peak24h.value)} at ${r.peak24h.localLabel}`,
        `${pmText(r.peak48h.value)} at ${r.peak48h.localLabel}`,
        r.trend ?? '—',
      ]),
    },
  ];
}

function fullWarningsBlocks(warnings: readonly OfficialWarning[]): DocBlock[] {
  const sorted = [...warnings].sort(compareWarnings);
  const official = sorted.filter((w) => w.authority === 'official');
  const aggregator = sorted.filter((w) => w.authority === 'aggregator');
  // As relayed (judged at retrieval): a message the issuer ended before its expiry reads ENDED, never
  // "EXPIRED <a time still ahead>" (endedLabel).
  const status = (w: OfficialWarning) => {
    const ended = endedLabel(w, Date.parse(w.retrievedAt));
    if (ended) return ended.text === 'EXPIRED' ? `EXPIRED ${utcStamp(ended.at)}` : 'ENDED by the issuer';
    return w.expiresAt ? `in force as relayed; expires ${utcStamp(w.expiresAt)}` : 'in force as relayed';
  };
  const rows = (list: readonly OfficialWarning[]) =>
    list.map((w) => [
      w.issuer,
      w.levelGloss ? `${w.level} [${w.levelGloss}]` : w.level,
      w.headline,
      w.areaDescription || '—',
      w.issuedAt ? utcStamp(w.issuedAt) : `not published (retrieved ${utcStamp(w.retrievedAt)})`,
      `${warningModeText(w)}; ${status(w)}`,
    ]);
  const out: DocBlock[] = [{ kind: 'h3', text: 'Every relayed message, verbatim' }];
  out.push({
    kind: 'table',
    caption: 'OFFICIAL messages as relayed, newest first. Text is the issuer\'s own; glosses in [brackets] are fixed, reviewed English notes. Follow each issuer for current instructions.',
    columns: ['Issuer', 'Level (verbatim)', 'Headline (verbatim)', 'Area', 'Issued', 'Mode and status'],
    rows: rows(official),
  });
  const withInstruction = official.filter((w) => w.instruction && !w.ended);
  if (withInstruction.length > 0) {
    out.push({ kind: 'h3', text: 'Official instructions, verbatim' });
    for (const w of withInstruction) {
      out.push({ kind: 'p', text: `${w.issuer}, ${w.areaDescription || w.headline} (${w.issuedAt ? utcStamp(w.issuedAt) : 'no issue time'}; ${warningModeText(w)}):` });
      out.push({ kind: 'quote', text: w.instruction as string });
    }
  }
  if (aggregator.length > 0) {
    out.push({
      kind: 'table',
      caption: 'GDACS items: an aggregator\'s impact estimates, NOT official warnings.',
      columns: ['Issuer', 'Alert colour', 'Headline', 'Area', 'Issued', 'Mode and status'],
      rows: rows(aggregator),
    });
  }
  return out;
}

function sourcesBlocks(catalogue: readonly SourceEntry[]): DocBlock[] {
  const out: DocBlock[] = [{ kind: 'h2', text: 'Sources and methods' }];
  for (const g of groupSources(catalogue)) {
    out.push({ kind: 'h3', text: g.group });
    out.push({ kind: 'p', text: g.blurb, small: true });
    out.push({
      kind: 'table',
      columns: ['Source', 'Issuer', 'Mode', 'Retrieved (UTC)', 'Licence or attribution', 'Limitations'],
      rows: g.entries.map((e) => [
        `${e.name} (${e.url})`,
        e.issuer,
        e.mode,
        e.retrievedAt ? utcStamp(e.retrievedAt).replace(' UTC', '') : '—',
        e.licence,
        e.limitations.join(' ') || '—',
      ]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown

const URL_RE = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

/** Escape Markdown syntax in prose, leaving URLs intact (as autolinks). Text stays the same when rendered. */
export function mdEscape(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    out += escapeChunk(text.slice(last, at));
    out += `<${m[0]}>`;
    last = at + m[0].length;
  }
  out += escapeChunk(text.slice(last));
  return out;
}

function escapeChunk(s: string): string {
  return s.replace(/([\\`*_[\]<>#|~])/g, '\\$1');
}

function mdCell(text: string): string {
  return mdEscape(text).replace(/\r?\n/g, '<br>');
}

function mdLines(text: string): string {
  // A line starting with "1." or "-" would become a list; escape the first character.
  return mdEscape(text).replace(/^(\s*)(\d+)\.(\s)/gm, '$1$2\\.$3').replace(/^(\s*)([-+])(\s)/gm, '$1\\$2$3');
}

export function toMarkdown(doc: ReportDoc): string {
  const out: string[] = [];
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'h1':
        out.push(`# ${mdEscape(b.text)}`, '');
        break;
      case 'h2':
        out.push(`## ${mdEscape(b.text)}`, '');
        break;
      case 'h3':
        out.push(`### ${mdEscape(b.text)}`, '');
        break;
      case 'p':
        out.push(b.small ? `<small>${mdLines(b.text)}</small>` : mdLines(b.text), '');
        break;
      case 'ul':
        for (const item of b.items) out.push(`- ${mdLines(item).replace(/\n/g, '\n  ')}`);
        out.push('');
        break;
      case 'ol':
        b.items.forEach((item, i) => out.push(`${i + 1}. ${mdLines(item).replace(/\n/g, '\n   ')}`));
        out.push('');
        break;
      case 'table': {
        if (b.caption) out.push(`*${mdEscape(b.caption)}*`, '');
        out.push(`| ${b.columns.map(mdCell).join(' | ')} |`);
        out.push(`| ${b.columns.map((_, i) => (b.numeric?.[i] ? '---:' : '---')).join(' | ')} |`);
        for (const row of b.rows) out.push(`| ${b.columns.map((_, i) => mdCell(row[i] ?? '')).join(' | ')} |`);
        out.push('');
        break;
      }
      case 'quote':
        out.push(...mdLines(b.text).split('\n').map((l) => `> ${l}`), '');
        break;
      case 'pre': {
        const fence = b.text.includes('```') ? '~~~~' : '```';
        out.push(`${fence}text`, b.text, fence, '');
        break;
      }
      case 'hr':
        out.push('---', '');
        break;
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Plain text (100 columns, like the watch-area brief)

const WIDTH = 100;

/** Word-wrap with a first-line and a hanging prefix; very long words (URLs) get their own line, unbroken. */
export function wrapText(text: string, firstPrefix = '', restPrefix: string = ' '.repeat(firstPrefix.length)): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  paragraphs.forEach((para, pi) => {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    const lead = pi === 0 ? firstPrefix : restPrefix;
    if (words.length === 0) {
      lines.push(lead.trimEnd());
      return;
    }
    let line = lead + words[0];
    for (const w of words.slice(1)) {
      if (line.length + 1 + w.length <= WIDTH) line += ` ${w}`;
      else {
        lines.push(line);
        line = restPrefix + w;
      }
    }
    lines.push(line);
  });
  return lines;
}

function textTable(b: Extract<DocBlock, { kind: 'table' }>): string[] {
  const out: string[] = [];
  if (b.caption) out.push(...wrapText(b.caption), '');
  const widths = b.columns.map((c, i) => Math.max(c.length, ...b.rows.map((r) => (r[i] ?? '').length)));
  const total = widths.reduce((a, w) => a + w, 0) + 2 * (widths.length - 1);
  const hasNewlines = b.rows.some((r) => r.some((c) => c.includes('\n')));
  if (total <= WIDTH && !hasNewlines) {
    const fmt = (cells: readonly string[]) =>
      cells.map((c, i) => (b.numeric?.[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ').trimEnd();
    out.push(fmt(b.columns), widths.map((w) => '-'.repeat(w)).join('  '));
    for (const r of b.rows) out.push(fmt(b.columns.map((_, i) => r[i] ?? '')));
    return out;
  }
  // Too wide for 100 columns: one record per row, "Column: value".
  const lw = Math.min(24, Math.max(...b.columns.map((c) => c.length)) + 2);
  b.rows.forEach((r, ri) => {
    if (ri > 0) out.push('');
    b.columns.forEach((c, i) => {
      const prefix = `  ${`${c}:`.padEnd(lw)}`;
      out.push(...wrapText(r[i] ?? '', prefix, ' '.repeat(prefix.length)));
    });
  });
  return out;
}

export function toPlainText(doc: ReportDoc): string {
  const out: string[] = [];
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'h1':
        out.push(b.text.toUpperCase(), '='.repeat(Math.min(WIDTH, b.text.length)), '');
        break;
      case 'h2':
        out.push('', b.text.toUpperCase(), '-'.repeat(Math.min(WIDTH, b.text.length)), '');
        break;
      case 'h3':
        out.push(b.text, '~'.repeat(Math.min(WIDTH, b.text.length)), '');
        break;
      case 'p':
        out.push(...wrapText(b.text), '');
        break;
      case 'ul':
        for (const item of b.items) out.push(...wrapText(item, '  - ', '    '));
        out.push('');
        break;
      case 'ol':
        b.items.forEach((item, i) => {
          const p = `  ${i + 1}. `;
          out.push(...wrapText(item, p, ' '.repeat(p.length)));
        });
        out.push('');
        break;
      case 'table':
        out.push(...textTable(b), '');
        break;
      case 'quote':
        out.push(...wrapText(b.text, '  | ', '  | '), '');
        break;
      case 'pre':
        out.push(b.text, '');
        break;
      case 'hr':
        out.push('='.repeat(WIDTH), '');
        break;
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Convenience

export function buildReportMarkdown(input: ComposeInput, sections: readonly ExportSectionKey[], meta: ReportMeta = {}): string {
  return toMarkdown(composeReport(input, sections, meta));
}

export function buildReportText(input: ComposeInput, sections: readonly ExportSectionKey[], meta: ReportMeta = {}): string {
  return toPlainText(composeReport(input, sections, meta));
}

/** "asean-watch-situation_20261014-0600.md": named after the model hour (or the compose time). */
export function reportFilename(report: Pick<SituationReport, 'anchorISO'>, ext: 'md' | 'txt', meta: ReportMeta = {}): string {
  const iso = report.anchorISO ?? meta.generatedAt ?? null;
  const ms = iso ? Date.parse(iso) : Number.NaN;
  const stamp = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-') : 'undated';
  return `asean-watch-situation_${stamp}.${ext}`;
}
