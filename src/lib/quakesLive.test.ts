import { beforeEach, describe, expect, it } from 'vitest';
import { resetConnectorCaches } from './liveLoad';
import {
  bundledQuakesSnapshot,
  combineQuakes,
  inQuakeBox,
  loadQuakes,
  loadQuakesSnapshot,
  parseBmkgDatagempa,
  parseBmkgTerkini,
  parseUsgsQuakes,
  usgsQueryUrl,
  USGS_TSUNAMI_FLAG_NOTE,
} from './quakesLive';
import { BUNDLED_WARNINGS_SNAPSHOT, xmlBlocks, xmlText } from './warnings';

// The bundled snapshot is a lazy chunk.
const BUNDLED_QUAKES_SNAPSHOT = (await bundledQuakesSnapshot())!;

// Trimmed real samples captured 2026-10-14 (data/quakes-snapshot.json).
const USGS_FIJI = {
  type: 'Feature',
  id: 'us6000u28y',
  properties: {
    mag: 5.9, place: 'Fiji region', time: 1791974987588, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u28y',
    tsunami: 0, status: 'reviewed', magType: 'mww', type: 'earthquake', title: 'M 5.9 - Fiji region',
  },
  geometry: { type: 'Point', coordinates: [-178.7711, -20.9899, 585.07] },
};
const USGS_PNG = {
  type: 'Feature',
  id: 'us6000u27u',
  properties: {
    mag: 4.9, place: '121 km S of Kokopo, Papua New Guinea', time: 1791959226453,
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u27u', tsunami: 0, status: 'reviewed', magType: 'mb', type: 'earthquake',
  },
  geometry: { type: 'Point', coordinates: [152.2617, -5.443, 35] },
};
const usgs = (...features: unknown[]) => ({ type: 'FeatureCollection', features });

const BMKG_TERKINI = {
  Infogempa: {
    gempa: [
      { Tanggal: '12 Okt 2026', Jam: '04:34:53 WIB', DateTime: '2026-10-11T21:34:53+00:00', Coordinates: '0.64,121.75', Magnitude: '5.7', Kedalaman: '76 km', Wilayah: '29 km BaratLaut POHUWATO-GORONTALO', Potensi: 'Tidak berpotensi tsunami' },
      { Tanggal: '11 Okt 2026', Jam: '10:30:20 WIB', DateTime: '2026-10-11T03:30:20+00:00', Coordinates: '-8.73,106.47', Magnitude: '5.7', Kedalaman: '10 km', Wilayah: '193 km BaratDaya KAB-SUKABUMI-JABAR', Potensi: 'Tidak berpotensi tsunami' },
    ],
  },
};
const BMKG_DATAGEMPA = {
  identifier: 'Indonesia-InaTEWS-felt-Eq-20261014173057',
  sent: '2026-10-14T17:30:57WIB',
  info: {
    event: 'Gempabumi', date: '14-10-26', time: '17:30:57 WIB', point: { coordinates: '120.56,-8.14' },
    magnitude: '3.8', depth: '10 Km', area: 'Pusat gempa berada di laut 53 km utara Ruteng, Manggarai', eventid: '20261014173057',
    potential: 'Gempa ini dirasakan untuk diteruskan pada masyarakat', subject: 'Warning Gempa dirasakan',
  },
};

