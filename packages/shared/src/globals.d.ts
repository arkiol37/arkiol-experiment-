// packages/shared/src/globals.d.ts
//
// Node 18+ ships fetch, Response, Request, AbortSignal.timeout() etc. as
// built-in globals. However the project's @types/node version and
// "lib": ["ES2022"] in tsconfig.json do not expose these types.
//
// This file declares the subset of the Fetch API actually used by
// packages/shared source files (specifically assetGenerationEngine.ts).
// It is NOT a stub or hack — it declares real runtime globals that Node
// already provides. When @types/node is upgraded to v20+ this file can
// be removed.

declare function fetch(input: string | URL, init?: RequestInit): Promise<Response>;

interface RequestInit {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: string | Buffer | ArrayBuffer | ReadableStream | null;
  signal?: AbortSignal;
  redirect?: 'follow' | 'error' | 'manual';
}

interface Headers {
  get(name: string): string | null;
  set(name: string, value: string): void;
  has(name: string): boolean;
  delete(name: string): void;
  forEach(callback: (value: string, key: string) => void): void;
  append(name: string, value: string): void;
}

interface Response {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly url: string;
  readonly redirected: boolean;
  readonly type: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  clone(): Response;
}

interface Blob {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  slice(start?: number, end?: number, contentType?: string): Blob;
}

interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: string, listener: (...args: unknown[]) => void): void;
  removeEventListener(type: string, listener: (...args: unknown[]) => void): void;
}

interface AbortSignalConstructor {
  timeout(ms: number): AbortSignal;
  abort(reason?: unknown): AbortSignal;
}

declare var AbortSignal: AbortSignalConstructor;
