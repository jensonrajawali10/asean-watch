// The Official-alerts pill (docs/UX_V3.md section 2): the count of active official messages, and whether
// any is a tsunami warning or an evacuation-level message (the pill then turns red). Pure, tested.
// Nothing here rewrites an issuer's words; it only decides how prominent the pill is.
import type { OfficialWarning } from '../../types';

/** Official (not aggregator) messages the issuer has not ended. */
export function activeOfficial(warnings: readonly OfficialWarning[]): OfficialWarning[] {
  return warnings.filter((w) => w.authority === 'official' && !w.ended);
}

const EVACUATION = /\b(evacuat\w*|evakuasi|mengungsi|pengungsian|避難)/i;
/** Tsunami products that are information or forecast statements, not warnings. */
const TSUNAMI_INFO = /\b(information|statement|forecast)\b/i;

/** A tsunami warning in force, or any official message carrying an evacuation instruction. */
export function isUrgentWarning(w: OfficialWarning): boolean {
  if (w.authority !== 'official' || w.ended) return false;
  const text = `${w.level} ${w.product} ${w.headline} ${w.instruction ?? ''}`;
  if (EVACUATION.test(text)) return true;
  return w.hazard === 'tsunami' && !TSUNAMI_INFO.test(`${w.level} ${w.product}`);
}

export interface AlertsPill {
  count: number;
  urgent: boolean;
  /** Short label, e.g. "3 official alerts" or "1 official alert". */
  label: string;
}

export function alertsPill(warnings: readonly OfficialWarning[]): AlertsPill {
  const active = activeOfficial(warnings);
  const count = active.length;
  return {
    count,
    urgent: active.some(isUrgentWarning),
    label: `${count} official ${count === 1 ? 'alert' : 'alerts'}`,
  };
}
