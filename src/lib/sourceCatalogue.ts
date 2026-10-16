// Every feed the app uses, with its issuer, licence or attribution, mode (live, snapshot, recorded, link),
// retrieval time and limitations, grouped as Official, Measured, Modelled, Imagery and Reference. Pure:
// statuses and times come from the loaded data (SituationInput), never from the clock. Used by the
// Sources section and by the report export. Licence wording follows data/SOURCES.md and
// docs/DATA_AND_LIMITATIONS.md, and the attribution constants exported by each adapter.
import type { WarningFeedStatus } from '../types';
import { AQ_ATTRIBUTION, AQ_MODEL, AQ_SOURCE_URL, PM25_BANDS_NOTE } from './airQuality';
import { ASH_WIND_ATTRIBUTION } from './ashDrift';
import { FLOOD_MODEL_ATTRIBUTION, FLOOD_MODEL_NOTE } from './floodModel';
import { GIBS_ATTRIBUTION, HIMAWARI_ATTRIBUTION } from './gibs';
import { NEA_LICENCE_URL, NEA_SOURCE_URL } from './nea';
import { PTWC_ATTRIBUTION, PTWC_LATEST_ONLY_NOTE, PTWC_NATIONAL_AUTHORITIES_NOTE } from './ptwc';
import { QUAKE_SOURCES, USGS_TSUNAMI_FLAG_NOTE } from './quakesLive';
import { BUNDLED_SEA_LEVEL_SNAPSHOT, SEA_LEVEL_ATTRIBUTION, SEA_LEVEL_NOTE } from './seaLevel';
import { ASMC, FIRMS_PAGE, NUS_CRISP } from './situation';
import type { SituationInput } from './situation';
import { GEOBOUNDARIES_ATTRIBUTION } from './tsunamiAreas';
import { OPEN_METEO_FORECAST_URL, WIND_ATTRIBUTION } from './windField';

export type SourceGroup = 'Official' | 'Measured' | 'Modelled' | 'Imagery' | 'Reference';

export const SOURCE_GROUPS: ReadonlyArray<{ group: SourceGroup; blurb: string }> = [
  {
    group: 'Official',
    blurb:
      'Agencies with authority. Their messages are relayed word for word in the reserved red style and never re-scored; ' +
      'when a feed fails, the app says "Official feed unavailable: check <issuer> directly", never "no warnings".',
  },
  {
    group: 'Measured',
    blurb: 'Station and satellite measurements: real observations, with their own limits (cloud, coverage, preliminary processing).',
  },
  {
    group: 'Modelled',
    blurb: 'Forecast-model output and our own illustrative computations. Context only: never evidence, never a warning.',
  },
  { group: 'Imagery', blurb: 'Satellite pictures shown for orientation. Imagery is not a measurement.' },
  { group: 'Reference', blurb: 'Catalogues, boundaries and basemaps that place everything on the map.' },
];

export interface SourceEntry {
  id: string;
  group: SourceGroup;
  name: string;
  issuer: string;
  url: string;
  /** "LIVE", "LIVE (cached)", "SNAPSHOT", "RECORDED COPY", "UNAVAILABLE", "LIVE TILES", "LINK ONLY", "BUNDLED", "NOT LOADED". */
  mode: string;
  /** The adapter's own status text, when it gave one. */
  modeNote: string | null;
  /** ISO 8601 UTC retrieval or capture time; null when not applicable or unknown. */
  retrievedAt: string | null;
  licence: string;
  usedFor: string;
  limitations: string[];
}

function statusMode(status: WarningFeedStatus['status'] | 'live' | 'cached' | 'snapshot' | 'unavailable'): string {
  if (status === 'live') return 'LIVE';
  if (status === 'cached') return 'LIVE (cached)';
  if (status === 'snapshot') return 'SNAPSHOT';
  return 'UNAVAILABLE';
}

const BMKG_LICENCE =
  'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika). BMKG Data Terbuka terms require BMKG to be credited in the app; 60 requests per minute per IP.';

