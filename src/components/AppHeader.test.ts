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
    for (const t of ['Circles: fine smoke forecast (PM2.5, modelled)', 'Orange squares: fires seen by NASA satellites', 'Triangles: volcanoes', 'Red pins: official warnings', 'Streaks: wind (forecast)']) {
      expect(html).toContain(t);
    }
    // Phones show the short words; the long ones stay in the markup for screen readers.
    for (const t of ['Smoke forecast', 'Fires (NASA)', 'Volcanoes', 'Warnings', 'Wind']) expect(html).toContain(`<span class="hl-short" aria-hidden="true">${t}</span>`);
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

describe('AppHeader time and freshness', () => {
  const render = (mode: 'LIVE' | 'SNAPSHOT') =>
    renderToStaticMarkup(
      createElement(AppHeader, {
        headline: 'x',
        timeLabel: 'Wed 21 Oct 12:00 UTC',
        timeISO: '2026-10-21T12:00:00Z',
        freshness: { mode, run: '21 Oct 12:55 UTC' },
        alerts: { count: 0, urgent: false, label: 'official alerts in force' },
        onAlerts: () => {},
        workspaceOpen: false,
        onWorkspace: () => {},
      }),
    );
  it('says what the time is and whether the forecast was fetched now or saved, keeping the LIVE / SNAPSHOT label', () => {
    expect(render('LIVE')).toContain('Map shows <time dateTime="2026-10-21T12:00:00Z">Wed 21 Oct 12:00 UTC</time>');
    expect(render('LIVE')).toMatch(/>LIVE<span class="fresh-chip__run"> · fetched 21 Oct 12:55 UTC<\/span>/);
    expect(render('SNAPSHOT')).toMatch(/>SNAPSHOT<span class="fresh-chip__run"> · saved 21 Oct 12:55 UTC<\/span>/);
    expect(render('LIVE')).toContain('Not an official warning service: follow your national agency.');
  });
});
