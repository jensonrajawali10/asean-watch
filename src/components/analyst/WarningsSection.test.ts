// The Warnings section's summary tiles use plain words for a first-time reader.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadWarningsSnapshot } from '../../lib/warnings';
import WarningsSection, { UrgentReason } from './WarningsSection';
import WorkspaceDrawer from '../shell/WorkspaceDrawer';
import { WarningsModeNote } from '../OfficialWarnings';

describe('WarningsSection tiles', () => {
  it('say "still active", explain GDACS and the saved copies in plain words', () => {
    const snap = loadWarningsSnapshot();
    const noop = () => {};
    const html = renderToStaticMarkup(
      createElement(WarningsSection, {
        warnings: snap.warnings,
        allWarnings: snap.warnings,
        elsewhere: [],
        gauges: snap.gauges,
        feeds: snap.feeds,
        nearName: null,
        loading: false,
        selectedWarningId: null,
        onInspect: noop,
      } as never),
    );
    expect(html).toContain('Official alerts still active');
    expect(html).toContain('Disaster impact estimates (GDACS)');
    expect(html).toContain('not warnings');
    expect(html).toContain('Agency sources checked');
    expect(html).not.toContain('not ended by the issuer');
    // Two feeds from one agency are told apart in the sources list (no duplicate entries).
    expect(html).toContain('BMKG InaTEWS: tsunami messages');
    expect(html).toContain('BMKG InaTEWS: latest earthquake message');
    const items = [...html.matchAll(/<li><a href="[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(items.length).toBeGreaterThan(5);
    expect(new Set(items).size).toBe(items.length);
  });
});

describe('WarningsSection how-to-read key', () => {
  it('says, before the first card, whose words are whose and what LIVE and HISTORICAL mean', () => {
    const snap = loadWarningsSnapshot();
    const noop = () => {};
    const html = renderToStaticMarkup(
      createElement(WarningsSection, {
        warnings: snap.warnings,
        allWarnings: snap.warnings,
        elsewhere: [],
        gauges: snap.gauges,
        feeds: snap.feeds,
        nearName: null,
        loading: false,
        selectedWarningId: null,
        onInspect: noop,
      } as never),
    );
    const key = html.indexOf('aria-label="How to read this list"');
    expect(key).toBeGreaterThan(-1);
    expect(key).toBeLessThan(html.indexOf('class="ow-list"'));
    expect(html).toContain("is one agency message in the agency&#x27;s own words, as issued.");
    expect(html).toContain('our fixed, plain gloss of that agency&#x27;s scale');
    expect(html).toContain('fetched from the agency during this visit');
    expect(html).toContain('a saved copy with the time it was');
  });
});

describe('WarningsSection live count', () => {
  it('counts a feed fetched earlier in this visit (the 5-minute session copy) as live, not as a saved copy', () => {
    const snap = loadWarningsSnapshot();
    const feeds = snap.feeds.map((f, i) => ({ ...f, status: i === 0 ? ('live' as const) : i < 4 ? ('cached' as const) : ('snapshot' as const) }));
    const noop = () => {};
    const html = renderToStaticMarkup(
      createElement(WarningsSection, {
        warnings: snap.warnings,
        allWarnings: snap.warnings,
        elsewhere: [],
        gauges: snap.gauges,
        feeds,
        nearName: null,
        loading: false,
        selectedWarningId: null,
        onInspect: noop,
      } as never),
    );
    expect(html).toContain('4 live');
    expect(html).toContain(`${feeds.length - 4} from saved copies (not refreshed just now)`);
  });
});

describe('Warnings drawer header', () => {
  it('pins the LIVE / HISTORICAL key above the scrolling list, in one line', () => {
    const html = renderToStaticMarkup(
      createElement(
        WorkspaceDrawer,
        { section: 'warnings', onSelectSection: () => {}, onClose: () => {}, note: createElement(WarningsModeNote) } as never,
        createElement('p', null, 'list'),
      ),
    );
    const head = html.slice(html.indexOf('<header class="ws-drawer__head"'), html.indexOf('</header>'));
    expect(head).toContain('<p class="ws-drawer__note">');
    expect(head).toContain('badge-mode--live">LIVE</span> fetched from the agency this visit');
    expect(head).toContain('badge-mode--historical">HISTORICAL</span> a saved copy, its time shown · levels as issued');
    expect(html.indexOf('ws-drawer__note')).toBeLessThan(html.indexOf('ws-drawer__body'));
  });

  it('shows no note when none is given', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceDrawer, { section: 'haze', onSelectSection: () => {}, onClose: () => {} } as never, createElement('p', null, 'x')),
    );
    expect(html).not.toContain('ws-drawer__note');
  });
});

describe('UrgentReason', () => {
  const base = loadWarningsSnapshot().warnings[0];
  const ptwc = {
    ...base,
    id: 'ptwc:2026-10-24T03:30:54Z',
    issuer: 'Pacific Tsunami Warning Center (PTWC)',
    hazard: 'tsunami' as const,
    level: 'TSUNAMI MESSAGE NUMBER 2',
    issuedAt: '2026-10-24T03:30:54Z',
  };

  it('says why the alerts button is red and names each message verbatim, with its issue time', () => {
    const html = renderToStaticMarkup(createElement(UrgentReason, { warnings: [ptwc], onInspect: () => {} }));
    expect(html).toContain('Why the alerts button is red:');
    expect(html).toContain('not labelled as');
    expect(html).toContain('Pacific Tsunami Warning Center (PTWC): TSUNAMI MESSAGE NUMBER 2');
    expect(html).toContain('issued 2026-10-24 03:30 UTC');
    const noTime = renderToStaticMarkup(createElement(UrgentReason, { warnings: [{ ...ptwc, issuedAt: null }], onInspect: () => {} }));
    expect(noTime).toContain('no issue time published');
  });

  it('shows nothing when no message makes the button red', () => {
    expect(renderToStaticMarkup(createElement(UrgentReason, { warnings: [], onInspect: () => {} }))).toBe('');
  });
});
