// Loads the real-data snapshot and turns it into incidents, replay days and validated observations.
// Owned by the real-data builder. Nothing here is simulated: watch areas come from data/watches.json,
// raw rows from data/real/*.json (written by scripts/refresh-data.mjs), and anomalies from the stated
// rules in ./watchRules. No network call here: src/lib/watchLive.ts fetches a fresh build from /api/watch
// and passes it to buildLiveFixtures.
import volcanoesRaw from '../../data/volcanoes.json';
import watchesRaw from '../../data/watches.json';
import firmsRaw from '../../data/real/firms.json';
import quakesRaw from '../../data/real/quakes.json';
import metaRaw from '../../data/real/meta.json';
import { DATA_MODES } from '../types';
import type { DemoScenario, Incident, Observation, ReplayStep, SourceRef, ValidationIssue, Volcano } from '../types';
import { parseUtcTimestamp, validateObservations } from './reviewRules';
import {
  WATCH_HAZARDS,
  buildReplayDays,
  describeWatchArea,
  isWatchArea,
  observationsForWatch,
  ruleContext,
  rulesForWatch,
} from './watchRules';
import type { FirmsRow, HotspotMember, QuakeRow, Watch, WatchArea } from './watchRules';

// Everything the UI needs about watches and rules can be imported from this module.
export type { HotspotMember, Watch, WatchArea } from './watchRules';
export {
  HAZE_MIN_DETECTIONS_PER_DAY,
  MODIS_MIN_CONFIDENCE,
  RULE_DISCLAIMER,
  SEISMIC_MIN_MAGNITUDE,
  SEISMIC_RADIUS_KM,
  THERMAL_RADIUS_KM,
  WATCH_RULE_TEXT,
  describeWatchArea,
  rulesForWatch,
} from './watchRules';

/** The shape the UI has always used. Unchanged so the UI keeps compiling. */
export interface Fixtures {
  volcanoes: Volcano[];
  incidents: Incident[];
  /**
   * Compatibility for the current UI, which replays one incident: `incidentId` is the first watch and
   * `replaySteps` are the shared snapshot days. Every watch replays over the same days; prefer
   * `replaySteps` / `replayStepsFor`.
   */
  scenario: DemoScenario;
  observations: Observation[];
  issues: ValidationIssue[];
  duplicatesIgnored: number;
}

/** One downloaded source, from data/real/meta.json. */
export interface SnapshotSource {
  /** e.g. "firms-viirs-noaa20", "usgs-fdsn", "bmkg-live30event". */
  id: string;
  name: string;
  provider: string;
  /** The exact file or query URL that was downloaded. */
  url: string;
  /** Public page describing the product. */
  productUrl: string;
  /** ISO 8601 UTC. */
  retrievedAt: string;
  /** The response's Last-Modified header as ISO 8601 UTC, when sent. */
  lastModified: string | null;
  rowsRead: number;
  rowsKept: number;
  attribution: string;
  licence: string;
}

/** The real-data snapshot behind every record. */
export interface Snapshot {
  /** ISO 8601 UTC time the snapshot was downloaded: "Data as of <time> UTC". Empty if no snapshot loaded. */
  retrievedAt: string;
  /** Newest FIRMS file Last-Modified (ISO 8601 UTC): the satellite data time for the banner. Null if unknown. */
  satelliteAsOf: string | null;
  /** The last 7 UTC days: start at 00:00Z of the first day, end at retrievedAt. */
  window: { start: string; end: string };
  sources: SnapshotSource[];
  /** One attribution line per provider (FIRMS, USGS, BMKG), for the footer and the brief. BMKG requires its credit. */
  attributions: string[];
  /** 'live' when built from the /api/watch relay this visit (src/lib/watchLive.ts); the bundled snapshot is 'historical'. */
  dataMode: 'live' | 'historical';
}

/** Per-watch metadata for the detail panel and the brief. */
export interface WatchMeta {
  id: string;
  /** Short key used as the prefix of observation ids, e.g. "merapi". */
  key: string;
  area: WatchArea;
  /** Plain words for the area, e.g. "Box: latitude -0.5 to 1.6, longitude 101 to 103.2". */
  areaText: string;
  /** Official and independent pages to consult (link-outs; never fetched by the app). */
  references: SourceRef[];
  /** The watch rules that apply, in plain words, thermal first. Each ends "Illustrative watch rule, not an official threshold." */
  rules: string[];
}

