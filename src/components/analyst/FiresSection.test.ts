import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FIRE_LINKS, FIRMS_ACKNOWLEDGEMENT, loadFireSnapshot } from '../../lib/fires';
import { loadWindSnapshot } from '../../lib/windField';
import { FiresSection } from './FiresSection';

const snap = loadFireSnapshot()!;
const noop = () => {};
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');

describe('FiresSection', () => {
  const html = renderToStaticMarkup(createElement(FiresSection, { snapshot: snap, onFlyTo: noop, windGrid: loadWindSnapshot('925hPa') }));

  it('has the tables, clusters, week-over-week, sensor mix, methods and links', () => {
    for (const heading of ['By country', 'By Indonesian province (approximate)', 'Top clusters', 'Week over week', 'Sensor mix', 'Methods and caveats']) {
      expect(html).toContain(heading);
    }
    expect(html).toContain('Fly to');
    expect(html).toContain('MODELLED');
    expect(html).toMatch(/Smoke from here is heading|Smoke heading not modelled here|winds are light here/);
    expect(html).toContain('Open Copernicus Fire Emissions Watch');
    expect(html).toContain(`href="${FIRE_LINKS.fireEmissionsWatch}"`);
    expect(html).toContain(`href="${FIRE_LINKS.crisp}"`);
    expect(html).toContain(esc(FIRMS_ACKNOWLEDGEMENT));
    expect(html).toContain('FRP is not emissions.');
    expect(html).toContain('Cloud and smoke hide fires.');
  });

  it('cites every FIRMS file and never states emissions as a mass or uses em dashes', () => {
    for (const s of snap.sources.filter((x) => x.sensor)) expect(html).toContain(s.url);
    expect(html).not.toMatch(/tonne|CO2|—/);
  });

  it('says unavailable, never "no fires", without a snapshot', () => {
    const empty = renderToStaticMarkup(createElement(FiresSection, { snapshot: null, onFlyTo: noop }));
    expect(empty).toContain('not an all-clear');
    expect(empty).not.toMatch(/no fires/i);
  });
});
