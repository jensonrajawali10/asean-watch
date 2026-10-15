// ASEAN Watch app shell (docs/UX_V3.md). Two modes, one map:
//   - Map mode: the full-bleed map, a floating top bar (brand, live headline, alerts pill), six layer chips
//     and one forecast scrubber at the bottom, and one small card for whatever is selected.
//   - Analyst workspace: a drawer opened from the left taskbar, dense on purpose, one section at a time.
// App is the single owner of the selection (one thing on the map), the open workspace section (both in the
// URL hash), the layer toggles, the forecast hour, the seven-day evidence replay, the generated brief and
// the inspected record or warning. Everything else is derived from those, the real-data snapshot loaded
// once below, and the live feeds loaded once after mount.
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
import { loadOfficialWarnings, loadWarningsSnapshot, warningDistanceKm, warningsNear } from './lib/warnings';
import type { OfficialWarningsResult } from './lib/warnings';
import type { HazeTransportView, MapViewProps } from './components/map/MapView';
import { hotspotsUpToDay } from './components/map/mapGeometry';
import type { MapHotspot } from './components/map/mapGeometry';
import { loadWindField, PARTICLE_WIND_LEVEL } from './lib/windField';
import { loadAshWind } from './lib/ashDrift';
import type { AshWindData } from './lib/ashDrift';
import { loadQuakes, loadQuakesSnapshot } from './lib/quakesLive';
import type { QuakesResult } from './lib/quakesLive';
import { loadFloodModel, loadFloodModelSnapshot } from './lib/floodModel';
import type { FloodModelResult } from './lib/floodModel';
import { loadPtwc, loadPtwcSnapshot } from './lib/ptwc';
import type { PtwcResult } from './lib/ptwc';
import type { WindGrid, WindLoadResult } from './lib/windField';
import { loadAirQuality, placePm25At } from './lib/airQuality';
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
import { headlineSentence } from './components/shell/headline';
import { DEFAULT_LAYERS } from './components/map/layerCatalog';
import type { LayerKey, MapLayerState } from './components/map/layerCatalog';
import { officialVolcanoLevel } from './components/map/volcanoLevels';
import type { OfficialVolcanoLevel } from './components/map/volcanoLevels';
import MapCards from './components/map/MapCards';
import VolcanoesSection from './components/analyst/VolcanoesSection';
import WarningsSection from './components/analyst/WarningsSection';
import WaterSection from './components/analyst/WaterSection';
import LayersSection from './components/analyst/LayersSection';
import { FiresInterim, HazeInterim, ReportInterim, SituationInterim, SourcesInterim, fireCounts } from './components/analyst/InterimSections';
import './App.css';
import './components/shell/shell.css';

/** MapLibre + deck.gl are large: the map loads as its own chunk so the shell paints first. */
const MapView = lazy(() => import('./components/map/MapView'));

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
/** Official warnings within this distance of a watch area are listed next to it. */
const NEAR_KM = 150;
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

/** Bundled official-warning snapshot, so the lists render before any network reply (never throws). */
const WARNINGS_SNAPSHOT: OfficialWarningsResult = (() => {
  try {
    return loadWarningsSnapshot();
  } catch (err) {
    console.error('Official warnings snapshot could not be read:', err);
    return { warnings: [], feeds: [], gauges: [] };
  }
})();

/** Hotspots per watch area from the bundled FIRMS snapshot (interim Fires data until the fires module lands). */
const FIRE_COUNTS = (() => {
  try {
    return fireCounts(FIXTURES);
  } catch (err) {
    console.error('Fire counts could not be derived:', err);
    return [];
  }
})();

