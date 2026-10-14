// "Summarise with Claude": asks the server (/api/ai-brief) for a short AI summary of the
// deterministic brief for one watch area and replay day. The browser sends only {watchId, dayIndex};
// the server builds the facts itself and holds the API key. The summary is shown as plain text with
// citation chips, under a persistent label that it is AI-written and not an official warning.
import { useEffect, useRef, useState } from 'react';
import { AI_BRIEF_LABEL, AI_BRIEF_SECTIONS, splitCitations } from '../lib/aiBrief';
import type { AiBriefError, AiBriefSuccess } from '../lib/aiBrief';
import './AiBriefPanel.css';

export interface AiBriefPanelProps {
  watchId: string;
  /** Replay day index (0..6); null when the area has no replay day selected. */
  dayIndex: number | null;
}

type State =
  | { key: string; status: 'loading' }
  | { key: string; status: 'done'; result: AiBriefSuccess }
  | { key: string; status: 'error'; message: string };

const SECTION_SET = new Set<string>(AI_BRIEF_SECTIONS);

function errorMessage(status: number, body: Partial<AiBriefError> | null): string {
  const code = body?.error;
  if (code === 'not_configured' || (status === 503 && !code)) return 'AI brief not configured.';
  if (code === 'rate_limited' || status === 429) {
    const mins = body?.retryAfterSeconds ? Math.max(1, Math.ceil(body.retryAfterSeconds / 60)) : null;
    return `Rate limited: too many AI summaries from this connection. Try again${mins ? ` in about ${mins} min` : ' later'}.`;
  }
  if (status === 404) return 'AI brief failed: the summary service is not available on this server.';
  if (code === 'refused') return 'AI brief failed: the model declined to summarise this brief.';
  return `AI brief failed${body?.message ? `: ${body.message}` : ` (HTTP ${status})`}. Try again.`;
}

function formatUtc(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC` : iso;
}

function Line({ text }: { text: string }) {
  return (
    <>
      {splitCitations(text).map((part, i) =>
        'cite' in part ? (
          <span key={i} className="ai-cite" title={part.cite.startsWith('E') ? 'Evidence record in the brief' : 'Official warning in the brief'}>
            <span className="visually-hidden">{part.cite.startsWith('E') ? 'evidence ' : 'warning '}</span>
            {part.cite}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Summary({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="ai-brief-summary">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === '') return null;
        if (SECTION_SET.has(trimmed.replace(/:$/, ''))) {
          return (
            <h3 key={i} className="ai-brief-section">
              {trimmed.replace(/:$/, '')}
            </h3>
          );
        }
        const bullet = /^-\s+/.test(trimmed);
        return (
          <p key={i} className={bullet ? 'ai-brief-line ai-brief-bullet' : 'ai-brief-line'}>
            <Line text={bullet ? trimmed.replace(/^-\s+/, '') : trimmed} />
          </p>
        );
      })}
    </div>
  );
}

export default function AiBriefPanel({ watchId, dayIndex }: AiBriefPanelProps) {
  const key = `${watchId}|${dayIndex ?? 'none'}`;
  const [state, setState] = useState<State | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A summary belongs to one watch and day: abort any request in flight when either changes.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, [key]);

  const current = state && state.key === key ? state : null;
  const loading = current?.status === 'loading';

  const run = async () => {
    if (loading || dayIndex === null) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ key, status: 'loading' });
    try {
      const res = await fetch('/api/ai-brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ watchId, dayIndex }),
        signal: controller.signal,
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (controller.signal.aborted) {
        setState((s) => (s && s.key === key && s.status === 'loading' ? null : s));
        return;
      }
      const ok = res.ok && body !== null && typeof (body as AiBriefSuccess).summary === 'string';
      setState(
        ok
          ? { key, status: 'done', result: body as AiBriefSuccess }
          : { key, status: 'error', message: errorMessage(res.status, body as Partial<AiBriefError> | null) },
      );
    } catch (err) {
      if (controller.signal.aborted) {
        setState((s) => (s && s.key === key && s.status === 'loading' ? null : s));
        return;
      }
      setState({ key, status: 'error', message: `AI brief failed: ${err instanceof Error ? 'network error' : 'unknown error'}. Try again.` });
    }
  };

  return (
    <section className="ai-brief" aria-labelledby="ai-brief-heading">
      <div className="ai-brief-head">
        <h3 id="ai-brief-heading" className="ai-brief-title">
          AI summary
        </h3>
        <button
          type="button"
          className="btn"
          onClick={() => void run()}
          aria-disabled={loading || dayIndex === null || undefined}
          title={dayIndex === null ? 'Select a replay day first' : undefined}
        >
          {loading ? 'Summarising…' : current?.status === 'done' ? 'Summarise again' : 'Summarise with Claude'}
        </button>
      </div>
      <p className="ai-brief-label">{AI_BRIEF_LABEL}</p>
      <div className="ai-brief-body" aria-live="polite" aria-busy={loading || undefined}>
        {loading && <p className="ai-brief-status">Summarising the brief for this watch area and day…</p>}
        {current?.status === 'error' && (
          <p className="ai-brief-status ai-brief-error" role="alert">
            {current.message}
          </p>
        )}
        {current?.status === 'done' && (
          <>
            <Summary text={current.result.summary} />
            {current.result.truncated && <p className="ai-brief-status">The summary was cut short at the length limit.</p>}
            <p className="ai-brief-meta">
              Model <span className="mono">{current.result.model}</span>, generated{' '}
              <span className="mono">{formatUtc(current.result.generatedAt)}</span>, from the bundled data snapshot (live
              feed updates are not included).
            </p>
          </>
        )}
      </div>
    </section>
  );
}
