// Vercel Function: GET /api/open-meteo?feed=wind|aq|ash|flood (cached relay for the Open-Meteo model
// feeds: wind at 10 m and 925 hPa, CAMS PM2.5, summit winds for the ash drift, GloFAS river flow).
// Browsers used to call Open-Meteo directly, about 1,300 counted calls per first load, and hit its
// 600-a-minute free limit (HTTP 429). This relay batches the wind levels and is cached at the Vercel
// CDN. The logic lives in src/lib/openMeteoProxy.ts, bundled into api/_lib/open-meteo-core.js by
// `npm run build:api` (also run by `npm run build`). The client names a feed and nothing else. No
// secrets are used.
import { clientIpFrom, handleOpenMeteoRequest } from './_lib/open-meteo-core.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleOpenMeteoRequest(request, { clientIp: clientIpFrom(request.headers) });
  },
};
