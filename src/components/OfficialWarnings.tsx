// Official warnings: a rail panel and a drawer inspector that RELAY agency warnings verbatim.
// ASEAN Watch never issues a warning of its own. Nothing here says "no warnings", "all clear" or
// "safe", and no level is restyled by severity: the one reserved official colour means "issuer
// statement". Aggregator items (GDACS) are impact estimates and look visibly different.
// Shared classes (.panel, .rail-panel, .panel-head, .drawer*, .fields, .official-*) are styled in
// App.css; everything this file owns is prefixed ow- in OfficialWarnings.css.
import './OfficialWarnings.css';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** APAC-wide lists start with this many items (newest first); "Show all" reveals the rest. */
const LIST_CAP = 20;
import type { OfficialWarning, WarningFeedStatus } from '../types';
import type { GaugeReading } from '../lib/warnings';
import Dialog from './Dialog';
import { EndedChip, ExternalLink, ModeBadge, OfficialLevelChip, OfficialTag } from './Badges';
import { formatCoords, formatUtc, formatValue, safeHttpUrl } from './format';
import { PTWC_ISSUER, PTWC_NATIONAL_AUTHORITIES_NOTE } from '../lib/ptwc';
import { belowTopOfScale, emptyWarningsText, endedLabel, gaugeForWarning, isExpired } from '../lib/warningsView';
import { useNowMs } from '../lib/useNowMs';
import { countsText, groupByHazard, HAZARD_GROUP_NAME, isSoutheastAsia, warningCounts } from './shell/alerts';

// ---------------------------------------------------------------------------
// Shared text helpers

const unavailableSentence = (issuer: string) => `Official feed unavailable: check ${issuer} directly`;

