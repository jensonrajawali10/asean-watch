// Shared by the browser (src/lib/warnings.ts) and the server relay (src/lib/dsdaProxy.ts, api/dsda.ts):
// the relay path, its answer and the fixed visitor-facing reasons. No logic, so the browser bundle
// carries none of the server code.

/** Same-origin relay for Jakarta DSDA's floodgate XML. */
export const DSDA_RELAY_PATH = '/api/dsda';
/** The one upstream document the relay fetches. */
export const DSDA_XML_URL = 'https://poskobanjir.dsdadki.web.id/xmldata.xml';

export type DsdaUnavailableReason = 'certificate' | 'timeout' | 'upstream_http' | 'not_floodgate_xml' | 'network';

/** Fixed, visitor-facing reasons (never upstream detail). */
export const DSDA_REASON_TEXT: Record<DsdaUnavailableReason, string> = {
  certificate: "DSDA's website shows a security certificate that cannot be verified, so its data cannot be trusted in transit",
  timeout: 'the DSDA site did not answer in time',
  upstream_http: 'the DSDA site returned an error',
  not_floodgate_xml: 'the DSDA site did not return its floodgate data',
  network: 'the DSDA site could not be reached',
};

export type DsdaPayload =
  | { available: true; url: string; retrievedAt: string; xml: string }
  | { available: false; url: string; checkedAt: string; reason: DsdaUnavailableReason; message: string };
