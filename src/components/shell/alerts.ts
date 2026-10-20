// The Official-alerts pill (docs/UX_V3.md section 2): the count of active official messages, and whether
// any is a tsunami warning or an evacuation-level message (the pill then turns red). Pure, tested.
// Nothing here rewrites an issuer's words; it only decides how prominent the pill is.
import type { OfficialWarning } from '../../types';
import { isExpired } from '../../lib/warningsView';

/** Not in force: on the page clock when given (ended, or past its expiry), else the issuer's ended flag. */
function inactive(w: OfficialWarning, nowMs?: number): boolean {
  return nowMs === undefined ? w.ended : isExpired(w, nowMs);
}

/** Official (not aggregator) messages still in force (judged on nowMs when given). */
export function activeOfficial(warnings: readonly OfficialWarning[], nowMs?: number): OfficialWarning[] {
  return warnings.filter((w) => w.authority === 'official' && !inactive(w, nowMs));
}

const EVACUATION = /\b(evacuat\w*|evakuasi|mengungsi|pengungsian|避難)/i;
/** Tsunami products that are information or forecast statements, not warnings. */
const TSUNAMI_INFO = /\b(information|statement|forecast)\b/i;

/** A tsunami warning in force, or any official message carrying an evacuation instruction. */
export function isUrgentWarning(w: OfficialWarning, nowMs?: number): boolean {
  if (w.authority !== 'official' || inactive(w, nowMs)) return false;
  const text = `${w.level} ${w.product} ${w.headline} ${w.instruction ?? ''}`;
  if (EVACUATION.test(text)) return true;
  return w.hazard === 'tsunami' && !TSUNAMI_INFO.test(`${w.level} ${w.product}`);
}

export interface AlertsPill {
  count: number;
  urgent: boolean;
  /** Short label after the count, e.g. "official messages in force" (the number is shown once, beside it). */
  label: string;
}

/** How a list of relayed messages splits: in force (the pill's number), ended or expired, impact estimates. */
export interface WarningCounts {
  total: number;
  inForce: number;
  endedOrExpired: number;
  /** Aggregator impact estimates (GDACS): not warnings. */
  estimates: number;
}

/** The one count used by the pill, the Warnings tile and the list heading, so they always agree. */
export function warningCounts(warnings: readonly OfficialWarning[], nowMs?: number): WarningCounts {
  const estimates = warnings.filter((w) => w.authority !== 'official').length;
  const inForce = activeOfficial(warnings, nowMs).length;
  return { total: warnings.length, inForce, endedOrExpired: warnings.length - estimates - inForce, estimates };
}

/** "113 messages: 48 in force, 59 ended or expired, 6 impact estimates" (zero parts left out). */
export function countsText(c: WarningCounts): string {
  const parts = [
    `${c.inForce} in force`,
    c.endedOrExpired > 0 ? `${c.endedOrExpired} ended or expired` : null,
    c.estimates > 0 ? `${c.estimates} impact ${c.estimates === 1 ? 'estimate' : 'estimates'}` : null,
  ].filter(Boolean);
  return `${c.total} ${c.total === 1 ? 'message' : 'messages'}: ${parts.join(', ')}`;
}

export function alertsPill(warnings: readonly OfficialWarning[], nowMs?: number): AlertsPill {
  const active = activeOfficial(warnings, nowMs);
  const count = active.length;
  return {
    count,
    urgent: active.some((w) => isUrgentWarning(w, nowMs)),
    label: `official ${count === 1 ? 'message' : 'messages'} in force`,
  };
}
