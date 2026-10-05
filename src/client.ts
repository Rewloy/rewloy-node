/**
 * The client: credentials, the request (headers, retries, timeouts, errors,
 * deprecation notices), pagination and streams. The operations themselves
 * come from the generated RewloyMethods, one method per operationId.
 */

import { randomUUID } from 'node:crypto';
import { RateLimitError, RewloyConnectionError, RewloyError, RewloyTimeoutError } from './errors.ts';
import { RewloyMethods } from './generated/methods.ts';
import { ERROR_TITLES, OPERATIONS } from './generated/operations.ts';
import type { OperationId, Operations, PagedOperationId, StreamOperationId } from './generated/types.ts';
import { EventStream } from './sse.ts';
import type { ApiResponse, AuthKind, OperationMeta, Page, RequestOptions, StreamOptions } from './types.ts';
import { VERSION } from './version.ts';

export const DEFAULT_BASE_URL = 'https://app.rewloy.com';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
/** Backoff: 0.5 s, 1 s, 2 s… up to 8 s, each with jitter (between half and all of it). */
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8000;
/** A `Retry-After` longer than this is not waited for: the error goes to the caller. */
const MAX_RETRY_AFTER_MS = 60_000;
/** setTimeout's ceiling; a longer (or infinite) timeout means none. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);
/** 502–504 and Cloudflare's 520–524 (the origin unreachable or too slow). */
const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

type Credential = Exclude<AuthKind, 'public'>;
type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

interface CommonOptions {
  /** The API's origin, without `/v1`. Default `https://app.rewloy.com`. */
  baseUrl?: string | undefined;
  /** Time allowed for one attempt, in milliseconds; `0` or `Infinity` for none. Default 60000. */
  timeoutMs?: number | undefined;
  /** Retries after a failed attempt, when retrying is safe. Default 2. */
  maxRetries?: number | undefined;
  /** A `fetch` to use instead of the global one (tests, proxies, instrumentation). */
  fetch?: typeof fetch | undefined;
  /** Added to the `User-Agent` this client sends, e.g. `"KasaPOS/4.2"`. */
  userAgent?: string | undefined;
  /** Replaces the wait between retries (tests, custom schedulers). */
  sleep?: Sleep | undefined;
}

/**
 * How to build a client: with one credential, or none for the endpoints that
 * need none (sign-in, joining a programme…).
 */
export type RewloyOptions = CommonOptions & (
  | {
    /** An API key, `rwk_…`: a till, a shop, your own system. */
    apiKey: string;
    staffSession?: undefined; holderSession?: undefined; merchant?: undefined;
  }
  | {
    /** A staff session, `rws_…` (`login`): a person's business app. */
    staffSession: string;
    /** The business this session acts for (`Rewloy-Merchant`), when the person has seats in several. */
    merchant?: string | undefined;
    apiKey?: undefined; holderSession?: undefined;
  }
  | {
    /** A card holder's session, `rwh_…` (`holderSession`): a Rewloy Cüzdan app. */
    holderSession: string;
    apiKey?: undefined; staffSession?: undefined; merchant?: undefined;
  }
  | { apiKey?: undefined; staffSession?: undefined; holderSession?: undefined; merchant?: undefined }
);

/** The argument of an operation: optional when nothing in it is required. */
type ArgsParam<A> = object extends A ? [args?: A] : [args: A];
type ItemOf<K extends PagedOperationId> = Operations[K]['data'] extends (infer T)[] ? T : never;

/** The shape every generated argument object has, as the request reads it. */
interface AnyArgs extends RequestOptions, StreamOptions {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
  idempotencyKey?: string | undefined;
  merchant?: string | undefined;
}

interface Exchange {
  res: Response;
  data: unknown;
  meta: Page<unknown>['meta'] | undefined;
}

/** Operations already warned about: one warning per operation per process. */
const warned = new Set<string>();

const defaultSleep: Sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason);
    return;
  }
  const onAbort = (): void => {
    clearTimeout(timer);
    reject(signal!.reason);
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `Retry-After` in milliseconds: delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Exponential backoff with jitter for the retry after attempt `attempt` (0-based). */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(cap / 2 + random() * (cap / 2));
}

