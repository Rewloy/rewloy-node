/**
 * What the client throws. Every failure to get an answer from Rewloy is a
 * RewloyError: an error answer from the API (with its stable `code`), an
 * answer that is not what the API documents, or no answer at all.
 */

import type { ErrorCode } from './generated/types.ts';
import type { RateLimitInfo } from './types.ts';

export interface RewloyErrorInit {
  status: number;
  code: string;
  detail: string;
  title?: string | null | undefined;
  details?: unknown;
  docs?: string | null | undefined;
  requestId?: string | null | undefined;
  body?: unknown;
  headers?: Headers | null | undefined;
  rateLimit?: RateLimitInfo | null | undefined;
  operation?: string | null | undefined;
  cause?: unknown;
}

/**
 * The API answered with an error, or the call failed on the way.
 *
 * Act on `code`: it is stable, while `detail` is a human sentence in Turkish
 * that may change. Besides the API's codes (https://rewloy.com/gelistiriciler/hatalar)
 * the client uses:
 *   - `CONNECTION_ERROR` and `TIMEOUT` (status 0): no answer arrived;
 *   - `INVALID_RESPONSE`: a 2xx answer that is not the documented JSON;
 *   - `HTTP_<status>`: an error answer without Rewloy's error body (a proxy's 502 page).
 */
export class RewloyError extends Error {
  /** The HTTP status; 0 when no answer arrived. */
  readonly status: number;
  /** The API's stable machine code, e.g. `INSUFFICIENT_BALANCE`. */
  readonly code: ErrorCode | (string & {});
  /** The code's one-line title in the catalogue, e.g. "Bakiye yetersiz". */
  readonly title: string | null;
  /** What happened, in the API's words (`error.message`). */
  readonly detail: string;
  /**
   * The API's `error.details`, when it sent any: for `VALIDATION` a list of
   * `{ field, rule, message }`, for others what the catalogue says (`left`,
   * `channels`, `request`…).
   */
  readonly details: unknown;
  /** Where the catalogue explains the code (`error.docs`). */
  readonly docs: string | null;
  /** `x-request-id`: quote it to Rewloy support. */
  readonly requestId: string | null;
  /** The parsed answer body (or its text, when it is not JSON). */
  readonly body: unknown;
  readonly headers: Headers | null;
  /** The `RateLimit-*` headers of the answer; `null` when it carried none. */
  readonly rateLimit: RateLimitInfo | null;
  /** The operationId of the call. */
  readonly operation: string | null;

  constructor(init: RewloyErrorInit) {
    const where = [init.operation, init.requestId ? `requestId ${init.requestId}` : null].filter(Boolean).join(', ');
    super(`${init.status ? `${String(init.status)} ` : ''}${init.code}: ${init.detail}${where ? ` (${where})` : ''}`,
      init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.title = init.title ?? null;
    this.detail = init.detail;
    this.details = init.details;
    this.docs = init.docs ?? null;
    this.requestId = init.requestId ?? null;
    this.body = init.body;
    this.headers = init.headers ?? null;
    this.rateLimit = init.rateLimit ?? null;
    this.operation = init.operation ?? null;
  }
}

/** 429 `RATE_LIMITED`: too many requests for this credential or this action. */
export class RateLimitError extends RewloyError {
  /** Seconds to wait before trying again (`Retry-After`), when the API said. */
  readonly retryAfter: number | null;

  constructor(init: RewloyErrorInit & { retryAfter: number | null }) {
    super(init);
    this.retryAfter = init.retryAfter;
  }
}

/** No answer arrived: the connection failed or broke (`CONNECTION_ERROR`). */
export class RewloyConnectionError extends RewloyError {
  constructor(init: Omit<RewloyErrorInit, 'status' | 'code'> & { code?: string }) {
    super({ ...init, status: 0, code: init.code ?? 'CONNECTION_ERROR' });
  }
}

/** No answer within `timeoutMs` (`TIMEOUT`), or a stream fell silent. */
export class RewloyTimeoutError extends RewloyConnectionError {
  constructor(init: Omit<RewloyErrorInit, 'status' | 'code'>) {
    super({ ...init, code: 'TIMEOUT' });
  }
}

// On the prototypes, not as fields: the stack trace's first line is written
// while the base constructor runs, before a field would be set.
const names: [{ prototype: Error }, string][] = [[RewloyError, 'RewloyError'], [RateLimitError, 'RateLimitError'],
  [RewloyConnectionError, 'RewloyConnectionError'], [RewloyTimeoutError, 'RewloyTimeoutError']];
for (const [E, name] of names) Object.defineProperty(E.prototype, 'name', { value: name, writable: true, configurable: true });
