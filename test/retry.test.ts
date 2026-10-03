import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RateLimitError, Rewloy, RewloyConnectionError, RewloyError, RewloyTimeoutError } from '../src/index.ts';
import { backoff, parseRetryAfter } from '../src/client.ts';
import { apiError, delay, json, KEY, LOCATION, recordingSleep, SERIAL, stub } from './helpers.ts';

const action = { params: { serial: SERIAL }, body: { action: 'earn-stamps' as const, locationId: LOCATION } };

describe('backoff', () => {
  it('doubles from 0.5 s up to 8 s, with jitter between half and all of it', () => {
    assert.equal(backoff(0, () => 0), 250);
    assert.equal(backoff(0, () => 1), 500);
    assert.equal(backoff(1, () => 1), 1000);
    assert.equal(backoff(2, () => 0.5), 1500);
    assert.equal(backoff(10, () => 1), 8000);
    assert.equal(backoff(10, () => 0), 4000);
  });

  it('reads Retry-After as seconds or an HTTP date', () => {
    assert.equal(parseRetryAfter('2'), 2000);
    assert.equal(parseRetryAfter('1.5'), 1500);
    const now = Date.parse('2026-10-03T12:00:00Z');
    assert.equal(parseRetryAfter('Sat, 03 Oct 2026 12:00:03 GMT', now), 3000);
    assert.equal(parseRetryAfter('Sat, 03 Oct 2026 11:59:00 GMT', now), 0);
    assert.equal(parseRetryAfter(null), null);
    assert.equal(parseRetryAfter('soon'), null);
  });
});