/**
 * The base URL without trailing slashes and without a trailing `/v1`: the
 * paths of the operations carry `/v1` themselves, and the documentation shows
 * the address both ways (`https://app.rewloy.com` and `https://app.rewloy.com/v1`).
 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/v1$/, '').replace(/\/+$/, '');
}

/**
 * An `Idempotency-Key` is 8–64 printable ASCII characters (0x21–0x7E): an HTTP
 * header value cannot carry anything else, and `fetch` would throw a bare TypeError.
 */
export function checkIdempotencyKey(key: unknown): string {
  if (typeof key !== 'string' || !/^[\x21-\x7e]{8,64}$/.test(key)) {
    throw new TypeError('Rewloy: Idempotency-Key yalnız ASCII karakterler içerebilir (görünür karakterler, 8–64) / the Idempotency-Key must be printable ASCII (0x21–0x7E), 8–64 characters');
  }
  return key;
}

/** The URL a `Link` header gives for `rel="deprecation"` (else its first). */
function deprecationLink(link: string | null): string | null {
  if (!link) return null;
  let first: string | null = null;
  for (const m of link.matchAll(/<([^>]*)>([^,]*)/g)) {
    first ??= m[1]!;
    if (/\brel\s*=\s*"?[^";]*\bdeprecation\b/i.test(m[2]!)) return m[1]!;
  }
  return first;
}

function warn(message: string): void {
  const p = (globalThis as { process?: { emitWarning?: (m: string, o: { type: string; code: string }) => void } }).process;
  if (typeof p?.emitWarning !== 'function') {
    console.warn(`DeprecationWarning: ${message}`);
    return;
  }
  try {
    p.emitWarning(message, { type: 'DeprecationWarning', code: 'REWLOY_DEPRECATED' });
  } catch (err) {
    // `node --throw-deprecation` throws here: let it surface, not pass for a failed request.
    queueMicrotask(() => { throw err; });
  }
}

function userAgent(suffix: string | undefined): string | null {
  const node = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
  // A browser decides its own User-Agent, and the API's CORS allow-list has no room for it.
  if (!node) return null;
  return [`rewloy-node/${VERSION}`, `node/${node}`, suffix?.trim()].filter(Boolean).join(' ');
}

/**
 * A client of the Rewloy API (`https://app.rewloy.com/v1`).
 *
 * ```ts
 * const rewloy = new Rewloy({ apiKey: process.env.REWLOY_API_KEY! });
 * const card = await rewloy.getPass({ params: { serial: 'ABCD-EFGH-JKLM' } });
 * ```
 *
 * Every operation of the API is a method named by its operationId; each takes
 * one argument with `params`, `query` and `body` as the operation needs, and
 * the options of {@link RequestOptions}.
 */
export class Rewloy extends RewloyMethods {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** The kind of credential this client sends, or `null` for none. */
  readonly credential: Credential | null;
  /** The default `Rewloy-Merchant` of a staff session. */
  readonly merchant: string | null;
  readonly #token: string | null;
  readonly #fetch: typeof fetch;
  readonly #userAgent: string | null;
  readonly #sleep: Sleep;

