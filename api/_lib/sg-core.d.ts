// Types for the generated bundle api/_lib/sg-core.js (source: src/lib/sgProxy.ts).
// Keep in step with that file's exports.
export interface SgContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export declare function handleSgRequest(request: Request, ctx: SgContext): Promise<Response>;
export declare function clientIpFrom(headers: Headers, fallback?: string): string;
