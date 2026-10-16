// Seven-day evidence replay (Volcanoes section of the analyst workspace): one button per UTC day that
// jumps to it, the current day in words, and Next day / Play / Back to day 1. Keyboard shortcuts (→ next
// day, R back to day 1) work only while focus is inside this bar, so they never fire under a dialog or
// while reading elsewhere (WCAG 2.1.4).
import type { KeyboardEvent } from 'react';
import type { ReplayStep } from '../types';
import { formatUtc } from './format';

export interface ReplayBarProps {
  steps: ReplayStep[];
  replayIndex: number;
  /** True only when the selected watch area is the replayable one. */
  enabled: boolean;
  playing: boolean;
  /** Short note shown while the controls are disabled. */
  disabledNote: string | null;
  /** Records per step index for the selected watch area (shown in each day cell); null when none is selected. */
  counts?: Record<number, number> | null;
  /** Records visible at the current step (evidence accumulates by day). */
  visibleCount?: number | null;
  onNext: () => void;
  onTogglePlay: () => void;
  onReset: () => void;
  /** Jump straight to a day (the day cells are buttons when this is given). */
  onJump?: (index: number) => void;
}

export default function ReplayBar({
  steps,
  replayIndex,
  enabled,
  playing,
  disabledNote,
  counts = null,
  visibleCount = null,
  onNext,
  onTogglePlay,
  onReset,
  onJump,
}: ReplayBarProps) {
  const pos = steps.findIndex((s) => s.index === replayIndex);
  const current = pos >= 0 ? steps[pos] : null;
  const atEnd = pos === -1 || pos >= steps.length - 1;
  const nextUnavailable = !enabled || atEnd;
  const playUnavailable = !enabled || (atEnd && !playing);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!enabled || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    if (e.key === 'ArrowRight') {
      if (!nextUnavailable) {
        e.preventDefault();
        onNext();
      }
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      onReset();
    }
  };

  return (
    <section
      className={`timeline-bar${enabled ? '' : ' timeline-bar--off'}`}
      aria-labelledby="replay-heading"
      onKeyDown={onKeyDown}
    >
      <h2 id="replay-heading" className="visually-hidden">
        Last seven days
      </h2>

      {steps.length > 0 ? (
        <ol className="day-strip" aria-label={`${steps.length} days`}>
          {steps.map((s, i) => {
            const phase = s.index < replayIndex ? 'done' : s.index === replayIndex ? 'current' : 'todo';
            const n = counts ? (counts[s.index] ?? 0) : null;
            const countText = n === null ? '' : `, ${n} ${n === 1 ? 'detection' : 'detections'}`;
            const title = `Day ${i + 1} of ${steps.length}: ${s.label}${countText}`;
            const body = (
              <>
                <span className="day-label">{s.label}</span>
                {n !== null && (
                  <span className="day-count" aria-hidden="true">
                    {n}
                  </span>
                )}
                {n !== null && <span className="visually-hidden">{countText}</span>}
              </>
            );
            return (
              <li key={s.index} className="day" data-phase={phase} aria-current={phase === 'current' ? 'step' : undefined} title={title}>
                {onJump && enabled ? (
                  <button type="button" className="day-btn" onClick={() => onJump(s.index)} aria-label={`Show ${title}`}>
                    {body}
                  </button>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="replay-status">No replay days are loaded.</p>
      )}

      <p className="replay-status" aria-live="polite">
        {enabled || !disabledNote ? (
          current ? (
            <>
              <span className="status-step">
                Day {pos + 1} of {steps.length}
              </span>
              <span className="sep" aria-hidden="true">
                ·
              </span>
              <span className="status-label">{current.label}</span>
              <span className="sep" aria-hidden="true">
                ·
              </span>
              <time dateTime={current.clock}>{formatUtc(current.clock)}</time>
              {visibleCount !== null && (
                <>
                  <span className="sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="status-count">
                    {visibleCount} {visibleCount === 1 ? 'detection' : 'detections'} so far
                  </span>
                </>
              )}
            </>
          ) : (
            'No day selected.'
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
          title={enabled ? 'Show the next day (→ while the timeline has focus)' : undefined}
          onClick={() => {
            if (!nextUnavailable) onNext();
          }}
        >
          Next day
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
        <button
          type="button"
          className="btn"
          disabled={!enabled}
          title={enabled ? 'Back to day 1 (R while the timeline has focus)' : undefined}
          onClick={onReset}
        >
          Day 1
        </button>
      </div>
    </section>
  );
}
