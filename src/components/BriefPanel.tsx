// Brief bar (pinned under the review column): Generate brief opens a read-only preview of the
// buildBriefing(...) text; Download .txt saves exactly that text. App owns the brief and clears it
// whenever the watch area, the replay step or the context data changes.
import { useRef, useState } from 'react';
import type { Incident } from '../types';
import Dialog from './Dialog';
import { ModeBadge } from './Badges';

export interface GeneratedBrief {
  text: string;
  /** Increments on every generation, so a download confirmation never outlives its brief. */
  seq: number;
  /** The context (NEA reading, nearby official warnings, feed statuses) the brief was built from. */
  contextKey: string;
}

export interface BriefPanelProps {
  incident: Incident | null;
  /** What the brief describes, e.g. "13 Oct, step 7 of 7". */
  contextLabel: string | null;
  brief: GeneratedBrief | null;
  /** The current context key; when it differs from the brief's, the brief is stale (never silently downloadable). */
  contextKey: string;
  filename: string | null;
  onGenerate: () => void;
  /** Starts the browser download of the current brief. May throw. */
  onDownload: () => void;
}

interface DownloadStatus {
  seq: number;
  ok: boolean;
  message: string;
}

export default function BriefPanel({
  incident,
  contextLabel,
  brief,
  contextKey,
  filename,
  onGenerate,
  onDownload,
}: BriefPanelProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [status, setStatus] = useState<DownloadStatus | null>(null);
  const previewRef = useRef<HTMLPreElement>(null);

  if (!incident) return null;

  const stale = brief !== null && brief.contextKey !== contextKey;
  // A stale brief stays readable while its preview is open (never pulled from under the presenter),
  // but from the bar it counts as no brief: Download .txt waits for a fresh one.
  const usable = brief !== null && (!stale || previewOpen);
  const downloadStatus = brief && status && status.seq === brief.seq ? status : null;

  const download = () => {
    if (!brief || !usable) return;
    try {
      onDownload();
      setStatus({ seq: brief.seq, ok: true, message: `Download started: ${filename ?? 'brief.txt'}` });
    } catch (err) {
      setStatus({
        seq: brief.seq,
        ok: false,
        message: `Download failed (${err instanceof Error ? err.message : String(err)}). The preview shows the full text.`,
      });
    }
  };

  const statusText = downloadStatus ? (
    <span className={downloadStatus.ok ? 'download-ok' : 'download-error'}>{downloadStatus.message}</span>
  ) : stale ? (
    'Context data updated since this brief; generate it again.'
  ) : brief ? (
    `Brief ready${contextLabel ? ` for ${contextLabel}` : ''}.`
  ) : (
    'No brief yet.'
  );

  return (
    <section className="brief-bar" aria-labelledby="brief-heading">
      <h2 id="brief-heading" className="visually-hidden">
        Brief
      </h2>
      <div className="brief-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onGenerate();
            setPreviewOpen(true);
          }}
        >
          Generate brief
        </button>
        <button
          type="button"
          className="btn"
          aria-disabled={!brief || stale || undefined}
          title={!brief ? 'Generate the brief first' : stale ? 'Context data updated; generate the brief again' : undefined}
          onClick={download}
        >
          Download .txt
        </button>
      </div>
      <p className="brief-status" aria-live={previewOpen ? 'off' : 'polite'}>
        {statusText}
      </p>

      <Dialog
        open={previewOpen && brief !== null}
        onClose={() => setPreviewOpen(false)}
        labelledBy="brief-preview-title"
        className="brief-dialog"
        initialFocus={previewRef}
      >
        {brief && (
          <div className="brief-dialog-inner">
            <header className="brief-dialog-head">
              <div className="brief-dialog-title">
                <h2 id="brief-preview-title">
                  Brief preview <ModeBadge mode={incident.dataMode} />
                </h2>
                <p className="mono small muted">{filename}</p>
              </div>
              <div className="brief-dialog-actions">
                <button type="button" className="btn btn-primary" onClick={download}>
                  Download .txt
                </button>
                <button type="button" className="btn" onClick={(e) => e.currentTarget.closest('dialog')?.close()}>
                  Close<span className="visually-hidden"> brief preview</span>
                </button>
              </div>
            </header>
            <pre ref={previewRef} className="brief-preview" tabIndex={0} aria-label="Brief text, read-only">
              {brief.text}
            </pre>
            <p className="brief-dialog-status" aria-live="polite">
              {downloadStatus ? (
                <span className={downloadStatus.ok ? 'download-ok' : 'download-error'}>{downloadStatus.message}</span>
              ) : stale ? (
                'Context data updated since this brief was generated. Close and generate it again for the latest context.'
              ) : null}
            </p>
          </div>
        )}
      </Dialog>
    </section>
  );
}
