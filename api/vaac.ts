// Vercel Function: GET /api/vaac (cached relay for the Tokyo VAAC volcanic ash advisories). One advisory
// takes two downloads from JMA (the list page, then its text page), so this relay builds the set once and
// keeps it at the Vercel CDN for ten minutes, like JMA's own cache. The logic lives in src/lib/vaacProxy.ts,
// bundled into api/_lib/vaac-core.js by `npm run build:api` (also run by `npm run build`). It takes no
// parameters; only https://www.data.jma.go.jp is ever fetched. No secrets are used.
import { clientIpFrom, handleVaacRequest } from './_lib/vaac-core.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleVaacRequest(request, { clientIp: clientIpFrom(request.headers) });
  },
};