/** What loadFixtures returns: the unchanged Fixtures plus the real-data fields. */
export interface RealFixtures extends Fixtures {
  /** The watch areas (Incident-shaped, with area, key and references). Same objects as `incidents`. */
  watches: Watch[];
  /** One step per UTC day of the snapshot, oldest first. Every watch replays over these. */
  replaySteps: ReplayStep[];
  snapshot: Snapshot;
  /** Metadata by watch id. */
  watchMeta: Record<string, WatchMeta>;
  /**
   * The individual FIRMS hotspots of each grouped thermal record, keyed by observation id: one entry per
   * volcano overpass and per haze daily total. Not part of Observation. Use `membersOf`.
   */
  members: Record<string, HotspotMember[]>;
}

// ---------------------------------------------------------------------------
// Raw input checks (data files are trusted to be ours, but a hand edit must fail loudly, not silently)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSourceRef(value: unknown): value is SourceRef {
  return isRecord(value) && typeof value.name === 'string' && typeof value.url === 'string' && /^https?:\/\//.test(value.url);
}

function readWatches(raw: unknown, issues: ValidationIssue[]): Watch[] {
  if (!Array.isArray(raw)) {
    issues.push({ recordId: null, index: -1, message: 'data/watches.json skipped: expected a list of watch areas.' });
    return [];
  }
  const out: Watch[] = [];
  raw.forEach((w: unknown, index) => {
    const problems: string[] = [];
    if (!isRecord(w)) {
      issues.push({ recordId: null, index, message: `Watch at position ${index} skipped: not a record.` });
      return;
    }
    for (const f of ['id', 'key', 'title', 'locationName', 'country', 'summary'] as const) {
      if (typeof w[f] !== 'string' || (w[f] as string).trim() === '') problems.push(`${f} is missing`);
    }
    if (!WATCH_HAZARDS.includes(w.hazard as Watch['hazard'])) problems.push(`hazard ${JSON.stringify(w.hazard)} is not known`);
    if (!(w.volcanoId === null || typeof w.volcanoId === 'string')) problems.push('volcanoId must be text or null');
    if (typeof w.lat !== 'number' || typeof w.lon !== 'number') problems.push('lat/lon must be numbers');
    if (!DATA_MODES.includes(w.dataMode as Watch['dataMode'])) problems.push(`dataMode ${JSON.stringify(w.dataMode)} is not known`);
    if (!isWatchArea(w.area)) problems.push('area must be {"kind":"summit"} or a valid bbox');
    if (typeof w.replayable !== 'boolean') problems.push('replayable must be true or false');
    if (!Array.isArray(w.references) || !w.references.every(isSourceRef)) problems.push('references must be a list of {name, url}');
    const win = w.scenarioWindow;
    if (!isRecord(win) || parseUtcTimestamp(win.start) === null || parseUtcTimestamp(win.end) === null) {
      problems.push('scenarioWindow must have UTC start and end');
    }
    if (problems.length > 0) {
      issues.push({ recordId: typeof w.id === 'string' ? w.id : null, index, message: `Watch ${JSON.stringify(w.id)} skipped: ${problems.join('; ')}.` });
      return;
    }
    out.push(w as unknown as Watch);
  });
  return out;
}

function rowsOf(raw: unknown): unknown[] {
  return isRecord(raw) && Array.isArray(raw.rows) ? raw.rows : [];
}

interface MetaShape {
  retrievedAt: string;
  window: { start: string; end: string };
  sources: SnapshotSource[];
  dataMode: 'live' | 'historical';
}

function readMeta(raw: unknown, issues: ValidationIssue[]): MetaShape | null {
  if (
    !isRecord(raw) ||
    parseUtcTimestamp(raw.retrievedAt) === null ||
    !isRecord(raw.window) ||
    parseUtcTimestamp(raw.window.start) === null ||
    parseUtcTimestamp(raw.window.end) === null ||
    !Array.isArray(raw.sources)
  ) {
    issues.push({
      recordId: null,
      index: -1,
      message: 'data/real/meta.json is missing or malformed, so no snapshot records were loaded. Run npm run refresh:data.',
    });
    return null;
  }
  const sources = raw.sources.filter(
    (s): s is SnapshotSource => isRecord(s) && typeof s.id === 'string' && typeof s.name === 'string',
  );
  return { retrievedAt: raw.retrievedAt as string, window: raw.window as MetaShape['window'], sources, dataMode: raw.dataMode === 'live' ? 'live' : 'historical' };
}

// ---------------------------------------------------------------------------