/** Licence and limitations for each official feed id (docs/DATA_AND_LIMITATIONS.md). */
const FEED_FACTS: Record<string, { name: string; licence: string; usedFor: string; limitations: string[] }> = {
  'bmkg-inatews': {
    name: 'BMKG InaTEWS tsunami messages (last30tsunamievent.xml)',
    licence: BMKG_LICENCE,
    usedFor: 'Tsunami warnings for Indonesia, warning areas and observed tide-gauge heights, verbatim.',
    limitations: ['Times are WIB (UTC+7), converted to UTC.', 'Indonesian text shown as issued, with fixed reviewed glosses; never machine-translated.'],
  },
  'bmkg-gempa': {
    name: 'BMKG InaTEWS latest earthquake message (datagempa.json)',
    licence: BMKG_LICENCE,
    usedFor: 'The latest BMKG earthquake message, verbatim.',
    limitations: ['Holds only the latest message.', 'Indonesian text shown as issued.'],
  },
  'jma-tsunami': {
    name: 'Japan Meteorological Agency tsunami warnings and forecasts',
    licence: 'JMA Public Data License v1.0.',
    usedFor: 'Tsunami warnings, advisories and forecasts for Japan, verbatim.',
    limitations: ['Japanese text shown as issued, with fixed reviewed glosses.'],
  },
  'jma-volcano': {
    name: 'Japan Meteorological Agency volcanic warnings',
    licence: 'JMA Public Data License v1.0.',
    usedFor: 'Volcanic alert levels for Japan, verbatim.',
    limitations: ['Japanese text shown as issued, with fixed reviewed glosses for alert levels.'],
  },
  'geonet-val': {
    name: 'GeoNet volcanic alert levels',
    licence: 'CC BY 3.0 NZ.',
    usedFor: 'Volcanic alert levels for New Zealand, verbatim.',
    limitations: ['The alert level carries no timestamp, so the retrieval time is shown instead.', 'Level 0 is not relayed.'],
  },
  'nws-tsunami': {
    name: 'US National Weather Service tsunami alerts (Hawaii, Guam, CNMI, American Samoa)',
    licence: 'US Government work (public domain).',
    usedFor: 'Tsunami warnings, advisories and watches for US Pacific territories, verbatim.',
    limitations: ['Covers US Pacific territories only.'],
  },
  gdacs: {
    name: 'GDACS event list (earthquakes, tsunamis, volcanoes, floods, cyclones)',
    licence: 'Terms ambiguous: its feeds say both "public domain" and "Copyright, GDACS".',
    usedFor: 'Cross-hazard context, shown in a separate dashed "impact estimate" style.',
    limitations: ['An aggregator: its alert colours are model-based impact estimates, not official warnings.'],
  },
  'magma-level-list': {
    name: 'PVMBG volcano activity levels (MAGMA Indonesia public level list)',
    licence: 'MAGMA Indonesia states all rights reserved; the app shows the recorded levels of the watched volcanoes with a link and does not ingest bulk data.',
    usedFor: 'Official volcano levels for Merapi, Semeru, Anak Krakatau and Sinabung, verbatim.',
    limitations: ["A recorded copy, not a live feed: MAGMA's API is token-only and no refresh updates it.", 'Check MAGMA for the current level before presenting.'],
  },
  thaiwater: {
    name: 'ThaiWater water levels (Hydro-Informatics Institute; RID gauges)',
    licence: 'Attributed on screen; terms not found.',
    usedFor: 'Gauges at situation level 5 ("overflowing bank") relayed as flood messages; every gauge kept as a reading.',
    limitations: ['A ThaiWater situation level is a gauge category, not an evacuation order.', 'Times are ICT (UTC+7), converted to UTC.'],
  },
  'dsda-jakarta': {
    name: 'Jakarta DSDA Posko Banjir floodgate levels',
    licence: 'Attributed on screen; terms not found.',
    usedFor: 'Floodgate water levels and Siaga status for Jakarta, verbatim.',
    limitations: ["DSDA publishes millimetres; shown in centimetres, as DSDA's own page does.", 'Siaga 1 is the most severe of the four levels.'],
  },
  'pub-flood': {
    name: 'PUB flood alerts (via data.gov.sg)',
    licence: `Singapore Open Data Licence v1.0 (${NEA_LICENCE_URL}).`,
    usedFor: "Flood alerts from Singapore's national water agency, verbatim.",
    limitations: ["Shares data.gov.sg's keyless rate limit with the NEA feeds."],
  },
  ptwc: {
    name: 'Pacific Tsunami Warning Center latest product (Atom and CAP, via the /api/ptwc proxy)',
    licence: PTWC_ATTRIBUTION,
    usedFor: 'The latest PTWC tsunami message, verbatim.',
    limitations: [PTWC_NATIONAL_AUTHORITIES_NOTE, PTWC_LATEST_ONLY_NOTE, 'In local development the proxy does not exist, so the snapshot is shown.'],
  },
};

