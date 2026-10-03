import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { signWebhook, verifyWebhook, WebhookSignatureError, type WebhookEvent } from '../src/index.ts';

/**
 * The vectors are made the way the platform signs a delivery (its
 * src/modules/webhooks/service.ts, `sign`), written out again here, not
 * imported:
 *
 *   `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`
 *
 * with `body = JSON.stringify(payload)` and the secret `whsec_…` as the key.
 */
function serverSign(secret: string, body: string, t: number): string {
  return `t=${String(t)},v1=${createHmac('sha256', secret).update(`${String(t)}.${body}`).digest('hex')}`;
}

const SECRET = 'whsec_dGVzdC1zZWNyZXQtZm9yLXJld2xveS1ub2RlLXRlc3Rz';
const T = 1790000000;
const BODY = '{"id":"0192f7c1-8b2e-7a31-9c1d-2e4f5a6b7c8d","type":"pass.activity","created_at":"2026-10-03T12:00:00.000Z","data":{"kind":"earn","card":"ABCD-EFGH-JKLM","program_id":"0192f7c1-0000-7000-8000-000000000002","location_id":"0192f7c1-0000-7000-8000-000000000003","customer_id":"0192f7c1-0000-7000-8000-000000000004","unit":"stamp","delta":2}}';
/** Computed once with the platform's formula; pins it against both sides changing together. */
const FIXED = 't=1790000000,v1=b17b337b887316b1e0e19c3f16bdc4936c03e93d16fbec3da121aacc0ec1eda7';
const TEST_BODY = '{"type":"webhook.test","created_at":"2026-10-03T12:00:00.000Z","data":{"message":"Rewloy webhook testi — ğüşıöç"}}';
const TEST_FIXED = 't=1790000000,v1=b06a92a7fb131aed835f2564fdf06a93461e0edb9216b4464598812f47704b1e';

const refused = (reason: string) => (err: unknown) => err instanceof WebhookSignatureError && err.reason === reason;

