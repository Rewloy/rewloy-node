/**
 * Webhook signatures, exactly as the platform signs a delivery:
 *
 *   Rewloy-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * The key is the whole secret as shown once when the webhook was created
 * (`whsec_…`, prefix included); the message is the timestamp, a dot and the
 * body's bytes as they arrived. Each delivery attempt is signed anew, so a
 * retry carries a fresh `t`.
 *
 * Every delivery also carries `Rewloy-Event` (the event type, as `type` in the
 * body) and `Rewloy-Delivery` (the delivery's id: the same on every retry of
 * one delivery; deliveries are at least once, so skip an id already handled).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** What a webhook's `data` holds for the `pass.*` events (only business facts, never contact details). */
export interface PassEventData {
  /** What happened on the card: `join`, `earn`, `redeem`, `spend`, `visit_credit`, `load`, `void`… */
  kind: string;
  /** The card's serial number, XXXX-XXXX-XXXX. */
  card: string | null;
  program_id: string | null;
  location_id: string | null;
  customer_id: string | null;
  /** What `delta` counts: `stamp`, `point`, `try_minor` (kuruş)… */
  unit?: string;
  delta?: number;
  reward?: unknown;
  use?: unknown;
  reason?: string;
  [key: string]: unknown;
}

/**
 * A webhook delivery's body. Read the person behind `customer_id` from the
 * API; new event types may appear, so keep a default branch.
 */
export type WebhookEvent =
  | {
    /** The event's id. */
    id: string;
    type: 'pass.issued' | 'pass.activity' | 'pass.voided';
    created_at: string;
    data: PassEventData;
  }
  | {
    /** The panel's or `testWebhook`'s test delivery: no event behind it. */
    id?: undefined;
    type: 'webhook.test';
    created_at: string;
    data: { message: string };
  };

/** Why a delivery was refused. */
export type WebhookSignatureReason = 'missing' | 'malformed' | 'expired' | 'mismatch' | 'payload';

/** The delivery is not a genuine one: answer it with 400 and do not act on it. */
export class WebhookSignatureError extends Error {
  readonly reason: WebhookSignatureReason;

  constructor(reason: WebhookSignatureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}
Object.defineProperty(WebhookSignatureError.prototype, 'name', { value: 'WebhookSignatureError', writable: true, configurable: true });

export interface VerifyWebhookOptions {
  /**
   * The body exactly as it arrived: a string or the raw bytes. Not a parsed
   * object: JSON parsing and re-serializing changes the bytes the signature
   * covers (in Express use `express.raw({ type: 'application/json' })`).
   */
  payload: string | Uint8Array | ArrayBuffer;
  /** The `Rewloy-Signature` header. */
  header: string | readonly string[] | null | undefined;
  /** The webhook's secret (`whsec_…`); several while you move from one webhook to another. */
  secret: string | readonly string[];
  /** How far `t` may be from now, in seconds. Default 300. */
  toleranceSeconds?: number | undefined;
  /** The current time: a `Date`, or Unix time in seconds (the unit of `t`). For tests. */
  now?: Date | number | undefined;
}

const V1 = /^[0-9a-f]{64}$/i;

function bytesOf(payload: VerifyWebhookOptions['payload']): Buffer {
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  if (ArrayBuffer.isView(payload)) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  throw new TypeError('verifyWebhook: `payload` must be the raw body (a string or bytes), not a parsed object');
}

function signature(secret: string, t: string, body: Buffer): Buffer {
  return createHmac('sha256', secret).update(`${t}.`).update(body).digest();
}

/**
 * Checks a delivery's `Rewloy-Signature` and returns its parsed body.
 * Throws {@link WebhookSignatureError} when the header is missing or
 * malformed, `t` is further than `toleranceSeconds` from now, or no `v1`
 * matches; the comparison takes constant time.
 */
export function verifyWebhook<T = WebhookEvent>(options: VerifyWebhookOptions): T {
  const { header, toleranceSeconds = 300 } = options;
  const body = bytesOf(options.payload);
  const secrets = (typeof options.secret === 'string' ? [options.secret] : [...options.secret]).filter((s) => s !== '');
  if (!secrets.length) throw new TypeError('verifyWebhook: `secret` is empty');

  const value = typeof header === 'string' ? header : Array.isArray(header) ? header.join(',') : '';
  if (!value.trim()) throw new WebhookSignatureError('missing', 'No Rewloy-Signature header');
  let t: string | undefined;
  const candidates: Buffer[] = [];
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't' && t === undefined) t = v;
    else if (k === 'v1' && V1.test(v)) candidates.push(Buffer.from(v, 'hex'));
  }
  if (t === undefined || !/^\d+$/.test(t) || !candidates.length) {
    throw new WebhookSignatureError('malformed', 'Rewloy-Signature is not "t=<unix seconds>,v1=<hex>"');
  }

  const now = options.now === undefined ? Date.now() / 1000 : options.now instanceof Date ? options.now.getTime() / 1000 : options.now;
  if (Math.abs(now - Number(t)) > toleranceSeconds) {
    throw new WebhookSignatureError('expired', `The signature's time (t=${t}) is more than ${String(toleranceSeconds)} seconds from now`);
  }

  let match = false;
  for (const secret of secrets) {
    const expected = signature(secret, t, body);
    for (const candidate of candidates) {
      // Every pair is compared, in constant time, whether or not one matched already.
      if (timingSafeEqual(candidate, expected)) match = true;
    }
  }
  if (!match) throw new WebhookSignatureError('mismatch', 'No v1 signature matches the body and the secret');

  try {
    return JSON.parse(body.toString('utf8')) as T;
  } catch {
    throw new WebhookSignatureError('payload', 'The signed body is not JSON');
  }
}

export interface SignWebhookOptions {
  payload: string | Uint8Array | ArrayBuffer;
  secret: string;
  /** Unix time in seconds; default now. */
  timestamp?: number | undefined;
}

/**
 * The `Rewloy-Signature` header the platform would send for this body: for
 * testing your own webhook handler.
 */
export function signWebhook(options: SignWebhookOptions): string {
  const t = String(Math.floor(options.timestamp ?? Date.now() / 1000));
  return `t=${t},v1=${signature(options.secret, t, bytesOf(options.payload)).toString('hex')}`;
}
