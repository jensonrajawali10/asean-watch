# Data sources and provenance

All references were accessed on 13 October 2026.

Every observation in `demo-events.json` and every incident in `incidents.json` is **simulated** (`dataMode: "simulated"`). Each record is a fixture written for the demo. It is modelled on the kind of product named in its `sourceName`. No value was downloaded, measured, or derived from a real satellite granule, scene, orbit, or acquisition, and no such identifier appears anywhere in the fixtures. Each `sourceUrl` points to a public page that describes the product type, not to a specific record.

Scenario dates are fictional and serve only as a replay clock. The Merapi coordinates identify the real volcano, but the scenario does not describe its current or past activity. The fixtures attribute no statement to any real agency or observatory, and they state no official alert level. Anomaly flags and thresholds are configured in the fixtures for illustration only. They are not scientific or official thresholds.

## Volcano catalog (`volcanoes.json`)

| Fact | Value | Confirmed by |
|---|---|---|
| Name | Merapi | GVP WFS record (below) |
| Volcano number | 263250 | GVP WFS record |
| Country | Indonesia | GVP WFS record |
| Region / subregion | Sunda-Banda Volcanic Regions / Sunda Volcanic Arc | GVP WFS record |
| Latitude, longitude | -7.54, 110.446 | GVP WFS record; also the search-index text of the GVP page (7.54°S, 110.446°E) |
| Summit elevation | 2910 m | GVP WFS record; also the search-index text of the GVP page (2,910 m) |

- **Catalog page (cited in the app):** Smithsonian Institution, Global Volcanism Program, *Volcanoes of the World*, Merapi (263250). https://volcano.si.edu/volcano.cfm?vn=263250
  - The page returned a bot-verification challenge (HTTP 403) to automated fetches during the build, so its HTML could not be read directly. Nothing was done to get past the challenge.
- **Machine-readable confirmation:** the GVP's own public GeoServer service, which publishes the same Volcanoes of the World Holocene volcano list. https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json&CQL_FILTER=Volcano_Number=263250

## Product reference pages used as `sourceUrl`

| Used by | Product the fixture is modelled on | URL | Status |
|---|---|---|---|
| `obs-merapi-thermal-baseline-01`, `obs-merapi-thermal-viirs-01`, `obs-riau-thermal-viirs-01` | NASA FIRMS VIIRS 375 m active fire detections | https://firms.modaps.eosdis.nasa.gov/content/active_fire/ | Resolves. "Active Fire Data" page covering MODIS and VIIRS 375 m detections and near-real-time latency. |
| `obs-merapi-thermal-modis-01` | NASA FIRMS MODIS 1 km active fire detections | https://firms.modaps.eosdis.nasa.gov/content/active_fire/ | Resolves (same page). |
| `obs-merapi-gas-baseline-01`, `obs-merapi-gas-tropomi-01` | Copernicus Sentinel-5P TROPOMI Level 2 sulfur dioxide | https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel5P.html | Resolves. Copernicus Data Space Ecosystem documentation listing the Sentinel-5P SO2 and UV aerosol index products. |
| `obs-riau-report-haze-01` | Copernicus Sentinel-5P TROPOMI UV aerosol index | https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel5P.html | Resolves (same page). |
| `obs-merapi-deformation-baseline-01` | Copernicus Sentinel-1 radar interferometry (InSAR) | https://www.esa.int/Applications/Observing_the_Earth/Earth_s_most_active_volcanoes_on_satellite_watch | Resolves. ESA article on volcano monitoring with Sentinel-1 radar, which can be acquired at night and in cloudy conditions. |
| `obs-ayutthaya-report-extent-01` | Copernicus Sentinel-1 C-band SAR imagery (water-extent review) | https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel1.html | Resolves. Copernicus Data Space Ecosystem documentation for Sentinel-1 all-weather, day-and-night radar imaging. |
| `obs-ayutthaya-report-rainfall-01` | NASA GPM IMERG Early Run precipitation estimate | https://gpm.nasa.gov/data/imerg | Resolves. NASA GPM page describing IMERG and its Early, Late and Final runs. |

## Background references (quality-note wording, not used as `sourceUrl`)

- Copernicus Data Space Ecosystem, "About the Browser". https://documentation.dataspace.copernicus.eu/Applications/Browser.html. Resolves; lists Sentinel-1 and Sentinel-5P among browsable collections.
- USGS Hawaiian Volcano Observatory, "Volcano Watch: Inflating volcanoes or cloudy data? Discerning deformation from noise with InSAR" (3 November 2022). https://www.usgs.gov/observatories/hvo/news/volcano-watch-inflating-volcanoes-or-cloudy-data-discerning-deformation. **Not confirmed by automated fetch:** the site returned a CAPTCHA page (HTTP 405). A web search index lists the page at this URL. It supports the InSAR caveat (atmospheric noise can mimic deformation), which the deformation quality note uses.

## Incident locations (`incidents.json`)

| Incident | Coordinates | Basis |
|---|---|---|
| `inc-merapi-demo` | -7.54, 110.446 | Smithsonian GVP (above) |
| `inc-riau-haze-demo` | 0.50, 102.55 | Central point of Key Biodiversity Area "Hutan Rawa Gambut Siak-Kampar" (peat swamp between the Siak and Kampar rivers, Riau). https://www.keybiodiversityareas.org/site/factsheet/15811 |
| `inc-ayutthaya-flood-demo` | 14.35, 100.56 | Phra Nakhon Si Ayutthaya city (14°20′52″N 100°33′38″E), where the Chao Phraya, Pa Sak and Lopburi rivers meet. https://en.wikipedia.org/wiki/Phra_Nakhon_Si_Ayutthaya_(city) |

The coordinates place each example at a real location. The events themselves are simulated.

## Map geometry

`data/region.geojson` comes from Natural Earth (public domain) through the `world-atlas` npm package. The map builder generates that file with `scripts/build-region.mjs`.
