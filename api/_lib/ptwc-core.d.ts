// Types for the generated bundle api/_lib/ptwc-core.js (source: src/lib/ptwcProxy.ts).
// Keep in step with that file's exports.
export interface PtwcContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export declare function handlePtwcRequest(request: Request, ctx: PtwcContext): Promise<Response>;
export declare function clientIpFrom(headers: Headers, fallback?: string): string;
