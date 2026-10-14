import { describe, expect, it } from 'vitest';
import type { OfficialWarning, OfficialWarningArea } from '../types';
import { BUNDLED_WARNINGS_SNAPSHOT, parseBmkgTsunami } from './warnings';
import {
  IDN_DISTRICT_CENTRES,
  SEGMENT_OFFSET_KM,
  buildDistrictIndex,
  idnDistrictIndex,
  offsetPoint,
  parseAreaName,
  placeTsunamiAreas,
  selectTsunamiAreaWarnings,
} from './tsunamiAreas';
import { haversineKm } from './nea';

const area = (name: string, level = 'SIAGA', province: string | null = null): OfficialWarningArea => ({ name, level, lat: null, lon: null, province });

const REAL = parseBmkgTsunami(BUNDLED_WARNINGS_SNAPSHOT.feeds['bmkg-inatews'].raw, { dataMode: 'historical', retrievedAt: '2026-10-13T07:51:20Z' }).warnings;

describe('parseAreaName', () => {
  it('normalises case, strips KAB./KOTA and reads the BAGIAN segment', () => {
    expect(parseAreaName('MANGGARAI BAGIAN UTARA')).toEqual({ base: 'MANGGARAI', key: 'MANGGARAI', city: false, segment: 'UTARA' });
    expect(parseAreaName('KOTA-BAU-BAU')).toEqual({ base: 'BAU-BAU', key: 'BAUBAU', city: true, segment: null });
    expect(parseAreaName('Kab. Flores Timur')).toMatchObject({ key: 'FLORESTIMUR', city: false, segment: null });
    expect(parseAreaName('KOTA-PALU BAGIAN BARAT')).toMatchObject({ key: 'PALU', city: true, segment: 'BARAT' });
    expect(parseAreaName('minahasa-utara bagian selatan')).toMatchObject({ key: 'MINAHASAUTARA', segment: 'SELATAN' });
  });
});

describe('bundled geoBoundaries centres', () => {
  it('has every Indonesian regency and city with a licence and attribution', () => {
    expect(IDN_DISTRICT_CENTRES.districts.length).toBeGreaterThan(500);
    expect(IDN_DISTRICT_CENTRES.licence).toMatch(/CC BY 3\.0 IGO/);
    expect(IDN_DISTRICT_CENTRES.attribution).toMatch(/geoBoundaries/);
  });
});

describe('placeTsunamiAreas with real BMKG names', () => {
  const index = idnDistrictIndex();
  const one = (name: string) => placeTsunamiAreas([area(name)], index);

  it('places a coastal segment north of the base district centre, labelled approximate', () => {
    const { placed, unplaced } = one('MANGGARAI BAGIAN UTARA');
    expect(unplaced).toEqual([]);
    const centre = IDN_DISTRICT_CENTRES.districts.find((d) => d.name === 'Manggarai');
    expect(centre).toBeDefined();
    const p = placed[0];
    expect(p.district).toBe('Manggarai');
    expect(p.approximate).toBe(true);
    expect(p.lat).toBeGreaterThan(centre?.lat ?? 0);
    expect(p.lon).toBeCloseTo(centre?.lon ?? 0, 6);
    expect(haversineKm(p.lat, p.lon, centre?.lat ?? 0, centre?.lon ?? 0)).toBeCloseTo(SEGMENT_OFFSET_KM, 1);
    expect(p.note).toMatch(/North coast segment of Manggarai.*approximate/);
    expect(p.area.name).toBe('MANGGARAI BAGIAN UTARA');
  });

  it('matches hyphenated, run-together and city names', () => {
    expect(one('MANGGARAI-BARAT BAGIAN UTARA').placed[0].district).toBe('Manggarai Barat');
    expect(one('FLORES-TIMUR BAGIAN UTARA').placed[0].district).toBe('Flores Timur');
    expect(one('KOTA-BAU-BAU').placed[0].district).toBe('Kota Baubau');
    expect(one('BOLAANGMONGONDOW BAGIAN UTARA').placed[0].district).toBe('Bolaang Mongondow');
    expect(one('TOLI-TOLI').placed[0].district).toBe('Toli-Toli');
    expect(one('KOTA-BIMA BAGIAN UTARA').placed[0].district).toBe('Kota Bima');
  });

  it('prefers the regency for an unqualified name and the city only with KOTA', () => {
    expect(one('JAYAPURA').placed[0].district).toBe('Jayapura');
    expect(one('KOTA-JAYAPURA').placed[0].district).toBe('Kota Jayapura');
  });

  it('uses a "Kepulauan" name only when no exact name matches', () => {
    expect(one('SELAYAR').placed[0].district).toBe('Kepulauan Selayar');
    expect(one('KOTA-TIDORE').placed[0].district).toBe('Kota Tidore Kepulauan');
    expect(one('KEPULAUAN SANGIHE').placed[0].district).toBe('Kepulauan Sangihe');
  });

  it('never drops or guesses an unmatched area: islands and unknown names are listed with a reason', () => {
    const r = placeTsunamiAreas([area('PULAU ENDE', 'WASPADA'), area('BIMA PULAU SANGIANG', 'WASPADA'), area('HALMAHERA'), area('KEPULAUAN MINAHASA')], index);
    expect(r.placed).toEqual([]);
    expect(r.unplaced.map((u) => u.area.name)).toEqual(['PULAU ENDE', 'BIMA PULAU SANGIANG', 'HALMAHERA', 'KEPULAUAN MINAHASA']);
    expect(r.unplaced[0].reason).toMatch(/No regency or city named "PULAU ENDE"/);
    // Levels travel verbatim with the unplaced area.
    expect(r.unplaced[0].area.level).toBe('WASPADA');
  });
});