  constructor(options: RewloyOptions = {}) {
    super();
    const given = (['apiKey', 'staffSession', 'holderSession'] as const).filter((k) => options[k] !== undefined);
    if (given.length > 1) throw new TypeError(`Rewloy: give one credential, not ${given.join(' and ')}`);
    const prefixes = { apiKey: ['rwk_', 'key'], staffSession: ['rws_', 'staff'], holderSession: ['rwh_', 'holder'] } as const;
    const which = given[0];
    if (which) {
      const token = options[which];
      const [prefix, kind] = prefixes[which];
      if (typeof token !== 'string' || !token.startsWith(prefix)) throw new TypeError(`Rewloy: ${which} must start with "${prefix}"`);
      this.#token = token;
      this.credential = kind;
    } else {
      this.#token = null;
      this.credential = null;
    }
    if (options.merchant !== undefined && which !== 'staffSession') throw new TypeError('Rewloy: `merchant` goes with a staffSession');
    this.merchant = options.merchant ?? null;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') throw new TypeError('Rewloy: no fetch (Node 22 or later has one)');
    this.#fetch = options.fetch ? f : (input, init) => globalThis.fetch(input, init);
    this.#userAgent = userAgent(options.userAgent);
    this.#sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Calls an operation and returns the whole answer: `data`, `meta` on paged
   * lists, the status, headers, `requestId`, `mode` and `replayed`.
   *
   * ```ts
   * const res = await rewloy.request('sendCampaign', { body: { body: 'Bu hafta kahveler 2 damga!' } });
   * res.status; res.replayed; res.data.id;
   * ```
   */
  async request<K extends Exclude<OperationId, StreamOperationId>>(id: K, ...args: ArgsParam<Operations[K]['args']>): Promise<ApiResponse<Operations[K]['data']>> {
    const op = this.#operation(id);
    if (op.stream) throw new TypeError(`Rewloy: ${id} is a stream; use stream('${id}')`);
    const { res, data, meta } = await this.#exchange(id, op, args[0] as AnyArgs | undefined);
    return {
      data: data as Operations[K]['data'], meta, status: res.status, headers: res.headers,
      requestId: res.headers.get('x-request-id'), mode: res.headers.get('rewloy-mode'),
      replayed: res.headers.get('idempotent-replayed') === 'true',
    };
  }

  /**
   * Walks a paged list item by item, asking for the next page (`page`) while
   * `meta` says there is one. `query.page` sets where to start and
   * `query.limit` the page size.
   *
   * ```ts
   * for await (const customer of rewloy.paginate('listCustomers', { query: { consent: 'yes' } })) { … }
   * ```
   */
  paginate<K extends PagedOperationId>(id: K, ...args: ArgsParam<Operations[K]['args']>): AsyncIterableIterator<ItemOf<K>> {
    const op = this.#operation(id);
    if (!op.paged) throw new TypeError(`Rewloy: ${id} is not a paged list`);
    const base = (args[0] ?? {}) as AnyArgs;
    const exchange = (page: number) => this.#exchange(id, op, { ...base, query: { ...base.query, page } });
    return (async function* (): AsyncGenerator<ItemOf<K>, void, undefined> {
      let page = Number(base.query?.page ?? 1);
      for (;;) {
        const { data, meta } = await exchange(page);
        const items = (Array.isArray(data) ? data : []) as ItemOf<K>[];
        yield* items;
        if (!meta || items.length === 0 || items.length < meta.pageSize || meta.page * meta.pageSize >= meta.total) return;
        page = meta.page + 1;
      }
    })();
  }

  /**
   * Opens a server-sent event stream (`liveFeed`, `holderCardEvents`) and
   * iterates its events. It reconnects by itself unless `reconnect: false`;
   * stop it with `signal`, `break` or `close()`.
   *
   * ```ts
   * for await (const ev of rewloy.stream('liveFeed', { signal })) {
   *   if (ev.event === 'event') console.log(JSON.parse(ev.data));
   * }
   * ```
   */
  stream<K extends StreamOperationId>(id: K, ...args: ArgsParam<Operations[K]['args']>): EventStream {
    return this.#open(id, args[0] as AnyArgs | undefined);
  }

  protected override async _call<K extends Exclude<OperationId, StreamOperationId>>(id: K, args: Operations[K]['args'] | undefined): Promise<Operations[K]['result']> {
    const op = this.#operation(id);
    const { data, meta } = await this.#exchange(id, op, args as AnyArgs | undefined);
    return (op.paged ? { data, meta } : data) as Operations[K]['result'];
  }

  protected override _open<K extends StreamOperationId>(id: K, args: Operations[K]['args'] | undefined): EventStream {
    return this.#open(id, args as AnyArgs | undefined);
  }

  #open(id: OperationId, args: AnyArgs | undefined): EventStream {
    const op = this.#operation(id);
    if (!op.stream) throw new TypeError(`Rewloy: ${id} is not a stream; use request('${id}')`);
    const a = args ?? {};
    return new EventStream({
      operation: id,
      connect: async (lastEventId, controller) => (await this.#exchange(id, op, a, { lastEventId, controller })).res,
      signal: a.signal,
      reconnect: a.reconnect ?? true,
      idleTimeoutMs: a.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      sleep: this.#sleep,
    });
  }

  #operation(id: OperationId): OperationMeta {
    const op = Object.hasOwn(OPERATIONS, id) ? OPERATIONS[id] : undefined;
    if (!op) throw new TypeError(`Rewloy: unknown operation "${String(id)}"`);
    return op;
  }

