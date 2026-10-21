// Types for the generated bundle api/_lib/dsda-core.js (source: src/lib/dsdaProxy.ts).
// Keep in step with that file's exports.
export interface DsdaContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export declare function handleDsdaRequest(request: Request, ctx: DsdaContext): Promise<Response>;
export declare function clientIpFrom(headers: Headers, fallback?: string): string;