/** Build the fixtures from raw inputs. Pure, so tests can feed synthetic snapshots. */
export function buildFixtures(raw: {
  volcanoes: unknown;
  watches: unknown;
  firms: unknown;
  quakes: unknown;
  meta: unknown;
}): RealFixtures {
  const issues: ValidationIssue[] = [];
  const volcanoes = (Array.isArray(raw.volcanoes) ? raw.volcanoes : []) as Volcano[];
  const watches = readWatches(raw.watches, issues);
  const meta = readMeta(raw.meta, issues);

  const replaySteps = meta ? buildReplayDays(meta.window) : [];
  const generated: Observation[] = [];
  const allMembers: Record<string, HotspotMember[]> = {};
  if (meta) {
    const ctx = ruleContext(meta);
    const firms = rowsOf(raw.firms) as FirmsRow[];
    const quakes = rowsOf(raw.quakes) as QuakeRow[];
    const reported = new Set<string>();
    for (const watch of watches) {
      const result = observationsForWatch(watch, { firms, quakes }, ctx);
      generated.push(...result.observations);
      Object.assign(allMembers, result.members);
      // A bad raw row is reported once, not once per watch.
      for (const [file, list] of [
        ['data/real/firms.json', result.firmsProblems],
        ['data/real/quakes.json', result.quakeProblems],
      ] as const) {
        for (const p of list) {
          const key = `${file}#${p.index}`;
          if (reported.has(key)) continue;
          reported.add(key);
          issues.push({ recordId: null, index: p.index, message: `Snapshot row ${p.index} in ${file} skipped: ${p.message}.` });
        }
      }
    }
  }

  const validation = validateObservations(generated, new Set(watches.map((w) => w.id)));
  // Members only for records that passed validation.
  const members: Record<string, HotspotMember[]> = {};
  for (const o of validation.valid) if (allMembers[o.id]) members[o.id] = allMembers[o.id];
  const firmsTimes = (meta?.sources ?? [])
    .filter((s) => s.id.startsWith('firms-') && typeof s.lastModified === 'string')
    .map((s) => s.lastModified as string)
    .sort();
  const providers = new Map<string, string>();
  for (const s of meta?.sources ?? []) if (typeof s.attribution === 'string' && !providers.has(s.provider)) providers.set(s.provider, s.attribution);

  return {
    volcanoes,
    incidents: watches,
    watches,
    scenario: { incidentId: watches.find((w) => w.replayable)?.id ?? '', replaySteps },
    replaySteps,
    observations: validation.valid,
    issues: [...issues, ...validation.issues],
    duplicatesIgnored: validation.duplicatesIgnored,
    snapshot: {
      retrievedAt: meta?.retrievedAt ?? '',
      satelliteAsOf: firmsTimes.length > 0 ? firmsTimes[firmsTimes.length - 1] : null,
      window: meta ? { start: meta.window.start, end: meta.window.end } : { start: '', end: '' },
      sources: meta?.sources ?? [],
      attributions: [...providers.values()],
      dataMode: meta?.dataMode ?? 'historical',
    },
    watchMeta: Object.fromEntries(
      watches.map((w): [string, WatchMeta] => [
        w.id,
        { id: w.id, key: w.key, area: w.area, areaText: describeWatchArea(w), references: w.references, rules: rulesForWatch(w) },
      ]),
    ),
    members,
  };
}

/** The hotspots behind a grouped thermal record (nearest and earliest first); empty for any other record. */
export function membersOf(fixtures: Pick<RealFixtures, 'members'>, observationId: string): HotspotMember[] {
  return fixtures.members[observationId] ?? [];
}

export function loadFixtures(): RealFixtures {
  return buildFixtures({ volcanoes: volcanoesRaw, watches: watchesRaw, firms: firmsRaw, quakes: quakesRaw, meta: metaRaw });
}

/**
 * Fixtures from a /api/watch build (src/lib/watchRelay.ts): the bundled watch areas with the build's
 * window, and every record marked live. Same rules and validation as the bundled snapshot.
 */
export function buildLiveFixtures(data: { firms: unknown; quakes: unknown; meta: unknown; scenarioWindow: { start: string; end: string } }): RealFixtures {
  const watches = Array.isArray(watchesRaw)
    ? (watchesRaw as unknown[]).map((w) => (isRecord(w) ? { ...w, scenarioWindow: data.scenarioWindow, dataMode: 'live' } : w))
    : watchesRaw;
  const meta = isRecord(data.meta) ? { ...data.meta, dataMode: 'live' } : data.meta;
  return buildFixtures({ volcanoes: volcanoesRaw, watches, firms: data.firms, quakes: data.quakes, meta });
}

/** The volcano with this id, or null (also null for a null/undefined id). */
export function findVolcano(volcanoes: Volcano[], id: string | null | undefined): Volcano | null {
  if (!id) return null;
  return volcanoes.find((v) => v.id === id) ?? null;
}

/**
 * Replay steps for an incident, oldest first: the shared snapshot days for every replayable watch.
 * Empty for unknown or non-replayable incidents.
 */
export function replayStepsFor(fixtures: Pick<Fixtures, 'incidents' | 'scenario'>, incidentId: string): ReplayStep[] {
  const incident = fixtures.incidents.find((i) => i.id === incidentId);
  if (!incident || !incident.replayable) return [];
  return fixtures.scenario.replaySteps;
}
