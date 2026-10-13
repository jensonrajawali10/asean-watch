# Data and limitations

What the prototype's data is, how it is labelled, what it cannot tell you, and what a real service would need. Bracketed numbers refer to the [references](#references) at the end.

## Satellite signals for volcano monitoring

USGS identifies four principal types of satellite observation for volcanoes: deformation and surface change, gas emissions, thermal anomalies, and ash plumes [1]. These observations support monitoring and expert assessment. A detected anomaly on its own does not establish that an eruption will occur.

| Signal | Candidate source | Sprint treatment |
|---|---|---|
| Ground deformation | Sentinel-1 radar and InSAR [2][3] | One simulated, non-anomalous deformation record in the Merapi baseline. No radar pairs are processed and no displacement series is presented as a measured product. |
| Volcanic gas | Sentinel-5P sulfur dioxide [5] | One simulated sulfur dioxide anomaly at replay step 2. No historical gas product is included. |
| Thermal anomaly | VIIRS or MODIS thermal detections, distributed by NASA FIRMS [6] | Two simulated thermal anomalies from different sensors at replay step 1; only the first counts. The static wildfire and haze example also carries one simulated thermal anomaly. No FIRMS sample file is included. |
| Ash and surface change | Optical or meteorological imagery | Not part of the demo scenario. The `ash` category exists in the data schema, but no imagery is shown, and no schematic is presented as satellite imagery. |

The build plan allowed optional real samples (a FIRMS extract, a historical gas example) under a strict time limit. The implementation contract makes every sprint record simulated, so none are included.

## Data in this repository

| File | Contents | Status |
|---|---|---|
| `data/volcanoes.json` | Merapi: GVP volcano number 263250, latitude -7.54, longitude 110.446 | Real, from the Smithsonian Global Volcanism Program [4] |
| `data/incidents.json` | The Merapi demo incident and two static examples (wildfire and haze, flood) | Simulated scenarios |
| `data/demo-events.json` | Merapi replay steps with a fictional scenario clock, and every observation record | Simulated |
| `data/region.geojson` | Country boundaries for the regional map, built by `npm run build:region` | Natural Earth (public domain), via the `world-atlas` package |
| `data/SOURCES.md` | Source and attribution for each fixture | Reference list |

The coordinates identify the real volcano. The scenario does not describe Merapi's current activity.

## Label policy

These rules keep the demo from being mistaken for real monitoring output.

- **DEMO REPLAY banner.** The page banner stays visible at all times.
- **Data mode in text.** Every record shows SIMULATED, HISTORICAL, or LIVE as a text label, not as colour alone. In the sprint every record is SIMULATED. A historical record would stay HISTORICAL even when replayed.
- **No fabricated identifiers.** No satellite granule, scene, or acquisition identifier is invented. A record's source name states the product type it is modelled on (for example, a simulated fixture modelled on VIIRS 375 m active fire detections), and its link points to the public page describing that product, not to a specific record.
- **No simulated value presented as measured.** No simulated chart or value is shown as a measured product.
- **No official alert levels.** Monitoring, Check observation, and Review needed are analyst workflow labels. Any official agency alert level added later must show its own source and publication time.
- **Observation time vs ingestion time.** Each record carries the time the sensor or reporter observed it and, separately, the time the platform received it. Both are shown, in ISO 8601 UTC.
- **Anomalies are configured, not computed.** Each anomaly flag is set in the fixture with a stated reason. The app does not infer anomalies from values.

## Validation

At startup, fixture records are checked. A record is dropped, with a readable message, if its id is missing, its incident is unknown, its category or data mode is not recognised, a timestamp is unparseable or not UTC, a numeric value is not finite or has no unit, or its replay step is not a non-negative integer. When two records share an id, the first is kept and the duplicate is ignored. Validation issues are listed in the brief.

## Limitations

- **An anomaly is not an eruption.** Satellite anomalies indicate change worth reviewing. They do not establish that an eruption will occur, when, or how large [1].
- **Hotspots can have other causes.** A thermal detection near a volcano may come from vegetation or agricultural fires, industrial heat sources, or other surface heating. It needs contextual review [6].
- **Cloud obscures optical and thermal views.** Optical imagery and many thermal detections fail under cloud, which is frequent over tropical volcanoes. Radar can observe through cloud and at night [2], but it measures different things.
- **InSAR atmospheric artefacts.** InSAR measures change between two acquisitions. Atmospheric water vapour and other effects can produce patterns that resemble ground deformation [3].
- **Revisit, resolution, and latency differ.** Satellites pass at different times, see at different resolutions, and publish products after different delays. A missing observation may mean no overpass or no product yet, not an absence of activity.
- **Illustrative rules.** The review rules count distinct anomaly categories. They do not weigh signal strength, trend, or source reliability, and they are not scientific thresholds.
- **No uncertainty model.** Records carry a quality note but no quantified uncertainty or confidence.
- **No ground data.** Satellite observations complement ground instruments (seismometers, ground deformation and gas stations, visual observation), none of which the prototype includes.
- **Simulated timing.** Scenario timestamps are fictional and do not correspond to real satellite overpasses or product release times.
- **No stale-data handling.** With no live feed, the prototype does not detect or flag observations that have aged past their expected update interval.

## What operational use would require

- **Calibration against local observatory data.** Anomaly criteria and review rules set and checked with the responsible volcano observatory, using its ground records.
- **Expert review.** Volcanologists and operations staff reviewing the rules, the wording of review prompts, and the brief template.
- **Uncertainty handling.** Detection limits, confidence, cloud cover, and missing coverage shown explicitly, so an absence of evidence is not read as evidence of absence.
- **Validation.** Retrospective testing against documented episodes, and measurement of how often review prompts mislead, before any accuracy claim.
- **Provenance and freshness.** Original product metadata, retrieval time, and attribution stored with every record, and stale observations flagged.
- **Clear authority.** Official alert levels and public warnings remain with the responsible agencies. The tool supports analysts; it does not issue warnings.

## References

All accessed 13 October 2026.

1. USGS. *Forecasting, detecting, and tracking volcanic eruptions from space.* <https://www.usgs.gov/publications/forecasting-detecting-and-tracking-volcanic-eruptions-space>
2. ESA. *Earth's most active volcanoes on satellite watch.* <https://www.esa.int/Applications/Observing_the_Earth/Earth_s_most_active_volcanoes_on_satellite_watch>
3. USGS Hawaiian Volcano Observatory, Volcano Watch. *Inflating volcanoes or cloudy data? Discerning deformation from noise with InSAR.* <https://www.usgs.gov/observatories/hvo/news/volcano-watch-inflating-volcanoes-or-cloudy-data-discerning-deformation>
4. Smithsonian Institution Global Volcanism Program. *Merapi.* <https://volcano.si.edu/volcano.cfm?vn=263250>
5. Copernicus Data Space Ecosystem. *Browser documentation.* <https://documentation.dataspace.copernicus.eu/Applications/Browser.html>
6. NASA FIRMS. *Active fire data.* <https://firms.modaps.eosdis.nasa.gov/content/active_fire/>

Boundary data: Natural Earth, <https://www.naturalearthdata.com/>, redistributed by `world-atlas`, <https://github.com/topojson/world-atlas>.
