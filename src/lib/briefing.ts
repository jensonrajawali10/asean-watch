// STUB: owned by the logic agent. Signatures are the contract; bodies get replaced.
import type { Incident, ReplayStep, ReviewResult, ValidationIssue, Volcano } from '../types';

export interface BriefingInput {
  incident: Incident;
  volcano: Volcano | null;
  /** Current replay step; null for static (non-replayable) incidents. */
  step: ReplayStep | null;
  review: ReviewResult;
  issues: ValidationIssue[];
}

/** Deterministic plain-text brief. Same input always yields the same text (no wall-clock time). */
export function buildBriefing(input: BriefingInput): string {
  return `ASEAN WATCH INCIDENT BRIEF (stub)\n${input.incident.title}\n`;
}

/** e.g. "asean-watch-brief_inc-merapi-demo_step-2.txt" */
export function briefingFilename(incident: Incident, step: ReplayStep | null): string {
  return `asean-watch-brief_${incident.id}_${step ? `step-${step.index}` : 'static'}.txt`;
}

/** Trigger a browser download of plain text via Blob + temporary anchor. */
export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