describe('placeTsunamiAreas ambiguity', () => {
  it('does not place a name shared by two districts of the same kind', () => {
    const index = buildDistrictIndex([
      { name: 'Sama', lat: -1, lon: 120 },
      { name: 'Sama', lat: -5, lon: 125 },
      { name: 'Kota Lain', lat: -2, lon: 121 },
    ]);
    const r = placeTsunamiAreas([area('SAMA BAGIAN TIMUR'), area('LAIN')], index);
    expect(r.unplaced).toHaveLength(1);
    expect(r.unplaced[0].reason).toMatch(/^Ambiguous: matches Sama and Sama/);
    // No regency named Lain, so the one city is used.
    expect(r.placed.map((p) => p.district)).toEqual(['Kota Lain']);
  });

  it('places a TENGAH segment at the district centre', () => {
    const index = buildDistrictIndex([{ name: 'Contoh', lat: -3, lon: 119 }]);
    const r = placeTsunamiAreas([area('CONTOH BAGIAN TENGAH')], index);
    expect(r.placed[0]).toMatchObject({ lat: -3, lon: 119, segment: 'TENGAH' });
  });

  it('offsets in the stated compass direction', () => {
    const e = offsetPoint(-8, 120, 90, SEGMENT_OFFSET_KM);
    expect(e.lat).toBeCloseTo(-8, 3);
    expect(e.lon).toBeGreaterThan(120);
    const w = offsetPoint(-8, 120, 270, SEGMENT_OFFSET_KM);
    expect(w.lon).toBeLessThan(120);
  });
});

describe('selectTsunamiAreaWarnings on the real snapshot', () => {
  it('has no BMKG warning in force and picks the 15 Aug 2026 Flores Sea PD-3.4 message as the latest', () => {
    const { inForce, latest } = selectTsunamiAreaWarnings(REAL);
    expect(inForce).toBeNull();
    expect(latest?.product).toBe('Warning Tsunami PD-3.4');
    expect(latest?.issuedAt).toBe('2026-08-15T00:05:32Z');
    expect(latest?.ended).toBe(true);
  });

  it('places most Flores Sea districts and lists the rest', () => {
    const latest = selectTsunamiAreaWarnings(REAL).latest as OfficialWarning;
    const r = placeTsunamiAreas(latest.areas, idnDistrictIndex());
    expect(r.placed.length + r.unplaced.length).toBe(latest.areas.length);
    expect(r.placed.length).toBeGreaterThanOrEqual(17);
    // Every placed level is the verbatim BMKG level.
    for (const p of r.placed) expect(['AWAS', 'SIAGA', 'WASPADA']).toContain(p.area.level);
    expect(r.unplaced.map((u) => u.area.name).sort()).toEqual(['BIMA PULAU GILI', 'BIMA PULAU SANGIANG', 'PULAU ENDE', 'PULAU SIKKA']);
  });

  it('prefers a message that has not been ended', () => {
    const base = REAL.find((w) => w.product === 'Warning Tsunami PD-3.4' && w.issuedAt === '2026-08-15T00:05:32Z') as OfficialWarning;
    const open = { ...base, id: 'bmkg-inatews:open', issuedAt: '2026-06-08T00:00:00Z', ended: false };
    expect(selectTsunamiAreaWarnings([base, open]).inForce?.id).toBe('bmkg-inatews:open');
    expect(selectTsunamiAreaWarnings([base, open]).latest?.id).toBe(base.id);
  });
});
