// ASEAN Watch app shell. App is the single owner of the selected watch area, the replay index, the
// generated brief and the inspected object; everything else is derived from them, the real-data
// snapshot loaded once below, and the two context feeds (NEA Singapore, official warnings) loaded
// once after mount. Every watch area replays over the same seven UTC days of the snapshot.
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
import { loadWindField } from './lib/windField';
import type { WindLoadResult } from './lib/windField';
import { computeTrajectories, hazeSourcesFromFixtures, sampleWind } from './lib/transport';
import AppHeader from './components/AppHeader';
import ReplayBar from './components/ReplayBar';
import IncidentQueue from './components/IncidentQueue';
import IncidentDetail, { IncidentExtras } from './components/IncidentDetail';
import EvidenceTimeline from './components/EvidenceTimeline';
import RecordInspector from './components/RecordInspector';
import BriefPanel from './components/BriefPanel';
import type { GeneratedBrief } from './components/BriefPanel';
import DataCheckNotice from './components/DataCheckNotice';
import NeaContextCard from './components/NeaContextCard';
import OfficialWarningsPanel, { WarningInspector, feedForWarning, gaugeForWarning } from './components/OfficialWarnings';
import ErrorBoundary from './components/ErrorBoundary';
import { isNearSingapore } from './components/format';
import './App.css';

/** MapLibre + deck.gl are large: the map loads as its own chunk so the panels paint first. */
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
const PLAY_INTERVAL_MS = 1500;
/** Official warnings within this distance of a watch area are listed next to it. */
const NEAR_KM = 150;
/** The watch area the overview offers to open first. */
const FIRST_INCIDENT: Incident | null = INCIDENTS[0] ?? null;

const DATA_AS_OF: string | null = FIXTURES.snapshot?.retrievedAt || null;
const ATTRIBUTIONS: string[] = Array.isArray(FIXTURES.snapshot?.attributions) ? FIXTURES.snapshot.attributions : [];
/** False while any loaded record or watch area is still a simulated fixture. */
const ALL_REAL =
  !FIXTURES.observations.some((o) => o.dataMode === 'simulated') && !INCIDENTS.some((i) => i.dataMode === 'simulated');

/**
 * Short place names for the map and the rail. A short watch title ("Anak Krakatau") is used as is;
 * a long one ("Riau peatland hotspots") is left to the map, which derives the place from the title.
 */