/** Every snapshot hotspot behind every watch's thermal records over the seven days (the Fires chip's interim layer). */
const ALL_HOTSPOTS: MapHotspot[] = (() => {
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
    const trajectories = computeTrajectories(grid, hazeSourcesFromFixtures(FIXTURES), time, 48, 30);
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
  /** null while the NEA context is loading. */
  const [neaResult, setNeaResult] = useState<NeaLoadResult | null>(null);
  /** The snapshot until the live load settles. */
  const [warningsResult, setWarningsResult] = useState<OfficialWarningsResult>(WARNINGS_SNAPSHOT);
  const [warningsLoading, setWarningsLoading] = useState(true);
  /** Modelled 10 m wind field (Open-Meteo, live or snapshot) for the haze paths; null until loaded. */
  const [windResult, setWindResult] = useState<WindLoadResult | null>(null);
  const transport = useMemo(() => buildTransport(windResult), [windResult]);
  /** Modelled haze inputs (CAMS PM2.5 and 925 hPa wind via Open-Meteo, live or snapshot); null until loaded. */
  const [airQuality, setAirQuality] = useState<AirQualityData | null>(null);
  const [wind925, setWind925] = useState<WindGrid | null>(null);
  /** Modelled pressure-level winds at the volcano summits (live or snapshot); null until loaded. */
  const [ashWind, setAshWind] = useState<AshWindData | null>(null);
  /** Connector layers: bundled snapshot first, replaced by the live load when it settles. */
  const [quakes, setQuakes] = useState<QuakesResult>(() => loadQuakesSnapshot());
  const [riverFlow, setRiverFlow] = useState<FloodModelResult>(() => loadFloodModelSnapshot());
  const [ptwc, setPtwc] = useState<PtwcResult>(() => loadPtwcSnapshot());
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
  const allWarnings = useMemo(() => [...warningsResult.warnings, ...ptwc.warnings], [warningsResult.warnings, ptwc.warnings]);
  const allFeeds = useMemo(
    () => [...warningsResult.feeds, { ...ptwc.status, message: [ptwc.status.message, ptwc.note].filter(Boolean).join(' ') }],
    [warningsResult.feeds, ptwc],
  );
  /** Warnings near the selected area, or every warning when nothing is selected. */
  const nearWarnings = useMemo<OfficialWarning[]>(() => {
    if (!incident) return allWarnings;
    try {
      return warningsNear(allWarnings, incident.lat, incident.lon, NEAR_KM);
    } catch (err) {
      console.error('Official warnings could not be filtered by distance:', err);
      return [];
    }
  }, [allWarnings, incident]);

  /** Warnings with no coordinates at all (e.g. JMA tsunami areas): never "near" anything, so listed apart. */
  const elsewhereWarnings = useMemo<OfficialWarning[]>(() => {
    if (!incident) return [];
    return allWarnings.filter((w) => warningDistanceKm(w, incident.lat, incident.lon) === null);
  }, [allWarnings, incident]);

  const inspectedWarning = useMemo(
    () => (inspectedWarningId ? (allWarnings.find((w) => w.id === inspectedWarningId) ?? null) : null),
    [inspectedWarningId, allWarnings],
  );
  const inspectedGauge = useMemo(
    () => (inspectedWarning ? gaugeForWarning(inspectedWarning, warningsResult.gauges) : null),
    [inspectedWarning, warningsResult.gauges],
  );
  const inspectedFeed = useMemo(() => (inspectedWarning ? feedForWarning(inspectedWarning, allFeeds) : null), [inspectedWarning, allFeeds]);

  /** Official activity level per volcano watch (verbatim, from the official feeds near the summit). */
  const levels = useMemo<Record<string, OfficialVolcanoLevel | null>>(() => {
    const out: Record<string, OfficialVolcanoLevel | null> = {};
    for (const i of INCIDENTS) {
      if (i.hazard !== 'volcano') continue;
      try {
        const v = findVolcano(FIXTURES.volcanoes, i.volcanoId);
        out[i.id] = officialVolcanoLevel(v ? { lat: v.lat, lon: v.lon } : i, allWarnings);
      } catch {
        out[i.id] = null;
      }
    }
    return out;
  }, [allWarnings]);

  const alerts = useMemo(() => alertsPill(allWarnings), [allWarnings]);

  /** The worst modelled city at the scrubber's hour, and the 925 hPa wind there (for the headline). */
  const worst = useMemo(() => {
    if (!airQuality || !hazeHour.timeISO) return null;
    let best: { name: string; pm25: number; lat: number; lon: number } | null = null;
    for (const p of airQuality.places) {
      const v = placePm25At(airQuality, p, hazeHour.timeISO);
      if (Number.isFinite(v) && (!best || v > best.pm25)) best = { name: cleanPlace(p.name), pm25: v, lat: p.lat, lon: p.lon };
    }
    return best;
  }, [airQuality, hazeHour.timeISO]);
  const headline = useMemo(() => {
    const w = worst && wind925 ? sampleWind(wind925, worst.lat, worst.lon, hazeHour.timeISO) : null;
    const speed = w ? Math.hypot(w.u, w.v) : null;
    const toward = w && speed ? ((Math.atan2(w.u, w.v) * 180) / Math.PI + 360) % 360 : null;
    return headlineSentence({
      worst,
      offsetH: hazeHour.steps.offsetsH[hazeHour.index] ?? 0,
      snapshot: airQuality?.dataMode === 'historical',
      windTowardDeg: toward,
      windSpeedMs: speed,
    });
  }, [worst, wind925, hazeHour, airQuality]);

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

  /** "Play ash scenario": the plume follows the one timeline, so the scrubber goes back to now and plays. */
  const playScenario = useCallback(
    (watchId: string) => {
      if (scenarioId === watchId) {
        setScenarioId(null);
        hazeHour.setPlaying(false);
        return;
      }
      setScenarioId(watchId);
      setLayers((prev) => (prev.watch ? prev : { ...prev, watch: true }));
      hazeHour.setPlaying(true, hazeHour.steps.nowIndex);
    },
    [scenarioId, hazeHour],
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
    settle(loadPtwc(), setPtwc, 'PTWC');
    return () => {
      alive = false;
    };
  }, []);

  // Official warnings: loaded once, live first with per-feed snapshot fallback; never throws.
  useEffect(() => {
    let alive = true;
    loadOfficialWarnings()
      .then((result) => {
        if (!alive) return;
        setWarningsResult(result);
        setWarningsLoading(false);
      })
      .catch((err: unknown) => {
        console.error('Official warnings could not be loaded:', err);
        if (alive) setWarningsLoading(false);
      });
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

  const connectors = [
    { label: 'CAMS PM2.5 via Open-Meteo', kind: 'modelled', url: 'https://open-meteo.com/en/docs/air-quality-api', status: { status: airQuality ? (airQuality.dataMode === 'live' ? 'live' : 'snapshot') : 'loading', retrievedAt: airQuality?.retrievedAt ?? null, message: null } },
    { label: `Wind ${wind925?.level ?? '925 hPa'} via Open-Meteo`, kind: 'modelled', url: 'https://open-meteo.com/', status: { status: wind925 ? (wind925.dataMode === 'live' ? 'live' : 'snapshot') : 'loading', retrievedAt: wind925?.retrievedAt ?? null, message: null } },
    { label: 'Ash-drift winds (pressure levels) via Open-Meteo', kind: 'modelled', url: 'https://open-meteo.com/', status: { status: ashWind ? (ashWind.dataMode === 'live' ? 'live' : 'snapshot') : 'loading', retrievedAt: ashWind?.retrievedAt ?? null, message: null } },
    ...quakes.statuses.map((s) => ({ label: s.sourceName, kind: 'measured', status: s })),
    { label: riverFlow.status.sourceName, kind: 'modelled', url: 'https://open-meteo.com/en/docs/flood-api', status: riverFlow.status },
    { label: 'NEA Singapore (wind, PSI)', kind: 'measured', url: 'https://data.gov.sg/', status: { status: nea ? (nea.dataMode === 'live' ? 'live' : 'snapshot') : 'loading', retrievedAt: nea?.retrievedAt ?? null, message: null } },
  ];

  let section: ReactNode = null;
  switch (ws) {
    case 'situation':
      section = (
        <SituationInterim
          headline={headline}
          airQuality={airQuality}
          hazeHour={hazeHour}
          warnings={allWarnings}
          incidents={INCIDENTS}
          placeNames={PLACE_NAMES}
          levels={levels}
          fires={FIRE_COUNTS}
          onInspectWarning={openWarning}
          onOpenVolcano={(id) => {
            selectArea(id);
            openSection('volcanoes');
          }}
        />
      );
      break;
    case 'haze':
      section = (
        <HazeInterim
          airQuality={airQuality}
          hazeHour={hazeHour}
          neaHaze={nea?.haze ?? null}
          transportSummary={transport?.summary ?? null}
          selectedCityId={selectedCityId}
          onSelectCity={(id) => setSelection({ kind: 'city', id })}
        />
      );
      break;
    case 'fires':
      section = <FiresInterim fires={FIRE_COUNTS} snapshotAt={DATA_AS_OF} onFlyTo={(id) => selectArea(id)} />;
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
      section = <ReportInterim brief={briefProps} headline={headline} onOpenVolcanoes={() => openSection('volcanoes')} />;
      break;
    case 'sources':
      section = <SourcesInterim snapshotSources={FIXTURES.snapshot?.sources ?? []} snapshotAt={DATA_AS_OF} feeds={allFeeds} connectors={connectors} />;
      break;
    case 'layers':
      section = <LayersSection layers={layers} onLayersChange={patchLayers} unavailable={layerUnavailable} />;
      break;
    default:
      section = null;
  }

  const card = (
    <MapCards
      selection={selection}
      onClose={() => setSelection(null)}
      onOpenWorkspace={openFromCard}
      airQuality={airQuality}
      hazeHour={hazeHour}
      wind925={wind925}
      neaHaze={nea?.haze ?? null}
      incidents={INCIDENTS}
      volcanoes={FIXTURES.volcanoes}
      placeNames={PLACE_NAMES}
      levels={levels}
      ashWind={ashWind}
      scenarioId={scenarioId}
      onPlayScenario={playScenario}
      fires={FIRE_COUNTS}
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
    hotspots: ALL_HOTSPOTS,
    windGrid: wind925,
    airQuality,
    hazeHour,
    ashWind,
    scenarioId,
    quakes,
    riverFlow: riverFlow.series,
  };

  const freshness = airQuality
    ? { mode: airQuality.dataMode === 'historical' ? ('SNAPSHOT' as const) : ('LIVE' as const), run: runLabel(airQuality.retrievedAt) }
    : null;
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
