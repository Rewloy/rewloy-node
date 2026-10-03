/**
 * Server-sent events (`text/event-stream`), as the HTML standard parses them
 * (https://html.spec.whatwg.org/multipage/server-sent-events.html), and the
 * stream the client opens on `liveFeed` and `holderCardEvents`.
 *
 * The API's streams start with `retry: 5000`, send `: hb` every 25 seconds
 * and events as `event: <type>` + `data: <text>`; they carry no `id:` today.
 */

import { RewloyConnectionError, RewloyError, RewloyTimeoutError } from './errors.ts';

/** One event of a stream. */
export interface ServerSentEvent {
  /** The type: the `event:` field, `message` when the event had none. */
  event: string;
  /** The `data:` lines, joined with "\n". */
  data: string;
  /** The last event ID: the latest `id:` field the stream has sent ("" if none). */
  id: string;
}

/**
 * The standard's parser, fed text in pieces of any size: a line, an event or
 * a CRLF may be split anywhere between two pieces.
 */
export class SseParser {
  /** The reconnection time the stream asked for (`retry:`), in milliseconds. */
  retry: number | undefined = undefined;
  /**
   * The last event ID: set from the `id:` buffer at every blank line, kept from
   * one event to the next, as the standard says.
   */
  lastEventId: string;
  #id: string;
  #line = '';
  #data = '';
  #event = '';
  #afterCR = false;
  #started = false;

  constructor(lastEventId = '') {
    this.lastEventId = lastEventId;
    this.#id = lastEventId;
  }

  /** Feeds decoded text; returns the events it completed. */
  push(text: string): ServerSentEvent[] {
    const out: ServerSentEvent[] = [];
    let i = 0;
    if (!this.#started && text.length) {
      this.#started = true;
      if (text.charCodeAt(0) === 0xfeff) i = 1;
    }
    // A CR ended the previous piece: an LF right after it belongs to the same line ending.
    if (this.#afterCR && i < text.length) {
      if (text[i] === '\n') i++;
      this.#afterCR = false;
    }
    while (i < text.length) {
      let j = i;
      while (j < text.length && text[j] !== '\n' && text[j] !== '\r') j++;
      if (j === text.length) {
        this.#line += text.slice(i);
        break;
      }
      const line = this.#line + text.slice(i, j);
      this.#line = '';
      if (text[j] === '\r') {
        if (j + 1 < text.length) { if (text[j + 1] === '\n') j++; } else this.#afterCR = true;
      }
      i = j + 1;
      this.#take(line, out);
    }
    return out;
  }

  /** The stream ended: an event without its blank line is dropped, as the standard says. */
  end(): void {
    this.#line = '';
    this.#data = '';
    this.#event = '';
    this.#afterCR = false;
  }

  #take(line: string, out: ServerSentEvent[]): void {
    if (line === '') {
      this.lastEventId = this.#id;
      if (this.#data === '') {
        this.#event = '';
        return;
      }
      out.push({ event: this.#event || 'message', data: this.#data.endsWith('\n') ? this.#data.slice(0, -1) : this.#data, id: this.lastEventId });
      this.#data = '';
      this.#event = '';
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'event': this.#event = value; break;
      case 'data': this.#data += `${value}\n`; break;
      case 'id': if (!value.includes('\0')) this.#id = value; break;
      case 'retry': if (/^[0-9]+$/.test(value)) this.retry = Number.parseInt(value, 10); break;
      default: break;
    }
  }
}

/** @internal How a stream asks the client for a connection. */
export interface StreamSource {
  operation: string;
  /** Opens one connection: resolves with the answer once its headers are in. */
  connect(lastEventId: string, controller: AbortController): Promise<Response>;
  signal: AbortSignal | undefined;
  reconnect: boolean;
  idleTimeoutMs: number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

const DEFAULT_RETRY_MS = 3000;
const MAX_RECONNECT_MS = 30_000;

/** Errors a new connection may fix. */
function transient(err: unknown): boolean {
  if (err instanceof RewloyConnectionError) return true;
  return err instanceof RewloyError && (err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504 || (err.status >= 520 && err.status <= 524));
}

/**
 * A live stream of server-sent events: iterate it with `for await`. It ends
 * when the signal aborts, on `break`, on `close()`, or with a
 * {@link RewloyError} that a reconnection cannot fix; with `reconnect: false`
 * also when the connection ends.
 */
export class EventStream implements AsyncIterable<ServerSentEvent> {
  /** The last event ID seen; sent as `Last-Event-ID` when reconnecting. */
  lastEventId = '';
  /** The wait before reconnecting, in milliseconds: the server's `retry:` once it sent one. */
  retryMs = DEFAULT_RETRY_MS;
  /** `x-request-id` of the current connection. */
  requestId: string | null = null;
  /** `Rewloy-Mode` of the current connection (see `ApiResponse.mode`). */
  mode: string | null = null;
  readonly #source: StreamSource;
  readonly #close = new AbortController();
  /** Aborts on `close()` and on the caller's signal. */
  readonly #stop: AbortSignal;
  #iterator: AsyncGenerator<ServerSentEvent, void, undefined> | null = null;

