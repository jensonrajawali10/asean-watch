// Air quality on region, province and country cards, every ASEAN member's capital, official links and the
// "why no PSI" note. Expected values come from the bundled snapshots (aq-snapshot.json, fires-snapshot.json).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AQ_PLACES, loadAqSnapshot, pm25At, placePm25At, samePlaces } from './airQuality';
import { areaAir, areaPlaceId, COUNTRY_CAPITAL_PLACE, ISO3_TO_ISO2 } from './areaAir';
import { loadFireSnapshot } from './fires';
import { AIR_QUALITY_INDEX, AIR_QUALITY_OFFICIAL, COUNTRY_NAME, noPsiNote } from './places';
import { FireCard } from '../components/map/FireCard';
import CityCard from '../components/map/CityPopover';

const AQ = (await loadAqSnapshot())!;
const FIRES = loadFireSnapshot()!;
const T = AQ.times[Math.floor(AQ.times.length / 2)];
const ASEAN = ['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'TL', 'VN'];
const noop = () => {};

describe('AQ_PLACES coverage', () => {
  it('has at least one place in every ASEAN member, and the bundled snapshot carries every place', () => {
    for (const c of ASEAN) expect(AQ_PLACES.some((p) => p.country === c), c).toBe(true);
    expect(AQ.places.map((p) => p.id)).toEqual(AQ_PLACES.map((p) => p.id));
  });

  it('a saved run from before the new places is not reused (samePlaces)', () => {
    expect(samePlaces(AQ)).toBe(true);
    expect(samePlaces({ places: AQ.places.slice(0, 23) })).toBe(false);
  });

  it('maps every ASEAN capital to a place that exists', () => {
    for (const [iso3, id] of Object.entries(COUNTRY_CAPITAL_PLACE)) {
      expect(AQ_PLACES.some((p) => p.id === id), `${iso3} -> ${id}`).toBe(true);
      expect(ISO3_TO_ISO2[iso3]).toBeDefined();
    }
  });
});

describe('areaAir', () => {
  it('a province with a city uses that city (Riau -> Pekanbaru), with the snapshot value', () => {
    const riau = FIRES.regions.find((r) => r.key === 'IDN:Riau')!;
    expect(areaPlaceId('IDN:Riau')).toEqual({ id: 'pekanbaru', role: 'a main city of the province' });
    const r = areaAir(AQ, { key: riau.key, name: riau.name, centre: riau.centre24h }, T);
    expect(r.kind).toBe('place');
    if (r.kind !== 'place') return;
    expect(r.value).toBeCloseTo(placePm25At(AQ, AQ.places.find((p) => p.id === 'pekanbaru')!, T), 6);
    expect(r.where).toBe('at Pekanbaru, a main city of the province');
  });

  it('a province without a place uses the grid at its fires, when inside the grid', () => {
    const inside = FIRES.regions.find((r) => {
      const c = r.centre24h ?? r.centre7d;
      return !areaPlaceId(r.key) && c && Number.isFinite(pm25At(AQ, c[0], c[1], T));
    })!;
    expect(inside).toBeDefined();
    const c = (inside.centre24h ?? inside.centre7d)!;
    const r = areaAir(AQ, { key: inside.key, name: inside.name, centre: c }, T);
    expect(r).toMatchObject({ kind: 'grid', where: 'at the centre of the fires here' });
    if (r.kind === 'grid') expect(r.value).toBeCloseTo(pm25At(AQ, c[0], c[1], T), 6);
  });

  it('outside the grid and without a place: no value, and the reason says so', () => {
    const r = areaAir(AQ, { key: 'PNG', name: 'Papua New Guinea', centre: [-6, 145] }, T);
    expect(r.kind).toBe('none');
    if (r.kind === 'none') expect(r.reason).toMatch(/No modelled air-quality point for Papua New Guinea/);
  });

  it('a country uses its capital', () => {
    const r = areaAir(AQ, { key: 'LAO', name: 'Laos', centre: null }, T);
    expect(r).toMatchObject({ kind: 'place', where: 'at Vientiane, the capital' });
  });
});

describe('noPsiNote', () => {
  it('is null for Singapore and explains the national index elsewhere', () => {
    expect(noPsiNote('SG')).toBeNull();
    expect(noPsiNote('ID')).toBe('Singapore reports PSI; Indonesia reports ISPU (official link below).');
    expect(noPsiNote('BN')).toBe('Brunei reports its own PSI (official link below); this map does not fetch it.');
    expect(noPsiNote('LA')).toBe('Singapore reports PSI; we found no official air-quality page for Laos.');
    for (const c of ASEAN) expect(COUNTRY_NAME[c], c).toBeDefined();
  });

  it('names an index only for countries with a verified official link', () => {
    for (const c of Object.keys(AIR_QUALITY_INDEX)) if (c !== 'SG') expect(AIR_QUALITY_OFFICIAL[c], c).toBeDefined();
  });
});

describe('cards', () => {
  it('a province fire card shows the modelled air, the PSI note and the official link', () => {
    const riau = FIRES.regions.find((r) => r.key === 'IDN:Riau')!;
    const html = renderToStaticMarkup(
      createElement(FireCard, {
        pick: { kind: 'fire-region', badge: { id: `badge:${riau.key}`, name: riau.name, count: riau.last24h.count, frp: riau.last24h.frp } } as never,
        snapshot: FIRES,
        airQuality: AQ,
        airTimeISO: T,
        onOpenWorkspace: noop,
      }),
    );
    expect(html).toContain('Air here');
    expect(html).toContain('at Pekanbaru, a main city of the province');
    expect(html).toContain('ISPU');
    expect(html).toContain(AIR_QUALITY_OFFICIAL.ID.url);
  });

  it('a non-Singapore city card says why there is no PSI; Singapore does not', () => {
    const city = (id: string) =>
      renderToStaticMarkup(createElement(CityCard, { cityId: id, airQuality: AQ, timeISO: T, nowISO: AQ.times[0], onClose: noop, onOpenWorkspace: noop }));
    expect(city('vientiane')).toContain('found no official air-quality page for Laos');
    expect(city('ho-chi-minh-city')).toContain('Vietnam reports VN_AQI');
    expect(city('singapore')).not.toContain('Singapore reports PSI');
    expect(city('vientiane')).toContain(AQ.dataMode === 'historical' ? 'Worst hour in the saved run' : 'Worst hour, next 48 h (forecast)');
    expect(city('vientiane')).toMatch(/Fine smoke (forecast for the next 48 hours|over 48 hours of the saved forecast run), µg\/m³/);
  });
});

describe('plain words', () => {
  it('plainAirSentence says how smoky, the unit and the WHO comparison, and that it is a forecast', async () => {
    const { plainAirSentence } = await import('./airQuality');
    expect(plainAirSentence('Palangka Raya', 407)).toBe(
      "The air around Palangka Raya is forecast to be hazardous for everyone: 407 µg/m³ of fine smoke, about 27 times the WHO's daily guideline of 15 µg/m³.",
    );
    expect(plainAirSentence('Cebu', 5)).toBe("The air around Cebu is forecast to be fairly clean: 5 µg/m³ of fine smoke, under the WHO's daily guideline of 15 µg/m³.");
  });
  it('the map key explains every symbol, including that red pins are not fires', async () => {
    const MapKey = (await import('../components/map/MapKey')).default;
    const html = renderToStaticMarkup(createElement(MapKey));
    expect(html).toContain('µg/m³');
    expect(html).toContain('MODELLED');
    expect(html).toContain('Not a fire.');
    expect(html).toContain('What&#x27;s on the map');
    expect(html).toContain('Fires seen by NASA satellites');
    expect(html).toContain('Volcanoes.');
    expect(html).toContain('The wind about 800 m up');
  });
});
