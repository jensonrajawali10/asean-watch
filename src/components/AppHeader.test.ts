import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AppHeader from './AppHeader';

describe('AppHeader first-load legend', () => {
  it('says what each symbol means without opening anything, and that the circles are modelled', () => {
    const html = renderToStaticMarkup(
      createElement(AppHeader, {
        headline: 'Now: the worst haze is at X.',
        timeLabel: null,
        timeISO: null,
        freshness: null,
        alerts: { count: 3, urgent: false, label: 'official alerts in force: floods' },
        onAlerts: () => {},
        workspaceOpen: false,
        onWorkspace: () => {},
      }),
    );
    for (const t of ['Circles: fine smoke forecast (PM2.5, modelled)', 'Orange squares: fires seen by NASA satellites', 'Triangles: volcanoes', 'Red pins: official warnings']) {
      expect(html).toContain(t);
    }
  });
});

describe('AppHeader alerts pill', () => {
  const render = (urgent: boolean) =>
    renderToStaticMarkup(
      createElement(AppHeader, {
        headline: 'x',
        timeLabel: null,
        timeISO: null,
        freshness: null,
        alerts: { count: 3, urgent, label: 'official alerts in force: floods, tsunami' },
        onAlerts: () => {},
        workspaceOpen: false,
        onWorkspace: () => {},
      }),
    );
  it('shows the number once and says what the alerts are, adding "urgent" when one is', () => {
    expect(render(false)).toContain('official alerts in force: floods, tsunami</span>');
    expect(render(true)).toContain('official alerts in force: floods, tsunami (incl. urgent)');
    expect(render(true)).toContain('alerts-pill is-urgent');
  });
});
