// The map key: a small permanent legend for first-time visitors. What each symbol means in plain words, and
// the PM2.5 colour bands with their unit. The circles are a forecast (MODELLED); the red pins are official
// warnings (not fires); the orange squares and "N hotspots" are fires seen by satellites (MEASURED).
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { PM25_BANDS, WHO_PM25_24H_UGM3 } from '../../lib/airQuality';
import { fireWindowWords, loadFireSnapshot } from '../../lib/fires';
import { useNowMs } from '../../lib/useNowMs';

const MAP_KEY_ROWS = {
  circles: { name: 'Coloured circles', text: 'Fine smoke (PM2.5) in the air, in µg/m³. Bigger and darker is worse. A forecast, not a measurement.' },
  pins: { name: 'Red pins', text: 'An official warning from a national agency (floods, tsunamis, volcanoes). Not a fire.' },
  volcanoes: { name: 'Triangles', text: 'Volcanoes. Click one for its official alert level.' },
  fires: { name: 'Orange squares', text: 'Fires seen by NASA satellites in the last 24 hours ("hotspots").' },
  firesDated: { name: 'Orange squares', text: (day: string) => `Fires seen by NASA satellites in ${day} ("hotspots"; a saved copy).` },
  wind: { name: 'Streaks', text: 'The wind about 800 m up, the height that carries smoke. A forecast.' },
} as const;

/** Phones start with the key folded to its title (one tap opens it): open, it would cover most of the map. */
function startsOpen(): boolean {
  try {
    return !(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches);
  } catch {
    return true;
  }
}

export default function MapKey() {
  const [open, setOpen] = useState(startsOpen);
  // FIRMS is a bundled snapshot: once it has aged, the key dates it rather than say "the last 24 hours".
  const fireSnap = loadFireSnapshot();
  const fireWords = fireWindowWords(fireSnap?.reference ?? '', useNowMs());
  return (
    <section className={`mv-key${open ? '' : ' is-closed'}`} aria-label="Map key">
      <button type="button" className="mv-key__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        What's on the map
      </button>
      {open && (
        <ul className="mv-key__list">
          <li>
            <span className="mv-key__bands" aria-hidden="true">
              {PM25_BANDS.map((b) => (
                <span key={b.key} className="mv-key__band" style={{ '--band': b.color } as CSSProperties} />
              ))}
            </span>
            <span>
              <strong>{MAP_KEY_ROWS.circles.name}</strong> {MAP_KEY_ROWS.circles.text}
              <span className="mv-key__scale">
                {PM25_BANDS.map((b) => b.min).join(' · ')} µg/m³ · WHO daily guideline {WHO_PM25_24H_UGM3} <span className="mv-key__tag">MODELLED</span>
              </span>
            </span>
          </li>
          <li>
            <svg className="mv-key__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path className="mv-wpin" d="M12 21.5s-6-6.1-6-11a6 6 0 0 1 12 0c0 4.9-6 11-6 11z" />
              <circle className="mv-wpin-dot" cx="12" cy="10.5" r="2.1" />
            </svg>
            <span>
              <strong>{MAP_KEY_ROWS.pins.name}</strong> {MAP_KEY_ROWS.pins.text}
            </span>
          </li>
          <li>
            <svg className="mv-key__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path className="mv-volcano" d="M12 4 21 19H3z" />
            </svg>
            <span>
              <strong>{MAP_KEY_ROWS.volcanoes.name}</strong> {MAP_KEY_ROWS.volcanoes.text}
            </span>
          </li>
          <li>
            <span className="mv-key__fire" aria-hidden="true" />
            <span>
              <strong>{MAP_KEY_ROWS.fires.name}</strong>{' '}
              {fireWords.dated ? MAP_KEY_ROWS.firesDated.text(fireWords.day) : MAP_KEY_ROWS.fires.text}
            </span>
          </li>
          <li>
            <span className="mv-key__wind" aria-hidden="true" />
            <span>
              <strong>{MAP_KEY_ROWS.wind.name}</strong> {MAP_KEY_ROWS.wind.text}
            </span>
          </li>
        </ul>
      )}
    </section>
  );
}
