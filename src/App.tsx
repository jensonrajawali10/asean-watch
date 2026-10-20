// ASEAN Watch app shell (docs/UX_V3.md). Two modes, one map:
//   - Map mode: the full-bleed map, a floating top bar (brand, live headline, alerts pill), six layer chips
//     and one forecast scrubber at the bottom, and one small card for whatever is selected.
//   - Analyst workspace: a drawer opened from the left taskbar, dense on purpose, one section at a time.
// App is the single owner of the selection (one thing on the map), the open workspace section (both in the
// URL hash), the layer toggles, the forecast hour, the seven-day evidence replay, the generated brief and
// the inspected record or warning. Everything else is derived from those, the real-data snapshot loaded
// once below, the live feeds loaded once after mount, and the official warnings with PTWC, which
// useOfficialWarnings refreshes every 5 minutes (and on visible and online). Expiry is judged on the shared
// page clock (useNowMs).
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DriftAssessment, Incident, OfficialWarning, ReplayStep, ReviewResult, ReviewState, SourceRef } from './types';
import { findVolcano, loadFixtures } from './lib/fixtures';
import type { HotspotMember, RealFixtures } from './lib/fixtures';
import { deriveReview, visibleObservations } from './lib/reviewRules';
import { buildBriefing, briefingFilename, downloadText } from './lib/briefing';
import type { BriefingInput } from './lib/briefing';
import { assessDrift, loadNeaContext } from './lib/nea';
import type { NeaLoadResult } from './lib/nea';
import { partitionWarnings } from './lib/warnings';
import { NEAR_KM, isExpired, mergeWarnings } from './lib/warningsView';
import { useOfficialWarnings } from './lib/useOfficialWarnings';
import { useNowMs } from './lib/useNowMs';
import type { HazeTransportView, MapViewProps } from './components/map/MapView';
import { hotspotsUpToDay } from './components/map/mapGeometry';
import type { MapHotspot } from './components/map/mapGeometry';
import { loadWindField, PARTICLE_WIND_LEVEL } from './lib/windField';
import { loadAshWind } from './lib/ashDrift';
import type { AshWindData } from './lib/ashDrift';
import { bundledQuakesSnapshot, loadQuakes, loadQuakesSnapshot } from './lib/quakesLive';
import type { QuakesResult } from './lib/quakesLive';
import { bundledFloodSnapshot, loadFloodModel, loadFloodModelSnapshot } from './lib/floodModel';
import type { FloodModelResult } from './lib/floodModel';
import type { WindGrid, WindLoadResult } from './lib/windField';
import { loadAirQuality } from './lib/airQuality';
import type { AirQualityData } from './lib/airQuality';
import { loadSeaLevelStations } from './lib/seaLevel';
import { useHazeHour } from './components/map/useHazeHour';
import { computeTrajectories, hazeSourcesFromFixtures, sampleWind } from './lib/transport';
import AppHeader from './components/AppHeader';
import RecordInspector from './components/RecordInspector';
import type { GeneratedBrief } from './components/BriefPanel';
import DataCheckNotice from './components/DataCheckNotice';
import { WarningInspector, feedForWarning, gaugeForWarning } from './components/OfficialWarnings';
import ErrorBoundary from './components/ErrorBoundary';
import { isNearSingapore } from './components/format';
import Taskbar, { taskbarButtonId } from './components/shell/Taskbar';
import WorkspaceDrawer from './components/shell/WorkspaceDrawer';
import { buildHash, parseHash, sameSelection, selToHash, selectionFromSel } from './components/shell/workspace';
import type { MapSelection, SectionId } from './components/shell/workspace';
import { alertsPill } from './components/shell/alerts';
import { DEFAULT_LAYERS } from './components/map/layerCatalog';
import type { LayerKey, MapLayerState } from './components/map/layerCatalog';
import { officialVolcanoLevel } from './components/map/volcanoLevels';
import type { OfficialVolcanoLevel } from './components/map/volcanoLevels';
import MapCards from './components/map/MapCards';
import { buildEruptionScenario } from './lib/eruptionScenario';
import EruptionScenarioPanel from './components/analyst/EruptionScenarioPanel';
import VolcanoesSection from './components/analyst/VolcanoesSection';
import WarningsSection from './components/analyst/WarningsSection';
import WaterSection from './components/analyst/WaterSection';
import LayersSection from './components/analyst/LayersSection';
import SituationSection from './components/analyst/SituationSection';
import HazeAirSection from './components/analyst/HazeAirSection';
import ReportSection from './components/analyst/ReportSection';
import SourcesSection from './components/analyst/SourcesSection';
import { FiresSection } from './components/analyst/FiresSection';
import BriefPanel from './components/BriefPanel';
import AiBriefPanel from './components/AiBriefPanel';
import { firesSummaryFromSnapshot, headline as situationHeadline } from './lib/situation';
import type { SituationInput } from './lib/situation';
import { loadFireSnapshot } from './lib/fires';
import type { FireSnapshot } from './lib/fires';
import type { FirePick } from './components/map/fireLayers';
import { firePoint, fireSelectionId, resolveFirePick } from './components/map/fireSelection';
import type { MapLayerContext } from './components/map/MapView';
import { REGIONAL_ZOOM } from './components/map/labelPlan';
import { regionalBadges } from './lib/fires';
import './App.css';
import './components/shell/shell.css';

/** MapLibre + deck.gl are large: the map loads as its own chunk so the shell paints first. */
// Both downloads start at module evaluation, not after the first render. The deck.gl layer builders are a
// dynamic import so deck.gl stays out of the entry chunk and off the first paint.
const mapViewModule = import('./components/map/MapView');
const MapView = lazy(() => mapViewModule);
type DeckLayersModule = typeof import('./components/map/deckLayers');
const deckLayersModule: Promise<DeckLayersModule | null> = import('./components/map/deckLayers').catch((err: unknown) => {
  console.error('Map layer code could not be loaded:', err);
  return null;
});