  /** @internal Use `client.stream()` or the operation's method. */
  constructor(source: StreamSource) {
    this.#source = source;
    this.#stop = source.signal ? AbortSignal.any([source.signal, this.#close.signal]) : this.#close.signal;
  }

  [Symbol.asyncIterator](): AsyncGenerator<ServerSentEvent, void, undefined> {
    this.#iterator ??= this.#run();
    return this.#iterator;
  }

  /** Closes the connection and ends the iteration. */
  close(): void {
    this.#close.abort();
  }

  #stopped(): boolean {
    return this.#stop.aborted;
  }

  /** Waits before a reconnection; false when the stream was stopped meanwhile. */
  async #wait(ms: number): Promise<boolean> {
    try {
      await this.#source.sleep(ms, this.#stop);
    } catch {
      return false;
    }
    return !this.#stopped();
  }

  async *#run(): AsyncGenerator<ServerSentEvent, void, undefined> {
    const s = this.#source;
    let failures = 0;
    while (!this.#stopped()) {
      const controller = new AbortController();
      const onStop = (): void => controller.abort();
      this.#stop.addEventListener('abort', onStop, { once: true });
      let res: Response;
      try {
        res = await s.connect(this.lastEventId, controller);
      } catch (err) {
        this.#stop.removeEventListener('abort', onStop);
        if (this.#stopped()) return;
        if (!s.reconnect || !transient(err)) throw err;
        failures++;
        if (!(await this.#wait(Math.max(this.retryMs, Math.min(MAX_RECONNECT_MS, 1000 * 2 ** failures))))) return;
        continue;
      }
      this.requestId = res.headers.get('x-request-id');
      this.mode = res.headers.get('rewloy-mode');

      const parser = new SseParser(this.lastEventId);
      const decoder = new TextDecoder();
      let idle: ReturnType<typeof setTimeout> | undefined;
      let silent = false;
      const arm = (): void => {
        if (!(s.idleTimeoutMs > 0 && s.idleTimeoutMs < 2 ** 31)) return;
        clearTimeout(idle);
        idle = setTimeout(() => { silent = true; controller.abort(); }, s.idleTimeoutMs);
      };
      let dropped: RewloyError | null = null;
      try {
        if (!res.body) throw new TypeError('the answer has no body');
        const reader = res.body.getReader();
        arm();
        for (;;) {
          const { done, value } = await reader.read();
          const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
          if (!done) arm();
          for (const event of parser.push(text)) {
            this.lastEventId = event.id;
            failures = 0;
            yield event;
          }
          this.lastEventId = parser.lastEventId;
          if (parser.retry !== undefined) this.retryMs = parser.retry;
          if (done) break;
        }
        parser.end();
      } catch (err) {
        if (this.#stopped()) return;
        dropped = silent
          ? new RewloyTimeoutError({ detail: `no data for ${String(s.idleTimeoutMs)} ms`, operation: s.operation, requestId: this.requestId })
          : new RewloyConnectionError({ detail: err instanceof Error ? err.message : String(err), operation: s.operation, requestId: this.requestId, cause: err });
      } finally {
        clearTimeout(idle);
        controller.abort();
        this.#stop.removeEventListener('abort', onStop);
      }
      if (!s.reconnect) {
        if (dropped) throw dropped;
        return;
      }
      if (dropped) failures++;
      const delay = dropped ? Math.max(this.retryMs, Math.min(MAX_RECONNECT_MS, 1000 * 2 ** failures)) : this.retryMs;
      if (!(await this.#wait(delay))) return;
    }
  }
}
