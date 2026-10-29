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
  /** Distinct anomaly categories inside the watch window, in first-seen order. */
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
  /** Verbatim province or region code from the issuer (e.g. BMKG "NTT"); absent when not given. */
  province?: string | null;
}

/** A tsunami height measured at a tide gauge, relayed verbatim (BMKG InaTEWS <obsarea>). */
export interface TsunamiObservation {
  /** Verbatim gauge or place name, e.g. "MAUROLE-ENDE". */
  location: string;
  lat: number;
  lon: number;
  /** Observed height in metres (parsed). */
  heightM: number;
  /** The height exactly as the issuer wrote it, e.g. "0.30". */
  heightText: string;
  /** ISO 8601 UTC; null when the issuer gives no full date and time. */
  observedAt: string | null;
  /** Verbatim time text, e.g. "05:27 WIB". */
  timeText: string | null;
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
  /** Observed tsunami heights the issuer reports with this message (BMKG InaTEWS); absent otherwise. */
  observations?: TsunamiObservation[];
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
  /**
   * ISO 8601 UTC: the newest time this feed answered live (live or cached) on this page. It stays when a
   * later refresh falls back to the snapshot, so "feed quiet" (src/lib/staleness.ts) counts from the last
   * real answer. Absent when the feed has not answered live since the page loaded.
   */
  lastAnswerAt?: string | null;
  /** Readable status or error text. */
  message: string | null;
}

// ---------------------------------------------------------------------------
// Connector layers (quakes, sea level, PTWC, GloFAS discharge, GIBS imagery). Context only: none of
// these enters deriveReview. "live" = fetched this session; "historical" = bundled snapshot, shown
// with its original times. See src/lib/{quakesLive,seaLevel,ptwc,floodModel,gibs}.ts.

/** Per-source load outcome. "unavailable" must render as "<source> unavailable: check <source> directly", never as "none". */
export interface ConnectorStatus {
  sourceId: string;
  sourceName: string;
  status: 'live' | 'cached' | 'snapshot' | 'unavailable';
  /** ISO 8601 UTC time the data was fetched (live/cached) or captured (snapshot); null when unavailable. */
  retrievedAt: string | null;
  message: string;
}

/** One earthquake as reported by ONE agency. USGS and BMKG reports of the same event are never merged. */
export interface QuakeEvent {
  /** Source-prefixed id, e.g. "usgs:us6000u28y", "bmkg-gempaterkini:20261011213453". */
  id: string;
  source: 'USGS' | 'BMKG';
  /** The product it came from, e.g. "USGS FDSN event service", "BMKG gempaterkini (M 5.0+)". */
  product: string;
  magnitude: number;
  /** e.g. "mww", "mb"; null when the agency does not say (BMKG). */
  magType: string | null;
  depthKm: number | null;
  lat: number;
  /** Normalised to -180..180. */
  lon: number;
  /** Verbatim place / region text from the agency. */
  place: string;
  /** ISO 8601 UTC origin time. */
  timeISO: string;
  /** Agency event page or product page. */
  url: string;
  /** USGS "tsunami" flag only (null for BMKG). NOT a tsunami warning: see USGS_TSUNAMI_FLAG_NOTE. */
  tsunamiFlag: boolean | null;
  /** BMKG verbatim tsunami-potential statement ("Potensi"), null for USGS. */
  potential: string | null;
  dataMode: Extract<DataMode, 'live' | 'historical'>;
}

/** IOC SLSMF tide gauge (one station, all its water-level sensors). */
export interface SeaLevelStation {
  code: string;
  name: string;
  /** IOC 3-letter country code, e.g. "IDN". */
  country: string;
  countryName: string | null;
  lat: number;
  lon: number;
  /** Water-level sensors reported by IOC for this station (battery and wind sensors removed). */
  sensors: string[];
  /** Sensor used for readings (rad, prs, pwl, ... in that preference). */
  sensor: string;
  /** Sampling interval in minutes, as listed by IOC. */
  rateMin: number | null;
  /** ISO 8601 UTC time of the last sample at list capture time; null if never. */
  lastTimeISO: string | null;
}

export interface SeaLevelReading {
  /** ISO 8601 UTC sample time. */
  timeISO: string;
  /** Raw gauge value on the station's own datum (includes the normal tide). */
  value: number;
  unit: 'm';
}

export interface SeaLevelSeries {
  stationCode: string;
  sensor: string;
  readings: SeaLevelReading[];
  dataMode: Extract<DataMode, 'live' | 'historical'>;
  retrievedAt: string;
  sourceUrl: string;
  /** Always the raw, unvalidated, not-a-warning caveat. */
  note: string;
}

/** GloFAS river discharge via Open-Meteo. MODELLED context, never a warning or evidence. */
export interface RiverDischargeDay {
  /** YYYY-MM-DD (UTC day). */
  date: string;
  /** m³/s; null where the model gives no value. */
  dischargeM3s: number | null;
  kind: 'past' | 'today' | 'forecast';
}

export interface RiverDischargeSeries {
  pointId: string;
  river: string;
  place: string;
  country: string;
  requested: { lat: number; lon: number };
  /** The GloFAS cell actually used (highest mean discharge in the 5×5 neighbourhood). */
  cell: { lat: number; lon: number };
  unit: 'm³/s';
  days: RiverDischargeDay[];
  basis: 'MODELLED';
  dataMode: Extract<DataMode, 'live' | 'historical'>;
  retrievedAt: string;
  sourceUrl: string;
  note: string;
}

/** A MapLibre raster source + layer spec for NASA GIBS imagery (EPSG:3857, GoogleMapsCompatible). */
export interface GibsRasterLayer {
  id: string;
  /** GIBS layer identifier, e.g. "Himawari_AHI_Band13_Clean_Infrared". */
  layer: string;
  title: string;
  /** MapLibre tile URL templates ({z}/{y}/{x}). */
  tiles: string[];
  tileSize: 256;
  maxzoom: number;
  attribution: string;
  /** Image time requested: ISO 8601 UTC (10-minute) or YYYY-MM-DD for daily layers. */
  timeISO: string;
  latencyNote: string;
  legendUrl: string | null;
  dataMode: 'live';
}