  #url(id: OperationId, op: OperationMeta, a: AnyArgs): string {
    const path = op.path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
      const v = a.params?.[name];
      if (v === undefined || v === null || v === '') throw new TypeError(`Rewloy: ${id} needs params.${name}`);
      return encodeURIComponent(String(v));
    });
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(a.query ?? {})) {
      if (v === undefined || v === null) continue;
      for (const x of Array.isArray(v) ? v : [v]) query.append(k, String(x));
    }
    const qs = query.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  #headers(id: OperationId, op: OperationMeta, a: AnyArgs, lastEventId: string | undefined): Headers {
    const h = new Headers();
    h.set('accept', op.stream ? 'text/event-stream' : op.response === 'json' || op.response === 'raw-json' ? 'application/json' : '*/*');
    if (this.#userAgent) h.set('user-agent', this.#userAgent);
    // An operation that takes no credential of this kind but works without one is called without it:
    // the API refuses a credential an operation does not accept (CREDENTIAL_NOT_ALLOWED).
    if (this.#token && this.credential && (op.auth.includes(this.credential) || !op.auth.includes('public'))) {
      h.set('authorization', `Bearer ${this.#token}`);
    }
    const merchant = a.merchant ?? (this.credential === 'staff' ? this.merchant : null);
    if (op.merchant && merchant) h.set('rewloy-merchant', merchant);
    if (op.idempotency) {
      if (a.idempotencyKey === undefined && op.idempotency === 'required') {
        throw new TypeError(`Rewloy: ${id} needs idempotencyKey: Idempotency-Key gerekli, kütüphane uydurmaz (8–64 ASCII karakter) / the Idempotency-Key is required and is never generated for you (8–64 printable ASCII characters)`);
      }
      h.set('idempotency-key', a.idempotencyKey === undefined ? randomUUID() : checkIdempotencyKey(a.idempotencyKey));
    }
    if (op.body) h.set('content-type', 'application/json');
    if (lastEventId) h.set('last-event-id', lastEventId);
    for (const [k, v] of Object.entries(a.headers ?? {})) {
      if (v === undefined || v === null) continue;
      h.set(k, k.toLowerCase() === 'idempotency-key' ? checkIdempotencyKey(v) : String(v));
    }
    return h;
  }

  #notice(id: OperationId, op: OperationMeta, headers: Headers): void {
    if (!headers.has('deprecation') || warned.has(id)) return;
    warned.add(id);
    const sunset = headers.get('sunset');
    const link = deprecationLink(headers.get('link'));
    warn(`Rewloy API operation ${id} (${op.method} ${op.path}) is deprecated.${sunset ? ` Sunset: ${sunset}.` : ''}${link ? ` See ${link}` : ''}`);
  }

  /**
   * One call: attempts until an answer settles it. For a stream it resolves
   * once the headers are in, the body unread; otherwise with the body read.
   */
  async #exchange(id: OperationId, op: OperationMeta, args: AnyArgs | undefined, stream?: { lastEventId: string; controller: AbortController }): Promise<Exchange> {
    const a = args ?? {};
    const url = this.#url(id, op, a);
    const headers = this.#headers(id, op, a, stream?.lastEventId);
    const body = op.body ? JSON.stringify(a.body ?? {}) : undefined;
    const retryable = IDEMPOTENT_METHODS.has(op.method) || headers.has('idempotency-key');
    const maxRetries = Math.max(0, a.maxRetries ?? this.maxRetries);
    const timeoutMs = a.timeoutMs ?? this.timeoutMs;
    const signal = a.signal;

    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const attemptCtrl = new AbortController();
      let timedOut = false;
      const timer = timeoutMs > 0 && timeoutMs < MAX_TIMER_MS ? setTimeout(() => { timedOut = true; attemptCtrl.abort(); }, timeoutMs) : undefined;
      const signals = [attemptCtrl.signal, ...(signal ? [signal] : []), ...(stream ? [stream.controller.signal] : [])];
      let failure: RewloyError;
      let wait: number | null = null;
      try {
        const res = await this.#fetch(url, { method: op.method, headers, body, signal: AbortSignal.any(signals) });
        this.#notice(id, op, res.headers);
        if (res.ok) {
          if (stream) return { res, data: undefined, meta: undefined };
          return { res, ...(await this.#read(id, op, res)) };
        }
        failure = this.#failure(id, res, await res.text().catch(() => ''));
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        if (!retryable || attempt >= maxRetries || !this.#retryStatus(res.status, failure.code)) throw failure;
        wait = retryAfter;
      } catch (err) {
        if (err instanceof RewloyError) throw err;
        if (signal?.aborted) throw signal.reason;
        if (stream?.controller.signal.aborted) throw err;
        failure = timedOut
          ? new RewloyTimeoutError({ detail: `no answer within ${String(timeoutMs)} ms`, operation: id, cause: err })
          : new RewloyConnectionError({ detail: describe(err), operation: id, cause: err });
        if (!retryable || attempt >= maxRetries) throw failure;
      } finally {
        // For a stream the timer ends with the headers; the body is the stream's own business.
        clearTimeout(timer);
      }
      const delay = wait ?? backoff(attempt);
      if (delay > MAX_RETRY_AFTER_MS) throw failure;
      await this.#sleep(delay, signal);
      signal?.throwIfAborted();
    }
  }

  #retryStatus(status: number, code: string): boolean {
    return status === 429 || GATEWAY_STATUSES.has(status) || (status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS');
  }

  async #read(id: OperationId, op: OperationMeta, res: Response): Promise<{ data: unknown; meta: Exchange['meta'] }> {
    if (op.response === 'none' || res.status === 204) {
      await res.arrayBuffer().catch(() => undefined);
      return { data: undefined, meta: undefined };
    }
    if (op.response === 'blob') return { data: await res.blob(), meta: undefined };
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.#invalid(id, res, text);
    }
    if (op.response === 'raw-json') return { data: parsed, meta: undefined };
    if (!isRecord(parsed) || !('data' in parsed)) throw this.#invalid(id, res, parsed);
    return { data: parsed.data, meta: isRecord(parsed.meta) ? parsed.meta as unknown as Exchange['meta'] : undefined };
  }

  #invalid(id: OperationId, res: Response, body: unknown): RewloyError {
    return new RewloyError({
      status: res.status, code: 'INVALID_RESPONSE', detail: `the answer is not the JSON the API documents (${res.headers.get('content-type') ?? 'no content type'})`,
      requestId: res.headers.get('x-request-id'), body, headers: res.headers, operation: id,
    });
  }

  #failure(id: OperationId, res: Response, text: string): RewloyError {
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON: a proxy's page */ }
    const e = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
    const code = e && typeof e.code === 'string' ? e.code : `HTTP_${String(res.status)}`;
    const init = {
      status: res.status, code,
      title: Object.hasOwn(ERROR_TITLES, code) ? ERROR_TITLES[code] : null,
      detail: e && typeof e.message === 'string' ? e.message : res.statusText || `HTTP ${String(res.status)}`,
      details: e?.details, docs: e && typeof e.docs === 'string' ? e.docs : null,
      requestId: res.headers.get('x-request-id') ?? (e && typeof e.requestId === 'string' ? e.requestId : null),
      body: parsed, headers: res.headers, operation: id,
    };
    if (res.status === 429) {
      const header = parseRetryAfter(res.headers.get('retry-after'));
      const fromBody = isRecord(init.details) && typeof init.details.retryAfterSec === 'number' ? init.details.retryAfterSec : null;
      return new RateLimitError({ ...init, retryAfter: header !== null ? Math.ceil(header / 1000) : fromBody });
    }
    return new RewloyError(init);
  }
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : undefined;
  return cause ? `${err.message}: ${cause}` : err.message;
}