// ---------------------------------------------------------------------------
// Snapshot data: loaded and validated once per page load.

const EMPTY_FIXTURES = {
  volcanoes: [],
  incidents: [],
  scenario: { incidentId: '', replaySteps: [] },
  observations: [],
  issues: [],
  duplicatesIgnored: 0,
  watches: [],
  replaySteps: [],
  snapshot: { retrievedAt: '', satelliteAsOf: null, window: { start: '', end: '' }, sources: [], attributions: [] },
} as unknown as RealFixtures;

function load(): { fixtures: RealFixtures; error: string | null } {
  try {
    return { fixtures: loadFixtures(), error: null };
  } catch (err) {
    return { fixtures: EMPTY_FIXTURES, error: err instanceof Error ? err.message : String(err) };
  }
}

const { fixtures: FIXTURES, error: LOAD_ERROR } = load();
const INCIDENTS: Incident[] = Array.isArray(FIXTURES.incidents) ? FIXTURES.incidents : [];
/** The shared replay days (oldest first); every watch area replays over them. */
const STEPS: ReplayStep[] = Array.isArray(FIXTURES.replaySteps) ? FIXTURES.replaySteps : [];
const FIRST_STEP = STEPS[0]?.index ?? 0;
/** The replay opens on the newest day (audit fix 3): the state a reader expects is today's. */
const LAST_STEP = STEPS[STEPS.length - 1]?.index ?? 0;
const PLAY_INTERVAL_MS = 1500;
const FIRST_INCIDENT: Incident | null = INCIDENTS[0] ?? null;

const DATA_AS_OF: string | null = FIXTURES.snapshot?.retrievedAt || null;
const ATTRIBUTIONS: string[] = Array.isArray(FIXTURES.snapshot?.attributions) ? FIXTURES.snapshot.attributions : [];
const MEMBERS: Record<string, HotspotMember[]> = (FIXTURES as Partial<{ members: Record<string, HotspotMember[]> }>).members ?? {};

/**
 * Short place names for the map and the lists. A short watch title ("Anak Krakatau") is used as is; a long
 * one ("Riau peatland hotspots") falls back to the volcano name, else the map derives the place.
 */
const HAZARD_WORDS = /\s+(?:volcanic|volcano|eruption|wildfires?|fires?|haze|smoke|hotspots?|peatlands?|floods?|flooding|observations?)\b.*$/i;
const PLACE_NAMES: Record<string, string> = Object.fromEntries(
  INCIDENTS.flatMap((i) => {
    const title = i.title.trim();
    if (title && title.length <= 16) return [[i.id, title]];
    const volcano = findVolcano(FIXTURES.volcanoes, i.volcanoId);
    if (volcano?.name?.trim()) return [[i.id, volcano.name.trim()]];
    // "Riau peatland hotspots" → "Riau".
    const stripped = title.replace(HAZARD_WORDS, '').trim();
    return stripped && stripped !== title ? [[i.id, stripped]] : [];
  }),
);

/** Per-watch metadata (references, rules) when the snapshot publishes it, read structurally so shape changes never break the UI. */
const WATCH_META: Record<string, { references?: unknown; rules?: unknown }> = (() => {
  const raw = (FIXTURES as Partial<{ watchMeta: unknown }>).watchMeta;
  return raw && typeof raw === 'object' ? (raw as Record<string, { references?: unknown; rules?: unknown }>) : {};
})();

function isSourceRef(v: unknown): v is SourceRef {
  return typeof v === 'object' && v !== null && typeof (v as SourceRef).name === 'string' && typeof (v as SourceRef).url === 'string';
}

/** Reference links per watch (official level page, MOUNTS, ASMC): from watchMeta, else from the watch record. */
const REFERENCES: Record<string, SourceRef[]> = Object.fromEntries(
  INCIDENTS.map((i) => {
    const fromMeta = WATCH_META[i.id]?.references;
    const fromWatch = (FIXTURES.watches ?? []).find((w) => w.id === i.id) as { references?: unknown } | undefined;
    const refs = Array.isArray(fromMeta) ? fromMeta : Array.isArray(fromWatch?.references) ? fromWatch.references : [];
    return [i.id, refs.filter(isSourceRef)];
  }),
);

/** Plain-language watch rules per watch id, when the snapshot publishes them. */
const RULES_BY_WATCH: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  const legacy = (FIXTURES as Partial<{ rulesByWatch: unknown }>).rulesByWatch;
  for (const i of INCIDENTS) {
    const fromMeta = WATCH_META[i.id]?.rules;
    const fromLegacy = legacy && typeof legacy === 'object' ? (legacy as Record<string, unknown>)[i.id] : undefined;
    const rules = Array.isArray(fromMeta) ? fromMeta : Array.isArray(fromLegacy) ? fromLegacy : [];
    out[i.id] = rules.filter((r): r is string => typeof r === 'string' && r.trim() !== '');
  }
  return out;
})();

/** The FIRMS whole-region snapshot (fires module): the Fires chip's heat grid, the fire cards and section. */
const FIRE_SNAP: FireSnapshot | null = loadFireSnapshot();
const NO_RIVER_SERIES: FloodModelResult['series'] = [];
const FIRES_SUMMARY = (() => {
  try {
    return FIRE_SNAP ? firesSummaryFromSnapshot(FIRE_SNAP) : null;
  } catch (err) {
    console.error('Fire summary could not be derived:', err);
    return null;
  }
})();

/** Province, state and country fire badges for the regional zoom (largest first). */
const FIRE_BADGES = (() => {
  try {
    return FIRE_SNAP ? regionalBadges(FIRE_SNAP, '24h', 8) : [];
  } catch {
    return [];
  }
})();

/** The watch-area FIRMS clusters the haze paths start from. */
const HAZE_SOURCES = (() => {
  try {
    return hazeSourcesFromFixtures(FIXTURES);
  } catch (err) {
    console.error('Haze sources could not be derived:', err);
    return [];
  }
})();

