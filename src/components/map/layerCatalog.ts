// The one list of map layers (docs/UX_V3.md section 2): at most six are chips above the scrubber; every
// layer appears in the workspace Layers section with a one-line explanation. App owns the state; MapView
// and the Layers section both read this catalog, so adding a layer is one entry here plus its drawing.
// Pure, tested.

export type LayerKey =
  | 'haze'
  | 'particles'
  | 'fires'
  | 'watch'
  | 'warnings'
  | 'satIr'
  | 'satTrue'
  | 'transport'
  | 'nea'
  | 'rings'
  | 'ash'
  | 'tsunami'
  | 'tsunamiHistory'
  | 'quakes'
  | 'tide'
  | 'gauges'
  | 'river'
  | 'buildings';

export type LayerKind = 'modelled' | 'measured' | 'official' | 'satellite' | 'reference' | 'scenario';

export interface LayerDef {
  key: LayerKey;
  /** Full label for the Layers section. */
  label: string;
  /** Short label for the map chip (only when `chip` is true). */
  chipLabel?: string;
  /** One plain sentence: what it shows, where it comes from, what it is not. */
  explanation: string;
  kind: LayerKind;
  group: 'Haze and wind' | 'Fires and volcanoes' | 'Official' | 'Water' | 'Earth' | 'Imagery';
  /** One of the at most six chips above the scrubber. */
  chip?: boolean;
  /** Shown only in the Layers section when this is true. */
  advanced?: boolean;
}

