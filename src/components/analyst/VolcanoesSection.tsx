// Volcanoes section of the analyst workspace (docs/UX_V3.md section 3.4): the watch areas, the seven-day
// evidence replay (queue, replay bar, detail with "Why this state?", evidence timeline), the NEA context
// card, and the brief. Wordy and dense on purpose; the map card stays small. The record inspector dialog
// is mounted by App.
import type { ReactNode } from 'react';
import type { DriftAssessment, Incident, NeaContext, OfficialWarning, ReplayStep, ReviewResult, SourceRef, Volcano } from '../../types';
import IncidentQueue from '../IncidentQueue';
import IncidentDetail, { IncidentExtras } from '../IncidentDetail';
import EvidenceTimeline from '../EvidenceTimeline';
import ReplayBar from '../ReplayBar';
import NeaContextCard from '../NeaContextCard';
import BriefPanel from '../BriefPanel';
import type { GeneratedBrief } from '../BriefPanel';
import ErrorBoundary from '../ErrorBoundary';
import { AnalystSection, AnalystSubhead } from './AnalystSection';
import type { SectionSource } from './AnalystSection';

export interface VolcanoesSectionProps {
  incidents: Incident[];
  reviews: Record<string, ReviewResult>;
  placeNames: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  incident: Incident | null;
  missingId: string | null;
  review: ReviewResult | null;
  volcano: Volcano | null;
  firstIncident: Incident | null;
  firstName: string | null;
  onInspect: (observationId: string) => void;
  nearWarnings: OfficialWarning[];
  onInspectWarning: (id: string) => void;
  references?: SourceRef[];
  watchRules?: string[];
  nea: { loading: boolean; context: NeaContext | null; drift: DriftAssessment | null; fellBack: boolean; error: string | null };
  replay: {
    steps: ReplayStep[];
    index: number;
    enabled: boolean;
    playing: boolean;
    disabledNote: string | null;
    counts: Record<number, number> | null;
    visibleCount: number | null;
    onNext: () => void;
    onTogglePlay: () => void;
    onReset: () => void;
    onJump: (index: number) => void;
  };
  brief: {
    contextLabel: string | null;
    brief: GeneratedBrief | null;
    contextKey: string;
    filename: string | null;
    onGenerate: () => void;
    onDownload: () => void;
  };
  attribution?: ReactNode;
  dataAsOf: string | null;
  /** True when the evidence is a live /api/watch build (src/lib/watchLive.ts), not the bundled snapshot. */
  dataLive?: boolean;
  /** "If it erupted now" for every watched volcano (the eruption module's panel). */
  scenarioPanel?: ReactNode;
}

const SOURCES: SectionSource[] = [
  { label: 'NASA FIRMS VIIRS and MODIS active fire (near real time)', url: 'https://firms.modaps.eosdis.nasa.gov/', mode: 'SNAPSHOT' },
  { label: 'USGS earthquake catalog', url: 'https://earthquake.usgs.gov/', mode: 'SNAPSHOT' },
  { label: 'BMKG earthquakes', url: 'https://www.bmkg.go.id/', mode: 'SNAPSHOT' },
  { label: 'PVMBG MAGMA Indonesia volcano activity levels', url: 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas', mode: 'OFFICIAL' },
  { label: 'NEA Singapore via data.gov.sg (wind and PSI)', url: 'https://data.gov.sg/', mode: 'MEASURED', licence: 'Singapore Open Data Licence' },
];

function PanelError({ message }: { message: string }) {
  return (
    <p className="empty panel-error" role="alert">
      This part could not be shown ({message}). Try another watch area or Reset.
    </p>
  );
}

export default function VolcanoesSection(p: VolcanoesSectionProps) {
  const { incident, review, replay } = p;
  const showNea = incident !== null && (p.nea.loading || p.nea.drift !== null);
  return (
    <AnalystSection
      id="volcanoes"
      title="Volcanoes"
      lede="The five watch areas and what the last seven days of satellite heat and nearby earthquakes say about each. Our workflow states come from stated watch rules and are never official alert levels; the official level is relayed verbatim beside them."
      meta={p.dataAsOf ? `${p.dataLive ? 'live, fetched' : 'snapshot'} ${p.dataAsOf.replace('T', ' ').slice(0, 16)} UTC` : undefined}
      sources={SOURCES}
    >
      <IncidentQueue
        incidents={p.incidents}
        reviews={p.reviews}
        selectedId={p.selectedId}
        scenarioIncidentId={null}
        onSelect={p.onSelect}
        placeNames={p.placeNames}
        onClearSelection={p.onClearSelection}
      />

      <AnalystSubhead>Seven-day replay</AnalystSubhead>
      <ReplayBar
        steps={replay.steps}
        replayIndex={replay.index}
        enabled={replay.enabled}
        playing={replay.playing}
        disabledNote={replay.disabledNote}
        counts={replay.counts}
        visibleCount={replay.visibleCount}
        onNext={replay.onNext}
        onTogglePlay={replay.onTogglePlay}
        onReset={replay.onReset}
        onJump={replay.onJump}
      />

      <ErrorBoundary resetKey={`${p.selectedId}|${replay.index}`} fallback={(m) => <PanelError message={m} />}>
        <IncidentDetail
          incident={incident}
          missingId={p.missingId}
          review={review}
          volcano={p.volcano}
          isScenario={replay.enabled}
          scenarioIncident={p.firstIncident}
          placeName={p.firstName ?? undefined}
          onSelect={p.onSelect}
          onClearSelection={p.onClearSelection}
          onInspect={p.onInspect}
          officialNear={p.nearWarnings}
          onInspectWarning={p.onInspectWarning}
          references={p.references}
          watchRules={p.watchRules}
          context={
            showNea ? (
              <NeaContextCard loading={p.nea.loading} nea={p.nea.context} drift={p.nea.drift} fellBack={p.nea.fellBack} error={p.nea.error} />
            ) : null
          }
        />
      </ErrorBoundary>

      <ErrorBoundary resetKey={`${p.selectedId}|${replay.index}`} fallback={(m) => <PanelError message={m} />}>
        <EvidenceTimeline
          incident={incident}
          missingId={p.missingId}
          review={review}
          isScenario={replay.enabled}
          replayIndex={replay.index}
          onInspect={p.onInspect}
        />
        <IncidentExtras incident={incident} review={review} />
      </ErrorBoundary>

      {incident && (
        <>
          <AnalystSubhead>Brief</AnalystSubhead>
          <BriefPanel
            incident={incident}
            contextLabel={p.brief.contextLabel}
            brief={p.brief.brief}
            contextKey={p.brief.contextKey}
            filename={p.brief.filename}
            onGenerate={p.brief.onGenerate}
            onDownload={p.brief.onDownload}
          />
        </>
      )}

      {p.scenarioPanel && (
        <>
          <AnalystSubhead>If it erupted now (modelled scenario)</AnalystSubhead>
          {p.scenarioPanel}
        </>
      )}

      {p.attribution}
    </AnalystSection>
  );
}
