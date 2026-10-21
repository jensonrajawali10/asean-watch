// The map hour in the visitor's own clock, beside the UTC time the analysts use ("Wed 8:00 pm your time").
// Kept out of AppHeader.tsx so the component module exports components only (fast refresh).

/** "Wed 8:00 pm your time" for an ISO time, in `timeZone` (default: the browser's); null when unreadable. */
export function localTimeLabel(iso: string | null, timeZone?: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).formatToParts(ms);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('weekday')} ${get('hour')}:${get('minute')} ${get('dayPeriod').toLowerCase()} your time`;
  } catch {
    return null; // unknown time zone or no Intl: the UTC time alone still shows
  }
}
