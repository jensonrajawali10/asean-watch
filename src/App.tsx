// ASEAN Watch app shell. App is the single owner of the selected incident, the replay index and the
// generated brief; everything else is derived from them and the fixtures loaded once below.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DriftAssessment, Incident, ReplayStep, ReviewResult, ReviewState } from './types';
import { findVolcano, loadFixtures, replayStepsFor } from './lib/fixtures';
import type { Fixtures } from './lib/fixtures';
import { deriveReview, visibleObservations } from './lib/reviewRules';
import { buildBriefing, briefingFilename, downloadText } from './lib/briefing';
import type { BriefingInput } from './lib/briefing';
import { assessDrift, loadNeaContext } from './lib/nea';
import type { NeaLoadResult } from './lib/nea';
import RegionMap from './components/RegionMap';
import type { RegionMapProps } from './components/RegionMap';
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
import ErrorBoundary from './components/ErrorBoundary';
import { isNearSingapore } from './components/format';
import './App.css';

// ---------------------------------------------------------------------------
// Fixtures: loaded and validated once per page load.

const EMPTY_FIXTURES: Fixtures = {
  volcanoes: [],
  incidents: [],
  scenario: { incidentId: '', replaySteps: [] },
  observations: [],
  issues: [],
  duplicatesIgnored: 0,
};

function load(): { fixtures: Fixtures; error: string | null } {
  try {
    return { fixtures: loadFixtures(), error: null };
  } catch (err) {
    return { fixtures: EMPTY_FIXTURES, error: err instanceof Error ? err.message : String(err) };
  }
}

const { fixtures: FIXTURES, error: LOAD_ERROR } = load();
const INCIDENTS: Incident[] = Array.isArray(FIXTURES.incidents) ? FIXTURES.incidents : [];
const SCENARIO_ID = FIXTURES.scenario?.incidentId ?? '';
const SCENARIO_STEPS: ReplayStep[] = SCENARIO_ID ? replayStepsFor(FIXTURES, SCENARIO_ID) : [];
const SCENARIO_INCIDENT: Incident | null =
  SCENARIO_STEPS.length > 0 ? (INCIDENTS.find((i) => i.id === SCENARIO_ID) ?? null) : null;
const FIRST_STEP = SCENARIO_STEPS[0]?.index ?? 0;
/** Static incidents show every record, whatever the scenario replay index is. */
const ALL_STEPS = Number.MAX_SAFE_INTEGER;
const PLAY_INTERVAL_MS = 1500;

/** Short place names for map labels, e.g. the volcano name. */
const PLACE_NAMES: Record<string, string> = Object.fromEntries(
  INCIDENTS.flatMap((i) => {
    const volcano = findVolcano(FIXTURES.volcanoes, i.volcanoId);
    return volcano ? [[i.id, volcano.name]] : [];
  }),
);

