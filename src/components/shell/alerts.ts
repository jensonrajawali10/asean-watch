// The Official-alerts pill (docs/UX_V3.md section 2): the count of active official messages, and whether
// any is a tsunami warning or an evacuation-level message (the pill then turns red). Pure, tested.
// Nothing here rewrites an issuer's words; it only decides how prominent the pill is.
import type { OfficialWarning, WarningHazard } from '../../types';
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

/** Hazards in the order the warnings list groups them (most life-threatening first), with plain names. */
export const HAZARD_ORDER: readonly WarningHazard[] = ['tsunami', 'volcano', 'earthquake', 'flood', 'haze', 'weather', 'other'];
export const HAZARD_GROUP_NAME: Record<WarningHazard, string> = {
  tsunami: 'Tsunami',
  volcano: 'Volcanoes',
  earthquake: 'Earthquakes',
  flood: 'Floods and river levels',
  haze: 'Haze and air',
  weather: 'Weather',
  other: 'Other',
};
const HAZARD_WORD: Record<WarningHazard, [string, string]> = {
  tsunami: ['tsunami', 'tsunami'],
  volcano: ['volcano', 'volcanoes'],
  earthquake: ['earthquake', 'earthquakes'],
  flood: ['flood', 'floods'],
  haze: ['haze', 'haze'],
  weather: ['weather', 'weather'],
  other: ['other', 'other'],
};

/** Count per hazard, in HAZARD_ORDER, zero counts left out. */
export function hazardCounts(warnings: readonly OfficialWarning[]): { hazard: WarningHazard; count: number }[] {
  return HAZARD_ORDER.map((hazard) => ({ hazard, count: warnings.filter((w) => w.hazard === hazard).length })).filter((h) => h.count > 0);
}

/** "floods, volcanoes, earthquakes": the kinds of message in force, most numerous first (up to three). */
export function hazardMix(warnings: readonly OfficialWarning[]): string {
  const counts = hazardCounts(warnings).sort((a, b) => b.count - a.count || HAZARD_ORDER.indexOf(a.hazard) - HAZARD_ORDER.indexOf(b.hazard));
  return counts
    .slice(0, 3)
    .map((h) => HAZARD_WORD[h.hazard][h.count === 1 ? 0 : 1])
    .join(', ');
}

/** Warnings grouped by hazard (HAZARD_ORDER), each group keeping the input order (newest first). */
export function groupByHazard(warnings: readonly OfficialWarning[]): { hazard: WarningHazard; items: OfficialWarning[] }[] {
  return HAZARD_ORDER.map((hazard) => ({ hazard, items: warnings.filter((w) => w.hazard === hazard) })).filter((g) => g.items.length > 0);
}

export function alertsPill(warnings: readonly OfficialWarning[], nowMs?: number): AlertsPill {
  const active = activeOfficial(warnings, nowMs);
  const count = active.length;
  const mix = hazardMix(active);
  return {
    count,
    urgent: active.some((w) => isUrgentWarning(w, nowMs)),
    // Says what the alerts are about, so flood gauges in a haze map do not look like a bug.
    label: `official ${count === 1 ? 'alert' : 'alerts'} in force${mix ? `: ${mix}` : ''}`,
  };
}
