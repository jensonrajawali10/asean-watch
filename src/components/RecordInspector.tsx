// Record inspector: a side panel with the fields a reviewer needs first (value, times, data mode, source,
// quality note, review treatment, watch rule), then every other field and the raw record under "All fields".
import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { EvidenceItem, Observation, ReplayStep } from '../types';
import type { HotspotMember } from '../lib/fixtures';
import Dialog from './Dialog';
import { CountedPill, ExternalLink, ModeBadge } from './Badges';
import { categoryLabel, formatCoords, formatUtc, formatValue, safeHttpUrl } from './format';

export interface RecordInspectorProps {
  item: EvidenceItem | null;
  incidentTitle: string | null;
  steps: ReplayStep[];
  /** Individual hotspots behind a grouped thermal record (one satellite overpass); empty for other records. */
  members?: HotspotMember[];
  onClose: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-09T18:56:00Z" → "18:56" (the date is on the record). */
function clockOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function MembersTable({ members }: { members: HotspotMember[] }) {
  const hasDistance = members.some((m) => m.distanceKm !== null);
  return (
    <div className="members">
      <h3 className="mini-title">Hotspots in this record ({members.length})</h3>
      <table className="members-table">
        <thead>
          <tr>
            <th scope="col">Time (UTC)</th>
            <th scope="col">Position</th>
            {hasDistance && <th scope="col">Summit</th>}
            <th scope="col">FRP</th>
            <th scope="col">Confidence</th>
            <th scope="col">Rule</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>
                <time dateTime={m.observedAt}>{clockOf(m.observedAt)}</time>{' '}
                <span className="muted">{m.daynight === 'N' ? 'night' : m.daynight === 'D' ? 'day' : m.daynight}</span>
              </td>
              <td className="mono">{formatCoords(m.latitude, m.longitude)}</td>
              {hasDistance && <td className="mono">{m.distanceKm === null ? '—' : `${m.distanceKm.toFixed(1)} km`}</td>}
              <td className="mono">{formatValue(m.frp, 'MW')}</td>
              <td>
                {m.confidenceLabel}
                <span className="muted"> · {m.satellite}</span>
              </td>
              <td>{m.meetsRule ? 'meets rule' : 'below rule'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

export default function RecordInspector({ item, incidentTitle, steps, members = [], onClose }: RecordInspectorProps) {
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
                Record · {categoryLabel(o.category)} · <ModeBadge mode={o.dataMode} />
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
              <Field label="Observed">
                <time dateTime={o.observedAt}>{formatUtc(o.observedAt)}</time>
              </Field>
              <Field label="Ingested">
                <time dateTime={o.ingestedAt}>{formatUtc(o.ingestedAt)}</time>
              </Field>
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
              <Field label="Watch rule">
                {o.anomaly
                  ? (o.anomalyReason?.trim() ?? 'Flagged by a watch rule; no rule text recorded.')
                  : 'Not flagged by a watch rule.'}
              </Field>
            </dl>

            {members.length > 0 && <MembersTable members={members} />}

            <details className="disclosure all-fields">
              <summary>All fields</summary>
              <div className="disclosure-body">
                <dl className="fields">
                  <Field label="Record id">
                    <code>{o.id}</code>
                  </Field>
                  <Field label="Watch area">
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
