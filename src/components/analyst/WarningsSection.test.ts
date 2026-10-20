// The Warnings section's summary tiles use plain words for a first-time reader.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadWarningsSnapshot } from '../../lib/warnings';
import WarningsSection from './WarningsSection';

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
