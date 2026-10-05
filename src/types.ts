/**
 * Hand-written types shared by the client and the generated code
 * (src/generated/), which imports them.
 */

import type { PageMeta } from './generated/types.ts';

/**
 * A credential kind of the Rewloy API, as the OpenAPI document's
 * `x-credentials` names them:
 *   - `key`: an API key (`rwk_…`);
 *   - `staff`: a staff session (`rws_…`);
 *   - `holder`: a card holder's session (`rwh_…`);
 *   - `public`: no credential.
 */
export type AuthKind = 'key' | 'staff' | 'holder' | 'public';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * How a successful answer is read:
 *   - `json`: the `{ data }` envelope (with `meta` on paged lists);
 *   - `none`: 204, no body;
 *   - `blob`: a file (image, CSV, pass), returned as a `Blob`;
 *   - `raw-json`: JSON without the envelope (the OpenAPI document itself);
 *   - `stream`: server-sent events.
 */
export type ResponseKind = 'json' | 'none' | 'blob' | 'raw-json' | 'stream';

/** One row of the metadata table (`OPERATIONS`): what the client needs to call an operation. */
export interface OperationMeta {
  readonly method: HttpMethod;
  /** The path with `{name}` placeholders, `/v1` included. */
  readonly path: string;
  /** The credential kinds the operation accepts. */
  readonly auth: readonly AuthKind[];
  /** Takes the `Rewloy-Merchant` header (staff sessions with seats in several businesses). */
  readonly merchant: boolean;
  /** Takes an `Idempotency-Key` header: `required`, `optional`, or not at all. */
  readonly idempotency: 'required' | 'optional' | null;
  /** Has a JSON request body. */
  readonly body: boolean;
  readonly response: ResponseKind;
  /** A paged list: `page`/`limit` in, `meta` out. */
  readonly paged: boolean;
  /** Answers with server-sent events. */
  readonly stream: boolean;
  /**
   * Marked for removal. `sunset` is the last day it works (YYYY-MM-DD) and `use`
   * the operation that replaces it, when the document says so.
   */
  readonly deprecated: { readonly sunset: string | null; readonly use: string | null } | null;
}

/** Options every call takes. */
export interface RequestOptions {
  /** Cancels the call (and any retry still waiting). The promise rejects with the signal's reason. */
  signal?: AbortSignal | undefined;
  /**
   * Time allowed for one attempt, in milliseconds: until the whole answer has
   * arrived (for a stream: until its headers have). Overrides the client's.
   */
  timeoutMs?: number | undefined;
  /** Retries after the first attempt. Overrides the client's. */
  maxRetries?: number | undefined;
}

/** Options of a server-sent event stream (`Rewloy.stream`). */
export interface StreamOptions {
  /**
   * Reconnect when the connection drops or the server ends the stream, as a
   * browser's `EventSource` does: after the server's `retry:` delay, with
   * `Last-Event-ID` once an event carried an id. Errors that a reconnection
   * cannot fix (401, 403, 404…) end the stream with a `RewloyError`.
   * Default `true`.
   */
  reconnect?: boolean | undefined;
  /**
   * Treat the connection as dead after this many milliseconds without a byte
   * (the API sends a heartbeat every 25 seconds). `0` turns the check off.
   * Default 60000.
   */
  idleTimeoutMs?: number | undefined;
}

/** One page of a paged list, as the API answers it. */
export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

/**
 * The request budget the API reports on every answer to an authenticated call
 * (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`).
 */
export interface RateLimitInfo {
  /** `RateLimit-Limit`: requests allowed per minute. */
  limit: number;
  /** `RateLimit-Remaining`: requests left in this minute. */
  remaining: number;
  /** `RateLimit-Reset`: seconds until the limit renews. */
  reset: number;
}

/** The whole answer to a call (`Rewloy.request`). */
export interface ApiResponse<T> {
  /** What `data` held (a `Blob` for files, `undefined` for 204). */
  data: T;
  /** Paging, on paged lists. */
  meta: PageMeta | undefined;
  /** The HTTP status: 200, 201, 202 or 204. Some operations answer 200 when they found what they would have created. */
  status: number;
  headers: Headers;
  /** `x-request-id`: quote it to Rewloy support. */
  requestId: string | null;
  /** The `RateLimit-*` headers; `null` when the answer carries none (anonymous calls). */
  rateLimit: RateLimitInfo | null;
  /**
   * `Rewloy-Mode`: which mode answered (`test` for test keys, once the platform
   * has test mode); `null` when the answer does not say.
   */
  mode: string | null;
  /** `Idempotent-Replayed: true`: the API replayed the first answer to this `Idempotency-Key`. */
  replayed: boolean;
}
