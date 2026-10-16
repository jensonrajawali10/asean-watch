// Official warnings section of the analyst workspace (docs/UX_V3.md section 3.5): key figures, then the
// full official-warnings list relayed verbatim with its feed status (OfficialWarningsPanel), and the
// inspector drawer for one message (mounted by App). GDACS items are labelled as aggregator estimates by
// the panel itself. Absence is never an all-clear.
import type { OfficialWarning, WarningFeedStatus } from '../../types';
import type { GaugeReading } from '../../lib/warnings';
import OfficialWarningsPanel from '../OfficialWarnings';
import ErrorBoundary from '../ErrorBoundary';
import { activeOfficial, isUrgentWarning } from '../shell/alerts';
import { useNowMs } from '../../lib/useNowMs';
import { AnalystSection, KeyFigure } from './AnalystSection';
import type { SectionSource } from './AnalystSection';

export interface WarningsSectionProps {
  /** The list to show: near the selected area, or APAC-wide. */
  warnings: OfficialWarning[];
  /** Every warning (for the key figures). */
  allWarnings: OfficialWarning[];
  gauges: GaugeReading[];
  feeds: WarningFeedStatus[];
  nearName: string | null;
  elsewhere: OfficialWarning[];
  onShowAll: () => void;
  loading: boolean;
  selectedWarningId: string | null;
  onInspect: (id: string) => void;
}

function sourcesFromFeeds(feeds: WarningFeedStatus[]): SectionSource[] {
  return feeds.map((f) => ({
    label: f.issuer,
    url: f.issuerUrl,
    retrievedAt: f.retrievedAt,
    mode: f.status === 'live' ? 'LIVE' : f.status === 'unavailable' ? 'UNAVAILABLE' : 'SNAPSHOT',
  }));
}

export default function WarningsSection(p: WarningsSectionProps) {
  const nowMs = useNowMs();
  const active = activeOfficial(p.allWarnings, nowMs);
  const urgent = active.filter((w) => isUrgentWarning(w, nowMs)).length;
  const estimates = p.allWarnings.filter((w) => w.authority === 'aggregator').length;
  const live = p.feeds.filter((f) => f.status === 'live').length;
  const unavailable = p.feeds.filter((f) => f.status === 'unavailable');
  return (
    <AnalystSection
      id="warnings"
      title="Official warnings"
      lede="Every message below is the issuing agency's own text, relayed as issued: level, headline, area, times and instruction. ASEAN Watch never issues a warning of its own, never re-scores a level, and never treats an empty feed as an all-clear."
      sources={sourcesFromFeeds(p.feeds)}
    >
      <div className="an-figures">
        <KeyFigure label="Active official messages" value={String(active.length)} note="not ended by the issuer or past expiry" />
        <KeyFigure label="Tsunami or evacuation-level" value={String(urgent)} note={urgent > 0 ? 'in force now' : 'none in force'} />
        <KeyFigure label="Impact estimates (GDACS)" value={String(estimates)} note="aggregator, not warnings" />
        <KeyFigure
          label="Feeds"
          value={`${live} live`}
          note={unavailable.length > 0 ? `${unavailable.length} unavailable: check ${unavailable.map((f) => f.issuer).join(', ')} directly` : `${p.feeds.length - live} from saved snapshots`}
        />
      </div>
      {unavailable.length > 0 && (
        <p className="an-note an-note--official">
          {unavailable.map((f) => `Official feed unavailable: check ${f.issuer} directly`).join('. ')}.
        </p>
      )}
      <ErrorBoundary resetKey={p.nearName} fallback={(m) => <p className="empty panel-error">This part could not be shown ({m}).</p>}>
        <OfficialWarningsPanel
          warnings={p.warnings}
          gauges={p.gauges}
          feeds={p.feeds}
          nearName={p.nearName}
          elsewhere={p.elsewhere}
          onShowAll={p.onShowAll}
          loading={p.loading}
          selectedWarningId={p.selectedWarningId}
          onInspect={p.onInspect}
        />
      </ErrorBoundary>
    </AnalystSection>
  );
}