function fetchFrom(routes: [RegExp, unknown][]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

beforeEach(() => resetConnectorCaches());

describe('dateline handling', () => {
  it('accepts the box across the dateline and rejects the outside', () => {
    expect(inQuakeBox(-20.99, -178.77)).toBe(true); // Fiji, west of 180
    expect(inQuakeBox(-20.99, 181.23)).toBe(true); // same point as 0..360
    expect(inQuakeBox(-5.4, 152.3)).toBe(true);
    expect(inQuakeBox(19.4, -155.3)).toBe(true); // Hawaii (155°W) is west of the 150°W edge
    expect(inQuakeBox(-9.0, -140.1)).toBe(false); // Marquesas, east of 150°W
    expect(inQuakeBox(-14.3, -170.7)).toBe(true); // American Samoa
    expect(inQuakeBox(28.4, 84.7)).toBe(false); // Nepal, west of 90°E
    expect(inQuakeBox(-55, 150)).toBe(false);
  });

  it('queries one FDSN box from 90°E to 210° (150°W), M4.5+, 7 days, hour-rounded start', () => {
    const url = usgsQueryUrl(Date.parse('2026-10-14T11:47:12Z'));
    expect(url).toContain('minlongitude=90&maxlongitude=210');
    expect(url).toContain('minlatitude=-50&maxlatitude=60');
    expect(url).toContain('minmagnitude=4.5');
    expect(url).toContain('starttime=2026-10-07T11:00:00');
  });

  it('normalises longitudes past 180 and keeps negative ones', () => {
    const shifted = { ...USGS_FIJI, id: 'x', geometry: { type: 'Point', coordinates: [181.2289, -20.9899, 585.07] } };
    const [a, b] = parseUsgsQuakes(usgs(USGS_FIJI, shifted), { dataMode: 'live' });
    expect(a.lon).toBeCloseTo(-178.7711, 4);
    expect(b.lon).toBeCloseTo(-178.7711, 4);
  });
});

describe('parsing', () => {
  it('maps USGS features to QuakeEvent', () => {
    const [q] = parseUsgsQuakes(usgs(USGS_PNG), { dataMode: 'live' });
    expect(q).toMatchObject({
      id: 'usgs:us6000u27u', source: 'USGS', magnitude: 4.9, magType: 'mb', depthKm: 35, lat: -5.443, lon: 152.2617,
      place: '121 km S of Kokopo, Papua New Guinea', timeISO: '2026-10-14T06:27:06Z', tsunamiFlag: false, potential: null, dataMode: 'live',
    });
    expect(q.url).toBe('https://earthquake.usgs.gov/earthquakes/eventpage/us6000u27u');
  });

  it('drops events below M4.5 and outside the box', () => {
    const small = { ...USGS_PNG, id: 's', properties: { ...USGS_PNG.properties, mag: 4.4 } };
    const outside = { ...USGS_PNG, id: 'o', geometry: { type: 'Point', coordinates: [-140.1, -9.0, 10] } };
    expect(parseUsgsQuakes(usgs(small, outside, USGS_PNG), { dataMode: 'live' }).map((q) => q.id)).toEqual(['usgs:us6000u27u']);
  });

  it('BMKG gempaterkini: "lat,lon" order, UTC DateTime, depth and verbatim Potensi', () => {
    const [a, b] = parseBmkgTerkini(BMKG_TERKINI, { dataMode: 'historical' });
    expect(a).toMatchObject({ source: 'BMKG', lat: 0.64, lon: 121.75, magnitude: 5.7, magType: null, depthKm: 76, timeISO: '2026-10-11T21:34:53Z', tsunamiFlag: null, potential: 'Tidak berpotensi tsunami', dataMode: 'historical' });
    expect(b.lat).toBe(-8.73);
    expect(b.place).toBe('193 km BaratDaya KAB-SUKABUMI-JABAR');
  });

  it('BMKG datagempa: "lon,lat" order and WIB origin time converted to UTC', () => {
    const [q] = parseBmkgDatagempa(BMKG_DATAGEMPA, { dataMode: 'live' });
    expect(q).toMatchObject({ id: 'bmkg-datagempa:20261014173057', lat: -8.14, lon: 120.56, magnitude: 3.8, depthKm: 10, timeISO: '2026-10-14T10:30:57Z' });
    expect(q.potential).toBe('Gempa ini dirasakan untuk diteruskan pada masyarakat');
  });
});

describe('tsunami flag is not a warning', () => {
  it('exposes the USGS flag as a boolean with a note that says it is NOT a warning', () => {
    // The real Fiji event with its tsunami flag set to 1 (no flagged event in the captured week).
    const flagged = { ...USGS_FIJI, properties: { ...USGS_FIJI.properties, tsunami: 1 } };
    const [q] = parseUsgsQuakes(usgs(flagged), { dataMode: 'live' });
    expect(q.tsunamiFlag).toBe(true);
    expect(USGS_TSUNAMI_FLAG_NOTE).toMatch(/NOT a tsunami warning/);
    expect(USGS_TSUNAMI_FLAG_NOTE).toMatch(/BMKG/);
    expect(Object.keys(q)).not.toContain('warning');
  });

  it('BMKG records carry no USGS flag', () => {
    expect(parseBmkgTerkini(BMKG_TERKINI, { dataMode: 'live' }).every((q) => q.tsunamiFlag === null)).toBe(true);
  });
});

describe('combining and loading', () => {
  it('never merges USGS and BMKG reports of the same event', () => {
    const usgsQ = parseUsgsQuakes(usgs(USGS_PNG), { dataMode: 'live' });
    const bmkgSame = { ...usgsQ[0], id: 'bmkg-gempaterkini:20261013154706', source: 'BMKG' as const, magnitude: 5.0, tsunamiFlag: null };
    const all = combineQuakes(usgsQ, [bmkgSame], []);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((q) => q.source))).toEqual(new Set(['USGS', 'BMKG']));
  });

  it('drops a BMKG datagempa record that repeats a gempaterkini event (same agency)', () => {
    const t = parseBmkgTerkini(BMKG_TERKINI, { dataMode: 'live' });
    const dup = { ...t[0], id: 'bmkg-datagempa:x' };
    expect(combineQuakes([], t, [dup]).map((q) => q.id)).not.toContain('bmkg-datagempa:x');
  });

  it('loads live when the feeds answer', async () => {
    const res = await loadQuakes({
      fetchImpl: fetchFrom([[/earthquake\.usgs\.gov/, usgs(USGS_FIJI, USGS_PNG)], [/gempaterkini/, BMKG_TERKINI], [/datagempa/, BMKG_DATAGEMPA]]),
      snapshot: null,
    });
    expect(res.statuses.map((s) => s.status)).toEqual(['live', 'live', 'live']);
    expect(res.events).toHaveLength(5);
    expect(res.events.every((q) => q.dataMode === 'live')).toBe(true);
    expect(res.events[0].timeISO >= res.events[1].timeISO).toBe(true);
  });

  it('falls back to the HISTORICAL snapshot per feed and never throws', async () => {
    const res = await loadQuakes({ fetchImpl: fetchFrom([]) });
    expect(res.statuses.every((s) => s.status === 'snapshot')).toBe(true);
    expect(res.statuses[0].message).toMatch(/HISTORICAL snapshot/);
    expect(res.events.length).toBeGreaterThan(0);
    expect(res.events.every((q) => q.dataMode === 'historical')).toBe(true);
  });

  it('reports unavailable (never "no earthquakes") when there is no snapshot either', async () => {
    const res = await loadQuakes({ fetchImpl: fetchFrom([]), snapshot: null });
    expect(res.events).toEqual([]);
    expect(res.statuses.every((s) => s.status === 'unavailable')).toBe(true);
    expect(res.statuses[0].message).toMatch(/not an all-clear/);
  });

  it('bundled snapshot parses: every USGS event in the box and M4.5+', () => {
    expect(BUNDLED_QUAKES_SNAPSHOT.capturedAt).toMatch(/Z$/);
    const res = loadQuakesSnapshot(BUNDLED_QUAKES_SNAPSHOT);
    const u = res.events.filter((q) => q.source === 'USGS');
    expect(u.length).toBeGreaterThan(0);
    expect(u.every((q) => q.magnitude >= 4.5 && inQuakeBox(q.lat, q.lon) && q.lon >= -180 && q.lon < 180)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BMKG datagempa origin time (QC finding L1). In InaTEWS tsunami messages (PD-1..PD-4) eventid is the
// SEND time, not the origin; the origin is info.date + info.time (WIB, UTC+7). Built from the bundled
// last30tsunamievent.xml: each <info> carries the same fields datagempa.json does.

describe('BMKG datagempa origin time', () => {
  const xml = BUNDLED_WARNINGS_SNAPSHOT.feeds['bmkg-inatews'].raw as string;
  const infos = xmlBlocks(xml, 'info').map((b) => b.replace(/<(wzarea|obsarea)(?:\s[^>]*)?>[\s\S]*?<\/>/g, ''));
  /** datagempa.json shape from one InaTEWS <info>. */
  const asDatagempa = (info: string) => ({
    identifier: `x-${xmlText(info, 'eventid')}`,
    sent: xmlText(info, 'timesent'),
    info: {
      date: xmlText(info, 'date'),
      time: xmlText(info, 'time'),
      point: { coordinates: xmlText(info, 'coordinates') },
      magnitude: xmlText(info, 'magnitude'),
      depth: xmlText(info, 'depth'),
      area: xmlText(info, 'area'),
      eventid: xmlText(info, 'eventid'),
      subject: xmlText(info, 'subject'),
      potential: xmlText(info, 'potential'),
    },
  });
  /** Independent check: "DD-MM-YY" + "hh:mm:ss WIB" minus 7 hours. */
  const expectedOrigin = (date: string, time: string) => {
    const [d, m, y] = date.split('-').map(Number);
    const [hh, mm, ss] = time.replace(/\s*WIB$/i, '').split(':').map(Number);
    return new Date(Date.UTC(y < 100 ? 2000 + y : y, m - 1, d, hh - 7, mm, ss)).toISOString().replace('.000Z', 'Z');
  };

  it('uses info.date/info.time, not eventid, for every bundled PD message', () => {
    const pd = infos.filter((i) => /PD-/.test(xmlText(i, 'subject') ?? ''));
    expect(pd.length).toBeGreaterThan(0);
    let differ = 0;
    for (const info of pd) {
      const [q] = parseBmkgDatagempa(asDatagempa(info), { dataMode: 'historical' });
      expect(q.timeISO).toBe(expectedOrigin(xmlText(info, 'date')!, xmlText(info, 'time')!));
      const eventidAsUtc = expectedOrigin(
        `${xmlText(info, 'eventid')!.slice(6, 8)}-${xmlText(info, 'eventid')!.slice(4, 6)}-${xmlText(info, 'eventid')!.slice(0, 4)}`,
        `${xmlText(info, 'eventid')!.slice(8, 10)}:${xmlText(info, 'eventid')!.slice(10, 12)}:${xmlText(info, 'eventid')!.slice(12, 14)}`,
      );
      if (eventidAsUtc !== q.timeISO) differ += 1;
    }
    // The bug was real in the bundled data: at least one PD message's eventid is not its origin.
    expect(differ).toBeGreaterThan(0);
  });

  it('a PD message dedupes against the gempaterkini record of the same quake', () => {
    const info = infos.find((i) => /PD-4/.test(xmlText(i, 'subject') ?? ''))!;
    const [dg] = parseBmkgDatagempa(asDatagempa(info), { dataMode: 'historical' });
    const terkini = { ...dg, id: `bmkg-gempaterkini:${dg.timeISO.replace(/\D/g, '').slice(0, 14)}`, product: 'BMKG gempaterkini (latest 15, M 5.0+)' };
    const all = combineQuakes([], [terkini], [dg]);
    expect(all.filter((q) => q.source === 'BMKG')).toHaveLength(1);
  });

  it('the bundled datagempa (a felt message) keeps its time: there eventid and date/time agree', () => {
    const raw = BUNDLED_QUAKES_SNAPSHOT.feeds['bmkg-datagempa']!.raw as { info: { date: string; time: string } };
    const [q] = parseBmkgDatagempa(raw, { dataMode: 'historical' });
    expect(q.timeISO).toBe(expectedOrigin(raw.info.date, raw.info.time));
  });

  it('falls back to eventid when date/time are missing', () => {
    const info = infos[0];
    const raw = asDatagempa(info);
    const [q] = parseBmkgDatagempa({ ...raw, info: { ...raw.info, date: null, time: null } }, { dataMode: 'historical' });
    const e = raw.info.eventid!;
    expect(q.timeISO).toBe(expectedOrigin(`${e.slice(6, 8)}-${e.slice(4, 6)}-${e.slice(0, 4)}`, `${e.slice(8, 10)}:${e.slice(10, 12)}:${e.slice(12, 14)}`));
  });
});