/** Fallback for the Fires chip when the whole-region snapshot is missing: the hotspots behind the watch areas. */
const WATCH_HOTSPOTS: MapHotspot[] = (() => {
  if (FIRE_SNAP) return [];
  try {
    return INCIDENTS.flatMap((i) => hotspotsUpToDay(FIXTURES.observations, MEMBERS, i.id, LAST_STEP));
  } catch {
    return [];
  }
})();

const TIDE: { stations: ReturnType<typeof loadSeaLevelStations>['stations']; listRetrievedAt: string | null } = (() => {
  try {
    return loadSeaLevelStations();
  } catch {
    return { stations: [], listRetrievedAt: null };
  }
})();

/** The grid time nearest to now (the snapshot's first time when now is outside the grid). */
function nearestTime(times: string[], now: number): string {
  let best = times[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of times) {
    const d = Math.abs(Date.parse(t) - now);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** Modelled wind arrows and 48 h haze paths; null when the wind field is unavailable. */
function buildTransport(result: WindLoadResult | null): HazeTransportView | null {
  const grid = result?.grid;
  if (!result || result.status === 'unavailable' || !grid || grid.times.length === 0) return null;
  try {
    const time = nearestTime(grid.times, Date.now());
    const arrows: HazeTransportView['arrows'] = [];
    for (const lat of grid.lats) {
      for (const lon of grid.lons) {
        const w = sampleWind(grid, lat, lon, time);
        if (w && Number.isFinite(w.u) && Number.isFinite(w.v)) arrows.push({ lat, lon, u: w.u, v: w.v });
      }
    }
    const trajectories = computeTrajectories(grid, HAZE_SOURCES, time, 48, 30);
    const closest = trajectories.reduce<(typeof trajectories)[number] | null>(
      (best, t) => (best === null || t.receptor.closestKm < best.receptor.closestKm ? t : best),
      null,
    );
    return {
      time,
      level: grid.level,
      dataMode: grid.dataMode,
      retrievedAt: grid.retrievedAt,
      arrows,
      paths: trajectories.map((t) => ({ id: t.source.id, label: t.source.label, points: t.points, reaches: t.receptor.reaches })),
      summary: closest?.summary ?? null,
    };
  } catch (err) {
    console.error('Haze transport could not be computed:', err);
    return null;
  }
}

function reviewFor(incident: Incident, replayIndex: number): ReviewResult | null {
  try {
    return deriveReview(visibleObservations(FIXTURES.observations, incident.id, replayIndex), incident.scenarioWindow);
  } catch (err) {
    console.error(`Review could not be derived for ${incident.id}:`, err);
    return null;
  }
}

/** Records per replay day for one watch area (for the day cells). */
function countsByStep(incidentId: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const o of FIXTURES.observations) {
    if (o.incidentId !== incidentId) continue;
    out[o.replayStep] = (out[o.replayStep] ?? 0) + 1;
  }
  return out;
}

/** "Thu 16 Oct 00:00 UTC". */
function hourLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} ${iso.slice(11, 16)} UTC`;
}

/** "14 Oct 07:19 UTC". */
function runLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)} UTC`;
}

const cleanPlace = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');

// ---------------------------------------------------------------------------
// URL hash: #ws=<section>&sel=<selection>

function readHash() {
  const h = parseHash(window.location.hash);
  return { ws: h.ws, selection: selectionFromSel(h.sel) };
}

function writeHash(ws: SectionId | null, selection: MapSelection | null): void {
  const hash = buildHash({ ws, sel: selToHash(selection) });
  const url = hash || `${window.location.pathname}${window.location.search}`;
  if (hash === window.location.hash || (!hash && !window.location.hash)) return;
  try {
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* history can be unavailable in sandboxed previews; state still works */
  }
}

// ---------------------------------------------------------------------------

