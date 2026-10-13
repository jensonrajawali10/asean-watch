// Deterministic plain-text incident brief. Owned by the logic builder.
// No wall-clock time anywhere: the only timestamp is the replay step clock (or "static example").
import type {
  Category,
  EvidenceItem,
  HazardType,
  Incident,
  Observation,
  ReplayStep,
  ReviewResult,
  ValidationIssue,
  Volcano,
} from '../types';
import { REASONS } from './reviewRules';

export interface BriefingInput {
  incident: Incident;
  volcano: Volcano | null;
  /** Current replay step; null for static (non-replayable) incidents. */
  step: ReplayStep | null;
  review: ReviewResult;
  issues: ValidationIssue[];
}

const WIDTH = 100;
const RULE_LINE = '='.repeat(WIDTH);
const LABEL_WIDTH = 20;

const HAZARD_NAMES: Record<HazardType, string> = {
  volcano: 'Volcano',
  wildfire: 'Wildfire and haze',
  flood: 'Flood',
};

/** Shown in place of a replay clock for non-replayable incidents. */
export const STATIC_CLOCK = 'static example';

/** Suggested next step, one sentence per hazard (each fits on one line of the brief). */
export const NEXT_STEP: Record<HazardType, string> = {
  volcano: 'Consult the relevant volcano observatory and corroborating ground measurements.',
  wildfire: 'Consult the relevant national agency and corroborating ground reports.',
  flood: 'Consult the relevant national agency and corroborating ground reports.',
};

// ---------------------------------------------------------------------------
// Text layout helpers

/** Word-wrap `text` to WIDTH. Words longer than the width (URLs) get their own line, unbroken. */
function wrap(text: string, firstPrefix: string, restPrefix: string = ' '.repeat(firstPrefix.length)): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [firstPrefix.trimEnd()];
  const lines: string[] = [];
  let line = firstPrefix + words[0];
  for (const word of words.slice(1)) {
    if (line.length + 1 + word.length <= WIDTH) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = restPrefix + word;
    }
  }
  lines.push(line);
  return lines;
}

function fieldPrefix(indent: string, label: string, labelWidth: number): string {
  return `${indent}${`${label}:`.padEnd(Math.max(labelWidth, label.length + 2))}`;
}

/** "  Label:           value", value wrapped with a hanging indent under itself. */
function field(indent: string, label: string, value: string, labelWidth = LABEL_WIDTH): string[] {
  const prefix = fieldPrefix(indent, label, labelWidth);
  return wrap(value, prefix, ' '.repeat(prefix.length));
}

/** A field whose value is a URL on its own continuation line, so it is never split. */
function fieldWithUrl(indent: string, label: string, name: string, url: string, labelWidth = LABEL_WIDTH): string[] {
  const lines = field(indent, label, name, labelWidth);
  lines.push(`${' '.repeat(fieldPrefix(indent, label, labelWidth).length)}${url}`);
  return lines;
}

function bullet(text: string, marker = '-', indent = '  '): string[] {
  const prefix = `${indent}${marker} `;
  return wrap(text, prefix, ' '.repeat(prefix.length));
}

