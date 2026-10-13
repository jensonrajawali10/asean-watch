// Shared data contract for ASEAN Watch. Every module builds against these types.
// Changing a type here is a contract change: update docs/CONTRACT.md in the same commit.

export const CATEGORIES = ['thermal', 'gas', 'deformation', 'ash', 'report'] as const;
export type Category = (typeof CATEGORIES)[number];

export const DATA_MODES = ['simulated', 'historical', 'live'] as const;
export type DataMode = (typeof DATA_MODES)[number];

export type HazardType = 'volcano' | 'wildfire' | 'flood';

/** Workflow urgency for analysts. Never an official volcano alert level. */
export type ReviewState = 'monitoring' | 'check' | 'review';
export type ReviewLabel = 'Monitoring' | 'Check observation' | 'Review needed';

export interface SourceRef {
  name: string;
  url: string;
}

export interface Volcano {
  /** Stable identifier, e.g. "gvp-263250". */
  id: string;
  /** Smithsonian Global Volcanism Program volcano number. */
  gvpNumber: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  elevationM: number | null;
  catalogSource: SourceRef;
}

export interface Incident {
  id: string;
  title: string;
  hazard: HazardType;
  volcanoId: string | null;
  locationName: string;
  country: string;
  lat: number;
  lon: number;
  /** Scenario-level data mode. Every sprint incident is "simulated". */
  dataMode: DataMode;
  /** ISO 8601 UTC. Anomalies observed outside this window are shown but not counted. */
  scenarioWindow: { start: string; end: string };
  /** Only the flagship Merapi scenario replays; secondary examples are static. */
  replayable: boolean;
  summary: string;
}

export interface ReplayStep {
  /** 0 = baseline. */
  index: number;
  label: string;
  description: string;
  /** ISO 8601 UTC replay clock shown in the UI and the briefing. */
  clock: string;
}

export interface DemoScenario {
  incidentId: string;
  replaySteps: ReplayStep[];
}

export interface Observation {
  id: string;
  incidentId: string;
  /** ISO 8601 UTC, when the sensor or reporter observed it. */
  observedAt: string;
  /** ISO 8601 UTC, when the platform received it. Displayed separately from observedAt. */
  ingestedAt: string;
  category: Category;
  /** Numeric values require a unit; qualitative reports use text and unit null. */
  value: number | string;
  unit: string | null;
  sourceName: string;
  sourceUrl: string;
  dataMode: DataMode;
  qualityNote: string;
  /** One-line human description of the record. */
  summary: string;
  /** Configured in the fixture, never computed. Illustrative only. */
  anomaly: boolean;
  /** Why the fixture marks this record anomalous; null when anomaly is false. */
  anomalyReason: string | null;
  /** Visible once the replay index reaches this step. Static incidents use 0. */
  replayStep: number;
}

export interface ValidationIssue {
  /** Record id when one could be read. */
  recordId: string | null;
  /** Position in the raw input array. */
  index: number;
  message: string;
}

export interface ValidationResult {
  valid: Observation[];
  issues: ValidationIssue[];
  duplicatesIgnored: number;
}

export interface EvidenceItem {
  observation: Observation;
  /** True when this record contributes a new distinct anomaly category. */
  counted: boolean;
  /** Plain-language reason it was counted or not counted. */
  reason: string;
}

export interface ReviewResult {
  state: ReviewState;
  label: ReviewLabel;
  /** Distinct anomaly categories inside the scenario window, in first-seen order. */
  anomalyCategories: Category[];
  /** Every visible observation, oldest first, each with its reason. */
  evidence: EvidenceItem[];
  /** Human-readable lines explaining how the state was derived. */
  explanation: string[];
  observationCount: number;
  latestObservedAt: string | null;
}
