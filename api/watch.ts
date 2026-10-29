// Vercel Function: GET /api/watch (cached relay for the watch-area evidence: NASA FIRMS hotspots near the
// volcanoes and in the haze boxes, and USGS and BMKG earthquakes near the volcanoes). FIRMS sends no CORS
// headers and its CSVs are about 8 MB each, so this relay builds the same data scripts/refresh-data.mjs
// writes and keeps it at the Vercel CDN for a few hours: the Overview and Volcanoes evidence stays current
// between deploys without committed data. The logic lives in src/lib/watchProxy.ts, bundled into
// api/_lib/watch-core.js by `npm run build:api` (also run by `npm run build`). It takes no parameters.
// No secrets are used.
import { clientIpFrom, handleWatchRequest } from './_lib/watch-core.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleWatchRequest(request, { clientIp: clientIpFrom(request.headers) });
  },
};