/** "overflowing bank" etc. are the issuer's words; only the join punctuation is ours. */
function gaugeThresholdText(g: GaugeReading): string | null {
  const entries = g.thresholds ? Object.entries(g.thresholds) : [];
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k} ${formatValue(v, g.unit)}`).join(', ');
}

function languageName(code: string): string {
  const tag = code.trim();
  if (!tag) return 'Not stated';
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag);
    return name && name !== tag ? `${name} (${tag})` : tag;
  } catch {
    return tag;
  }
}

function Time({ at }: { at: string }) {
  return <time dateTime={at}>{formatUtc(at)}</time>;
}

function FollowLink({ w }: { w: OfficialWarning }) {
  const estimate = w.authority === 'aggregator';
  return (
    <ExternalLink className={estimate ? 'ow-follow ow-follow--estimate' : 'ow-follow'} href={w.issuerUrl}>
      {estimate ? `Open ${w.issuer}` : `Follow ${w.issuer}`}
    </ExternalLink>
  );
}

// ---------------------------------------------------------------------------
// Panel

export interface OfficialWarningsPanelProps {
  warnings: OfficialWarning[];
  gauges: GaugeReading[];
  feeds: WarningFeedStatus[];
  /** e.g. "Merapi"; null = APAC-wide list. */
  nearName: string | null;
  loading: boolean;
  selectedWarningId: string | null;
  onInspect: (warningId: string) => void;
  /** Warnings with no coordinates (e.g. JMA tsunami areas), listed in a collapsed "Elsewhere in APAC" group. */
  elsewhere?: OfficialWarning[];
  /** Shows the APAC-wide list (clears the watch-area selection); the button appears only with a nearName. */
  onShowAll?: () => void;
}

export default function OfficialWarningsPanel({
  warnings,
  gauges,
  feeds,
  nearName,
  loading,
  selectedWarningId,
  onInspect,
  elsewhere = [],
  onShowAll,
}: OfficialWarningsPanelProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const nowMs = useNowMs();
  const n = warnings.length;
  // Long APAC-wide lists start capped (readable, and not hundreds of tab stops); "Show all" expands them.
  const [showAll, setShowAll] = useState(false);
  const capped = !showAll && n > LIST_CAP;
  // Grouped by hazard (tsunami, volcanoes, earthquakes, floods...), newest first within a group, so a reader
  // sees what kind of message each is before reading it; the cap applies to the grouped order.
  // Southeast Asia first (the site's region), then the wider Asia-Pacific (JMA, GeoNet, NWS, PTWC, GDACS
  // elsewhere); each grouped by hazard with active alerts first.
  const isActive = (w: OfficialWarning) => w.authority === 'official' && !isExpired(w, nowMs);
  const regions = [
    { key: 'sea', name: 'Southeast Asia', groups: groupByHazard(warnings.filter(isSoutheastAsia), isActive) },
    { key: 'apac', name: 'Wider Asia-Pacific (Japan, New Zealand, US Pacific, Pacific-wide)', groups: groupByHazard(warnings.filter((w) => !isSoutheastAsia(w)), isActive) },
  ].filter((r) => r.groups.length > 0);
  const ordered = regions.flatMap((r) => r.groups.flatMap((g) => g.items));
  const shown = capped ? ordered.slice(0, LIST_CAP) : ordered;
  const shownIds = new Set(shown.map((w) => w.id));
  const regionsShown = regions
    .map((r) => ({
      key: r.key,
      name: r.name,
      groups: r.groups
        .map((g) => ({ hazard: g.hazard, total: g.items.length, active: g.active, items: g.items.filter((w) => shownIds.has(w.id)) }))
        .filter((g) => g.items.length > 0),
    }))
    .filter((r) => r.groups.length > 0);

  // Keep the selected item in view when selection comes from elsewhere (map marker, detail link).
  useEffect(() => {
    if (!selectedWarningId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedWarningId]);

  return (
    <section className="panel rail-panel ow-panel" aria-labelledby="official-heading">
      <div className="panel-head">
        <h2 id="official-heading">
          Official warnings{' '}
          <span className="panel-meta">
            {nearName ? `near ${nearName}` : 'across APAC'} · {countsText(warningCounts(warnings, nowMs))}
          </span>
        </h2>
        {nearName && onShowAll && (
          <button type="button" className="link-button head-action" onClick={onShowAll}>
            All APAC
          </button>
        )}
      </div>

      <p className="ow-relayed">Southeast Asia first, then the wider Asia-Pacific.</p>
      <div className="ow-scroll">
        {n === 0 ? (
          <p className="ow-empty">{emptyWarningsText({ loading, nearName })}</p>
        ) : (
          <ul className="ow-list" ref={listRef}>
            {regionsShown.map((r) => (
              <Fragment key={r.key}>
                <li className="ow-region" aria-hidden="true">
                  {r.name}
                </li>
                {r.groups.map((g) => (
                  <Fragment key={`${r.key}-${g.hazard}`}>
                    <li className="ow-group" aria-hidden="true">
                      {HAZARD_GROUP_NAME[g.hazard]} <span className="panel-meta">({g.active} active, {g.total} in all)</span>
                    </li>
                    {g.items.map((w) => (
                      <WarningItem
                        key={w.id}
                        w={w}
                        gauge={gaugeForWarning(w, gauges)}
                        selected={w.id === selectedWarningId}
                        onInspect={onInspect}
                        nowMs={nowMs}
                      />
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </ul>
        )}
        {capped && (
          <p className="ow-more">
            <button type="button" className="link-button" onClick={() => setShowAll(true)}>
              Show all {n} warnings
            </button>
            <span className="muted"> · newest {LIST_CAP} shown</span>
          </p>
        )}

        {elsewhere.length > 0 && (
          <details className="ow-elsewhere">
            <summary>
              Elsewhere in APAC{' '}
              <span className="panel-meta">({elsewhere.length}: no coordinates published, or tsunami messages in force for other coasts)</span>
            </summary>
            <ul className="ow-list ow-list--inner">
              {elsewhere.map((w) => (
                <WarningItem
                  key={w.id}
                  w={w}
                  gauge={gaugeForWarning(w, gauges)}
                  selected={w.id === selectedWarningId}
                  onInspect={onInspect}
                  nowMs={nowMs}
                />
              ))}
            </ul>
          </details>
        )}
      </div>

      <FeedFooter feeds={feeds} />
    </section>
  );
}

function WarningItem({
  w,
  gauge,
  selected,
  onInspect,
  nowMs,
}: {
  w: OfficialWarning;
  gauge: GaugeReading | null;
  selected: boolean;
  onInspect: (warningId: string) => void;
  /** Clock for the expiry check (isExpired). */
  nowMs: number;
}) {
  const lang = w.language || undefined;
  const expired = isExpired(w, nowMs);
  // An official level below the top of its issuer's scale (e.g. DSDA Siaga 3 = 2nd lowest of 4) gets the
  // official rail on a plain surface, not the emergency fill; its words stay verbatim (officialScale).
  const scaled = !expired && w.authority === 'official' && belowTopOfScale(w);
  const variant = expired ? 'ow-item--ended' : w.authority === 'aggregator' ? 'ow-item--estimate' : scaled ? 'ow-item--info' : 'ow-item--official';
  const headline = w.headline.trim();
  const area = w.areaDescription.trim();
  const instruction = w.instruction?.trim() ?? '';
  const thresholds = gauge ? gaugeThresholdText(gauge) : null;

  return (
    <li
      className={`ow-item ${variant}${selected ? ' ow-item--selected' : ''}`}
      aria-current={selected ? 'true' : undefined}
      data-warning-id={w.id}
    >
      <div className="ow-eyebrow">
        <OfficialTag issuer={w.issuer} authority={w.authority} />
        <ModeBadge mode={w.dataMode} time={w.retrievedAt} title="Data mode and retrieval time" />
      </div>

      <div className="ow-level">
        <OfficialLevelChip level={w.level} gloss={w.levelGloss} ended={expired} authority={w.authority} lower={scaled} />
        <EndedChip warning={w} nowMs={nowMs} />
      </div>

      <p className="ow-headline" lang={lang} title={headline}>
        {headline}
      </p>
      {w.issuer === PTWC_ISSUER && <p className="ow-meta">{PTWC_NATIONAL_AUTHORITIES_NOTE}</p>}

      <p className="ow-meta">
        {w.issuedAt ? (
          <>
            Issued <Time at={w.issuedAt} />
          </>
        ) : (
          <>
            No issue time published · retrieved <Time at={w.retrievedAt} />
          </>
        )}
        {!expired &&
          (w.expiresAt ? (
            <>
              {' · '}Expires <Time at={w.expiresAt} />
            </>
          ) : (
            <>{' · '}No expiry given</>
          ))}
      </p>

      {area && (
        <p className="ow-area" lang={lang}>
          {area}
        </p>
      )}

      {gauge && (
        <p className="ow-gauge">
          <span lang={lang}>{gauge.name}</span>
          {' · '}water level <span className="mono">{formatValue(gauge.value, gauge.unit)}</span> ({gauge.datum})
          {gauge.situation && (
            <>
              {' · '}
              <span lang={lang}>{gauge.situation}</span>
            </>
          )}
          {thresholds && (
            <>
              {' · '}thresholds: <span className="mono">{thresholds}</span>
            </>
          )}
        </p>
      )}

      {instruction && (
        <details className="ow-instruction">
          <summary>Instruction from {w.issuer}</summary>
          <p lang={lang}>{instruction}</p>
        </details>
      )}

      <div className="ow-actions">
        <button type="button" className="link-button" onClick={() => onInspect(w.id)}>
          Details
          <span className="visually-hidden">
            : {w.issuer} {w.level}
          </span>
        </button>
        <FollowLink w={w} />
      </div>
    </li>
  );
}

function FeedFooter({ feeds }: { feeds: WarningFeedStatus[] }) {
  const count = (s: WarningFeedStatus['status']) => feeds.filter((f) => f.status === s).length;
  const live = count('live');
  const cached = count('cached');
  const snapshot = count('snapshot');
  const unavailable = feeds.filter((f) => f.status === 'unavailable');

  const parts: string[] = [];
  if (live > 0) parts.push(`${live} live`);
  if (cached > 0) parts.push(`${cached} cached`);
  if (snapshot > 0) parts.push(`${snapshot} snapshot`);
  if (unavailable.length > 0) parts.push(`${unavailable.length} unavailable: ${unavailable.map((f) => f.issuer).join(', ')}`);
  const summary = feeds.length === 0 ? 'Feeds: status not retrieved yet' : `Feeds: ${parts.join(' · ')}`;

  return (
    <details className="ow-feeds">
      <summary>{summary}</summary>
      <ul className="ow-feeds-list">
        {feeds.map((f) => (
          <FeedRow key={f.feedId} feed={f} />
        ))}
      </ul>
      <p className="ow-attribution">
        Sources: BMKG, JMA, GeoNet (CC BY), NWS, GDACS, ThaiWater/HII, DSDA Jakarta, PUB via data.gov.sg, MAGMA Indonesia
      </p>
    </details>
  );
}

function FeedRow({ feed: f }: { feed: WarningFeedStatus }) {
  const sentence = unavailableSentence(f.issuer);
  const message = f.message?.trim() ?? '';
  const showMessage = message !== '' && message !== sentence;
  return (
    <li className={`ow-feed ow-feed--${f.status}`}>
      <span className="ow-feed-issuer">
        <ExternalLink href={f.issuerUrl}>{f.issuer}</ExternalLink>
      </span>
      {' · '}
      {f.status === 'unavailable' ? (
        <span className="ow-feed-status">{sentence}</span>
      ) : f.status === 'snapshot' ? (
        <span className="ow-feed-status">
          saved snapshot{f.retrievedAt ? <> <Time at={f.retrievedAt} /></> : null}
        </span>
      ) : (
        <span className="ow-feed-status">
          {f.status}
          {f.retrievedAt ? (
            <>
              {' · '}retrieved <Time at={f.retrievedAt} />
            </>
          ) : null}
        </span>
      )}
      {showMessage && <span className="ow-feed-message">{message}</span>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Inspector drawer (same skeleton and classes as RecordInspector)

export interface WarningInspectorProps {
  warning: OfficialWarning | null;
  gauge: GaugeReading | null;
  feed: WarningFeedStatus | null;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function WarningInspector({ warning: w, gauge, feed, onClose }: WarningInspectorProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const nowMs = useNowMs();
  const lang = w?.language || undefined;
  const ended = w ? endedLabel(w, nowMs) : null;
  const thresholds = gauge ? gaugeThresholdText(gauge) : null;

  return (
    <Dialog open={w !== null} onClose={onClose} labelledBy="warning-title" className="drawer" initialFocus={closeRef}>
      {w && (
        <div className="drawer-inner ow-drawer">
          <header className="drawer-head">
            <div className="drawer-head-text">
              <p className="eyebrow">
                <OfficialTag issuer={w.issuer} authority={w.authority} /> ·{' '}
                <ModeBadge mode={w.dataMode} time={w.retrievedAt} title="Data mode and retrieval time" />
              </p>
              <h2 id="warning-title" className="ow-verbatim" lang={lang}>
                {w.headline.trim()}
              </h2>
            </div>
            <button ref={closeRef} type="button" className="btn" onClick={(e) => e.currentTarget.closest('dialog')?.close()}>
              Close<span className="visually-hidden"> warning details</span>
            </button>
          </header>

          <div className="drawer-body">
            <dl className="fields">
              <Field label="Issuer">
                <span className="ow-issuer-row">
                  <span>{w.issuer}</span>
                  <FollowLink w={w} />
                </span>
              </Field>

              <Field label="Level">
                <span className="ow-level">
                  <OfficialLevelChip level={w.level} gloss={w.levelGloss} ended={ended !== null} authority={w.authority} />
                  <EndedChip warning={w} nowMs={nowMs} />
                </span>
              </Field>

              <Field label="Product">
                <span className="ow-verbatim" lang={lang}>
                  {w.product.trim() || 'Not stated'}
                </span>
              </Field>

              <Field label="Headline">
                <span className="ow-verbatim ow-prewrap" lang={lang}>
                  {w.headline.trim()}
                </span>
              </Field>

              {w.issuer === PTWC_ISSUER && (
                <Field label="Audience">
                  <span>{PTWC_NATIONAL_AUTHORITIES_NOTE}</span>
                </Field>
              )}

              <Field label="Area">
                {w.areaDescription.trim() ? (
                  <span className="ow-verbatim ow-prewrap" lang={lang}>
                    {w.areaDescription.trim()}
                  </span>
                ) : (
                  'No area description published by the issuer'
                )}
              </Field>

              {w.areas.length > 0 && (
                <Field label="Areas">
                  <ul className="ow-areas">
                    {w.areas.map((a, i) => (
                      <li key={`${a.name}-${i}`}>
                        <span className="ow-verbatim" lang={lang}>
                          {a.name}
                        </span>
                        {' · '}
                        <span className="ow-verbatim" lang={lang}>
                          {a.level?.trim() || 'Level not stated'}
                        </span>
                        {' · '}
                        <span className="ow-coords">{formatCoords(a.lat, a.lon)}</span>
                      </li>
                    ))}
                  </ul>
                </Field>
              )}

              <Field label="Issued">
                {w.issuedAt ? (
                  <Time at={w.issuedAt} />
                ) : (
                  <>
                    No issue time published · retrieved <Time at={w.retrievedAt} />
                  </>
                )}
              </Field>

              {ended?.text === 'EXPIRED' ? (
                <Field label="Expired">
                  <Time at={ended.at} />
                </Field>
              ) : ended ? (
                <Field label="Ended">Ended by the issuer; no time given</Field>
              ) : (
                <Field label="Expires">{w.expiresAt ? <Time at={w.expiresAt} /> : 'No expiry given'}</Field>
              )}

              <Field label="Instruction">
                {w.instruction?.trim() ? (
                  <span className="ow-verbatim ow-prewrap" lang={lang}>
                    {w.instruction.trim()}
                  </span>
                ) : (
                  'No instruction published by the issuer'
                )}
              </Field>

              <Field label="Language">{languageName(w.language)}</Field>

              {gauge && (
                <Field label="Gauge">
                  <span className="ow-verbatim" lang={lang}>
                    {gauge.name}
                  </span>
                  <br />
                  Water level <span className="mono">{formatValue(gauge.value, gauge.unit)}</span> ({gauge.datum})
                  {gauge.situation && (
                    <>
                      {' · '}
                      <span className="ow-verbatim" lang={lang}>
                        {gauge.situation}
                      </span>
                    </>
                  )}
                  {thresholds && (
                    <>
                      <br />
                      Thresholds: <span className="mono">{thresholds}</span>
                    </>
                  )}
                  <br />
                  Observed <Time at={gauge.observedAt} /> · <ModeBadge mode={gauge.dataMode} />
                </Field>
              )}

              <Field label="Source">
                {safeHttpUrl(w.sourceUrl) ? (
                  <ExternalLink href={w.sourceUrl} className="url ow-url">
                    {w.sourceUrl}
                  </ExternalLink>
                ) : (
                  <code className="ow-url">{w.sourceUrl || 'Not recorded'}</code>
                )}
              </Field>

              <Field label="Retrieved">
                <Time at={w.retrievedAt} />
              </Field>

              <Field label="Feed status">
                {feed ? (
                  feed.status === 'unavailable' ? (
                    <>
                      {unavailableSentence(feed.issuer)}
                      {feed.message?.trim() && feed.message.trim() !== unavailableSentence(feed.issuer) && (
                        <span className="ow-feed-message">{feed.message.trim()}</span>
                      )}
                    </>
                  ) : (
                    <>
                      {feed.status === 'snapshot' ? 'saved snapshot' : feed.status}
                      {feed.retrievedAt ? (
                        <>
                          {' · '}
                          <Time at={feed.retrievedAt} />
                        </>
                      ) : null}
                      {feed.message?.trim() && <span className="ow-feed-message">{feed.message.trim()}</span>}
                    </>
                  )
                ) : (
                  'Not reported'
                )}
              </Field>
            </dl>

            <details className="disclosure">
              <summary>Raw record</summary>
              <div className="disclosure-body">
                <pre className="raw-json">{JSON.stringify(w, null, 2)}</pre>
              </div>
            </details>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * The LIVE / HISTORICAL key in one line, pinned in the drawer header above the Warnings list so it never
 * scrolls away from the cards it explains. WarningsHowTo below gives the full wording.
 */
export function WarningsModeNote() {
  return (
    <>
      <span className="badge badge-mode badge-mode--live">LIVE</span> fetched from the agency this visit ·{' '}
      <span className="badge badge-mode badge-mode--historical">HISTORICAL</span> a saved copy, its time shown · levels as issued
    </>
  );
}

/**
 * How to read the official-warnings list, at the top of the Warnings section: whose words are whose, and
 * what LIVE and HISTORICAL mean. Plain words only; it changes nothing in the agency text, levels or labels.
 */
export function WarningsHowTo() {
  return (
    <ul className="ow-howto" aria-label="How to read this list">
      <li>
        <span className="ow-howto__card" aria-hidden="true" />
        <span>
          <strong>Each card</strong> is one agency message in the agency's own words, as issued.
        </span>
      </li>
      <li>
        <span className="official-chip official-chip--lower ow-howto__chip" aria-hidden="true">
          Level
        </span>
        <span>
          <strong>The agency's level</strong>, as issued. The grey words after it are our fixed, plain gloss of that agency's scale (for example
          "Level 2 of 4").
        </span>
      </li>
      <li>
        <span className="ow-howto__modes" aria-hidden="true">
          <span className="badge badge-mode badge-mode--live">LIVE</span>
          <span className="badge badge-mode badge-mode--historical">HISTORICAL</span>
        </span>
        <span>
          <strong>LIVE</strong>: fetched from the agency during this visit. <strong>HISTORICAL SNAPSHOT</strong>: a saved copy with the time it was
          saved, shown when the agency has no open live feed or did not answer. Check the agency for the current state.
        </span>
      </li>
    </ul>
  );
}
