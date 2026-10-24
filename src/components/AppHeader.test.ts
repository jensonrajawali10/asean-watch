import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AppHeader from './AppHeader';
import { localTimeLabel } from './localTime';

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
    expect(html).toContain('Smoke forecast (modelled) · NASA fire detections · official warnings, word for word<span class="brand-line__region"> · South-east Asia</span>');
    for (const t of ['Circles: fine smoke forecast (PM2.5, modelled)', 'Orange squares: fires seen by NASA satellites', 'Triangles: volcanoes', 'Red pins: official warnings', 'Streaks: wind (forecast)']) {
      expect(html).toContain(t);
    }
    // Phones show the short words; the long ones stay in the markup for screen readers.
    for (const t of ['Smoke forecast, not sensors', 'Fires (NASA)', 'Volcanoes', 'Warnings', 'Wind']) expect(html).toContain(`<span class="hl-short" aria-hidden="true">${t}</span>`);
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
    // Local time first (the visitor's clock), the UTC time the analysts use after it.
    expect(render('LIVE')).toMatch(/Map shows <span class="headline-local">\w{3} \d{1,2}:\d{2} [ap]m your time<\/span><span class="headline-utc"> \(<time dateTime="2026-10-21T12:00:00Z">Wed 21 Oct 12:00 UTC<\/time>\)<\/span>/);
    // The verb and the date have their own spans: phones show a LIVE chip as "LIVE · 12:55 UTC" (shell.css).
    const text = (html: string) => html.replace(/<[^>]+>/g, '');
    expect(render('LIVE')).toContain('>LIVE<span class="fresh-chip__run"> · <span class="fresh-chip__verb">fetched </span><span class="fresh-chip__date">21 Oct </span>12:55 UTC</span>');
    expect(text(render('LIVE'))).toContain('LIVE · fetched 21 Oct 12:55 UTC');
    expect(text(render('SNAPSHOT'))).toContain('SNAPSHOT · saved 21 Oct 12:55 UTC');
    expect(render('LIVE')).toContain('Not an official warning service: follow your national agency.');
  });
});

describe('localTimeLabel', () => {
  it("gives the map hour on the visitor's own clock, with its weekday (which can differ from the UTC day)", () => {
    expect(localTimeLabel('2026-10-21T12:00:00Z', 'Asia/Makassar')).toBe('Wed 8:00 pm your time');
    expect(localTimeLabel('2026-10-21T21:00:00Z', 'Asia/Jakarta')).toBe('Thu 4:00 am your time');
    expect(localTimeLabel('2026-10-21T12:00:00Z', 'UTC')).toBe('Wed 12:00 pm your time');
    expect(localTimeLabel(null)).toBeNull();
    expect(localTimeLabel('not a time')).toBeNull();
    expect(localTimeLabel('2026-10-21T12:00:00Z', 'Not/AZone')).toBeNull();
  });
});

describe('AppHeader alerts pill on phones', () => {
  it('carries a short word after the number for the phone layout', () => {
    const html = renderToStaticMarkup(
      createElement(AppHeader, {
        headline: 'x',
        timeLabel: null,
        timeISO: null,
        freshness: null,
        alerts: { count: 47, urgent: false, label: 'official alerts in force: floods' },
        onAlerts: () => {},
        workspaceOpen: false,
        onWorkspace: () => {},
      }),
    );
    expect(html).toContain('<span class="alerts-pill__count">47</span><span class="alerts-pill__short" aria-hidden="true">alerts</span>');
  });
});