export const LAYER_CATALOG: readonly LayerDef[] = [
  {
    key: 'haze',
    label: 'Haze (modelled PM2.5) and city circles',
    chipLabel: 'Haze',
    explanation: 'CAMS fine-particle forecast via Open-Meteo as a soft cloud, with each city circle sized and coloured by its modelled PM2.5. Not an official air-quality index.',
    kind: 'modelled',
    group: 'Haze and wind',
    chip: true,
  },
  {
    key: 'particles',
    label: 'Wind particles (modelled, 925 hPa)',
    chipLabel: 'Wind',
    explanation: 'Animated trails following the forecast wind about 800 m up, the level that carries regional smoke. Open-Meteo, modelled.',
    kind: 'modelled',
    group: 'Haze and wind',
    chip: true,
  },
  {
    key: 'fires',
    label: 'Fire hotspots (NASA FIRMS)',
    chipLabel: 'Fires',
    explanation: 'Satellite heat detections from VIIRS and MODIS, sized by fire radiative power. Detections, not confirmed fires; cloud and smoke hide hotspots.',
    kind: 'measured',
    group: 'Fires and volcanoes',
    chip: true,
  },
  {
    key: 'watch',
    label: 'Volcanoes and watch areas',
    chipLabel: 'Volcanoes',
    explanation: 'The watched volcanoes as triangles, ringed in the colour of the official MAGMA level (shown verbatim on hover), plus the Riau haze watch box.',
    kind: 'official',
    group: 'Fires and volcanoes',
    chip: true,
  },
  {
    key: 'warnings',
    label: 'Official warnings',
    chipLabel: 'Warnings',
    explanation: 'Red pins for official messages in force, relayed verbatim (BMKG, JMA, GeoNet, NWS, PTWC, flood agencies); dashed circles for GDACS impact estimates, which are not warnings. Ended messages stay in the Warnings section.',
    kind: 'official',
    group: 'Official',
    chip: true,
  },
  {
    key: 'satIr',
    label: 'Clouds: Himawari-9 infrared satellite image',
    chipLabel: 'Clouds',
    explanation: 'Cloud-top image from the Himawari-9 weather satellite, about 10 minutes per frame and roughly 45 minutes behind. NASA GIBS and JMA.',
    kind: 'satellite',
    group: 'Imagery',
    chip: true,
  },
  {
    key: 'satTrue',
    label: 'Satellite: true colour (yesterday)',
    explanation: 'A daily true-colour photo from VIIRS (yesterday, UTC). Smoke shows as grey streaks. NASA GIBS.',
    kind: 'satellite',
    group: 'Imagery',
    advanced: true,
  },
  {
    key: 'transport',
    label: 'Haze paths (modelled, 10 m wind)',
    explanation: 'Illustrative 48 h forward paths from fire clusters along the surface wind, with a dot every 12 h. Not a dispersion model.',
    kind: 'modelled',
    group: 'Haze and wind',
    advanced: true,
  },
  {
    key: 'nea',
    label: 'Measured haze and wind, Singapore (NEA)',
    explanation: 'NEA station wind as an arrow at Singapore and the 24-hour PSI by region when zoomed in. Measured, not modelled; shown apart from the forecast.',
    kind: 'measured',
    group: 'Haze and wind',
    advanced: true,
  },
  {
    key: 'rings',
    label: 'Distance rings around the selected volcano',
    explanation: 'Reference distances of 3, 5, 10 and 15 km from the summit. Distance only; the agency hazard map is the authority.',
    kind: 'reference',
    group: 'Fires and volcanoes',
    advanced: true,
  },
  {
    key: 'ash',
    label: 'Ash drift lines (modelled, three heights)',
    explanation: 'Where ash would drift over 24 h with the forecast wind at 3, 5.5 and 9 km altitude, using the wind at the summit for the whole path. Not an ash advisory.',
    kind: 'modelled',
    group: 'Fires and volcanoes',
    advanced: true,
  },
  {
    key: 'tsunami',
    label: 'Tsunami warning areas (BMKG InaTEWS)',
    explanation: 'The districts named in the BMKG tsunami message in force, with their verbatim levels, placed at district centres (approximate).',
    kind: 'official',
    group: 'Official',
    advanced: true,
  },
  {
    key: 'tsunamiHistory',
    label: 'Show the last BMKG tsunami message even when it has ended',
    explanation: 'History only: the most recent BMKG message with warning areas, labelled with its real issue time and ended state.',
    kind: 'official',
    group: 'Official',
    advanced: true,
  },
  {
    key: 'tide',
    label: 'Tide gauges (IOC sea-level stations)',
    explanation: 'Raw water-level gauges from the IOC Sea Level Station Monitoring Facility; click one for its last 24 h. Includes the normal tide; not a tsunami warning.',
    kind: 'measured',
    group: 'Water',
    advanced: true,
  },
  {
    key: 'gauges',
    label: 'Flood gauges at or above the bank (agencies)',
    explanation: 'River and canal gauges that ThaiWater, DSDA Jakarta and PUB report at or above their own thresholds, as small squares with the agency situation text verbatim on hover. Official relays, kept off the calm map by default.',
    kind: 'official',
    group: 'Water',
    advanced: true,
  },
  {
    key: 'river',
    label: 'River flow (modelled, GloFAS)',
    explanation: 'Modelled discharge at four river points from GloFAS via Open-Meteo, 15 days. Not a gauge reading and not a flood warning.',
    kind: 'modelled',
    group: 'Water',
    advanced: true,
  },
  {
    key: 'quakes',
    label: 'Earthquakes (USGS M4.5+ for 7 days, and BMKG latest lists)',
    explanation: 'USGS as filled discs, BMKG as rings, sized by magnitude and coloured by depth (amber under 70 km, teal 70 to 300 km, violet deeper). The BMKG lists include smaller and older events. Brighter marks are from the last 24 h; when the feeds are unreachable the saved snapshot is shown and the Sources section says so. Not a tsunami warning.',
    kind: 'measured',
    group: 'Earth',
    advanced: true,
  },
  {
    key: 'buildings',
    label: '3D buildings (street zoom only)',
    explanation: 'Building extrusions from the basemap tiles, visible from zoom 15. Decorative.',
    kind: 'reference',
    group: 'Imagery',
    advanced: true,
  },
];

export interface MapLayerState extends Record<LayerKey, boolean> {
  /** Opacity of the satellite rasters, 0.2 to 1. */
  satOpacity: number;
}

export const DEFAULT_LAYERS: MapLayerState = {
  haze: true,
  particles: true,
  fires: true,
  watch: true,
  warnings: true,
  satIr: false,
  satTrue: false,
  transport: false,
  nea: false,
  rings: true,
  ash: false,
  tsunami: true,
  tsunamiHistory: false,
  quakes: false,
  tide: false,
  gauges: false,
  river: false,
  buildings: false,
  satOpacity: 0.75,
};

/** The chips above the scrubber, in catalog order. Never more than six. */
export const MAP_CHIPS: readonly LayerDef[] = LAYER_CATALOG.filter((l) => l.chip);

export const LAYER_GROUPS: readonly LayerDef['group'][] = ['Haze and wind', 'Fires and volcanoes', 'Official', 'Water', 'Earth', 'Imagery'];

export function layersInGroup(group: LayerDef['group']): LayerDef[] {
  return LAYER_CATALOG.filter((l) => l.group === group);
}

export const LAYER_KIND_LABEL: Record<LayerKind, string> = {
  modelled: 'MODELLED',
  measured: 'MEASURED',
  official: 'OFFICIAL',
  satellite: 'SATELLITE',
  reference: 'REFERENCE',
  scenario: 'MODELLED SCENARIO',
};