const PLACE_NAMES: Record<string, string> = Object.fromEntries(
  INCIDENTS.flatMap((i) => {
    const title = i.title.trim();
    if (title && title.length <= 16) return [[i.id, title]];
    const volcano = findVolcano(FIXTURES.volcanoes, i.volcanoId);
    return volcano?.name?.trim() ? [[i.id, volcano.name.trim()]] : [];
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

/** Bundled official-warning snapshot, so the rail renders before any network reply (never throws). */
const WARNINGS_SNAPSHOT: OfficialWarningsResult = (() => {
  try {
    return loadWarningsSnapshot();
  } catch (err) {
    console.error('Official warnings snapshot could not be read:', err);
    return { warnings: [], feeds: [], gauges: [] };
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

/** Modelled wind arrows and 48 h haze paths for the map; null when the wind field is unavailable. */
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

/** Individual hotspots behind a grouped thermal record, when the snapshot publishes them. */
function membersFor(observationId: string): HotspotMember[] {
  const members = (FIXTURES as Partial<{ members: Record<string, HotspotMember[]> }>).members;
  const list = members?.[observationId];
  return Array.isArray(list) ? list : [];
}

/** Records per replay day for one watch area (for the timeline cells). */
function countsByStep(incidentId: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const o of FIXTURES.observations) {
    if (o.incidentId !== incidentId) continue;
    out[o.replayStep] = (out[o.replayStep] ?? 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Optional URL hash preselection: #incident=<id>

function readHashIncident(): string | null {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return null;
  const id = new URLSearchParams(raw).get('incident');
  return id && id.trim() ? id.trim() : null;
}

function writeHashIncident(id: string | null): void {
  const url = id ? `#incident=${encodeURIComponent(id)}` : `${window.location.pathname}${window.location.search}`;
  try {
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* history can be unavailable in sandboxed previews; selection still works */
  }
}

// ---------------------------------------------------------------------------

export default function App() {
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(readHashIncident);
  const [replayIndex, setReplayIndex] = useState<number>(FIRST_STEP);
  const [brief, setBrief] = useState<GeneratedBrief | null>(null);
  const [playing, setPlaying] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [inspectedWarningId, setInspectedWarningId] = useState<string | null>(null);
  /** null while the NEA context is loading. */
  const [neaResult, setNeaResult] = useState<NeaLoadResult | null>(null);
  /** The snapshot until the live load settles. */
  const [warningsResult, setWarningsResult] = useState<OfficialWarningsResult>(WARNINGS_SNAPSHOT);
  const [warningsLoading, setWarningsLoading] = useState(true);
  /** Modelled wind field (Open-Meteo, live or snapshot); null until loaded. */
  const [windResult, setWindResult] = useState<WindLoadResult | null>(null);
  const transport = useMemo(() => buildTransport(windResult), [windResult]);
  const briefSeq = useRef(0);
  /** Floating panels over the full-screen map: the left list can shrink to a slim tab; the review can collapse. */
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  /** Each side renders one toggle at a time (header button or slim tab); after a toggle, focus follows it. */
  const leftToggleRef = useRef<HTMLButtonElement>(null);
  const rightToggleRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<'left' | 'right' | null>(null);
  /** Narrow layout only: a pick from the list panel scrolls the review (stacked under the list) into view. */
  const pendingReveal = useRef(false);

  // --- Derived state -------------------------------------------------------

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
  /** FIRMS detections behind the selected watch's thermal records, up to the replay day (map dots). */
  const hotspots = useMemo(
    () =>
      hotspotsUpToDay(
        FIXTURES.observations,
        (FIXTURES as Partial<{ members: Record<string, HotspotMember[]> }>).members,
        incident?.id ?? null,
        replayIndex,
      ),
    [incident, replayIndex],
  );
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

  const allWarnings = warningsResult.warnings;
  /** Warnings near the selected area, or every warning (APAC-wide) when nothing is selected. */
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
  const inspectedFeed = useMemo(
    () => (inspectedWarning ? feedForWarning(inspectedWarning, warningsResult.feeds) : null),
    [inspectedWarning, warningsResult.feeds],
  );

  /**
   * The context a brief is built from: the NEA reading (when it applies), the nearby official warnings
   * and every feed's status. A brief generated under a different key is stale (a Riau brief generated
   * before NEA arrived would lack that section); the brief bar then asks for a fresh one.
   */
  const contextKey = useMemo(
    () =>
      [
        drift && nea ? `nea:${nea.dataMode}:${nea.retrievedAt}` : 'nea:none',
        `w:${nearWarnings.map((w) => w.id).join(',')}`,
        `f:${warningsResult.feeds.map((f) => `${f.feedId}=${f.status}`).join(',')}`,
      ].join('|'),
    [drift, nea, nearWarnings, warningsResult.feeds],
  );

  // --- Actions -------------------------------------------------------------

  const selectIncident = useCallback(
    (id: string | null) => {
      if (id === selectedIncidentId) return;
      setSelectedIncidentId(id);
      setBrief(null);
      setPlaying(false);
      setInspectedId(null);
      if (id !== null) setRightCollapsed(false);
      writeHashIncident(id);
    },
    [selectedIncidentId],
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
    const next = STEPS[stepPos + 1];
    if (!next) return;
    goToStep(next.index); // advance at once, then every PLAY_INTERVAL_MS
    setPlaying(stepPos + 2 < STEPS.length);
  };

  const reset = () => {
    setPlaying(false);
    setReplayIndex(FIRST_STEP);
    setBrief(null);
  };

  const openInspector = (id: string) => {
    setPlaying(false);
    setInspectedId(id);
  };

  const openWarning = (id: string) => {
    setPlaying(false);
    setInspectedWarningId(id);
  };

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
      warningFeeds: warningsResult.feeds,
      dataAsOf: DATA_AS_OF,
      stepCount: STEPS.length || undefined,
    };
    let text: string;
    try {
      text = buildBriefing(input);
    } catch (err) {
      text = `ASEAN WATCH - INCIDENT BRIEF\n\nThe brief could not be generated: ${err instanceof Error ? err.message : String(err)}\n`;
    }
    setBrief({ text, seq: briefSeq.current, contextKey });
  };

  const downloadBrief = () => {
    if (!brief || !incident) return;
    downloadText(brief.text, briefingFilename(incident, currentStep));
  };

  // --- Effects -------------------------------------------------------------

  // Play: advance one step every PLAY_INTERVAL_MS and stop at the last step.
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

  // Hash changes (typed or pasted links) select the same way the map and rail do.
  useEffect(() => {
    const onHashChange = () => {
      setSelectedIncidentId(readHashIncident());
      setRightCollapsed(false);
      setBrief(null);
      setPlaying(false);
      setInspectedId(null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Esc with no dialog open clears the selection (back to the APAC-wide view). Dialogs handle their own Esc.
  useEffect(() => {
    if (selectedIncidentId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      // Esc closes the review panel; focus moves to the list panel instead of falling to the page.
      if (document.activeElement?.closest('.float-right')) pendingFocus.current = 'left';
      selectIncident(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIncidentId, selectIncident]);

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

  // Modelled wind field: loaded once after first render; never throws, never blocks the UI.
  useEffect(() => {
    let alive = true;
    loadWindField()
      .then((result) => {
        if (alive) setWindResult(result);
      })
      .catch((err: unknown) => console.error('Wind field could not be loaded:', err));
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

  // The state badge and the newest records sit at the top of the review column: show them after a change.
  const reviewScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    reviewScrollRef.current?.scrollTo({ top: 0 });
  }, [replayIndex, selectedIncidentId]);

  // After a collapse, expand or close, focus the control that replaced the one just used.
  useEffect(() => {
    const side = pendingFocus.current;
    pendingFocus.current = null;
    if (side === 'left') leftToggleRef.current?.focus();
    if (side === 'right') rightToggleRef.current?.focus();
  }, [leftCollapsed, rightCollapsed, selectedIncidentId]);

  useEffect(() => {
    if (!pendingReveal.current) return;
    pendingReveal.current = false;
    if (!window.matchMedia?.('(max-width: 899px)').matches) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // After the map's own selection effects (which can move focus and cancel a smooth scroll).
    const timer = window.setTimeout(() => {
      document.querySelector('.float-right')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [selectedIncidentId]);

  const selectFromList = (id: string) => {
    pendingReveal.current = true;
    selectIncident(id);
  };

  const toggleLeft = () => {
    pendingFocus.current = 'left';
    setLeftCollapsed((c) => !c);
  };
  const toggleRight = () => {
    pendingFocus.current = 'right';
    setRightCollapsed((c) => !c);
  };
  const closeReview = () => {
    pendingFocus.current = 'left';
    selectIncident(null);
  };

  // --- Render --------------------------------------------------------------

  const firstName = FIRST_INCIDENT ? (PLACE_NAMES[FIRST_INCIDENT.id] ?? FIRST_INCIDENT.title) : null;
  const disabledNote =
    STEPS.length === 0
      ? 'No replay days are loaded.'
      : incident
        ? null
        : `Select a watch area to replay the last ${STEPS.length} days.`;

  const contextLabel =
    incident && currentStep ? `${currentStep.label}, step ${stepPos + 1} of ${STEPS.length}` : incident ? 'all records' : null;

  const neaLoading = neaResult === null && incident !== null && isNearSingapore(incident.lat, incident.lon);
  const selectedName = incident ? (PLACE_NAMES[incident.id] ?? incident.title) : null;
  /** The review panel floats in when a watch area is selected (or a #incident link names an unknown one). */
  const showReview = incident !== null || missingId !== null;

  /** Snapshot data acknowledgements: in the review panel, or the list panel while no review is open. */
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

  const mapProps: MapViewProps = {
    onClearSelection: () => selectIncident(null),
    transport,
    hotspots,
    windGrid: windResult?.grid ?? null,
    hazeTimeISO: transport?.time ?? null,
    incidents: INCIDENTS,
    selectedId: incident?.id ?? null,
    states,
    onSelect: selectIncident,
    placeNames: PLACE_NAMES,
    nea,
    drift,
    warnings: allWarnings,
    gauges: warningsResult.gauges,
    selectedWarningId: inspectedWarningId,
    onSelectWarning: openWarning,
  };

  return (
    <div className="app">
      <AppHeader dataAsOf={DATA_AS_OF} allReal={ALL_REAL} />

      <main
        className="workspace"
        data-left={leftCollapsed ? 'collapsed' : 'open'}
        data-right={showReview ? (rightCollapsed ? 'collapsed' : 'open') : 'none'}
      >
        {/* The map is the base layer and fills the workspace; the panels float over it. Map controls can
            read --overlay-left / --overlay-right (set on .map-panel) to stay clear of the open panels. */}
        <section className="map-panel" aria-label="Regional map">
          <div className="map-frame">
            <ErrorBoundary
              resetKey={selectedIncidentId}
              fallback={(message) => (
                <div className="map-fallback" role="alert">
                  <p>
                    <strong>The map could not be drawn.</strong> Use the watch-area list instead.
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
        </section>

        <aside
          className="float-panel float-left"
          data-collapsed={leftCollapsed || undefined}
          aria-label="Watch areas and official warnings"
        >
          {leftCollapsed ? (
            <button
              ref={leftToggleRef}
              type="button"
              className="float-tab"
              aria-expanded="false"
              aria-controls="list-panel-body"
              title="Show watch areas and official warnings"
              onClick={toggleLeft}
            >
              <span className="float-tab-label">Watches · Warnings</span>
            </button>
          ) : (
            <div className="float-head">
              <span className="float-eyebrow" aria-hidden="true">
                Watches · Warnings
              </span>
              <button
                ref={leftToggleRef}
                type="button"
                className="float-btn"
                aria-expanded="true"
                aria-controls="list-panel-body"
                title="Collapse panel"
                onClick={toggleLeft}
              >
                <span aria-hidden="true">‹</span>
                <span className="visually-hidden">Collapse watch areas and official warnings</span>
              </button>
            </div>
          )}
          <div id="list-panel-body" className="float-body rail" hidden={leftCollapsed}>
            <IncidentQueue
              incidents={INCIDENTS}
              reviews={reviews}
              selectedId={incident?.id ?? null}
              scenarioIncidentId={null}
              onSelect={selectFromList}
              placeNames={PLACE_NAMES}
              onClearSelection={() => selectIncident(null)}
            />
            <ErrorBoundary resetKey={selectedIncidentId} fallback={(message) => <PanelError message={message} />}>
              <OfficialWarningsPanel
                warnings={nearWarnings}
                gauges={warningsResult.gauges}
                feeds={warningsResult.feeds}
                nearName={selectedName}
                elsewhere={elsewhereWarnings}
                onShowAll={() => selectIncident(null)}
                loading={warningsLoading}
                selectedWarningId={inspectedWarningId}
                onInspect={openWarning}
              />
            </ErrorBoundary>
            <DataCheckNotice issues={FIXTURES.issues} duplicatesIgnored={FIXTURES.duplicatesIgnored} loadError={LOAD_ERROR} />
            {!showReview && attribution}
          </div>
        </aside>

        {showReview ? (
          <aside
            className="float-panel float-right"
            data-collapsed={rightCollapsed || undefined}
            aria-label={selectedName ? `Review: ${selectedName}` : 'Review'}
          >
            {rightCollapsed ? (
              <button
                ref={rightToggleRef}
                type="button"
                className="float-tab"
                aria-expanded="false"
                aria-controls="review-panel-body"
                title="Show the review"
                onClick={toggleRight}
              >
                <span className="float-tab-label">Review{selectedName ? ` · ${selectedName}` : ''}</span>
              </button>
            ) : (
              <div className="float-head">
                <span className="float-eyebrow" aria-hidden="true">
                  Review{selectedName ? ` · ${selectedName}` : ''}
                </span>
                <button
                  ref={rightToggleRef}
                  type="button"
                  className="float-btn"
                  aria-expanded="true"
                  aria-controls="review-panel-body"
                  title="Collapse panel"
                  onClick={toggleRight}
                >
                  <span aria-hidden="true">›</span>
                  <span className="visually-hidden">Collapse the review</span>
                </button>
                <button type="button" className="float-btn" title="Close (Esc)" onClick={closeReview}>
                  <span aria-hidden="true">×</span>
                  <span className="visually-hidden">Close the review</span>
                </button>
              </div>
            )}
            <div id="review-panel-body" className="float-body col-review" hidden={rightCollapsed}>
              <div className="right-scroll" ref={reviewScrollRef}>
                <ErrorBoundary
                  resetKey={`${selectedIncidentId}|${replayIndex}`}
                  fallback={(message) => <PanelError message={message} />}
                >
                  <IncidentDetail
                    incident={incident}
                    missingId={missingId}
                    review={review}
                    volcano={volcano}
                    isScenario={replayEnabled}
                    scenarioIncident={FIRST_INCIDENT}
                    placeName={firstName ?? undefined}
                    onSelect={selectIncident}
                    onClearSelection={() => selectIncident(null)}
                    onInspect={openInspector}
                    officialNear={nearWarnings}
                    onInspectWarning={openWarning}
                    references={incident ? REFERENCES[incident.id] : undefined}
                    watchRules={incident ? RULES_BY_WATCH[incident.id] : undefined}
                    context={
                      incident && (neaLoading || drift) ? (
                        <NeaContextCard
                          loading={neaLoading}
                          nea={nea}
                          drift={drift}
                          fellBack={neaResult?.fellBack ?? false}
                          error={neaResult?.error ?? null}
                        />
                      ) : null
                    }
                  />
                </ErrorBoundary>
                <ErrorBoundary
                  resetKey={`${selectedIncidentId}|${replayIndex}`}
                  fallback={(message) => <PanelError message={message} />}
                >
                  <EvidenceTimeline
                    incident={incident}
                    missingId={missingId}
                    review={review}
                    isScenario={replayEnabled}
                    replayIndex={replayIndex}
                    onInspect={openInspector}
                  />
                  <IncidentExtras incident={incident} review={review} />
                </ErrorBoundary>
                {attribution}
              </div>
              <BriefPanel
                incident={incident}
                contextLabel={contextLabel}
                brief={brief}
                contextKey={contextKey}
                filename={incident ? briefingFilename(incident, currentStep) : null}
                onGenerate={generateBrief}
                onDownload={downloadBrief}
              />
            </div>
          </aside>
        ) : (
          <div className="float-hint">
            <p>
              Select a watch area on the map or in the list.
              {FIRST_INCIDENT && (
                <>
                  {' '}
                  <button type="button" className="link-button" onClick={() => selectFromList(FIRST_INCIDENT.id)}>
                    Open {firstName ?? FIRST_INCIDENT.title}
                  </button>
                </>
              )}
            </p>
            <p className="float-hint-note">
              Official agency levels are relayed verbatim; our workflow state is not an alert level.
            </p>
          </div>
        )}
      </main>

      <ReplayBar
        steps={STEPS}
        replayIndex={replayIndex}
        enabled={replayEnabled}
        playing={playing}
        disabledNote={disabledNote}
        counts={dayCounts}
        visibleCount={review?.observationCount ?? null}
        onNext={nextStep}
        onTogglePlay={togglePlay}
        onReset={reset}
      />

      <RecordInspector
        item={inspected}
        incidentTitle={incident?.title ?? null}
        steps={STEPS}
        members={inspected ? membersFor(inspected.observation.id) : []}
        onClose={() => setInspectedId(null)}
      />
      <WarningInspector
        warning={inspectedWarning}
        gauge={inspectedGauge}
        feed={inspectedFeed}
        onClose={() => setInspectedWarningId(null)}
      />
    </div>
  );
}

function PanelError({ message }: { message: string }): ReactNode {
  return (
    <p className="empty panel-error" role="alert">
      This part could not be shown ({message}). Try another watch area or Reset.
    </p>
  );
}
