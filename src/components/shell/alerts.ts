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

/** Feeds whose messages are from Southeast Asian national agencies (by warning id prefix). */
const SEA_FEEDS = ['bmkg-inatews:', 'bmkg-gempa:', 'magma-level-list:', 'thaiwater:', 'dsda-jakarta:', 'pub-flood:'];
/** ASEAN members as GDACS names the country of an event. */
const SEA_COUNTRIES = /\b(Indonesia|Malaysia|Singapore|Thailand|Viet ?Nam|Cambodia|Laos|Lao PDR|Philippines|Brunei|Myanmar|Timor-Leste|East Timor)\b/i;

/**
 * True for a message about Southeast Asia: from a Southeast Asian agency (BMKG, MAGMA/PVMBG, ThaiWater, Jakarta
 * DSDA, Singapore PUB), or a GDACS estimate or Tokyo VAAC advisory whose country is an ASEAN member. JMA,
 * GeoNet, NWS and PTWC messages (Japan, New Zealand, US Pacific, the wider Pacific) are the wider Asia-Pacific.
 */
export function isSoutheastAsia(w: Pick<OfficialWarning, 'id' | 'areaDescription'>): boolean {
  if (SEA_FEEDS.some((p) => w.id.startsWith(p))) return true;
  // GDACS and Tokyo VAAC cover several countries: by the country they name (VAAC: the advisory's AREA line).
  if (w.id.startsWith('gdacs:') || w.id.startsWith('vaac-tokyo:')) return SEA_COUNTRIES.test(w.areaDescription ?? '');
  return false;
}

/** Hazards in the order the warnings list groups them (most life-threatening first), with plain names. */
export const HAZARD_ORDER: readonly WarningHazard[] = ['tsunami', 'volcano', 'ash', 'earthquake', 'flood', 'haze', 'weather', 'other'];
export const HAZARD_GROUP_NAME: Record<WarningHazard, string> = {
  tsunami: 'Tsunami',
  volcano: 'Volcanoes',
  ash: 'Volcanic ash advisories (aviation)',
  earthquake: 'Earthquakes',
  flood: 'Floods and river levels',
  haze: 'Haze and air',
  weather: 'Weather',
  other: 'Other',
};
const HAZARD_WORD: Record<WarningHazard, [string, string]> = {
  tsunami: ['tsunami', 'tsunami'],
  volcano: ['volcano', 'volcanoes'],
  ash: ['ash advisory', 'ash advisories'],
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

/**
 * Warnings grouped by hazard. Active messages come first: groups with an active message before groups with
 * none (each set in HAZARD_ORDER), and within a group the active ones before the ended or expired ones,
 * each keeping the input order (newest first). Without `isActive` every message counts as active.
 */
export function groupByHazard(
  warnings: readonly OfficialWarning[],
  isActive: (w: OfficialWarning) => boolean = () => true,
): { hazard: WarningHazard; items: OfficialWarning[]; active: number }[] {
  const groups = HAZARD_ORDER.map((hazard) => {
    const all = warnings.filter((w) => w.hazard === hazard);
    const live = all.filter(isActive);
    return { hazard, items: [...live, ...all.filter((w) => !isActive(w))], active: live.length };
  }).filter((g) => g.items.length > 0);
  return [...groups.filter((g) => g.active > 0), ...groups.filter((g) => g.active === 0)];
}

export function alertsPill(warnings: readonly OfficialWarning[], nowMs?: number): AlertsPill {
  const active = activeOfficial(warnings, nowMs);
  const count = active.length;
  const mix = hazardMix(active);
  return {
    count,
    urgent: active.some((w) => isUrgentWarning(w, nowMs)),
    // Says what the alerts are about, so flood gauges in a haze map do not look like a bug.
    label: `official ${count === 1 ? 'message' : 'messages'} in force${mix ? `: ${mix}` : ''}`,
  };
}