describe('retries', () => {
  it('retries a GET on 502/503/504 with backoff, then succeeds', async () => {
    const statuses = [503, 502, 200];
    const s = await stub((_req, res, n) => json(res, statuses[n - 1]!, statuses[n - 1] === 200 ? { data: { ok: n } } : apiError('INTERNAL', 503, 'x')));
    const { sleeps, sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep });
      assert.deepEqual(await c.getPass({ params: { serial: SERIAL } }), { ok: 3 });
      assert.equal(s.requests.length, 3);
      assert.equal(sleeps.length, 2);
      assert.ok(sleeps[0]! >= 250 && sleeps[0]! <= 500, `first wait ${String(sleeps[0])}`);
      assert.ok(sleeps[1]! >= 500 && sleeps[1]! <= 1000, `second wait ${String(sleeps[1])}`);
    } finally {
      await s.close();
    }
  });

  it('gives up after maxRetries and throws the last answer', async () => {
    const s = await stub((_req, res) => json(res, 504, apiError('INTERNAL', 504, 'gateway')));
    const { sleeps, sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep });
      await assert.rejects(c.getPass({ params: { serial: SERIAL } }), (err: unknown) => err instanceof RewloyError && err.status === 504);
      assert.equal(s.requests.length, 3);
      assert.equal(sleeps.length, 2);
      await assert.rejects(c.getPass({ params: { serial: SERIAL }, maxRetries: 0 }));
      assert.equal(s.requests.length, 4);
      await assert.rejects(new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep, maxRetries: 5 }).getPass({ params: { serial: SERIAL } }));
      assert.equal(s.requests.length, 10);
    } finally {
      await s.close();
    }
  });

  it('honours Retry-After on 429', async () => {
    const s = await stub((_req, res, n) => (n === 1
      ? json(res, 429, apiError('RATE_LIMITED', 429, 'Bu anahtarın dakikalık istek sınırı aşıldı', { retryAfterSec: 2 }), { 'retry-after': '2' })
      : json(res, 200, { data: [] })));
    const { sleeps, sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep });
      assert.deepEqual(await c.listPrograms(), []);
      assert.deepEqual(sleeps, [2000]);
    } finally {
      await s.close();
    }
  });

  it('does not wait out a long Retry-After: the caller gets RateLimitError', async () => {
    const s = await stub((_req, res) => json(res, 429, apiError('RATE_LIMITED', 429, 'Çok fazla hatalı kod.', { retryAfterSec: 900 }), { 'retry-after': '900' }));
    const { sleeps, sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep });
      await assert.rejects(c.listPrograms(), (err: unknown) => err instanceof RateLimitError && err.retryAfter === 900);
      assert.equal(s.requests.length, 1);
      assert.deepEqual(sleeps, []);
    } finally {
      await s.close();
    }
  });

  it('never retries a POST without an Idempotency-Key, nor a PATCH', async () => {
    const s = await stub((_req, res) => json(res, 503, apiError('INTERNAL', 503, 'busy')));
    const { sleeps, sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep });
      await assert.rejects(c.issuePass({ body: { programId: LOCATION } }), (err: unknown) => err instanceof RewloyError && err.status === 503);
      assert.equal(s.requests.length, 1);
      await assert.rejects(c.updateProgram({ params: { id: LOCATION }, body: {} }));
      assert.equal(s.requests.length, 2);
      assert.deepEqual(sleeps, []);
    } finally {
      await s.close();
    }
  });

  it('retries PUT and DELETE', async () => {
    const s = await stub((_req, res, n) => {
      if (n % 2 === 1) return json(res, 503, apiError('INTERNAL', 503, 'busy'));
      if (n === 2) return json(res, 200, { data: { hosts: [] } });
      res.writeHead(204);
      res.end();
    });
    const { sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep });
      await c.setEmbedHosts({ body: { hosts: [] } });
      await c.unblockEmail({ params: { hash: 'abc' } });
      assert.deepEqual(s.requests.map((r) => r.method), ['PUT', 'PUT', 'DELETE', 'DELETE']);
    } finally {
      await s.close();
    }
  });

  it('retries a till action with the same Idempotency-Key', async () => {
    const s = await stub((_req, res, n) => (n === 1 ? json(res, 503, apiError('INTERNAL', 503, 'busy')) : json(res, 200, { data: { balance: 3, duplicate: false } })));
    const { sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep });
      assert.deepEqual(await c.passAction(action), { balance: 3, duplicate: false });
      assert.equal(s.requests.length, 2);
      const keys = s.requests.map((r) => r.headers['idempotency-key']);
      assert.ok(typeof keys[0] === 'string' && keys[0].length === 36);
      assert.equal(keys[1], keys[0]);
      await c.passAction({ ...action, idempotencyKey: 'fis-42-0001' });
      assert.equal(s.requests[2]!.headers['idempotency-key'], 'fis-42-0001');
    } finally {
      await s.close();
    }
  });

  it('waits out IDEMPOTENCY_IN_PROGRESS on a campaign send, then reads the replayed answer', async () => {
    const s = await stub((_req, res, n) => (n === 1
      ? json(res, 409, apiError('IDEMPOTENCY_IN_PROGRESS', 409, 'Bu anahtarla gelen ilk istek hâlâ işleniyor'))
      : json(res, 201, { data: { id: 'c1' } }, { 'idempotent-replayed': 'true' })));
    const { sleeps, sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep });
      const res = await c.request('sendCampaign', { body: { body: 'Merhaba' }, idempotencyKey: 'kampanya-2026-10-03' });
      assert.equal(res.replayed, true);
      assert.equal(sleeps.length, 1);
      assert.deepEqual(s.requests.map((r) => r.headers['idempotency-key']), ['kampanya-2026-10-03', 'kampanya-2026-10-03']);
    } finally {
      await s.close();
    }
  });

  it('retries when the connection breaks, for a GET only', async () => {
    const s = await stub((req, res, n) => {
      if (n === 1 || n === 3) { req.socket.destroy(); return; }
      json(res, 200, { data: { ok: true } });
    });
    const { sleeps, sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep });
      assert.deepEqual(await c.getPass({ params: { serial: SERIAL } }), { ok: true });
      assert.equal(sleeps.length, 1);
      await assert.rejects(c.issuePass({ body: { programId: LOCATION } }), (err: unknown) => err instanceof RewloyConnectionError && err.status === 0 && err.code === 'CONNECTION_ERROR');
      assert.equal(s.requests.length, 3);
    } finally {
      await s.close();
    }
  });

  it('times out a silent attempt and retries it', async () => {
    const s = await stub((_req, res, n) => { if (n > 1) json(res, 200, { data: { ok: true } }); });
    const { sleeps, sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep, timeoutMs: 50 });
      assert.deepEqual(await c.getPass({ params: { serial: SERIAL } }), { ok: true });
      assert.equal(s.requests.length, 2);
      assert.equal(sleeps.length, 1);
    } finally {
      await s.close();
    }
  });

  it('throws RewloyTimeoutError when every attempt times out', async () => {
    const s = await stub(() => { /* never answers */ });
    const { sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep, timeoutMs: 30, maxRetries: 1 });
      await assert.rejects(c.getPass({ params: { serial: SERIAL } }), (err: unknown) => err instanceof RewloyTimeoutError && err.code === 'TIMEOUT' && err instanceof RewloyConnectionError);
      assert.equal(s.requests.length, 2);
      // A per-call timeout wins over the client's.
      await assert.rejects(new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep, maxRetries: 0 }).getPass({ params: { serial: SERIAL }, timeoutMs: 20 }), RewloyTimeoutError);
    } finally {
      await s.close();
    }
  });

  it('stops at once when the caller aborts: during the request, and during the wait', async () => {
    const s = await stub((_req, res, n) => { if (n === 2) json(res, 503, apiError('INTERNAL', 503, 'busy'), { 'retry-after': '30' }); });
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
      const first = new AbortController();
      setTimeout(() => first.abort(), 20);
      await assert.rejects(c.getPass({ params: { serial: SERIAL }, signal: first.signal }), { name: 'AbortError' });
      assert.equal(s.requests.length, 1);

      const second = new AbortController();
      const started = Date.now();
      setTimeout(() => second.abort(new Error('stop')), 50);
      await assert.rejects(c.getPass({ params: { serial: SERIAL }, signal: second.signal }), /stop/);
      assert.ok(Date.now() - started < 5000, 'did not wait out Retry-After');
      assert.equal(s.requests.length, 2);
      await delay(10);
    } finally {
      await s.close();
    }
  });
});