describe('verifyWebhook', () => {
  it('accepts what the platform signs, as a string or as bytes', () => {
    assert.equal(serverSign(SECRET, BODY, T), FIXED);
    assert.equal(serverSign(SECRET, TEST_BODY, T), TEST_FIXED);
    for (const payload of [BODY, Buffer.from(BODY), new TextEncoder().encode(BODY), new TextEncoder().encode(BODY).buffer]) {
      const event = verifyWebhook({ payload, header: FIXED, secret: SECRET, now: T + 10 });
      assert.equal(event.type, 'pass.activity');
      assert.equal(event.id, '0192f7c1-8b2e-7a31-9c1d-2e4f5a6b7c8d');
      assert.equal(event.data.card, 'ABCD-EFGH-JKLM');
    }
    const test = verifyWebhook({ payload: Buffer.from(TEST_BODY, 'utf8'), header: TEST_FIXED, secret: SECRET, now: new Date(T * 1000) });
    assert.deepEqual(test, { type: 'webhook.test', created_at: '2026-10-03T12:00:00.000Z', data: { message: 'Rewloy webhook testi — ğüşıöç' } });
  });

  it('accepts a header split into several values, and other entries around v1', () => {
    assert.equal(verifyWebhook({ payload: BODY, header: ['t=1790000000', 'v1=b17b337b887316b1e0e19c3f16bdc4936c03e93d16fbec3da121aacc0ec1eda7'], secret: SECRET, now: T }).type, 'pass.activity');
    assert.equal(verifyWebhook({ payload: BODY, header: ` v0=abc, ${FIXED.replace(',', ' , ')} `, secret: SECRET, now: T }).type, 'pass.activity');
  });

  it('accepts any of several v1 signatures and any of several secrets', () => {
    const other = serverSign('whsec_other', BODY, T).split(',')[1]!;
    assert.equal(verifyWebhook({ payload: BODY, header: `${FIXED},${other}`, secret: SECRET, now: T }).type, 'pass.activity');
    assert.equal(verifyWebhook({ payload: BODY, header: `t=${String(T)},${other},${FIXED.split(',')[1]!}`, secret: SECRET, now: T }).type, 'pass.activity');
    assert.equal(verifyWebhook({ payload: BODY, header: FIXED, secret: ['whsec_new', SECRET], now: T }).type, 'pass.activity');
  });

  it('refuses a changed body, the wrong secret and a v1 for another time', () => {
    assert.throws(() => verifyWebhook({ payload: BODY.replace('"delta":2', '"delta":20'), header: FIXED, secret: SECRET, now: T }), refused('mismatch'));
    assert.throws(() => verifyWebhook({ payload: `${BODY}\n`, header: FIXED, secret: SECRET, now: T }), refused('mismatch'));
    assert.throws(() => verifyWebhook({ payload: BODY, header: FIXED, secret: 'whsec_wrong', now: T }), refused('mismatch'));
    assert.throws(() => verifyWebhook({ payload: BODY, header: FIXED.replace('t=1790000000', 't=1790000001'), secret: SECRET, now: T }), refused('mismatch'));
    // The prefix is part of the key.
    assert.throws(() => verifyWebhook({ payload: BODY, header: FIXED, secret: SECRET.slice('whsec_'.length), now: T }), refused('mismatch'));
  });

  it('refuses a time outside the tolerance, either way', () => {
    assert.equal(verifyWebhook({ payload: BODY, header: FIXED, secret: SECRET, now: T + 300 }).type, 'pass.activity');
    assert.equal(verifyWebhook({ payload: BODY, header: FIXED, secret: SECRET, now: T - 300 }).type, 'pass.activity');
    assert.throws(() => verifyWebhook({ payload: BODY, header: FIXED, secret: SECRET, now: T + 301 }), refused('expired'));
    assert.throws(() => verifyWebhook({ payload: BODY, header: FIXED, secret: SECRET, now: T - 301 }), refused('expired'));
    assert.equal(verifyWebhook({ payload: BODY, header: FIXED, secret: SECRET, now: T + 3600, toleranceSeconds: 3600 }).type, 'pass.activity');
    // Real time: a 2026 signature is long expired.
    assert.throws(() => verifyWebhook({ payload: BODY, header: 't=1000,v1=' + 'a'.repeat(64), secret: SECRET }), refused('expired'));
  });

  it('refuses a missing or malformed header', () => {
    for (const header of [undefined, null, '', '  ']) {
      assert.throws(() => verifyWebhook({ payload: BODY, header, secret: SECRET, now: T }), refused('missing'));
    }
    for (const header of ['v1=' + 'a'.repeat(64), 't=1790000000', 't=abc,v1=' + 'a'.repeat(64), 't=1790000000,v1=xyz', 't=1790000000,v1=' + 'a'.repeat(63), 'garbage']) {
      assert.throws(() => verifyWebhook({ payload: BODY, header, secret: SECRET, now: T }), refused('malformed'), header);
    }
  });

  it('refuses a signed body that is not JSON, and a parsed object as the payload', () => {
    assert.throws(() => verifyWebhook({ payload: 'not json', header: serverSign(SECRET, 'not json', T), secret: SECRET, now: T }), refused('payload'));
    assert.throws(() => verifyWebhook({ payload: JSON.parse(BODY) as never, header: FIXED, secret: SECRET, now: T }), TypeError);
    assert.throws(() => verifyWebhook({ payload: BODY, header: FIXED, secret: '', now: T }), TypeError);
  });

  it('is typed', () => {
    const e: WebhookEvent = verifyWebhook({ payload: BODY, header: FIXED, secret: SECRET, now: T });
    if (e.type === 'webhook.test') assert.fail('not a test');
    else assert.equal(e.data.unit, 'stamp');
  });
});

describe('signWebhook', () => {
  it('signs as the platform does, for testing your own handler', () => {
    assert.equal(signWebhook({ payload: BODY, secret: SECRET, timestamp: T }), FIXED);
    assert.equal(signWebhook({ payload: Buffer.from(TEST_BODY), secret: SECRET, timestamp: T }), TEST_FIXED);
    const header = signWebhook({ payload: BODY, secret: SECRET });
    assert.equal(verifyWebhook({ payload: BODY, header, secret: SECRET }).type, 'pass.activity');
  });
});
