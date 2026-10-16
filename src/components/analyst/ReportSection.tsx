// Workspace section 7, "Report" (docs/UX_V3.md section 3): pick the sections, add a period and the analyst's
// name and organisation, then download Markdown or plain text, or copy the Markdown. Everything is composed
// in the browser from the data already loaded (src/lib/reportExport.ts); nothing is sent anywhere. The name
// and organisation are remembered in this browser only (localStorage), for convenience.
import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { downloadText } from '../../lib/briefing';
import { cityHazeTable, situationReport, utcStamp } from '../../lib/situation';
import type { SituationInput, SituationReport } from '../../lib/situation';
import { buildSourceCatalogue } from '../../lib/sourceCatalogue';
import {
  DEFAULT_EXPORT_SECTIONS,
  EXPORT_SECTIONS,
  composeReport,
  reportFilename,
  toMarkdown,
  toPlainText,
} from '../../lib/reportExport';
import type { ComposeInput, ExportSectionKey, ReportMeta } from '../../lib/reportExport';
import { AnalystSection, AnalystSubhead } from './AnalystSection';
import { FreshnessChip } from './reportParts';
import './workspaceSections.css';

export interface ReportSectionProps {
  /** Everything App already holds (see SituationInput). Memoise it in App. */
  input: SituationInput;
  /** A report already built from the same input (optional; built here otherwise). */
  report?: SituationReport | null;
  /** The deterministic brief for the selected watch area (App's brief?.text), offered as an optional section. */
  incidentBrief?: { title: string; text: string } | null;
  /** Slot under the composer, e.g. the existing <BriefPanel /> for the selected watch area. */
  children?: ReactNode;
}

const AUTHOR_KEY = 'asean-watch:report-author:v1';

function readAuthor(): { name: string; org: string } {
  try {
    const raw = globalThis.localStorage?.getItem(AUTHOR_KEY);
    if (!raw) return { name: '', org: '' };
    const v: unknown = JSON.parse(raw);
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      return { name: typeof o.name === 'string' ? o.name : '', org: typeof o.org === 'string' ? o.org : '' };
    }
  } catch {
    /* storage blocked or malformed: start empty */
  }
  return { name: '', org: '' };
}

function writeAuthor(name: string, org: string): void {
  try {
    if (!name && !org) globalThis.localStorage?.removeItem(AUTHOR_KEY);
    else globalThis.localStorage?.setItem(AUTHOR_KEY, JSON.stringify({ name, org }));
  } catch {
    /* storage blocked: the fields still work for this session */
  }
}

