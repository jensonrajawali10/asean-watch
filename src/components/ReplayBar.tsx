// Scenario replay: step indicators, the fictional scenario clock, and Next step / Play / Reset.
// Buttons that become unavailable while focused use aria-disabled so keyboard focus is not lost.
import type { ReplayStep } from '../types';
import { formatUtc } from './format';

export interface ReplayBarProps {
  steps: ReplayStep[];
  replayIndex: number;
  /** True only when the selected incident is the replayable scenario incident. */
  enabled: boolean;
  playing: boolean;
  /** Short note shown while the controls are disabled. */
  disabledNote: string | null;
  onNext: () => void;
  onTogglePlay: () => void;
  onReset: () => void;
}

export default function ReplayBar({
  steps,
  replayIndex,
  enabled,
  playing,
  disabledNote,
  onNext,
  onTogglePlay,
  onReset,
}: ReplayBarProps) {
  const pos = steps.findIndex((s) => s.index === replayIndex);
  const current = pos >= 0 ? steps[pos] : null;
  const atEnd = pos === -1 || pos >= steps.length - 1;
  const nextUnavailable = !enabled || atEnd;
  const playUnavailable = !enabled || (atEnd && !playing);

  return (
    <section className={`replay-bar${enabled ? '' : ' replay-bar--off'}`} aria-labelledby="replay-heading">
      <h2 id="replay-heading" className="visually-hidden">
        Scenario replay
      </h2>

      {steps.length > 0 ? (
        <ol className="replay-steps">
          {steps.map((s, i) => {
            const phase = s.index < replayIndex ? 'done' : s.index === replayIndex ? 'current' : 'todo';
            return (
              <li key={s.index} className="step" data-phase={phase} aria-current={phase === 'current' ? 'step' : undefined}>
                <span className="step-chip">
                  <span className="step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="replay-steps-empty">No replay scenario is loaded.</p>
      )}

      <p className="replay-status" aria-live="polite">
        {enabled || !disabledNote ? (
          current ? (
            <>
              <span className="status-step">{current.label} · </span>
              Step {pos + 1} of {steps.length}
              <span className="sep" aria-hidden="true">
                ·
              </span>
              Scenario clock (fictional): <time dateTime={current.clock}>{formatUtc(current.clock)}</time>
            </>
          ) : (
            'No replay step selected.'
          )
        ) : (
          disabledNote
        )}
      </p>

      <div className="replay-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!enabled}
          aria-disabled={nextUnavailable || undefined}
          onClick={() => {
            if (!nextUnavailable) onNext();
          }}
        >
          Next step
        </button>
        <button
          type="button"
          className="btn btn-play"
          disabled={!enabled}
          aria-disabled={playUnavailable || undefined}
          onClick={() => {
            if (!playUnavailable) onTogglePlay();
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn" disabled={!enabled} onClick={onReset}>
          Reset
        </button>
      </div>
    </section>
  );
}
