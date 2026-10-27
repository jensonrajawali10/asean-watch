// Types for the generated bundle api/_lib/fires-core.js (source: src/lib/firesProxy.ts).
// Keep in step with that file's exports.
export interface FiresContext {
  clientIp: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export declare function handleFiresRequest(request: Request, ctx: FiresContext): Promise<Response>;
export declare function clientIpFrom(headers: Headers, fallback?: string): string;