/** "14 October 2026" for the model hour, as a starting period label. */
function defaultPeriod(anchorISO: string | null): string {
  if (!anchorISO) return '';
  const d = new Date(anchorISO);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function ReportSection({ input, report, incidentBrief = null, children }: ReportSectionProps) {
  const ids = useId();
  const r = useMemo(() => report ?? situationReport(input), [report, input]);
  const compose = useMemo<ComposeInput>(
    () => ({
      report: r,
      cityTable: cityHazeTable(input.airQuality),
      warnings: input.warnings ?? null,
      catalogue: buildSourceCatalogue(input),
      incidentBrief,
    }),
    [r, input, incidentBrief],
  );

  const hasFires = Boolean(input.fires);
  const available = useMemo(() => EXPORT_SECTIONS.filter((s) => s.key !== 'fires' || hasFires), [hasFires]);
  const [checked, setChecked] = useState<ReadonlySet<ExportSectionKey>>(
    () => new Set<ExportSectionKey>([...DEFAULT_EXPORT_SECTIONS, ...(incidentBrief ? (['brief'] as const) : [])]),
  );
  const [period, setPeriod] = useState(() => defaultPeriod(r.anchorISO));
  const [author, setAuthor] = useState(readAuthor);
  const [status, setStatus] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    writeAuthor(author.name.trim(), author.org.trim());
  }, [author]);

  const chosen = useMemo(
    () => available.map((s) => s.key).filter((k) => checked.has(k) && (k !== 'brief' || incidentBrief !== null)),
    [available, checked, incidentBrief],
  );
  const meta = (generatedAt: string | null): ReportMeta => ({
    periodLabel: period,
    analystName: author.name,
    organisation: author.org,
    generatedAt,
  });
  const preview = useMemo(
    () => (showPreview ? toMarkdown(composeReport(compose, chosen, { periodLabel: period, analystName: author.name, organisation: author.org })) : ''),
    [showPreview, compose, chosen, period, author],
  );

  const toggle = (key: ExportSectionKey) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const download = (ext: 'md' | 'txt') => {
    try {
      const m = meta(nowIso());
      const doc = composeReport(compose, chosen, m);
      const text = ext === 'md' ? toMarkdown(doc) : toPlainText(doc);
      const name = reportFilename(r, ext, m);
      downloadText(text, name);
      setStatus(`Downloaded ${name} (${chosen.length} sections, ${doc.citations.length} sources cited).`);
    } catch (err) {
      setStatus(`The report could not be built: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const copy = async () => {
    const text = toMarkdown(composeReport(compose, chosen, meta(nowIso())));
    const ok = await copyText(text);
    setStatus(ok ? `Copied the Markdown report (${text.length.toLocaleString('en-US')} characters).` : 'Copy failed: your browser blocked the clipboard. Use Download instead.');
  };

  return (
    <AnalystSection
      id="ws-report"
      title="Report"
      meta={<FreshnessChip freshness={r.headline.freshness} chip={r.headline.chip} />}
      lede={
        <>
          Compose a report from the data on screen. Pick the sections, then download Markdown (headings, tables and a
          numbered source list) or plain text, or copy the Markdown into a document. Every figure keeps its label, time
          and source; official text stays verbatim; the disclaimer and the data-freshness lines are always included.
        </>
      }
    >
      <p className="anx-headline__text">{r.headline.text}</p>
      <p className="an-muted">
        {r.anchorISO
          ? `The report describes the model hour ${utcStamp(r.anchorISO)}; official messages and measurements keep their own times.`
          : 'No air-quality model is loaded, so the report covers fires, official messages and the other feeds only.'}
      </p>

      <form className="anx-form" onSubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend>Sections</legend>
          <div className="anx-checks">
            {available.map((s) => {
              const id = `${ids}-${s.key}`;
              const disabled = s.key === 'brief' && !incidentBrief;
              return (
                <label key={s.key} className="anx-check" htmlFor={id}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked.has(s.key) && !disabled}
                    disabled={disabled}
                    onChange={() => toggle(s.key)}
                    aria-describedby={`${id}-hint`}
                  />
                  <span>{s.label}</span>
                  <span id={`${id}-hint`} className="anx-check__hint">
                    {disabled ? 'Generate a brief for a watch area in Volcanoes first.' : s.hint}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend>Cover details</legend>
          <label className="anx-field">
            Period or time label
            <input type="text" value={period} placeholder="e.g. 14 to 15 October 2026" onChange={(e) => setPeriod(e.target.value)} />
          </label>
          <label className="anx-field">
            Analyst name
            <input
              type="text"
              autoComplete="name"
              value={author.name}
              onChange={(e) => setAuthor((a) => ({ ...a, name: e.target.value }))}
            />
          </label>
          <label className="anx-field">
            Organisation
            <input
              type="text"
              autoComplete="organization"
              value={author.org}
              onChange={(e) => setAuthor((a) => ({ ...a, org: e.target.value }))}
            />
          </label>
          <p className="an-muted">Kept in this browser only and written into the file you download; never sent anywhere.</p>
        </fieldset>

        <div className="anx-actions">
          <button type="button" className="btn btn-primary" onClick={() => download('md')} disabled={chosen.length === 0}>
            Download .md
          </button>
          <button type="button" className="btn" onClick={() => download('txt')} disabled={chosen.length === 0}>
            Download .txt
          </button>
          <button type="button" className="btn" onClick={() => void copy()} disabled={chosen.length === 0}>
            Copy to clipboard
          </button>
          <button type="button" className="btn" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? 'Hide preview' : 'Preview'}
          </button>
        </div>
        <p className="anx-status" role="status" aria-live="polite">
          {chosen.length === 0 ? 'Pick at least one section.' : status}
        </p>
      </form>

      {showPreview && (
        <>
          <AnalystSubhead>Markdown preview</AnalystSubhead>
          <pre className="anx-preview" tabIndex={0} aria-label="Markdown preview of the report">
            {preview}
          </pre>
        </>
      )}

      {children && (
        <section className="anx-slot" aria-label="Watch-area brief">
          {children}
        </section>
      )}

      <p className="an-note">{r.disclaimer}</p>
    </AnalystSection>
  );
}
