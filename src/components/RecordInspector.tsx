// Record inspector: a side panel with the fields a reviewer needs first, then every other field of the
// Observation (and the raw record) under "All fields".
import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { EvidenceItem, Observation, ReplayStep } from '../types';
import Dialog from './Dialog';
import { CountedPill, ExternalLink, ModeBadge } from './Badges';
import { categoryLabel, formatUtc, formatValue, safeHttpUrl } from './format';

export interface RecordInspectorProps {
  item: EvidenceItem | null;
  incidentTitle: string | null;
  steps: ReplayStep[];
  onClose: () => void;
}

const KNOWN_FIELDS = new Set<string>([
  'id',
  'incidentId',
  'observedAt',
  'ingestedAt',
  'category',
  'value',
  'unit',
  'sourceName',
  'sourceUrl',
  'dataMode',
  'qualityNote',
  'summary',
  'anomaly',
  'anomalyReason',
  'replayStep',
] satisfies (keyof Observation)[]);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Raw({ value }: { value: unknown }) {
  return <code className="raw">{value === null ? 'null' : value === undefined ? 'not set' : String(value)}</code>;
}

export default function RecordInspector({ item, incidentTitle, steps, onClose }: RecordInspectorProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const o = item?.observation;
  const stepLabel = o ? steps.find((s) => s.index === o.replayStep)?.label : undefined;
  const extraFields = o ? Object.keys(o).filter((k) => !KNOWN_FIELDS.has(k)) : [];

  return (
    <Dialog open={item !== null} onClose={onClose} labelledBy="inspector-title" className="drawer" initialFocus={closeRef}>
      {item && o && (
        <div className="drawer-inner">
          <header className="drawer-head">
            <div className="drawer-head-text">
              <p className="eyebrow">
                Record inspector · <ModeBadge mode={o.dataMode} />
              </p>
              <h2 id="inspector-title">{o.summary?.trim() || o.id}</h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="btn"
              onClick={(e) => e.currentTarget.closest('dialog')?.close()}
            >
              Close<span className="visually-hidden"> record inspector</span>
            </button>
          </header>

          <div className="drawer-body">
            <dl className="fields">
              <Field label="Value">{formatValue(o.value, o.unit)}</Field>
              <Field label="Observed (scenario time)">{formatUtc(o.observedAt)}</Field>
              <Field label="Ingested (scenario time)">{formatUtc(o.ingestedAt)}</Field>
              <Field label="Data mode">
                <ModeBadge mode={o.dataMode} />
              </Field>
              <Field label="Source">
                {o.sourceName || 'Not recorded'}
                <br />
                {safeHttpUrl(o.sourceUrl) ? (
                  <ExternalLink href={o.sourceUrl} className="url">
                    {o.sourceUrl}
                  </ExternalLink>
                ) : (
                  <Raw value={o.sourceUrl} />
                )}
              </Field>
              <Field label="Quality note">{o.qualityNote?.trim() || 'None recorded.'}</Field>
              <Field label="Review treatment">
                <CountedPill counted={item.counted} /> {item.reason}
              </Field>
              <Field label="Anomaly flag (demo data)">
                {o.anomaly ? (o.anomalyReason ?? 'Flagged; no reason recorded.') : 'Not flagged'}
              </Field>
            </dl>

            <details className="disclosure all-fields">
              <summary>All fields</summary>
              <div className="disclosure-body">
                <dl className="fields">
                  <Field label="Record id">
                    <code>{o.id}</code>
                  </Field>
                  <Field label="Incident">
                    {incidentTitle ? `${incidentTitle} ` : ''}
                    <code>{o.incidentId}</code>
                  </Field>
                  <Field label="Category">{categoryLabel(o.category)}</Field>
                  <Field label="Unit">{o.unit ?? 'None (text value)'}</Field>
                  <Field label="Summary">{o.summary?.trim() || 'None recorded.'}</Field>
                  <Field label="Anomaly">{o.anomaly ? 'true' : 'false'}</Field>
                  <Field label="Replay step">
                    {o.replayStep}
                    {stepLabel ? ` (${stepLabel})` : ''}
                  </Field>
                  <Field label="Observed at (raw)">
                    <Raw value={o.observedAt} />
                  </Field>
                  <Field label="Ingested at (raw)">
                    <Raw value={o.ingestedAt} />
                  </Field>
                  {extraFields.map((k) => (
                    <Field key={k} label={k}>
                      <Raw value={JSON.stringify((o as unknown as Record<string, unknown>)[k])} />
                    </Field>
                  ))}
                </dl>
                <h3 className="mini-title">Raw record</h3>
                <pre className="raw-json">{JSON.stringify(o, null, 2)}</pre>
              </div>
            </details>
          </div>
        </div>
      )}
    </Dialog>
  );
}
