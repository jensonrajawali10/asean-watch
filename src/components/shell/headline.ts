// Interim headline sentence for the top-left of map mode (docs/UX_V3.md section 2), built from the
// modelled haze forecast. The content teammate's src/lib/situation.ts headlineSentence(...) replaces
// this; App swaps the import. Pure, deterministic, tested. MODELLED values are always said to be modelled.

export interface HeadlineInput {
  /** The worst city at the scrubber's hour, or null when no air-quality data is loaded. */
  worst: { name: string; pm25: number } | null;
  /** Hours from the forecast anchor ("now" live, the capture time for a snapshot). */
  offsetH: number;
  /** True when the model run is the bundled snapshot. */
  snapshot: boolean;
  /** Direction the low-level wind blows TOWARD at the worst city, degrees clockwise from north; null when unknown. */
  windTowardDeg?: number | null;
  /** Wind speed at that point, m/s; calm winds get no transport sentence. */
  windSpeedMs?: number | null;
}

const WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** 8-point compass word for a bearing. */
export function compassWord(deg: number): string {
  return WORDS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

const signed = (h: number) => (h < 0 ? `−${Math.abs(h)} h` : `+${h} h`);

/** "Now" / "At +24 h" / "Saved run" / "Saved run −3 h". */
export function headlineWhen(offsetH: number, snapshot: boolean): string {
  if (snapshot) return offsetH === 0 ? 'Saved run' : `Saved run ${signed(offsetH)}`;
  return offsetH === 0 ? 'Now' : `At ${signed(offsetH)}`;
}

export function headlineSentence(input: HeadlineInput): string {
  const when = headlineWhen(input.offsetH, input.snapshot);
  if (!input.worst || !Number.isFinite(input.worst.pm25)) return `${when}: the haze forecast has not loaded yet.`;
  const pm = Math.round(input.worst.pm25).toLocaleString('en-US');
  const first = `${when}: haze is worst over ${input.worst.name} (${pm} µg/m³, modelled).`;
  const deg = input.windTowardDeg;
  const speed = input.windSpeedMs ?? null;
  if (deg === null || deg === undefined || !Number.isFinite(deg) || (speed !== null && speed < 1)) {
    return speed !== null && speed < 1 ? `${first} Low-level winds there are calm.` : first;
  }
  return `${first} Low-level winds carry its smoke toward the ${compassWord(deg)}.`;
}
