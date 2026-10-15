// Checks the four NEA responses before scripts/capture-nea-snapshot.mjs writes them, so a good
// snapshot is never replaced by one the app cannot use. data.gov.sg sometimes answers 200 with
// code 0 and empty readings or items; normaliseNea (src/lib/nea.ts) would then throw for the wind,
// loadNeaSnapshot() would return null and the offline NEA fallback would disappear.
// Plain Node, no dependencies. Mirrors what normaliseNea needs: at least one wind-direction reading
// in 0..360 for a station listed with coordinates, at least one wind-speed value, and at least one
// regional value in the PSI 24-hour and PM2.5 1-hour items.

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function stationsWithCoordinates(body) {
  const ids = new Set();
  for (const s of Array.isArray(body?.data?.stations) ? body.data.stations : []) {
    if (isRecord(s) && typeof s.id === 'string' && isNum(s.location?.latitude) && isNum(s.location?.longitude)) ids.add(s.id);
  }
  return ids;
}

function readingValues(body) {
  const readings = Array.isArray(body?.data?.readings) ? body.data.readings : [];
  return readings.flatMap((r) => (isRecord(r) && Array.isArray(r.data) ? r.data : [])).filter((d) => isRecord(d) && typeof d.stationId === 'string');
}

function windProblem(name, body, valid) {
  if (!isRecord(body?.data)) return `${name}: no data block`;
  const stations = stationsWithCoordinates(body);
  if (stations.size === 0) return `${name}: no stations with coordinates`;
  const values = readingValues(body);
  if (values.length === 0) return `${name}: empty readings`;
  if (!values.some((d) => stations.has(d.stationId) && isNum(d.value) && valid(d.value))) return `${name}: no usable station value`;
  return null;
}

function regionalProblem(name, body, field) {
  const items = Array.isArray(body?.data?.items) ? body.data.items : [];
  if (items.length === 0) return `${name}: empty items`;
  const ok = items.some((it) => isRecord(it?.readings) && isRecord(it.readings[field]) && Object.values(it.readings[field]).some((v) => isNum(v) && v >= 0));
  return ok ? null : `${name}: no ${field} values`;
}

/**
 * Problems that make the NEA responses unfit to replace the snapshot; empty when they are usable.
 * @param {{ windDirection?: unknown, windSpeed?: unknown, psi?: unknown, pm25?: unknown }} responses
 * @returns {string[]}
 */
export function neaSnapshotProblems(responses) {
  return [
    windProblem('windDirection', responses?.windDirection, (v) => v >= 0 && v <= 360),
    windProblem('windSpeed', responses?.windSpeed, (v) => v >= 0),
    regionalProblem('psi', responses?.psi, 'psi_twenty_four_hourly'),
    regionalProblem('pm25', responses?.pm25, 'pm25_one_hourly'),
  ].filter((p) => p !== null);
}
