import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ERROR_TITLES, RateLimitError, Rewloy, RewloyConnectionError, RewloyError } from '../src/index.ts';
import { apiError, json, KEY, LOCATION, SERIAL, stub, type Stub } from './helpers.ts';

describe('error mapping', () => {
  let s: Stub;
  let answer: (res: import('node:http').ServerResponse) => void = () => {};
  before(async () => { s = await stub((_req, res) => answer(res)); });
  after(() => s.close());
  const client = () => new Rewloy({ apiKey: KEY, baseUrl: s.url, maxRetries: 0 });
  const caught = async (p: Promise<unknown>): Promise<RewloyError> => {
    try { await p; } catch (err) { assert.ok(err instanceof RewloyError, `not a RewloyError: ${String(err)}`); return err; }
    throw new Error('did not throw');
  };

  it('maps an API error body', async () => {
    answer = (res) => json(res, 409, apiError('INSUFFICIENT_BALANCE', 409, 'bakiye yetersiz: 40,00 ₺ var'), { 'x-request-id': '0192f7c1-8b2e-7a31-9c1d-000000000009' });
    const err = await caught(client().passAction({ params: { serial: SERIAL }, body: { action: 'spend', locationId: LOCATION, amountMinor: 5000 }, idempotencyKey: 'fis-000123' }));
    assert.equal(err.name, 'RewloyError');
    assert.ok(!(err instanceof RateLimitError));
    assert.equal(err.status, 409);
    assert.equal(err.code, 'INSUFFICIENT_BALANCE');
    assert.equal(err.title, 'Bakiye yetersiz');
    assert.equal(err.title, ERROR_TITLES.INSUFFICIENT_BALANCE);
    assert.equal(err.detail, 'bakiye yetersiz: 40,00 ₺ var');
    assert.equal(err.docs, 'https://rewloy.com/gelistiriciler/hatalar#INSUFFICIENT_BALANCE');
    assert.equal(err.requestId, '0192f7c1-8b2e-7a31-9c1d-000000000009', 'the header wins over the body');
    assert.equal(err.operation, 'passAction');
    assert.deepEqual(err.body, apiError('INSUFFICIENT_BALANCE', 409, 'bakiye yetersiz: 40,00 ₺ var'));
    assert.ok(err.headers instanceof Headers);
    assert.equal(err.message, '409 INSUFFICIENT_BALANCE: bakiye yetersiz: 40,00 ₺ var (passAction, requestId 0192f7c1-8b2e-7a31-9c1d-000000000009)');
    assert.match(String(err.stack), /^RewloyError: 409 INSUFFICIENT_BALANCE/);
  });

  it('keeps the validation details', async () => {
    const details = [{ field: 'body', rule: 'maxLength', message: 'en fazla 180 karakter olmalı' }];
    answer = (res) => json(res, 400, apiError('VALIDATION', 400, 'Gönderilen bilgiler geçersiz (gövde): body en fazla 180 karakter olmalı', details));
    const err = await caught(client().sendCampaign({ body: { body: 'x'.repeat(200) }, idempotencyKey: 'kampanya-0001' }));
    assert.equal(err.code, 'VALIDATION');
    assert.deepEqual(err.details, details);
    assert.equal(err.title, 'Gönderilen bilgiler geçersiz');
  });

  it('makes 429 a RateLimitError with retryAfter from the header, else from the details', async () => {
    answer = (res) => json(res, 429, apiError('RATE_LIMITED', 429, 'sınır', { retryAfterSec: 12 }), { 'retry-after': '7' });
    let err = await caught(client().listPrograms());
    assert.ok(err instanceof RateLimitError);
    assert.equal(err.name, 'RateLimitError');
    assert.equal(err.retryAfter, 7);
    assert.equal(err.rateLimit, null);
    answer = (res) => json(res, 429, apiError('RATE_LIMITED', 429, 'sınır'), { 'retry-after': '9', 'ratelimit-limit': '60', 'ratelimit-remaining': '0', 'ratelimit-reset': '9' });
    err = await caught(client().listPrograms());
    assert.ok(err instanceof RateLimitError);
    assert.deepEqual(err.rateLimit, { limit: 60, remaining: 0, reset: 9 });
    answer = (res) => json(res, 429, apiError('RATE_LIMITED', 429, 'çok fazla canlı bağlantı', { retryAfterSec: 12 }));
    err = await caught(client().listPrograms());
    assert.ok(err instanceof RateLimitError && err.retryAfter === 12);
    answer = (res) => json(res, 429, apiError('RATE_LIMITED', 429, 'çok fazla canlı bağlantı'));
    err = await caught(client().listPrograms());
    assert.ok(err instanceof RateLimitError && err.retryAfter === null);
  });

  it('names an answer that is not Rewloy\'s by its status', async () => {
    answer = (res) => { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<html><body>Bad gateway</body></html>'); };
    const err = await caught(client().getPass({ params: { serial: SERIAL } }));
    assert.equal(err.status, 502);
    assert.equal(err.code, 'HTTP_502');
    assert.equal(err.detail, 'Bad Gateway');
    assert.equal(err.title, null);
    assert.equal(err.requestId, null);
    assert.equal(err.body, '<html><body>Bad gateway</body></html>');
  });

  it('refuses a 2xx answer that is not the documented JSON', async () => {
    answer = (res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>captive portal</html>'); };
    const err = await caught(client().getPass({ params: { serial: SERIAL } }));
    assert.equal(err.code, 'INVALID_RESPONSE');
    assert.equal(err.status, 200);
    answer = (res) => json(res, 200, { serial: SERIAL });
    assert.equal((await caught(client().getPass({ params: { serial: SERIAL } }))).code, 'INVALID_RESPONSE');
  });

  it('reports a connection that cannot be made', async () => {
    const closed = await stub(() => {});
    const url = closed.url;
    await closed.close();
    const err = await caught(new Rewloy({ apiKey: KEY, baseUrl: url, maxRetries: 0 }).getPass({ params: { serial: SERIAL } }));
    assert.ok(err instanceof RewloyConnectionError);
    assert.equal(err.status, 0);
    assert.equal(err.code, 'CONNECTION_ERROR');
    assert.equal(err.operation, 'getPass');
    assert.ok(err.cause instanceof Error);
  });
});
