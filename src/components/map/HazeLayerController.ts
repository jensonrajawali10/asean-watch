// CONTRACT STUB (lead). Owned by the haze agent, which replaces the body; MapView (map agent) only
// calls this public surface. Draws the modelled haze, wind particles and city markers on its OWN deck.gl
// overlay attached to the MapLibre map, so it never fights MapView's overlay for layer ownership.
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { WindGrid } from '../../lib/windField';

/** Modelled air quality (CAMS via Open-Meteo); the concrete type lives in src/lib/airQuality.ts. */
export type AirQualityData = unknown;

export interface HazeCity {
  name: string;
  lat: number;
  lon: number;
}

export interface HazeLayerInput {
  /** 925 hPa wind for particles (modelled). */
  windGrid: WindGrid | null;
  airQuality: AirQualityData | null;
  /** ISO 8601 UTC hour shown by the forecast scrubber. */
  timeISO: string;
  dark: boolean;
  visible: { particles: boolean; haze: boolean; cities: boolean };
  /** Called when a city marker is clicked (MapView/App shows the popover). */
  onCityClick?: (city: HazeCity) => void;
}

export class HazeLayerController {
  private readonly map: MapLibreMap;

  constructor(map: MapLibreMap) {
    this.map = map;
  }

  /** Apply new input; cheap to call on every React render. */
  update(input: HazeLayerInput): void {
    void this.map;
    void input;
  }

  /** Remove the overlay and stop any animation loop. */
  destroy(): void {}
}