function heading(title: string): string[] {
  return ['', title, '-'.repeat(title.length)];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function formatValue(o: Observation): string {
  if (typeof o.value === 'number') return o.unit ? `${String(o.value)} ${o.unit}` : String(o.value);
  return `"${o.value}" (qualitative${o.unit ? `, unit ${o.unit}` : ''})`;
}

function formatCoordinates(lat: number, lon: number): string {
  return `lat ${String(lat)}, lon ${String(lon)}`;
}

/** Non-replayable incidents never show a replay step, even if one is passed. */
function effectiveStep(incident: Incident, step: ReplayStep | null): ReplayStep | null {
  return incident.replayable ? step : null;
}

// ---------------------------------------------------------------------------
// Sections

function headerSection(incident: Incident): string[] {
  const mode = incident.dataMode.toUpperCase();
  const notice =
    incident.dataMode === 'live'
      ? 'LIVE DATA - NOT A FORECAST AND NOT AN OFFICIAL WARNING'
      : `${mode} DEMO DATA - NOT A FORECAST AND NOT AN OFFICIAL WARNING`;
  return [
    'ASEAN WATCH - INCIDENT BRIEF',
    RULE_LINE,
    `*** ${notice} ***`,
    ...wrap(
      'This brief was generated from demo replay fixtures to support human review. It contains no ' +
        'predicted eruption date, no probability, no official alert level, and no evacuation boundary.',
      '',
    ),
    RULE_LINE,
  ];
}

function incidentSection(incident: Incident, volcano: Volcano | null): string[] {
  const location = incident.locationName.includes(incident.country)
    ? incident.locationName
    : `${incident.locationName}, ${incident.country}`;
  const lines = [
    ...heading('INCIDENT'),
    ...field('  ', 'Title', incident.title),
    ...field('  ', 'Incident id', incident.id),
    ...field('  ', 'Hazard', HAZARD_NAMES[incident.hazard] ?? String(incident.hazard)),
    ...field('  ', 'Location', location),
    ...field('  ', 'Coordinates', formatCoordinates(incident.lat, incident.lon)),
  ];
  if (volcano) {
    const elevation = volcano.elevationM === null ? '' : `, elevation ${String(volcano.elevationM)} m`;
    lines.push(
      ...field(
        '  ',
        'Volcano',
        `${volcano.name}, ${volcano.country} (GVP volcano number ${volcano.gvpNumber}; ` +
          `${formatCoordinates(volcano.lat, volcano.lon)}${elevation})`,
      ),
      ...fieldWithUrl('  ', 'Catalog source', volcano.catalogSource.name, volcano.catalogSource.url),
    );
  } else if (incident.hazard === 'volcano') {
    lines.push(
      ...field('  ', 'Catalog source', `not available (volcano record "${incident.volcanoId ?? 'none'}" not found)`),
    );
  } else {
    lines.push(...field('  ', 'Catalog source', 'not applicable (no volcano catalog entry for this example)'));
  }
  if (incident.summary.trim() !== '') lines.push(...field('  ', 'Summary', incident.summary));
  return lines;
}

function replaySection(incident: Incident, step: ReplayStep | null): string[] {
  const lines = [...heading('REPLAY')];
  if (step) {
    lines.push(
      ...field('  ', 'Replay step', `${step.index} - ${step.label}`),
      ...field('  ', 'Scenario clock', `${step.clock} (fictional scenario clock, not the current time)`),
    );
    if (step.description.trim() !== '') lines.push(...field('  ', 'Step description', step.description));
  } else {
    lines.push(
      ...field('  ', 'Replay step', `${STATIC_CLOCK} (this incident does not replay)`),
      ...field('  ', 'Scenario clock', STATIC_CLOCK),
    );
  }
  lines.push(
    ...field('  ', 'Scenario window', `${incident.scenarioWindow.start} to ${incident.scenarioWindow.end}`),
  );
  return lines;
}

function dataModeSection(incident: Incident, evidence: EvidenceItem[]): string[] {
  const counts = new Map<string, number>();
  for (const e of evidence) {
    const mode = e.observation.dataMode.toUpperCase();
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  const breakdown =
    counts.size === 0
      ? 'none at this replay step'
      : [...counts.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([mode, n]) => `${n} ${mode}`)
          .join(', ');
  const lines = [
    ...heading('DATA MODE'),
    ...field('  ', 'Incident mode', incident.dataMode.toUpperCase()),
    ...field('  ', 'Records', breakdown),
  ];
  if (incident.dataMode === 'simulated' || counts.has('SIMULATED')) {
    lines.push(
      ...bullet(
        'SIMULATED values come from demo fixtures. They are not measured products and do not ' +
          'describe current activity at this location.',
      ),
    );
  }
  if (counts.has('HISTORICAL')) {
    lines.push(...bullet('HISTORICAL records keep their original acquisition times, even when replayed.'));
  }
  if (counts.has('LIVE')) {
    lines.push(...bullet('LIVE records have not been reviewed by an analyst or an official agency.'));
  }
  return lines;
}

function reviewSection(review: ReviewResult): string[] {
  const categories = review.anomalyCategories.length > 0 ? review.anomalyCategories.join(', ') : 'none';
  const lines = [
    ...heading('REVIEW STATE'),
    ...field('  ', 'State', review.label),
    ...field('  ', 'Anomaly categories', categories),
    ...field('  ', 'Visible records', String(review.observationCount)),
    ...field('  ', 'Latest observed', review.latestObservedAt ?? 'none'),
    '  How the state was derived:',
  ];
  for (const line of review.explanation) lines.push(...bullet(line, '-', '    '));
  lines.push(
    ...wrap(
      'The state is a workflow prompt for human review. It is not an official volcano alert level ' +
        'or any other official warning.',
      '  ',
    ),
  );
  return lines;
}

function evidenceSection(evidence: EvidenceItem[]): string[] {
  const lines = [...heading(`EVIDENCE (${plural(evidence.length, 'record', 'records')}, oldest first)`)];
  if (evidence.length === 0) {
    lines.push('  No observations at this replay step.');
    return lines;
  }
  evidence.forEach((e, i) => {
    const o = e.observation;
    const ref = `[E${i + 1}]`;
    const indent = ' '.repeat(2 + ref.length + 1);
    const w = 14;
    if (i > 0) lines.push('');
    lines.push(`  ${ref} ${o.id}`);
    lines.push(
      ...field(indent, 'Category', o.category, w),
      ...(o.summary.trim() !== '' ? field(indent, 'Summary', o.summary, w) : []),
      ...field(indent, 'Value', formatValue(o), w),
      ...field(indent, 'Observed', o.observedAt, w),
      ...field(indent, 'Ingested', o.ingestedAt, w),
      ...field(indent, 'Data mode', o.dataMode.toUpperCase(), w),
      ...fieldWithUrl(indent, 'Source', o.sourceName, o.sourceUrl, w),
      ...field(indent, 'Quality note', o.qualityNote.trim() !== '' ? o.qualityNote : 'none recorded', w),
      ...field(
        indent,
        'Anomaly flag',
        o.anomaly ? `yes (configured in fixture): ${o.anomalyReason ?? 'no reason recorded'}` : 'no',
        w,
      ),
      ...field(indent, 'Counted', `${e.counted ? 'YES' : 'NO'} - ${e.reason}`, w),
    );
  });
  return lines;
}

function issuesSection(issues: ValidationIssue[]): string[] {
  const lines = [...heading('VALIDATION ISSUES')];
  if (issues.length === 0) {
    lines.push('  None. Every input record passed validation.');
    return lines;
  }
  lines.push(
    ...wrap(
      `${plural(issues.length, 'input record was', 'input records were')} skipped or ignored. ` +
        'They are not part of this brief:',
      '  ',
    ),
  );
  for (const issue of issues) {
    const where = issue.index >= 0 ? ` (input position ${issue.index})` : '';
    lines.push(...bullet(`${issue.message}${where}`));
  }
  return lines;
}

function limitationsFor(incident: Incident): string[] {
  const items: string[] = [];
  if (incident.dataMode === 'simulated') {
    items.push(
      'This is a simulated demo scenario. The location is real; the observations and dates are not, ' +
        'and they do not describe current conditions there.',
    );
  }
  items.push(
    'Anomaly flags are configured in the fixtures, not computed from the values.',
    'Review states are illustrative workflow rules, not scientific thresholds or official alert levels.',
    'Satellite observations complement, and do not replace, ground instruments and expert assessment.',
    'Observation and ingestion times are shown separately; products differ in revisit time, ' +
      'resolution, and latency, and cloud cover can hide signals.',
    'The absence of an anomaly in this brief is not evidence that conditions are normal.',
  );
  if (incident.hazard === 'volcano') {
    items.push(
      'A thermal hotspot can have causes other than volcanic activity, such as vegetation fires.',
      'Satellite gas retrievals are affected by cloud, wind, and plume height.',
    );
  } else if (incident.hazard === 'wildfire') {
    items.push('A satellite hotspot is not a confirmed fire until it is verified on the ground.');
  } else if (incident.hazard === 'flood') {
    items.push('Mapped water extent can be observed or modelled; forecast and observed extent differ.');
  }
  return items;
}

function idsOf(items: EvidenceItem[]): string {
  return items.map((e) => `"${e.observation.id}"`).join(', ');
}

function analystQuestions(input: BriefingInput): string[] {
  const { incident, review, issues } = input;
  const evidence = review.evidence;
  const counted = new Set<Category>(review.anomalyCategories);
  const present = (c: Category) => evidence.some((e) => e.observation.category === c);
  const questions: string[] = [];

  if (evidence.length === 0) {
    questions.push('No observations are visible at this replay step. Which sources should be checked first?');
  }
  if (incident.hazard === 'volcano') {
    if (counted.has('thermal')) {
      questions.push(
        'What caused the thermal hotspot? Its cause is unconfirmed: it could be volcanic, a vegetation ' +
          'fire, or a sensor artifact.',
      );
    }
    if (counted.has('gas')) {
      questions.push(
        'Do ground gas measurements confirm the gas signal, or could cloud, wind, or retrieval limits explain it?',
      );
    }
    if (!counted.has('deformation')) {
      questions.push('No deformation anomaly is present. Do GNSS, tilt, or InSAR measurements show ground change?');
    }
    questions.push(
      present('report')
        ? 'Do field or observatory reports corroborate the satellite records?'
        : 'No ground observation or field report is included. What does the volcano observatory or a field team report?',
    );
  } else if (incident.hazard === 'wildfire') {
    if (counted.has('thermal')) {
      questions.push('Is the thermal hotspot a confirmed fire? Its cause is unconfirmed until checked on the ground.');
    }
    questions.push('Do air quality stations or smoke imagery show haze, and which communities are downwind?');
    questions.push('Do fire services or ground reports confirm a fire at this location?');
  } else {
    if (counted.size === 0) {
      questions.push('No anomaly is flagged. Do rain gauges or river levels show rising water?');
    }
    questions.push('Is any mapped water extent observed or forecast? The two should be kept separate.');
    questions.push('Do local agencies or field reports confirm the mapped water extent?');
  }

  const repeats = evidence.filter((e) => !e.counted && e.reason === REASONS.sameCategory);
  if (repeats.length > 0) {
    questions.push(
      `${idsOf(repeats)} ${repeats.length === 1 ? 'repeats' : 'repeat'} an earlier anomaly category. ` +
        'Are these independent sensors seeing the same event, or one detection counted twice?',
    );
  }
  const outside = evidence.filter((e) => e.reason === REASONS.outsideWindow);
  if (outside.length > 0) {
    questions.push(`${idsOf(outside)} fall outside the scenario window. Should they be reviewed separately?`);
  }
  if (issues.length > 0) {
    questions.push(
      `${plural(issues.length, 'input record was', 'input records were')} rejected or ignored during ` +
        'validation. Should the source data be corrected?',
    );
  }
  if (evidence.length > 0 && review.latestObservedAt) {
    questions.push(`Is any observation newer than ${review.latestObservedAt} available?`);
  }
  return questions;
}

function nextStepSection(incident: Incident, volcano: Volcano | null): string[] {
  const lines = [...heading('SUGGESTED NEXT STEP'), ...wrap(NEXT_STEP[incident.hazard] ?? NEXT_STEP.flood, '  ')];
  if (incident.hazard === 'volcano') {
    const where = volcano ? ` for ${volcano.name} (${volcano.country})` : '';
    lines.push(
      ...wrap(
        `Use this brief as a prompt for expert review${where}. It does not assess whether or when an ` +
          'eruption may occur.',
        '  ',
      ),
    );
  } else if (incident.hazard === 'wildfire') {
    lines.push(
      ...wrap(
        `For ${incident.country}, that is the national fire, forestry, environment, or disaster management agency.`,
        '  ',
      ),
    );
  } else {
    lines.push(
      ...wrap(
        `For ${incident.country}, that is the national hydrology, meteorology, or disaster management agency.`,
        '  ',
      ),
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Public API

/** Deterministic plain-text brief. Same input always yields the same text (no wall-clock time). */
export function buildBriefing(input: BriefingInput): string {
  const { incident, volcano, review, issues } = input;
  const step = effectiveStep(incident, input.step);
  const lines: string[] = [
    ...headerSection(incident),
    ...incidentSection(incident, volcano),
    ...replaySection(incident, step),
    ...dataModeSection(incident, review.evidence),
    ...reviewSection(review),
    ...evidenceSection(review.evidence),
    ...issuesSection(issues),
    ...heading('LIMITATIONS'),
    ...limitationsFor(incident).flatMap((item) => bullet(item)),
    ...heading('QUESTIONS FOR AN ANALYST'),
    ...analystQuestions(input).flatMap((q, i) => bullet(q, `${i + 1}.`)),
    ...nextStepSection(incident, volcano),
    '',
    RULE_LINE,
    'END OF BRIEF',
  ];
  return `${lines.join('\n')}\n`;
}

/** Keep only filesystem-safe characters (letters, digits, dot, underscore, hyphen). */
function safeSegment(text: string, fallback: string): string {
  const cleaned = text
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return cleaned === '' ? fallback : cleaned;
}

/** e.g. "asean-watch-brief_inc-merapi-demo_step-2.txt" */
export function briefingFilename(incident: Incident, step: ReplayStep | null): string {
  const s = effectiveStep(incident, step);
  const stepPart = s && Number.isInteger(s.index) && s.index >= 0 ? `step-${s.index}` : 'static';
  return `asean-watch-brief_${safeSegment(incident.id, 'incident')}_${stepPart}.txt`;
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
