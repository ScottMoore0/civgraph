/**
 * The Cloudflare Pages Functions runtime, as far as civgraph's Functions use it, for type
 * checking only (functions/tsconfig.check.json; `npm run check:types:functions`).
 *
 * Written by hand instead of depending on @cloudflare/workers-types: the Functions use a small
 * part of the runtime, and this file names exactly that part. A Function that starts using more
 * of a binding's API adds it here, and the type check says where it is used.
 *
 * A `.d.mts` on purpose: Pages builds every .js/.mjs/.ts/.tsx/.jsx file under functions/ into
 * the route table (wrangler's generateConfigFromFileTree); `.mts` is not among them, so this
 * file can never become a route or reach the bundle. esbuild never reads it either.
 */
export {};

declare global {
  /** `caches.default`: the zone's default cache (Workers runtime). */
  interface CacheStorage {
    readonly default: Cache;
  }

  /** The Workers `cf` request options used here. */
  interface RequestInit {
    cf?: { cacheTtl?: number; cacheEverything?: boolean; [key: string]: unknown };
  }

  /** A prepared D1 statement (developers.cloudflare.com/d1/worker-api/prepared-statements/). */
  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[]; success?: boolean; meta?: Record<string, unknown> }>;
    raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
    run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number; [key: string]: unknown } }>;
  }

  /** A D1 database binding. */
  interface D1Database {
    prepare(sql: string): D1PreparedStatement;
    batch(statements: D1PreparedStatement[]): Promise<Array<{ results?: Record<string, unknown>[] }>>;
    exec(sql: string): Promise<unknown>;
    withSession?(constraint?: string): D1Database;
  }

  /** A KV namespace binding. */
  interface KVNamespace {
    get(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream' | { type?: string; cacheTtl?: number }): Promise<any>;
    getWithMetadata?(key: string, type?: string | { type?: string }): Promise<{ value: any; metadata: any }>;
    put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { expiration?: number; expirationTtl?: number; metadata?: unknown }): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string | undefined; cursor?: string | undefined; limit?: number | undefined }): Promise<{ keys: Array<{ name: string; expiration?: number; metadata?: unknown }>; list_complete: boolean; cursor?: string }>;
  }

  /** An R2 object's metadata (head, list). */
  interface R2Object {
    key: string;
    size: number;
    etag: string;
    httpEtag: string;
    uploaded: Date;
    httpMetadata?: { contentType?: string; cacheControl?: string; [key: string]: unknown };
    customMetadata?: Record<string, string>;
    writeHttpMetadata(headers: Headers): void;
  }

  /** An R2 object with its body (get). */
  interface R2ObjectBody extends R2Object {
    body: ReadableStream;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }

  /** An R2 bucket binding. */
  interface R2Bucket {
    get(key: string, options?: Record<string, unknown>): Promise<R2ObjectBody | null>;
    head(key: string): Promise<R2Object | null>;
    put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null, options?: Record<string, unknown>): Promise<R2Object | null>;
    delete(keys: string | string[]): Promise<void>;
    list(options?: { prefix?: string | undefined; cursor?: string | undefined; limit?: number | undefined; delimiter?: string | undefined; include?: string[] | undefined }): Promise<{ objects: R2Object[]; delimitedPrefixes: string[]; truncated: boolean; cursor?: string }>;
  }

  /** The `context` every Pages Function handler receives. */
  interface PagesContext<Env = Record<string, any>, Params extends string = string> {
    request: Request;
    env: Env;
    params: Record<Params, string | string[]>;
    data: Record<string, unknown>;
    functionPath?: string;
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
    next(input?: Request | string, init?: RequestInit): Promise<Response>;
  }
}
