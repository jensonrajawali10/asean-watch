// Readable data-quality message for records that failed validation or were duplicates.
// Renders nothing when every fixture record loaded cleanly.
import type { ValidationIssue } from '../types';
import { plural } from './format';

export interface DataCheckNoticeProps {
  issues: ValidationIssue[];
  duplicatesIgnored: number;
  /** Set when the fixture files themselves could not be loaded. */
  loadError: string | null;
}

export default function DataCheckNotice({ issues, duplicatesIgnored, loadError }: DataCheckNoticeProps) {
  const rejected = Math.max(0, issues.length - duplicatesIgnored);
  if (!loadError && issues.length === 0 && duplicatesIgnored === 0) return null;

  const parts: string[] = [];
  if (rejected > 0) parts.push(`${plural(rejected, 'record was', 'records were')} not loaded because it failed validation.`);
  if (duplicatesIgnored > 0) {
    parts.push(`${plural(duplicatesIgnored, 'duplicate record id was', 'duplicate record ids were')} ignored; the first copy is kept.`);
  }

  return (
    <section className="panel panel-datacheck" aria-labelledby="datacheck-heading">
      <div className="panel-head">
        <h2 id="datacheck-heading">Data check</h2>
        <span className="panel-meta">{loadError ? 'Fixtures not loaded' : plural(issues.length, 'issue', 'issues')}</span>
      </div>
      <div className="panel-body datacheck-body">
        {loadError && (
          <p className="datacheck-error" role="alert">
            The fixture files could not be loaded: {loadError}. The dashboard stays empty until the data files in data/
            are fixed.
          </p>
        )}
        {parts.length > 0 && <p>{parts.join(' ')} Everything else on screen uses the records that passed.</p>}
        {issues.length > 0 && (
          <ul className="datacheck-list">
            {issues.map((issue, i) => (
              <li key={`${issue.index}-${i}`}>{issue.message}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