function feedEntry(f: WarningFeedStatus): SourceEntry {
  const facts = FEED_FACTS[f.feedId] ?? {
    name: `${f.issuer} (${f.feedId})`,
    licence: 'See the issuer.',
    usedFor: 'Official messages, verbatim.',
    limitations: [],
  };
  const recorded = f.feedId === 'magma-level-list' && f.status !== 'unavailable';
  return {
    id: `feed:${f.feedId}`,
    group: f.feedId === 'gdacs' ? 'Modelled' : 'Official',
    name: facts.name,
    issuer: f.issuer,
    url: f.issuerUrl,
    mode: recorded ? 'RECORDED COPY' : statusMode(f.status),
    modeNote: f.status === 'unavailable' ? `Official feed unavailable: check ${f.issuer} directly.` : f.message,
    retrievedAt: f.retrievedAt,
    licence: facts.licence,
    usedFor: facts.usedFor,
    limitations: facts.limitations,
  };
}

function gridMode(dataMode: 'live' | 'historical' | undefined | null): string {
  return dataMode === 'live' ? 'LIVE' : dataMode === 'historical' ? 'SNAPSHOT' : 'NOT LOADED';
}

/** Every source, in group order (Official, Measured, Modelled, Imagery, Reference). */
export function buildSourceCatalogue(input: SituationInput): SourceEntry[] {
  const out: SourceEntry[] = [];

  // --- Official
  for (const f of input.warningFeeds ?? []) out.push(feedEntry(f));
  out.push({
    id: 'asmc',
    group: 'Official',
    name: 'Regional haze situation, alert levels and hotspot maps',
    issuer: ASMC.name,
    url: ASMC.home,
    mode: 'LINK ONLY',
    modeNote: `Pages checked ${ASMC.checkedAt}: ${ASMC.alerts}, ${ASMC.hotspots}, ${ASMC.wis2Haze}.`,
    retrievedAt: null,
    licence: `ASMC terms of use (${ASMC.terms}): the site is run by the Meteorological Service Singapore (NEA); reproducing or republishing its content needs written permission, so ASEAN Watch links to it and does not copy it.`,
    usedFor: 'The regional authority for transboundary haze: the daily regional haze situation and the alert level for each sub-region.',
    limitations: [
      "Not ingested: ASMC publishes its alert banner and daily haze situation as web pages; its RSS feed and hotspot files only allow browser calls from ASMC's own site; and its WIS2 'regional haze' item is a map image, not figures.",
      "Check ASMC's Warnings and Alerts page for the current level before writing a report.",
    ],
  });

  // --- Measured
  const nea = input.nea ?? null;
  out.push({
    id: 'nea',
    group: 'Measured',
    name: 'NEA 24-hour PSI, 1-hour PM2.5 and station wind (data.gov.sg real-time APIs)',
    issuer: 'National Environment Agency, Singapore',
    url: nea?.sourceUrl ?? NEA_SOURCE_URL,
    mode: nea ? gridMode(nea.haze?.dataMode ?? nea.dataMode) : 'NOT LOADED',
    modeNote: input.neaError ?? null,
    retrievedAt: nea?.retrievedAt ?? null,
    licence: nea?.attribution ?? `Singapore Open Data Licence v1.0 (${NEA_LICENCE_URL}).`,
    usedFor: "Singapore's measured haze beside the modelled value; wind arrows near Singapore.",
    limitations: [
      'PSI is a 24-hour index over several pollutants; PM2.5 is a 1-hour concentration by region. Neither is the modelled CAMS value.',
      'Station wind describes conditions over Singapore, not along a haze path.',
      'Context only: it never changes a watch-area state.',
    ],
  });
  const firmsSources = (input.hotspotSnapshot?.sources ?? []).filter((s) => s.id.startsWith('firms-'));
  for (const s of firmsSources) {
    out.push({
      id: `firms:${s.id}`,
      group: 'Measured',
      name: s.name,
      issuer: s.provider ?? 'NASA FIRMS (LANCE)',
      url: s.productUrl ?? FIRMS_PAGE,
      mode: 'SNAPSHOT',
      modeNote: s.lastModified ? `File last modified ${s.lastModified}.` : null,
      retrievedAt: s.retrievedAt ?? input.hotspotSnapshot?.retrievedAt ?? null,
      licence: s.licence ?? 'NASA open data.',
      usedFor: 'Thermal evidence in the watch areas, and the fire clusters behind the smoke-transport paths.',
      limitations: [
        'A hotspot is a possible fire or other hot ground, not a confirmed fire or eruption.',
        'Cloud and thick smoke hide hotspots, so daily counts are lower bounds; near-real-time data are preliminary.',
        'Each satellite is counted separately, so one fire seen twice is counted twice.',
      ],
    });
  }
  if (firmsSources.length === 0 && input.hotspotSnapshot) {
    out.push({
      id: 'firms',
      group: 'Measured',
      name: 'NASA FIRMS active fire hotspots (VIIRS 375 m, MODIS 1 km), South East Asia, last 7 days',
      issuer: 'NASA FIRMS (LANCE)',
      url: FIRMS_PAGE,
      mode: 'SNAPSHOT',
      modeNote: null,
      retrievedAt: input.hotspotSnapshot.retrievedAt,
      licence: 'NASA open data; FIRMS asks for its acknowledgement.',
      usedFor: 'Thermal evidence in the watch areas.',
      limitations: ['Cloud and smoke hide hotspots; counts are lower bounds.'],
    });
  }
  const fires = input.fires ?? null;
  if (fires) {
    out.push({
      id: 'fires',
      group: 'Measured',
      name: fires.source,
      issuer: 'NASA FIRMS (LANCE)',
      url: fires.sourceUrl ?? FIRMS_PAGE,
      mode: fires.dataMode === 'live' ? 'LIVE' : 'SNAPSHOT',
      modeNote: null,
      retrievedAt: fires.asOf,
      licence: 'NASA open data; FIRMS asks for its acknowledgement.',
      usedFor: 'Regional hotspot counts and fire radiative power (the Fires section).',
      limitations: [
        'Fire radiative power is a proxy for how intensely a fire burns, not an emission measurement.',
        'Cloud and smoke hide hotspots; counts are lower bounds.',
        ...(fires.notes ?? []),
      ],
    });
  }
  const quakeStatus = new Map((input.quakes?.statuses ?? []).map((s) => [s.sourceId, s]));
  for (const key of ['usgs', 'bmkgTerkini', 'bmkgDatagempa'] as const) {
    const src = QUAKE_SOURCES[key];
    const st = quakeStatus.get(src.id) ?? null;
    out.push({
      id: `quakes:${src.id}`,
      group: 'Measured',
      name: key === 'usgs' ? 'USGS earthquakes M 4.5+, past 7 days (FDSN)' : key === 'bmkgTerkini' ? 'BMKG latest 15 earthquakes M 5.0+' : 'BMKG InaTEWS latest earthquake',
      issuer: src.name,
      url: 'pageUrl' in src ? src.pageUrl : src.url,
      mode: st ? statusMode(st.status) : 'NOT LOADED',
      modeNote: st?.message ?? null,
      retrievedAt: st?.retrievedAt ?? null,
      licence: src.attribution,
      usedFor: 'Earthquake context on the map and near the volcano watch areas.',
      limitations: [
        'Magnitudes differ between agencies and products; reports of one event are never merged.',
        ...(key === 'usgs' ? [USGS_TSUNAMI_FLAG_NOTE] : ["BMKG's lists are rolling, so older small events drop out."]),
      ],
    });
  }
  out.push({
    id: 'ioc-sea-level',
    group: 'Measured',
    name: 'IOC Sea Level Station Monitoring Facility tide gauges',
    issuer: 'Flanders Marine Institute (VLIZ) and IOC-UNESCO',
    url: 'https://www.ioc-sealevelmonitoring.org/',
    mode: 'LIVE on demand; station list BUNDLED',
    modeNote: 'Readings are fetched live when a gauge is opened; the APAC station list is a bundled capture.',
    retrievedAt: typeof BUNDLED_SEA_LEVEL_SNAPSHOT?.capturedAt === 'string' ? BUNDLED_SEA_LEVEL_SNAPSHOT.capturedAt : null,
    licence: SEA_LEVEL_ATTRIBUTION,
    usedFor: 'Raw sea level near the coast (Water section).',
    limitations: [SEA_LEVEL_NOTE],
  });

  // --- Modelled
  const aq = input.airQuality;
  out.push({
    id: 'cams',
    group: 'Modelled',
    name: `PM2.5 from the ${AQ_MODEL}`,
    issuer: 'Copernicus Atmosphere Monitoring Service (ECMWF), via the Open-Meteo Air Quality API',
    url: aq?.sourceUrl ?? AQ_SOURCE_URL,
    mode: gridMode(aq?.dataMode),
    modeNote: aq?.dataMode === 'historical' ? 'Bundled snapshot, stored every 3 hours.' : null,
    retrievedAt: aq?.retrievedAt ?? null,
    licence: aq?.attribution ?? AQ_ATTRIBUTION,
    usedFor: 'The haze layer, the city circles, the scrubber, the city table and the headline sentence.',
    limitations: [
      'A grid-cell average of about 45 km, not a point measurement: it can differ from a monitor by a large factor in either direction.',
      PM25_BANDS_NOTE,
      'Fire emissions come from satellite fire observations; fires hidden by cloud or smouldering underground can be missed.',
    ],
  });
  for (const g of [input.wind925, input.wind10m]) {
    if (!g) continue;
    out.push({
      id: /925/.test(g.level) ? 'wind-925' : 'wind-10m',
      group: 'Modelled',
      name: `Wind at ${g.level} on a 1° grid (6°S to 8°N, 95°E to 120°E)`,
      issuer: `${g.source} (${g.model})`,
      url: g.sourceUrl || OPEN_METEO_FORECAST_URL,
      mode: gridMode(g.dataMode),
      modeNote: null,
      retrievedAt: g.retrievedAt,
      licence: g.attribution || WIND_ATTRIBUTION,
      usedFor: /925/.test(g.level)
        ? 'Wind particles (the smoke-transport level, about 750 m) and the 925 hPa transport paths.'
        : 'The haze paths on the map and the 10 m transport paths.',
      limitations: ['Model wind, not measured wind; a 1° grid smooths local winds such as sea breezes.'],
    });
  }
  const ash = input.ashWind ?? null;
  out.push({
    id: 'ash-wind',
    group: 'Modelled',
    name: 'Pressure-level winds at 700, 500 and 300 hPa at each watched volcano summit',
    issuer: ash ? `${ash.source}` : 'Open-Meteo',
    url: ash?.sourceUrl ?? OPEN_METEO_FORECAST_URL,
    mode: gridMode(ash?.dataMode),
    modeNote: null,
    retrievedAt: ash?.retrievedAt ?? null,
    licence: ash?.attribution ?? ASH_WIND_ATTRIBUTION,
    usedFor: 'The "if it erupted now" ash-drift scenario.',
    limitations: [
      'A scenario, not a prediction and not an ash advisory: it uses the summit wind for the whole path and ignores plume height, fall-out and dispersion.',
      'VAAC Darwin issues the official ash advisories for Indonesia.',
    ],
  });
  const river = input.riverFlow ?? null;
  out.push({
    id: 'glofas',
    group: 'Modelled',
    name: 'GloFAS river discharge at four river points',
    issuer: 'Copernicus Emergency Management Service, via the Open-Meteo Flood API',
    url: 'https://open-meteo.com/en/docs/flood-api',
    mode: river?.status ? statusMode(river.status.status) : gridMode(river?.series[0]?.dataMode),
    modeNote: river?.status?.message ?? null,
    retrievedAt: river?.status?.retrievedAt ?? river?.series[0]?.retrievedAt ?? null,
    licence: FLOOD_MODEL_ATTRIBUTION,
    usedFor: 'Modelled river flow (Water section).',
    limitations: [FLOOD_MODEL_NOTE, 'Small urban rivers such as the Ciliwung are poorly resolved on a 0.05° grid.'],
  });
  out.push({
    id: 'trajectories',
    group: 'Modelled',
    name: 'Smoke-transport paths toward Singapore (ASEAN Watch computation)',
    issuer: 'ASEAN Watch, from the modelled wind grids and NASA FIRMS clusters',
    url: 'https://asean-watch.vercel.app/',
    mode: 'DERIVED',
    modeNote: 'Computed in the browser from the loaded wind grids; no extra download.',
    retrievedAt: null,
    licence: 'Inherits the wind and FIRMS attributions above.',
    usedFor: 'Whether air from a fire cluster could reach Singapore within 48 h.',
    limitations: [
      'Illustrative only; not a dispersion model: one level, no vertical motion, mixing, rain-out or chemistry.',
      '"Reaches" means within 75 km; it says where air could go, not how much smoke arrives.',
    ],
  });

  // --- Imagery
  out.push(
    {
      id: 'gibs-himawari',
      group: 'Imagery',
      name: 'Himawari-9 clean infrared (AHI Band 13), 10-minute scans',
      issuer: 'NASA GIBS; Himawari data from the Japan Meteorological Agency',
      url: 'https://gibs.earthdata.nasa.gov/',
      mode: 'LIVE TILES',
      modeNote: 'Requested 60 min behind real time because GIBS publishes Himawari about 40 to 60 min late.',
      retrievedAt: null,
      licence: HIMAWARI_ATTRIBUTION,
      usedFor: 'Cloud cover, which explains missing hotspots and gaps in satellite coverage.',
      limitations: ['Cloud-top brightness temperature: not a rain, haze or ash product.'],
    },
    {
      id: 'gibs-truecolour',
      group: 'Imagery',
      name: 'True colour daily mosaics (VIIRS NOAA-20 and MODIS Terra corrected reflectance)',
      issuer: 'NASA GIBS',
      url: 'https://gibs.earthdata.nasa.gov/',
      mode: 'LIVE TILES',
      modeNote: "Yesterday's complete UTC-day mosaic.",
      retrievedAt: null,
      licence: GIBS_ATTRIBUTION,
      usedFor: 'Seeing smoke plumes and haze for orientation.',
      limitations: ['Polar-orbit passes once a day; swath gaps near the equator are normal. Imagery, not a measurement.'],
    },
    {
      id: 'nus-crisp',
      group: 'Imagery',
      name: 'Satellite images of the region and hotspot maps for Sumatra, Kalimantan and Malaysia',
      issuer: NUS_CRISP.name,
      url: NUS_CRISP.url,
      mode: 'LINK ONLY',
      modeNote: 'The site answered scripted checks on 15 Oct 2026 with a security check, so its current pages were not verified.',
      retrievedAt: null,
      licence: 'See CRISP; nothing is copied into ASEAN Watch.',
      usedFor: 'Independent satellite imagery for analysts writing reports.',
      limitations: ['Not ingested; availability and coverage not verified here.'],
    },
  );

  // --- Reference
  out.push(
    {
      id: 'gvp',
      group: 'Reference',
      name: 'Volcanoes of the World (Holocene list)',
      issuer: 'Smithsonian Institution Global Volcanism Program',
      url: 'https://volcano.si.edu/',
      mode: 'BUNDLED',
      modeNote: 'Queried 13 Oct 2026 from the GVP GeoServer service.',
      retrievedAt: '2026-10-13T07:12:00Z',
      licence: 'Global Volcanism Program, Volcanoes of the World, Smithsonian Institution (terms page blocked to scripts).',
      usedFor: 'Summit points, names and volcano numbers.',
      limitations: ['GVP catalogues Anak Krakatau under Krakatau (262000); that point may not mark the active cone exactly.'],
    },
    {
      id: 'geoboundaries',
      group: 'Reference',
      name: 'Indonesian district centres (IDN ADM2, 2020)',
      issuer: 'geoBoundaries (Runfola et al. 2020), from BPS, WFP and OCHA ROAP',
      url: 'https://www.geoboundaries.org/',
      mode: 'BUNDLED',
      modeNote: null,
      retrievedAt: null,
      licence: `${GEOBOUNDARIES_ATTRIBUTION}.`,
      usedFor: 'Approximate positions for BMKG tsunami warning areas.',
      limitations: ['District centres, not coastlines: the positions are approximate.'],
    },
    {
      id: 'natural-earth',
      group: 'Reference',
      name: 'Country boundaries (offline outline map)',
      issuer: 'Natural Earth, via the world-atlas package',
      url: 'https://www.naturalearthdata.com/',
      mode: 'BUNDLED',
      modeNote: null,
      retrievedAt: null,
      licence: 'Public domain.',
      usedFor: 'The outline map when the basemap cannot load.',
      limitations: ['Boundaries are generalised; not an authority on borders.'],
    },
    {
      id: 'basemaps',
      group: 'Reference',
      name: 'Basemaps: CARTO Dark Matter (dark) and OpenFreeMap positron (light)',
      issuer: 'CARTO; OpenFreeMap; OpenStreetMap contributors',
      url: 'https://carto.com/attributions',
      mode: 'LIVE TILES',
      modeNote: null,
      retrievedAt: null,
      licence: '© CARTO © OpenStreetMap contributors. CARTO free basemaps are for non-commercial use within their view limits.',
      usedFor: 'The map background.',
      limitations: [],
    },
  );
  return out;
}

/** Entries grouped in SOURCE_GROUPS order (empty groups omitted). */
export function groupSources(entries: readonly SourceEntry[]): Array<{ group: SourceGroup; blurb: string; entries: SourceEntry[] }> {
  return SOURCE_GROUPS.map((g) => ({ ...g, entries: entries.filter((e) => e.group === g.group) })).filter((g) => g.entries.length > 0);
}