export default function App() {
  const initial = useRef(readHash()).current;
  const [selection, setSelectionState] = useState<MapSelection | null>(initial.selection);
  const [ws, setWs] = useState<SectionId | null>(initial.ws);
  /** The last section open, so the Workspace button reopens it. */
  const lastWs = useRef<SectionId>(initial.ws ?? 'situation');
  const [layers, setLayers] = useState<MapLayerState>(DEFAULT_LAYERS);
  const [replayIndex, setReplayIndex] = useState<number>(LAST_STEP);
  const [brief, setBrief] = useState<GeneratedBrief | null>(null);
  const [playing, setPlaying] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [inspectedWarningId, setInspectedWarningId] = useState<string | null>(null);
  /** Volcano watch id whose "If it erupted now" ash scenario plays on the map; null when none. */
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  /** The last fire object picked on the map or in the Fires section (cells and regions are not in the hash). */
  const [lastFirePick, setLastFirePick] = useState<FirePick | null>(null);
  /** A one-off camera request from a workspace row ("Fly to"); seq makes repeats count. */
  const [flyRequest, setFlyRequest] = useState<{ lat: number; lon: number; zoom?: number; seq: number } | null>(null);
  /** null while the NEA context is loading. */
  const [neaResult, setNeaResult] = useState<NeaLoadResult | null>(null);
  /** Official feeds and PTWC: the bundled snapshot first, then live, refreshed every 5 minutes. */
  const { feed: warningsResult, ptwc, loading: warningsLoading } = useOfficialWarnings();
  /** Shared page clock (every 5 minutes, on visible, on online): warning expiry and the quake layer's 24 h. */
  const nowMs = useNowMs();
  /** The deck.gl layer builders, once their chunk is in (the map draws no fire or plume layers before). */
  const [deckLayers, setDeckLayers] = useState<DeckLayersModule | null>(null);
  useEffect(() => {
    let live = true;
    void deckLayersModule.then((m) => {
      if (live) setDeckLayers(m);
    });
    return () => {
      live = false;
    };
  }, []);
  /** Modelled 10 m wind field (Open-Meteo, live or snapshot) for the haze paths; null until loaded. */
  const [windResult, setWindResult] = useState<WindLoadResult | null>(null);
  const transport = useMemo(() => buildTransport(windResult), [windResult]);
  /** Modelled haze inputs (CAMS PM2.5 and 925 hPa wind via Open-Meteo, live or snapshot); null until loaded. */
  const [airQuality, setAirQuality] = useState<AirQualityData | null>(null);
  const [wind925, setWind925] = useState<WindGrid | null>(null);
  /** Modelled pressure-level winds at the volcano summits (live or snapshot); null until loaded. */
  const [ashWind, setAshWind] = useState<AshWindData | null>(null);
  /** Connector layers: bundled snapshot first, replaced by the live load when it settles. */
  // Null until the bundled snapshot chunk (moments after first paint) or the live answer arrives.
  const [quakes, setQuakes] = useState<QuakesResult | null>(null);
  const [riverFlow, setRiverFlow] = useState<FloodModelResult | null>(null);
  useEffect(() => {
    let live = true;
    void bundledQuakesSnapshot().then((s) => {
      if (live) setQuakes((prev) => prev ?? loadQuakesSnapshot(s));
    });
    void bundledFloodSnapshot().then((s) => {
      if (live) setRiverFlow((prev) => prev ?? loadFloodModelSnapshot(s));
    });
    return () => {
      live = false;
    };
  }, []);
  const hazeHour = useHazeHour(airQuality);
  const briefSeq = useRef(0);

  // --- Selection and workspace (both mirrored in the hash) -----------------------------------

  const setSelection = useCallback((next: MapSelection | null) => {
    setSelectionState((prev) => (sameSelection(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    writeHash(ws, selection);
  }, [ws, selection]);

  const openSection = useCallback((section: SectionId) => {
    lastWs.current = section;
    setWs(section);
  }, []);
  const closeWorkspace = useCallback(() => setWs(null), []);

  // Typed or pasted links select the same way the map and the lists do.
  useEffect(() => {
    const onHashChange = () => {
      const h = readHash();
      setSelectionState(h.selection);
      setWs(h.ws);
      if (h.ws) lastWs.current = h.ws;
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const patchLayers = useCallback((patch: Partial<MapLayerState>) => setLayers((prev) => ({ ...prev, ...patch })), []);

  // --- Derived state -------------------------------------------------------

  const selectedIncidentId = selection?.kind === 'area' ? selection.id : null;
  const selectedCityId = selection?.kind === 'city' ? selection.id : null;
  const firePick = useMemo(
    () => (selection?.kind === 'fire' ? resolveFirePick(FIRE_SNAP, selection.id, lastFirePick) : null),
    [selection, lastFirePick],
  );
  const selectedClusterId = firePick?.kind === 'fire-cluster' ? firePick.cluster.id : null;
  const selectFire = useCallback(
    (pick: FirePick) => {
      setLastFirePick(pick);
      setSelection({ kind: 'fire', id: fireSelectionId(pick) });
    },
    [setSelection],
  );
  const flyTo = useCallback((lat: number, lon: number, zoom?: number) => {
    setFlyRequest((prev) => ({ lat, lon, zoom, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const reviews = useMemo(() => {
    const out: Record<string, ReviewResult> = {};
    for (const incident of INCIDENTS) {
      const r = reviewFor(incident, replayIndex);
      if (r) out[incident.id] = r;
    }
    return out;
  }, [replayIndex]);

  const states = useMemo(() => {
    const out: Record<string, ReviewState> = {};
    for (const [id, r] of Object.entries(reviews)) out[id] = r.state;
    return out;
  }, [reviews]);

  const incident = useMemo(
    () => (selectedIncidentId === null ? null : (INCIDENTS.find((i) => i.id === selectedIncidentId) ?? null)),
    [selectedIncidentId],
  );
  const missingId = selectedIncidentId !== null && incident === null ? selectedIncidentId : null;
  const review = incident ? (reviews[incident.id] ?? null) : null;
  const volcano = useMemo(() => (incident ? findVolcano(FIXTURES.volcanoes, incident.volcanoId) : null), [incident]);
  const replayEnabled = incident !== null && STEPS.length > 0;

  const stepPos = STEPS.findIndex((s) => s.index === replayIndex);
  const currentStep = stepPos >= 0 ? STEPS[stepPos] : null;
  const dayCounts = useMemo(() => (incident ? countsByStep(incident.id) : null), [incident]);

  const inspected = useMemo(
    () => (inspectedId && review ? (review.evidence.find((e) => e.observation.id === inspectedId) ?? null) : null),
    [inspectedId, review],
  );

  const nea = neaResult?.context ?? null;
  const drift = useMemo<DriftAssessment | null>(() => {
    if (!incident || !nea) return null;
    try {
      return assessDrift(incident, nea);
    } catch (err) {
      console.error('NEA drift could not be assessed:', err);
      return null;
    }
  }, [incident, nea]);

  // PTWC messages are official and relayed verbatim alongside the other feeds (its feed status carries the
  // "for national authorities" note).
  // One list, newest first (mergeWarnings re-sorts, so a PTWC message is never stuck behind the feed list).
  const allWarnings = useMemo(() => mergeWarnings(warningsResult.warnings, ptwc.warnings), [warningsResult.warnings, ptwc.warnings]);
  const allFeeds = useMemo(
    () => [...warningsResult.feeds, { ...ptwc.status, message: [ptwc.status.message, ptwc.note].filter(Boolean).join(' ') }],
    [warningsResult.feeds, ptwc],
  );
  /**
   * Warnings near the selected area (or every warning when nothing is selected), and the ones listed apart:
   * no coordinates published (e.g. JMA tsunami areas), or an official tsunami message in force whose warned
   * areas are not near (never dropped; see partitionWarnings).
   */
  const { nearWarnings, elsewhereWarnings } = useMemo<{ nearWarnings: OfficialWarning[]; elsewhereWarnings: OfficialWarning[] }>(() => {
    if (!incident) return { nearWarnings: allWarnings, elsewhereWarnings: [] };
    try {
      const { near, elsewhere } = partitionWarnings(allWarnings, incident.lat, incident.lon, NEAR_KM, nowMs);
      return { nearWarnings: near, elsewhereWarnings: elsewhere };
    } catch (err) {
      console.error('Official warnings could not be filtered by distance:', err);
      return { nearWarnings: [], elsewhereWarnings: allWarnings };
    }
  }, [allWarnings, incident, nowMs]);

  const inspectedWarning = useMemo(
    () => (inspectedWarningId ? (allWarnings.find((w) => w.id === inspectedWarningId) ?? null) : null),
    [inspectedWarningId, allWarnings],
  );
  const inspectedGauge = useMemo(
    () => (inspectedWarning ? gaugeForWarning(inspectedWarning, warningsResult.gauges) : null),
    [inspectedWarning, warningsResult.gauges],
  );
  const inspectedFeed = useMemo(() => (inspectedWarning ? feedForWarning(inspectedWarning, allFeeds) : null), [inspectedWarning, allFeeds]);

  /**
   * Official activity level per volcano watch: the issuer's level, verbatim, chosen by the one shared rule
   * (officialLevelFor), so the map ring, the volcano card and the review show the same record.
   */
  const levels = useMemo<Record<string, OfficialVolcanoLevel | null>>(() => {
    const out: Record<string, OfficialVolcanoLevel | null> = {};
    for (const i of INCIDENTS) {
      if (i.hazard !== 'volcano') continue;
      try {
        const v = findVolcano(FIXTURES.volcanoes, i.volcanoId);
        out[i.id] = officialVolcanoLevel({ title: i.title, volcanoId: i.volcanoId, lat: v?.lat ?? i.lat, lon: v?.lon ?? i.lon }, allWarnings, nowMs);
      } catch {
        out[i.id] = null;
      }
    }
    return out;
  }, [allWarnings, nowMs]);

  const alerts = useMemo(() => alertsPill(allWarnings, nowMs), [allWarnings, nowMs]);

  /** Everything the situation report, the headline and the content sections are built from. */
  const situationInput = useMemo<SituationInput>(
    () => ({
      airQuality,
      wind10m: windResult?.grid ?? null,
      wind925,
      hazeSources: HAZE_SOURCES,
      hotspotSnapshot: FIXTURES.snapshot ?? null,
      transportStartISO: transport?.time ?? null,
      nea,
      neaError: neaResult?.error ?? null,
      warnings: allWarnings,
      warningFeeds: allFeeds,
      fires: FIRES_SUMMARY,
      ashWind,
      riverFlow,
      quakes,
      nowMs,
    }),
    [airQuality, windResult, wind925, transport, nea, neaResult, allWarnings, allFeeds, ashWind, riverFlow, quakes, nowMs],
  );
  /** One live sentence that follows the scrubber; a snapshot never says "now". */
  const head = useMemo(() => situationHeadline(situationInput, { atISO: hazeHour.timeISO || null }), [situationInput, hazeHour.timeISO]);
  const headline = head.text;

  /**
   * The context a brief is built from: the NEA reading (when it applies), the nearby official warnings and
   * every feed's status. A brief generated under a different key is stale; the brief bar asks for a fresh one.
   */
  const contextKey = useMemo(
    () =>
      [
        drift && nea ? `nea:${nea.dataMode}:${nea.retrievedAt}` : 'nea:none',
        `w:${nearWarnings.map((w) => w.id).join(',')}`,
        `f:${allFeeds.map((f) => `${f.feedId}=${f.status}`).join(',')}`,
      ].join('|'),
    [drift, nea, nearWarnings, allFeeds],
  );

  // --- Actions -------------------------------------------------------------

  /** Select a watch area (map triangle, list row, card link); clears the brief and stops the replay. */
  const selectArea = useCallback(
    (id: string | null) => {
      setSelection(id === null ? null : { kind: 'area', id });
      setBrief(null);
      setPlaying(false);
      setInspectedId(null);
    },
    [setSelection],
  );

  const goToStep = (index: number) => {
    if (index === replayIndex) return;
    setReplayIndex(index);
    setBrief(null);
  };

  const nextStep = () => {
    setPlaying(false);
    const next = STEPS[stepPos + 1];
    if (next) goToStep(next.index);
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // From the last day, Play starts again at day 1.
    const startPos = stepPos >= STEPS.length - 1 ? -1 : stepPos;
    const next = STEPS[startPos + 1];
    if (!next) return;
    goToStep(next.index);
    setPlaying(startPos + 2 < STEPS.length);
  };

  const reset = () => {
    setPlaying(false);
    setReplayIndex(FIRST_STEP);
    setBrief(null);
  };

  const jumpToStep = (index: number) => {
    setPlaying(false);
    goToStep(index);
  };

  const openInspector = (id: string) => {
    setPlaying(false);
    setInspectedId(id);
  };

  const openWarning = useCallback((id: string) => {
    setPlaying(false);
    setInspectedWarningId(id);
  }, []);

  const generateBrief = () => {
    if (!incident || !review) return;
    setPlaying(false);
    briefSeq.current += 1;
    const input: BriefingInput = {
      incident,
      volcano,
      step: currentStep,
      review,
      issues: FIXTURES.issues,
      nea,
      drift,
      warnings: nearWarnings,
      otherTsunami: elsewhereWarnings.filter((w) => w.authority === 'official' && w.hazard === 'tsunami' && !isExpired(w, nowMs)),
      warningFeeds: allFeeds,
      dataAsOf: DATA_AS_OF,
      stepCount: STEPS.length || undefined,
    };
    let text: string;
    try {
      text = buildBriefing(input);
    } catch (err) {
      text = `ASEAN Watch summary\n\nThe summary could not be generated: ${err instanceof Error ? err.message : String(err)}\n`;
    }
    setBrief({ text, seq: briefSeq.current, contextKey });
  };

  const downloadBrief = () => {
    if (!brief || !incident) return;
    downloadText(brief.text, briefingFilename(incident, currentStep));
  };

  /** "Open in workspace →" from a card: the section for that kind of thing, keeping the selection. */
  const openFromCard = useCallback(
    (section: SectionId) => {
      openSection(section);
    },
    [openSection],
  );

  /** The scrubber's anchor step: "now" for a live model run, the capture hour for a snapshot. */
  const [mountMs] = useState(() => Date.now());
  const anchorMs = useMemo(() => {
    const t = Date.parse(hazeHour.steps.times[hazeHour.steps.nowIndex] ?? '');
    return Number.isFinite(t) ? t : mountMs;
  }, [hazeHour.steps, mountMs]);
  /** "If it erupted now" for the selected volcano: one scenario shared by the plume, the card and the panel. */
  const scenario = useMemo(
    () =>
      incident?.hazard === 'volcano' && ashWind
        ? buildEruptionScenario(ashWind, incident.volcanoId, anchorMs, { hours: 48, name: PLACE_NAMES[incident.id] ?? incident.title })
        : null,
    [incident, ashWind, anchorMs],
  );
  const plumeLayers = useCallback(
    (timeMs: number, ctx: MapLayerContext) =>
      deckLayers
        ? deckLayers.buildPlumeLayers(scenario, timeMs, { theme: ctx.theme, visible: true, showTrail: true, showFootprint: true, showPlaces: true })
        : [],
    [scenario, deckLayers],
  );

  /** "Play ash scenario": the plume follows the one timeline, so the scrubber goes back to now and plays. */
  const playScenario = useCallback(
    (watchId: string) => {
      if (scenarioId === watchId) {
        setScenarioId(null);
        hazeHour.setPlaying(false);
        return;
      }
      setSelection({ kind: 'area', id: watchId });
      setScenarioId(watchId);
      setLayers((prev) => (prev.watch ? prev : { ...prev, watch: true }));
      hazeHour.setPlaying(true, hazeHour.steps.nowIndex);
      // On a phone the workspace sheet covers the map: close it so the plume is seen.
      if (window.matchMedia?.('(max-width: 767px)').matches) setWs(null);
    },
    [scenarioId, hazeHour, setSelection],
  );

  // A scenario belongs to the volcano it was started on.
  useEffect(() => {
    if (scenarioId && selectedIncidentId !== scenarioId) setScenarioId(null);
  }, [scenarioId, selectedIncidentId]);

  // --- Effects -------------------------------------------------------------

  // Replay Play: advance one day every PLAY_INTERVAL_MS and stop at the last day.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      const pos = STEPS.findIndex((s) => s.index === replayIndex);
      const next = STEPS[pos + 1];
      if (!next) {
        setPlaying(false);
        return;
      }
      setReplayIndex(next.index);
      setBrief(null);
      if (pos + 2 >= STEPS.length) setPlaying(false);
    }, PLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, replayIndex]);

  // Esc outside the drawer and with no dialog open: close the card first, then the workspace.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .ws-drawer')) return;
      if (selection) {
        e.preventDefault();
        setSelection(null);
        return;
      }
      if (ws) {
        e.preventDefault();
        const back = document.getElementById(taskbarButtonId(ws));
        setWs(null);
        back?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, ws, setSelection]);

  // NEA Singapore context: loaded once; loadNeaContext never throws and falls back to a snapshot.
  useEffect(() => {
    let alive = true;
    loadNeaContext()
      .then((result) => {
        if (alive) setNeaResult(result);
      })
      .catch((err: unknown) => {
        if (alive) setNeaResult({ context: null, fellBack: false, error: String(err) });
      });
    return () => {
      alive = false;
    };
  }, []);

  // Model and connector feeds: loaded once after first render; every loader falls back to its snapshot.
  useEffect(() => {
    let alive = true;
    const settle = <T,>(p: Promise<T>, apply: (v: T) => void, what: string) =>
      p.then((v) => alive && apply(v)).catch((err: unknown) => console.error(`${what} could not be loaded:`, err));
    settle(loadWindField(), setWindResult, 'Wind field');
    settle(loadAirQuality(), (r) => setAirQuality(r.data), 'Air quality');
    settle(loadWindField({ level: PARTICLE_WIND_LEVEL }), (r) => setWind925(r.grid), '925 hPa wind');
    settle(loadAshWind(), (r) => setAshWind(r.data), 'Ash-drift winds');
    settle(loadQuakes(), setQuakes, 'Earthquakes');
    settle(loadFloodModel(), setRiverFlow, 'River flow');
    return () => {
      alive = false;
    };
  }, []);

  // --- Render --------------------------------------------------------------

  const firstName = FIRST_INCIDENT ? (PLACE_NAMES[FIRST_INCIDENT.id] ?? FIRST_INCIDENT.title) : null;
  const disabledNote =
    STEPS.length === 0 ? 'No replay days are loaded.' : incident ? null : `Pick an area to step through the last ${STEPS.length} days.`;
  const contextLabel = incident && currentStep ? `${currentStep.label}, day ${stepPos + 1} of ${STEPS.length}` : incident ? 'all records' : null;
  const neaLoading = neaResult === null && incident !== null && isNearSingapore(incident.lat, incident.lon);
  const selectedName = incident ? (PLACE_NAMES[incident.id] ?? incident.title) : null;
  const cityName = selectedCityId ? (airQuality?.places.find((p) => p.id === selectedCityId)?.name ?? null) : null;

  /** Snapshot data acknowledgements (FIRMS, USGS, "Sumber data: BMKG"): in the Volcanoes and Sources sections. */
  const attribution =
    ATTRIBUTIONS.length > 0 ? (
      <div className="data-attribution">
        {ATTRIBUTIONS.filter((line) => line.length <= 120).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {ATTRIBUTIONS.some((line) => line.length > 120) && (
          <details className="data-attribution-more">
            <summary>Data acknowledgements</summary>
            {ATTRIBUTIONS.filter((line) => line.length > 120).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </details>
        )}
      </div>
    ) : null;

  const briefProps =
    incident !== null
      ? {
          incident,
          contextLabel,
          brief,
          contextKey,
          filename: briefingFilename(incident, currentStep),
          onGenerate: generateBrief,
          onDownload: downloadBrief,
          dayIndex: currentStep?.index ?? null,
        }
      : null;

  const layerUnavailable: Partial<Record<LayerKey, string>> = {
    ...(airQuality ? {} : { haze: 'Waiting for the air-quality model.' }),
    ...(wind925 ? {} : { particles: 'Waiting for the wind model.' }),
    ...(transport ? {} : { transport: 'Waiting for the surface wind model.' }),
    ...(incident?.hazard === 'volcano' ? {} : { rings: 'Shown when a volcano is selected.', ash: 'Shown when a volcano is selected.' }),
  };


  /** The fires module's heat grid and badges, through MapView's layer seam. */
  const fireLayers = useCallback(
    (ctx: MapLayerContext) =>
      !deckLayers
        ? []
        : deckLayers.buildFireLayers({
        snapshot: FIRE_SNAP,
        theme: ctx.theme,
        zoom: ctx.zoom,
        visible: layers.fires,
        selectedClusterId,
        // Calm at the regional view: the glow only (squares from zoom 4.5 in both themes). Region badges at the
        // regional zoom are MapView's (one collision plan with pins, volcano names and city labels); the
        // fires module draws the cluster badges from zoom 5.2.
        cellsMinZoom: 4.5,
        showBadges: ctx.zoom >= REGIONAL_ZOOM,
        maxBadges: 6,
        onClick: (pick) => selectFire(pick),
      }),
    [layers.fires, selectedClusterId, selectFire, deckLayers],
  );

  let section: ReactNode = null;
  switch (ws) {
    case 'situation':
      section = (
        <SituationSection
          input={situationInput}
          onOpenSection={openSection}
          aiBrief={
            incident ? (
              <AiBriefPanel watchId={incident.id} dayIndex={currentStep?.index ?? null} />
            ) : (
              <p className="an-muted">Pick a watch area (map or Volcanoes section) to ask for an AI-written summary of it.</p>
            )
          }
        />
      );
      break;
    case 'haze':
      section = (
        <HazeAirSection
          airQuality={airQuality}
          nea={nea}
          neaError={neaResult?.error ?? null}
          neaLoading={neaResult === null}
          wind10m={windResult?.grid ?? null}
          wind925={wind925}
          hazeSources={HAZE_SOURCES}
          hotspotSnapshot={FIXTURES.snapshot ?? null}
          fires={FIRES_SUMMARY}
          transportStartISO={transport?.time ?? null}
          scrubberISO={hazeHour.timeISO || null}
          selectedCityId={selectedCityId}
          onFlyTo={(lat, lon) => flyTo(lat, lon, 6.5)}
          onSelectCity={(id) => setSelection({ kind: 'city', id })}
        />
      );
      break;
    case 'fires':
      section = (
        <FiresSection
          snapshot={FIRE_SNAP}
          windGrid={wind925}
          smokeStartISO={hazeHour.timeISO || undefined}
          onFlyTo={flyTo}
          selectedClusterId={selectedClusterId}
          onSelectCluster={(cluster) => selectFire({ kind: 'fire-cluster', cluster })}
        />
      );
      break;
    case 'volcanoes':
      section = (
        <VolcanoesSection
          incidents={INCIDENTS}
          reviews={reviews}
          placeNames={PLACE_NAMES}
          selectedId={incident?.id ?? null}
          onSelect={selectArea}
          onClearSelection={() => selectArea(null)}
          incident={incident}
          missingId={missingId}
          review={review}
          volcano={volcano}
          firstIncident={FIRST_INCIDENT}
          firstName={firstName}
          onInspect={openInspector}
          nearWarnings={nearWarnings}
          onInspectWarning={openWarning}
          references={incident ? REFERENCES[incident.id] : undefined}
          watchRules={incident ? RULES_BY_WATCH[incident.id] : undefined}
          nea={{ loading: neaLoading, context: nea, drift, fellBack: neaResult?.fellBack ?? false, error: neaResult?.error ?? null }}
          replay={{
            steps: STEPS,
            index: replayIndex,
            enabled: replayEnabled,
            playing,
            disabledNote,
            counts: dayCounts,
            visibleCount: review?.observationCount ?? null,
            onNext: nextStep,
            onTogglePlay: togglePlay,
            onReset: reset,
            onJump: jumpToStep,
          }}
          brief={{
            contextLabel,
            brief,
            contextKey,
            filename: incident ? briefingFilename(incident, currentStep) : null,
            onGenerate: generateBrief,
            onDownload: downloadBrief,
            dayIndex: currentStep?.index ?? null,
          }}
          attribution={attribution}
          dataAsOf={DATA_AS_OF}
          scenarioPanel={
            <EruptionScenarioPanel
              watches={FIXTURES.watches ?? []}
              ashWind={ashWind}
              nowMs={anchorMs}
              warnings={allWarnings}
              selectedWatchId={incident?.id ?? null}
              onSelectWatch={selectArea}
              onPlayScenario={playScenario}
              withMethods
            />
          }
        />
      );
      break;
    case 'warnings':
      section = (
        <WarningsSection
          warnings={nearWarnings}
          allWarnings={allWarnings}
          gauges={warningsResult.gauges}
          feeds={allFeeds}
          nearName={selectedName}
          elsewhere={elsewhereWarnings}
          onShowAll={() => selectArea(null)}
          loading={warningsLoading}
          selectedWarningId={selection?.kind === 'warning' ? selection.id : inspectedWarningId}
          onInspect={openWarning}
        />
      );
      break;
    case 'water':
      section = (
        <WaterSection
          ptwc={ptwc}
          warnings={allWarnings}
          gauges={warningsResult.gauges}
          tideStations={TIDE.stations}
          tideListRetrievedAt={TIDE.listRetrievedAt}
          riverFlow={riverFlow}
          layers={layers}
          onLayersChange={patchLayers}
          onInspectWarning={openWarning}
        />
      );
      break;
    case 'report':
      section = (
        <ReportSection input={situationInput} incidentBrief={brief && incident ? { title: `${selectedName ?? incident.title}: watch-area summary`, text: brief.text } : null}>
          {briefProps ? (
            <BriefPanel {...briefProps} />
          ) : (
            <p className="an-muted">
              Pick a watch area to add its seven-day summary.{' '}
              <button type="button" className="an-row-btn" onClick={() => openSection('volcanoes')}>
                Open the Volcanoes section
              </button>
            </p>
          )}
        </ReportSection>
      );
      break;
    case 'sources':
      section = <SourcesSection input={situationInput} />;
      break;
    case 'layers':
      section = <LayersSection layers={layers} onLayersChange={patchLayers} unavailable={layerUnavailable} />;
      break;
    default:
      section = null;
  }

  const card = (
    <MapCards
      fireSnapshot={FIRE_SNAP}
      firePick={firePick}
      selection={selection}
      onClose={() => setSelection(null)}
      onOpenWorkspace={openFromCard}
      airQuality={airQuality}
      hazeHour={hazeHour}
      wind925={wind925}
      neaHaze={nea?.haze ?? null}
      incidents={INCIDENTS}
      placeNames={PLACE_NAMES}
      levels={levels}
      ashWind={ashWind}
      scenarioId={scenarioId}
      scenario={scenario}
      anchorMs={anchorMs}
      onPlayScenario={playScenario}
      warnings={allWarnings}
      onInspectWarning={openWarning}
    />
  );

  const mapProps: MapViewProps = {
    incidents: INCIDENTS,
    states,
    placeNames: PLACE_NAMES,
    selection,
    onSelect: setSelection,
    layers,
    onLayersChange: patchLayers,
    onOpenLayers: () => openSection('layers'),
    card: selection ? card : null,
    levels,
    nea,
    drift,
    warnings: allWarnings,
    gauges: warningsResult.gauges,
    transport,
    hotspots: WATCH_HOTSPOTS,
    extraLayers: fireLayers,
    fireBadges: FIRE_BADGES,
    onSelectFireBadge: (badge) => selectFire({ kind: 'fire-region', badge }),
    flyRequest,
    focusPoint: firePick ? firePoint(firePick) : null,
    windGrid: wind925,
    airQuality,
    hazeHour,
    ashWind,
    scenarioId,
    scenarioLayers: scenario ? plumeLayers : null,
    scenarioInfo: scenario ? { startMs: scenario.startMs, bounds: scenario.bounds } : null,
    quakes,
    riverFlow: riverFlow?.series ?? NO_RIVER_SERIES,
  };

  const freshness =
    head.freshness === 'UNAVAILABLE' || !head.asOf ? null : { mode: head.freshness, run: runLabel(head.asOf) };
  const subtitle = selectedName ? `Selected: ${selectedName}` : cityName ? `Selected: ${cleanPlace(cityName)}` : undefined;

  return (
    <div className="app" data-drawer={ws ? 'open' : 'closed'} data-card={selection ? 'open' : 'closed'}>
      <main className="map-panel" aria-label="Regional map">
        <div className="map-frame">
          <ErrorBoundary
            resetKey={selectedIncidentId}
            fallback={(message) => (
              <div className="map-fallback" role="alert">
                <p>
                  <strong>The map could not be drawn.</strong> The workspace sections still work: use the taskbar on the left.
                </p>
                <p className="muted small">{message}</p>
              </div>
            )}
          >
            <Suspense
              fallback={
                <div className="map-fallback" role="status">
                  <p>Loading the map…</p>
                </div>
              }
            >
              <MapView {...mapProps} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      <AppHeader
        headline={headline}
        timeLabel={hazeHour.timeISO ? hourLabel(hazeHour.timeISO) : null}
        timeISO={hazeHour.timeISO || null}
        freshness={freshness}
        alerts={alerts}
        onAlerts={() => openSection('warnings')}
        workspaceOpen={ws !== null}
        onWorkspace={() => (ws ? closeWorkspace() : openSection(lastWs.current))}
      >
        <DataCheckNotice issues={FIXTURES.issues} duplicatesIgnored={FIXTURES.duplicatesIgnored} loadError={LOAD_ERROR} />
      </AppHeader>

      <Taskbar active={ws} onOpen={(s) => (ws === s ? closeWorkspace() : openSection(s))} onMap={closeWorkspace} alerts={alerts} />

      <WorkspaceDrawer section={ws} onSelectSection={openSection} onClose={closeWorkspace} subtitle={subtitle}>
        <ErrorBoundary resetKey={`${ws}|${selectedIncidentId}`} fallback={(message) => <PanelError message={message} />}>
          {section}
        </ErrorBoundary>
      </WorkspaceDrawer>

      <RecordInspector
        item={inspected}
        incidentTitle={incident?.title ?? null}
        steps={STEPS}
        members={inspected ? (MEMBERS[inspected.observation.id] ?? []) : []}
        onClose={() => setInspectedId(null)}
      />
      <WarningInspector warning={inspectedWarning} gauge={inspectedGauge} feed={inspectedFeed} onClose={() => setInspectedWarningId(null)} />
    </div>
  );
}

function PanelError({ message }: { message: string }): ReactNode {
  return (
    <p className="empty panel-error" role="alert">
      This part could not be shown ({message}). Try another section or reload the page.
    </p>
  );
}
