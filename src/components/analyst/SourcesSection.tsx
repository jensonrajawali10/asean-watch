// Workspace section 8, "Sources & methods" (docs/UX_V3.md section 3): every feed the app uses, grouped as
// Official, Measured, Modelled, Imagery and Reference, each with its issuer, licence or attribution, mode
// (live, snapshot, recorded copy, link only...), retrieval time where there is one, what it is used for and
// its limitations. Built by src/lib/sourceCatalogue.ts from the data App has loaded.
import { useMemo } from 'react';
import { utcStamp } from '../../lib/situation';
import type { SituationInput } from '../../lib/situation';
import { buildSourceCatalogue, groupSources } from '../../lib/sourceCatalogue';
import type { SourceEntry } from '../../lib/sourceCatalogue';
import { AnalystSection, AnalystSubhead, KeyFigure } from './AnalystSection';
import { ExtLink } from './reportParts';
import './workspaceSections.css';

export interface SourcesSectionProps {
  /** Everything App already holds (see SituationInput); statuses and times come from it. */
  input: SituationInput;
  /** A catalogue already built from the same input (optional). */
  catalogue?: readonly SourceEntry[] | null;
}

const MODES: ReadonlyArray<[string, string]> = [
  ['LIVE', 'Fetched from the source in this browser session ("cached" means a copy from the last few minutes).'],
  ['SNAPSHOT', 'A bundled copy with its real capture time. It works offline and must never be read as current.'],
  ['RECORDED COPY', 'Copied once from a public page (MAGMA Indonesia levels), with the time it was recorded.'],
  ['UNAVAILABLE', 'The live load failed and no snapshot exists. Shown as "Official feed unavailable: check <issuer> directly", never as "none".'],
  ['LIVE TILES', 'Map imagery loaded tile by tile from the provider as you pan; there is no single retrieval time.'],
  ['LINK ONLY', 'Not ingested: linked so you can read it at the source.'],
  ['BUNDLED', 'Reference data built into the app (catalogues, boundaries).'],
  ['DERIVED', 'Computed in your browser from the sources above.'],
];

function SourceCard({ e }: { e: SourceEntry }) {
  return (
    <article className={`anx-source${e.group === 'Official' ? ' anx-source--official' : ''}`}>
      <div className="anx-source__head">
        <h4 className="anx-source__name">
          <ExtLink href={e.url}>{e.name}</ExtLink>
        </h4>
        <span className={`anx-chip${e.mode.startsWith('LIVE') ? ' anx-chip--live' : e.mode === 'SNAPSHOT' || e.mode === 'RECORDED COPY' ? ' anx-chip--snapshot' : e.mode === 'UNAVAILABLE' ? ' anx-chip--unavailable' : ''}`}>
          {e.mode}
        </span>
      </div>
      <dl>
        <dt>Issuer</dt>
        <dd>{e.issuer}</dd>
        <dt>Retrieved</dt>
        <dd>{e.retrievedAt ? utcStamp(e.retrievedAt) : 'not applicable'}</dd>
        {e.modeNote && (
          <>
            <dt>Status</dt>
            <dd>{e.modeNote}</dd>
          </>
        )}
        <dt>Used for</dt>
        <dd>{e.usedFor}</dd>
        <dt>Licence</dt>
        <dd>{e.licence}</dd>
        {e.limitations.length > 0 && (
          <>
            <dt>Limitations</dt>
            <dd>
              <ul className="anx-list">
                {e.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </article>
  );
}

export default function SourcesSection({ input, catalogue }: SourcesSectionProps) {
  const entries = useMemo(() => catalogue ?? buildSourceCatalogue(input), [catalogue, input]);
  const groups = useMemo(() => groupSources(entries), [entries]);
  const unavailable = entries.filter((e) => e.mode === 'UNAVAILABLE');
  const snapshots = entries.filter((e) => (e.mode === 'SNAPSHOT' || e.mode === 'RECORDED COPY') && e.retrievedAt);
  const oldest = snapshots.map((e) => e.retrievedAt as string).sort()[0] ?? null;
  const acknowledgements = input.hotspotSnapshot?.attributions ?? [];

  return (
    <AnalystSection
      id="ws-sources"
      title="Sources & methods"
      lede={
        <>
          Every feed behind the map and the workspace: who issues it, how it reached this page, when, under what licence,
          and what it cannot tell you. Official messages are relayed word for word; measurements and model output are
          labelled MEASURED and MODELLED and kept apart from them. ASEAN Watch is not an official warning service; follow the
          issuing agency.
        </>
      }
    >
      <div className="an-figures">
        <KeyFigure label="Sources listed" value={String(entries.length)} />
        <KeyFigure label="Live now" value={String(entries.filter((e) => e.mode.startsWith('LIVE') && e.mode !== 'LIVE TILES' && !e.mode.includes('on demand')).length)} />
        <KeyFigure label="From a snapshot or copy" value={String(snapshots.length)} note={oldest ? `oldest ${utcStamp(oldest)}` : undefined} />
        <KeyFigure label="Unavailable" value={String(unavailable.length)} note={unavailable.length > 0 ? 'check those issuers directly' : 'none failed'} />
      </div>
      {unavailable.length > 0 && (
        <ul className="anx-list anx-list--official">
          {unavailable.map((e) => (
            <li key={e.id}>{e.modeNote ?? `${e.issuer} unavailable: check ${e.issuer} directly.`}</li>
          ))}
        </ul>
      )}

      <AnalystSubhead>What the modes mean</AnalystSubhead>
      <div className="an-table-wrap">
        <table className="an-table">
          <tbody>
            {MODES.map(([mode, text]) => (
              <tr key={mode}>
                <th scope="row">
                  <span className="anx-chip">{mode}</span>
                </th>
                <td>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="an-note">
        Labels on every figure: MODELLED (forecast-model output, context only, never evidence), MEASURED (stations or
        satellites, with their own gaps), OFFICIAL (the issuing agency's own words, never re-scored or translated on the fly).
        The absence of a message or a hotspot is never an all-clear: feeds fail, cloud hides fires, and snapshots age.
      </p>

      {groups.map((g) => (
        <section key={g.group} aria-labelledby={`ws-sources-${g.group}`}>
          <AnalystSubhead>
            <span id={`ws-sources-${g.group}`}>
              {g.group} ({g.entries.length})
            </span>
          </AnalystSubhead>
          <p className="an-muted">{g.blurb}</p>
          {g.entries.map((e) => (
            <SourceCard key={e.id} e={e} />
          ))}
        </section>
      ))}

      {acknowledgements.length > 0 && (
        <>
          <AnalystSubhead>Required acknowledgements</AnalystSubhead>
          <ul className="anx-list">
            {acknowledgements.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}

      <AnalystSubhead>Further reading</AnalystSubhead>
      <p className="an-muted">
        The full data and limitations note, the provenance of every snapshot and the watch rules are in the project's{' '}
        <ExtLink href="https://github.com/jensonrajawali10/asean-watch/blob/main/docs/DATA_AND_LIMITATIONS.md">DATA_AND_LIMITATIONS</ExtLink> and{' '}
        <ExtLink href="https://github.com/jensonrajawali10/asean-watch/blob/main/data/SOURCES.md">SOURCES</ExtLink> documents.
      </p>
    </AnalystSection>
  );
}
