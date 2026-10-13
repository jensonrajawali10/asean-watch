// Shared data contract for ASEAN Watch. Every module builds against these types.
// Changing a type here is a contract change: update docs/CONTRACT.md in the same commit.

export const CATEGORIES = ['thermal', 'gas', 'deformation', 'ash', 'seismic', 'report'] as const;
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
  /** Set by a stated watch rule in the adapter (e.g. "VIIRS detection within 5 km of the summit"). Illustrative, never official. */
  anomaly: boolean;
  /** The watch rule that flagged this record, in plain words; null when anomaly is false. */
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

// ---------------------------------------------------------------------------
// NEA live context layer (Singapore National Environment Agency via data.gov.sg).
// Context, not evidence: it never changes review state. Shown in the zoomed view for
// incidents near Singapore. "live" = fetched this session; "historical" = bundled snapshot.

export interface NeaStationWind {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  /** Degrees clockwise from north that the wind blows FROM (meteorological convention). */
  fromDeg: number;
  speedKnots: number | null;
}

export interface WindSummary {
  /** Speed-weighted vector-mean direction the wind blows FROM; null only when there is no usable reading or the resultant is ~0. */
  fromDeg: number | null;
  /** Mean of station speeds in knots; null when no speeds were reported. */
  meanSpeedKnots: number | null;
  /** 0..1 agreement between stations (resultant vector length / mean speed). Below 0.5 reads as variable. */
  consistency: number;
  stationCount: number;
  /** Plain text, e.g. "From SW (226°) at 4.1 kn" or "From SW (226°) at 1.2 kn, variable: stations disagree". */
  label: string;
}

export interface HazeReading {
  /** ISO 8601 UTC time of the NEA reading. */
  observedAt: string;
  /** NEA 24-hour PSI by region (north, south, east, west, central). */
  psi24h: Record<string, number>;
  /** NEA 1-hour PM2.5 in µg/m³ by region, when available. */
  pm25OneHour: Record<string, number> | null;
  /** NEA PSI descriptor for the highest regional 24-hour PSI, e.g. "Unhealthy". */
  psiBand: string;
  /** "live" when fetched this session; "historical" when taken from the bundled snapshot. */
  dataMode?: 'live' | 'historical';
}

export interface NeaContext {
  dataMode: Extract<DataMode, 'live' | 'historical'>;
  /** ISO 8601 UTC time of the wind reading. */
  observedAt: string;
  /** ISO 8601 UTC time it was fetched (live) or captured (snapshot). */
  retrievedAt: string;
  stations: NeaStationWind[];
  wind: WindSummary;
  haze: HazeReading | null;
  sourceName: string;
  sourceUrl: string;
  /** Singapore Open Data Licence attribution text. */
  attribution: string;
  qualityNote: string;
}

export interface DriftAssessment {
  incidentId: string;
  /** Great-circle distance from the incident to Singapore. */
  distanceKm: number;
  /** Initial bearing from the incident to Singapore, degrees clockwise from north. */
  bearingToSingaporeDeg: number;
  /** Direction the wind blows TOWARD ((fromDeg + 180) mod 360); null when there is no wind direction. */
  downwindDeg: number | null;
  /** True when Singapore lies within ±45° of downwind from the incident; null when there is no wind direction. */
  singaporeDownwind: boolean | null;
  /** One plain-language sentence for the UI and the brief, with the not-a-dispersion-model caveat. */
  text: string;
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

// ---------------------------------------------------------------------------
// Official warnings: relayed verbatim from the issuing agency, never generated by us.
// Context for evacuation awareness; never enters deriveReview. See docs/CONTRACT.md.

export type WarningHazard = 'tsunami' | 'volcano' | 'earthquake' | 'flood' | 'haze' | 'weather' | 'other';

export interface OfficialWarningArea {
  /** Verbatim area name, e.g. "MANGGARAI BAGIAN UTARA". */
  name: string;
  /** Verbatim per-area level, e.g. "SIAGA"; null when the issuer gives none. */
  level: string | null;
  lat: number | null;
  lon: number | null;
}

export interface OfficialWarning {
  /** Issuer's message id when provided, otherwise a stable derived id. */
  id: string;
  /** e.g. "BMKG InaTEWS", "Japan Meteorological Agency". */
  issuer: string;
  /** Official public page people should follow. */
  issuerUrl: string;
  /** "official": the agency with authority. "aggregator": e.g. GDACS impact estimates, never styled as a warning. */
  authority: 'official' | 'aggregator';
  hazard: WarningHazard;
  /** Verbatim product or subject, e.g. "Warning Tsunami PD-3.4". */
  product: string;
  /** Verbatim headline level, e.g. "SIAGA", "Level III (Siaga)", "Tsunami Advisory". */
  level: string;
  /** Fixed, reviewed English gloss for a non-English level; null when not needed. */
  levelGloss: string | null;
  /** Verbatim headline. */
  headline: string;
  /** Verbatim area summary. */
  areaDescription: string;
  areas: OfficialWarningArea[];
  location: { lat: number; lon: number } | null;
  /** ISO 8601 UTC; null when the issuer publishes no time (show retrievedAt instead). */
  issuedAt: string | null;
  /** ISO 8601 UTC; null when the issuer gives no expiry. */
  expiresAt: string | null;
  /** True when the issuer has ended or cancelled it, or expiresAt had passed when retrieved. */
  ended: boolean;
  /** Verbatim safety or evacuation instruction, if the issuer gave one. */
  instruction: string | null;
  /** BCP 47 language of the verbatim text, e.g. "id", "ja", "en". */
  language: string;
  /** The feed or message URL this was read from. */
  sourceUrl: string;
  dataMode: Extract<DataMode, 'live' | 'historical'>;
  /** ISO 8601 UTC time it was fetched (live) or captured (snapshot). */
  retrievedAt: string;
}

export interface WarningFeedStatus {
  /** e.g. "bmkg-inatews", "jma-tsunami", "geonet-val". */
  feedId: string;
  issuer: string;
  issuerUrl: string;
  /** "unavailable" must render as "Official feed unavailable: check <issuer> directly", never as "no warnings". */
  status: 'live' | 'cached' | 'snapshot' | 'unavailable';
  retrievedAt: string | null;
  /** Readable status or error text. */
  message: string | null;
}
