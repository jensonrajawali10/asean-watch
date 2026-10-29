// Official warnings section of the analyst workspace (docs/UX_V3.md section 3.5): key figures, then the
// full official-warnings list relayed verbatim with its feed status (OfficialWarningsPanel), and the
// inspector drawer for one message (mounted by App). GDACS items are labelled as aggregator estimates by
// the panel itself. Absence is never an all-clear.
import type { OfficialWarning, WarningFeedStatus } from '../../types';
import type { GaugeReading } from '../../lib/warnings';
import OfficialWarningsPanel, { WarningsHowTo } from '../OfficialWarnings';
import ErrorBoundary from '../ErrorBoundary';
import { activeOfficial, isUrgentWarning } from '../shell/alerts';
import { useNowMs } from '../../lib/useNowMs';
import { formatUtc } from '../format';
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
  /** True while the feeds are being asked again (useOfficialWarnings); a feed is not called quiet meanwhile. */
  checking?: boolean;
  selectedWarningId: string | null;
  onInspect: (id: string) => void;
}

/** What each feed carries, so two feeds from one agency (BMKG, JMA) are told apart in the sources list. */
const FEED_WHAT: Readonly<Record<string, string>> = {
  'bmkg-inatews': 'tsunami messages',
  'bmkg-gempa': 'latest earthquake message',
  'jma-tsunami': 'tsunami warnings and forecasts',
  'jma-volcano': 'volcanic warnings',
  'geonet-val': 'volcanic alert levels',
  'nws-tsunami': 'US Pacific alerts',
  gdacs: 'disaster impact estimates',
  'magma-level-list': 'volcano activity levels',
  thaiwater: 'river gauges',
  'dsda-jakarta': 'Jakarta floodgates',
  'pub-flood': 'Singapore flood alerts',
  ptwc: 'Pacific tsunami messages',
};

/** Fetched from the agency during this visit: live now, or the 5-minute session copy of a live fetch. */
const fetchedThisVisit = (f: WarningFeedStatus) => f.status === 'live' || f.status === 'cached';

function sourcesFromFeeds(feeds: WarningFeedStatus[]): SectionSource[] {
  return feeds.map((f) => ({
    label: FEED_WHAT[f.feedId] ? `${f.issuer}: ${FEED_WHAT[f.feedId]}` : f.issuer,
    url: f.issuerUrl,
    retrievedAt: f.retrievedAt,
    mode: fetchedThisVisit(f) ? 'LIVE' : f.status === 'unavailable' ? 'UNAVAILABLE' : 'SNAPSHOT',
  }));
}

/**
 * Why the alerts button is red, above everything else: our rule in plain words, then each message that
 * triggers it (issuer and level verbatim, issue time), each opening its full card. Nothing re-scored.
 */
export function UrgentReason({ warnings, onInspect }: { warnings: readonly OfficialWarning[]; onInspect: (id: string) => void }) {
  if (warnings.length === 0) return null;
  return (
    <div className="an-note an-urgent" role="note">
      <p>
        <strong>Why the alerts button is red:</strong> it turns red for any tsunami message in force that the agency has not labelled as
        information or a forecast, and for any message with an evacuation instruction. Now:
      </p>
      <ul>
        {warnings.map((w) => (
          <li key={w.id}>
            <button type="button" className="an-row-btn" onClick={() => onInspect(w.id)}>
              {w.issuer}: {w.level}
            </button>{' '}
            · {w.issuedAt ? `issued ${formatUtc(w.issuedAt)}` : 'no issue time published'}
          </li>
        ))}
      </ul>
      <p>Follow the issuing agency and your national authorities.</p>
    </div>
  );
}

export default function WarningsSection(p: WarningsSectionProps) {
  const nowMs = useNowMs();
  const active = activeOfficial(p.allWarnings, nowMs);
  const urgentList = active.filter((w) => isUrgentWarning(w, nowMs));
  const urgent = urgentList.length;
  const estimates = p.allWarnings.filter((w) => w.authority === 'aggregator').length;
  const live = p.feeds.filter(fetchedThisVisit).length;
  const unavailable = p.feeds.filter((f) => f.status === 'unavailable');
  return (
    <AnalystSection
      id="warnings"
      title="Official warnings"
      lede="Messages from national agencies, relayed as issued. ASEAN Watch never issues a warning of its own, never re-scores a level, and never treats an empty feed as an all-clear."
      sources={sourcesFromFeeds(p.feeds)}
    >
      <UrgentReason warnings={urgentList} onInspect={p.onInspect} />
      <WarningsHowTo />
      <div className="an-figures">
        <KeyFigure label="Official alerts still active" value={String(active.length)} note="not ended by the agency and not past their expiry time (the number on the alerts button)" />
        <KeyFigure label="Tsunami or evacuation alerts" value={String(urgent)} note={urgent > 0 ? 'active now' : 'none active'} />
        <KeyFigure label="Disaster impact estimates (GDACS)" value={String(estimates)} note="computer estimates from a UN/EU service, not warnings" />
        <KeyFigure
          label="Agency sources checked"
          value={`${live} live`}
          note={unavailable.length > 0 ? `${unavailable.length} unavailable: check ${unavailable.map((f) => f.issuer).join(', ')} directly` : `${p.feeds.length - live} from saved copies (not refreshed just now)`}
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
          checking={p.checking}
          selectedWarningId={p.selectedWarningId}
          onInspect={p.onInspect}
        />
      </ErrorBoundary>
    </AnalystSection>
  );
}