function reviewFor(incident: Incident, replayIndex: number): ReviewResult | null {
  try {
    const index = incident.id === SCENARIO_INCIDENT?.id ? replayIndex : ALL_STEPS;
    return deriveReview(visibleObservations(FIXTURES.observations, incident.id, index), incident.scenarioWindow);
  } catch (err) {
    console.error(`Review could not be derived for ${incident.id}:`, err);
    return null;
  }
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

const SHORTCUT_EXCLUDED =
  'input, textarea, select, pre, [contenteditable]:not([contenteditable="false"]), dialog, .region-map, ' +
  '[role="slider"], [role="listbox"], [role="menu"], [role="grid"], [role="tablist"]';

/** Shortcuts (→ next step, R reset) never fire under a dialog, while typing, in a scrollable region, or with a modifier. */
function shortcutBlocked(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat || e.isComposing) return true;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
  if (document.querySelector('dialog[open]')) return true;
  const target = e.target instanceof Element ? e.target : null;
  if (!target || target === document.body || target === document.documentElement) return false;
  if (target.closest(SHORTCUT_EXCLUDED)) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    const scrollsY = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const scrollsX = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    if (scrollsY || scrollsX) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

export default function App() {
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(readHashIncident);
  const [replayIndex, setReplayIndex] = useState<number>(FIRST_STEP);
  const [brief, setBrief] = useState<GeneratedBrief | null>(null);
  const [playing, setPlaying] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  /** null while the NEA context is loading. */
  const [neaResult, setNeaResult] = useState<NeaLoadResult | null>(null);
  const briefSeq = useRef(0);

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
  const review = incident ? (reviews[incident.id] ?? null) : null;
  const volcano = useMemo(() => (incident ? findVolcano(FIXTURES.volcanoes, incident.volcanoId) : null), [incident]);
  const isScenario = incident !== null && incident.id === SCENARIO_INCIDENT?.id;

  const stepPos = SCENARIO_STEPS.findIndex((s) => s.index === replayIndex);
  const currentStep = stepPos >= 0 ? SCENARIO_STEPS[stepPos] : null;
  const briefStep = isScenario ? currentStep : null;

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

  // --- Actions -------------------------------------------------------------

  const selectIncident = useCallback(
    (id: string | null) => {
      if (id === selectedIncidentId) return;
      setSelectedIncidentId(id);
      setBrief(null);
      setPlaying(false);
      setInspectedId(null);
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
    const next = SCENARIO_STEPS[stepPos + 1];
    if (next) goToStep(next.index);
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    const next = SCENARIO_STEPS[stepPos + 1];
    if (!next) return;
    goToStep(next.index); // advance at once, then every PLAY_INTERVAL_MS
    setPlaying(stepPos + 2 < SCENARIO_STEPS.length);
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

  const generateBrief = () => {
    if (!incident || !review) return;
    setPlaying(false);
    briefSeq.current += 1;
    // A variable, not an inline literal, so the optional NEA fields compile before and after
    // BriefingInput gains them.
    const input: BriefingInput & { nea: typeof nea; drift: DriftAssessment | null } = {
      incident,
      volcano,
      step: briefStep,
      review,
      issues: FIXTURES.issues,
      nea,
      drift,
    };
    let text: string;
    try {
      text = buildBriefing(input);
    } catch (err) {
      text = `ASEAN WATCH - INCIDENT BRIEF\n\nThe brief could not be generated: ${err instanceof Error ? err.message : String(err)}\n`;
    }
    setBrief({ text, seq: briefSeq.current });
  };

  const downloadBrief = () => {
    if (!brief || !incident) return;
    downloadText(brief.text, briefingFilename(incident, briefStep));
  };

  // --- Effects -------------------------------------------------------------

  // Play: advance one step every PLAY_INTERVAL_MS and stop at the last step.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      const pos = SCENARIO_STEPS.findIndex((s) => s.index === replayIndex);
      const next = SCENARIO_STEPS[pos + 1];
      if (!next) {
        setPlaying(false);
        return;
      }
      setReplayIndex(next.index);
      setBrief(null);
      if (pos + 2 >= SCENARIO_STEPS.length) setPlaying(false);
    }, PLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, replayIndex]);

  // Hash changes (typed or pasted links) select the same way the map and queue do.
  useEffect(() => {
    const onHashChange = () => {
      setSelectedIncidentId(readHashIncident());
      setBrief(null);
      setPlaying(false);
      setInspectedId(null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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

  // Keyboard shortcuts for the scenario: → next step, R reset (see shortcutBlocked for the guards).
  useEffect(() => {
    if (!isScenario) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (shortcutBlocked(e)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextStep();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // The state badge and the newest records sit at the top of the right column: show them after a change.
  const rightScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rightScrollRef.current?.scrollTo({ top: 0 });
  }, [replayIndex, selectedIncidentId]);

  // --- Render --------------------------------------------------------------

  const scenarioName = SCENARIO_INCIDENT ? (PLACE_NAMES[SCENARIO_INCIDENT.id] ?? SCENARIO_INCIDENT.title) : null;
  const disabledNote = !scenarioName
    ? 'No replay scenario is configured.'
    : isScenario
      ? null
      : incident
        ? `Replay applies to ${scenarioName}.`
        : `Select ${scenarioName} to replay.`;

  const contextLabel =
    isScenario && currentStep
      ? `${currentStep.label}, step ${stepPos + 1} of ${SCENARIO_STEPS.length}`
      : incident
        ? 'static example'
        : null;

  const neaLoading = neaResult === null && incident !== null && isNearSingapore(incident.lat, incident.lon);

  // Spread so the optional nea/drift props compile before and after RegionMap declares them.
  const mapProps: RegionMapProps & { nea: typeof nea; drift: DriftAssessment | null } = {
    incidents: INCIDENTS,
    selectedId: incident?.id ?? null,
    states,
    onSelect: selectIncident,
    placeNames: PLACE_NAMES,
    nea,
    drift,
  };

  return (
    <div className="app">
      <div className="topbar">
        <AppHeader />
        <ReplayBar
          steps={SCENARIO_STEPS}
          replayIndex={replayIndex}
          enabled={isScenario}
          playing={playing}
          disabledNote={disabledNote}
          onNext={nextStep}
          onTogglePlay={togglePlay}
          onReset={reset}
        />
      </div>

      <main className="workspace">
        <div className="col-left">
          <section className="map-panel" aria-label="Regional map">
            <div className="map-frame">
              <ErrorBoundary
                resetKey={selectedIncidentId}
                fallback={(message) => (
                  <div className="map-fallback" role="alert">
                    <p>
                      <strong>The map could not be drawn.</strong> Use the incident queue instead.
                    </p>
                    <p className="muted small">{message}</p>
                  </div>
                )}
              >
                <RegionMap {...mapProps} />
              </ErrorBoundary>
            </div>
          </section>
          <IncidentQueue
            incidents={INCIDENTS}
            reviews={reviews}
            selectedId={incident?.id ?? null}
            scenarioIncidentId={SCENARIO_INCIDENT?.id ?? null}
            onSelect={selectIncident}
          />
          <DataCheckNotice issues={FIXTURES.issues} duplicatesIgnored={FIXTURES.duplicatesIgnored} loadError={LOAD_ERROR} />
        </div>

        <div className="col-right">
          <div className="right-scroll" ref={rightScrollRef}>
            <ErrorBoundary
              resetKey={`${selectedIncidentId}|${replayIndex}`}
              fallback={(message) => <PanelError message={message} />}
            >
              <IncidentDetail
                incident={incident}
                missingId={missingId}
                review={review}
                volcano={volcano}
                isScenario={isScenario}
                scenarioIncident={SCENARIO_INCIDENT}
                onSelect={selectIncident}
                onClearSelection={() => selectIncident(null)}
                onInspect={openInspector}
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
                isScenario={isScenario}
                replayIndex={replayIndex}
                onInspect={openInspector}
              />
              <IncidentExtras incident={incident} review={review} />
            </ErrorBoundary>
          </div>
          <BriefPanel
            incident={incident}
            contextLabel={contextLabel}
            brief={brief}
            filename={incident ? briefingFilename(incident, briefStep) : null}
            onGenerate={generateBrief}
            onDownload={downloadBrief}
          />
        </div>
      </main>

      <RecordInspector
        item={inspected}
        incidentTitle={incident?.title ?? null}
        steps={SCENARIO_STEPS}
        onClose={() => setInspectedId(null)}
      />
    </div>
  );
}

function PanelError({ message }: { message: string }): ReactNode {
  return (
    <p className="empty panel-error" role="alert">
      This part could not be shown ({message}). Try another incident or Reset.
    </p>
  );
}
