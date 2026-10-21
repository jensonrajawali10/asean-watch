// Types for the generated bundle api/_lib/open-meteo-core.js (source: src/lib/openMeteoProxy.ts).
// Keep in step with that file's exports.
export interface OpenMeteoContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export declare function handleOpenMeteoRequest(request: Request, ctx: OpenMeteoContext): Promise<Response>;
export declare function clientIpFrom(headers: Headers, fallback?: string): string;
