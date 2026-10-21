// "Air here" block for the fire cards (province, state, country or cluster): the MODELLED PM2.5 at a stated
// point, its band and the WHO comparison, why there is no PSI, and the official link. Same honesty as the
// city card: a model in ~45 km squares, not a measurement and not an official index.
import { WHO_PM25_24H_UGM3, describePm25 } from '../../lib/airQuality';
import type { AirQualityData } from '../../lib/airQuality';
import { areaAir, ISO3_TO_ISO2 } from '../../lib/areaAir';
import type { AreaAirInput } from '../../lib/areaAir';
import { AIR_QUALITY_OFFICIAL, COUNTRY_NAME, noPsiNote } from '../../lib/places';
import { ExternalLink } from './PopoverParts';

export interface AreaAirQualityProps {
  area: AreaAirInput;
  /** ISO3 of the area's country (fires snapshot), for the PSI note and the official link. */
  iso3: string;
  airQuality: AirQualityData | null;
  timeISO: string | null;
}

export function AreaAirQuality({ area, iso3, airQuality, timeISO }: AreaAirQualityProps) {
  const air = timeISO ? areaAir(airQuality, area, timeISO) : areaAir(null, area, '');
  const iso2 = ISO3_TO_ISO2[iso3] ?? null;
  const official = iso2 ? (AIR_QUALITY_OFFICIAL[iso2] ?? null) : null;
  const psi = iso2 ? noPsiNote(iso2) : null;
  const d = air.kind === 'none' ? null : describePm25(air.value);
  return (
    <div className="area-air">
      <p className="area-air__head">
        <span className="area-air__tag">MODELLED</span> Air here
      </p>
      {air.kind === 'none' || !d ? (
        <p className="area-air__line">{air.kind === 'none' ? air.reason : ''}</p>
      ) : (
        <p className="area-air__line">
          Fine smoke (PM2.5) <strong>{d.valueText} µg/m³</strong>
          {d.band ? `, ${d.band.label}` : ''}
          {d.timesWho !== null ? `, about ${d.timesWho.toLocaleString('en-US')} times the WHO's daily guideline of ${WHO_PM25_24H_UGM3} µg/m³,` : ''} {air.where}. A
          computer forecast in ~45 km squares, not a measurement.
        </p>
      )}
      {psi && <p className="area-air__line area-air__muted">{psi}</p>}
      {iso2 && (
        <p className="area-air__line">
          Official readings and advice:{' '}
          {official ? (
            <ExternalLink href={official.url}>{official.label}</ExternalLink>
          ) : (
            <>check {COUNTRY_NAME[iso2] ?? 'the country'}&apos;s national environment agency.</>
          )}
        </p>
      )}
    </div>
  );
}
