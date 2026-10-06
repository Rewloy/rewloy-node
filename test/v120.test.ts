import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { OPERATIONS, Rewloy, RewloyError, type Operations } from '../src/index.ts';
import { apiError, json, KEY, LOCATION, SERIAL, stub, type Stub } from './helpers.ts';

const WEBHOOK = '0192f7c1-0000-7000-8000-0000000000aa';

/** A webhook object as 1.2.0 answers: `pausedUntil` and `resumableUntil` are always present. */
const webhookRow = (state: { pausedUntil: string | null; resumableUntil: string | null }) => ({
  id: WEBHOOK,
  url: 'https://ornek.com/rewloy/webhook',
  events: ['pass.activity'],
  status: 'active',
  failures: 0,
  disabledReason: null,
  createdAt: '2026-10-06T09:00:00.000Z',
  week: { delivered: 3, failed: 0, pending: 1 },
  lastDelivered: '2026-10-06T09:30:00.000Z',
  createdByKey: null,
  ...state,
});

describe('Rewloy 1.2.0 operations', () => {
  let s: Stub;
  before(async () => {
    s = await stub((req, res) => {
      const url = req.url ?? '';
      if (url.startsWith(`/v1/passes/${SERIAL}/operations`)) {
        return json(res, 200, {
          data: [{ id: 'o1', kind: 'earn', delta: 1, unit: 'stamp', saleKey: 'kasa3-z0187-fis0042', undoWith: 'sale/reverse', reversible: true, byCaller: true }],
          meta: { page: 1, pageSize: 50, total: 1 },
        });
      }
      const refusal = /^\/v1\/batches\/(b-[a-z]+)\/send$/.exec(url);
      if (refusal) {
        const [status, code] = { 'b-closed': [410, 'BATCH_CLOSED'], 'b-expired': [410, 'BATCH_EXPIRED'], 'b-full': [410, 'BATCH_FULL'], 'b-archived': [409, 'PROGRAM_ARCHIVED'] }[refusal[1]!] as [number, string];
        return json(res, status, apiError(code, status, code));
      }
      if (url.startsWith('/v1/batches')) return json(res, 200, { data: [{ id: 'b1', status: 'open', state: 'archived' }], meta: { page: 1, pageSize: 50, total: 1 } });
      if (url === `/v1/developers/webhooks/${WEBHOOK}/rotate-secret`) return json(res, 200, { data: { secret: 'whsec_new', previousValidUntil: '2026-10-07T10:00:00.000Z' } });
      if (url === `/v1/developers/webhooks/${WEBHOOK}` && req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
      if (url === '/v1/developers/keys') return json(res, 201, { data: { token: 'rwk_x_y', baseUrl: 'https://app.rewloy.com' } });
      if (url === '/v1/test/environment/reset') return json(res, 200, { data: { keysRevoked: true } });
      if (url === '/v1/programs/p1/batches') return json(res, 409, apiError('PROGRAM_ARCHIVED', 409, 'Program arşivde'));
      if (url === '/v1/developers/webhooks' && req.method === 'GET') {
        return json(res, 200, { data: [webhookRow({ pausedUntil: '2026-10-06T10:01:00.000Z', resumableUntil: null }), webhookRow({ pausedUntil: null, resumableUntil: '2026-10-07T09:45:00.000Z' })] });
      }
      if (url === `/v1/developers/webhooks/${WEBHOOK}` && req.method === 'PATCH') {
        return json(res, 200, { data: { ...webhookRow({ pausedUntil: null, resumableUntil: null }), status: 'active' } });
      }
      if (url.endsWith('/sale')) {
        return json(res, 200, { data: { type: 'stamp', applied: 'stamps', credited: 1, balance: 3, duplicate: true, reversed: true, rewardReady: false, rewardsReady: 0, card: null } });
      }
      return json(res, 200, { data: { ok: true } });
    });
  });
  after(() => s.close());
  const last = () => s.requests[s.requests.length - 1]!;
  const client = () => new Rewloy({ apiKey: KEY, baseUrl: s.url });

  it('knows the new operations', () => {
    for (const id of ['listPassOperations', 'listAllBatches', 'rotateWebhookSecret', 'deleteWebhook']) assert.ok(id in OPERATIONS, id);
    assert.equal(OPERATIONS.listPassOperations.paged, true);
    assert.equal(OPERATIONS.listAllBatches.paged, true);
  });

  it('lists a card\'s operations and pages them', async () => {
    const page = await client().listPassOperations({ params: { serial: SERIAL }, query: { limit: 10 } });
    assert.equal(page.data[0]!.undoWith, 'sale/reverse');
    assert.match(last().url, /\/operations\?limit=10$/);
    const seen: string[] = [];
    for await (const op of client().paginate('listPassOperations', { params: { serial: SERIAL } })) seen.push(op.id);
    assert.deepEqual(seen, ['o1']);
  });

  it('lists every batch, with the archived state', async () => {
    const page = await client().listAllBatches({ query: { status: 'archived' } });
    assert.equal(page.data[0]!.state, 'archived');
    assert.equal(last().url, '/v1/batches?status=archived');
  });

  it('rotates and deletes a webhook', async () => {
    const r = await client().rotateWebhookSecret({ params: { id: WEBHOOK } });
    assert.equal(r.secret, 'whsec_new');
    assert.equal(last().method, 'POST');
    assert.equal(await client().deleteWebhook({ params: { id: WEBHOOK } }), undefined);
    assert.equal(last().method, 'DELETE');
  });

  it('creates a pos key and resets the test environment with revokeKeys', async () => {
    await client().createApiKey({ body: { kind: 'pos', locationId: LOCATION, register: 'Kasa 1', password: 'x' } });
    assert.deepEqual(JSON.parse(last().body), { kind: 'pos', locationId: LOCATION, register: 'Kasa 1', password: 'x' });
    await client().resetTestEnvironment({ body: { revokeKeys: true } });
    assert.deepEqual(JSON.parse(last().body), { revokeKeys: true });
  });

  it('types `card` and `reversed` on a replayed sale, card may be null', async () => {
    const sale = await client().recordSale({ params: { serial: SERIAL }, body: { locationId: LOCATION, amountMinor: 100 }, idempotencyKey: 'kasa3-z0187-fis0042' });
    assert.equal(sale.reversed, true);
    const ready: boolean | undefined = sale.card?.actions.some((a) => a.ready);
    assert.equal(ready, undefined, 'card is null here');
  });

  it('surfaces PROGRAM_ARCHIVED', async () => {
    await assert.rejects(client().createBatch({ params: { id: 'p1' }, body: {} as never }), (err: unknown) => err instanceof RewloyError && err.status === 409 && err.code === 'PROGRAM_ARCHIVED');
  });

  it('types the webhook state fields, a date-time or null', async () => {
    const rows = await client().listWebhooks();
    const paused: string | null = rows[0]!.pausedUntil;
    const resumable: string | null = rows[1]!.resumableUntil;
    assert.equal(paused, '2026-10-06T10:01:00.000Z');
    assert.equal(rows[0]!.resumableUntil, null);
    assert.equal(rows[1]!.pausedUntil, null);
    assert.equal(resumable, '2026-10-07T09:45:00.000Z');
    const turnedOn = await client().setWebhookStatus({ params: { id: WEBHOOK }, body: { active: true } });
    assert.deepEqual([turnedOn.pausedUntil, turnedOn.resumableUntil], [null, null]);
    assert.equal(last().method, 'PATCH');
  });

  it('surfaces what sendBatchLink refuses: BATCH_CLOSED, BATCH_EXPIRED, BATCH_FULL and PROGRAM_ARCHIVED', async () => {
    for (const [batch, status, code] of [['b-closed', 410, 'BATCH_CLOSED'], ['b-expired', 410, 'BATCH_EXPIRED'], ['b-full', 410, 'BATCH_FULL'], ['b-archived', 409, 'PROGRAM_ARCHIVED']] as const) {
      await assert.rejects(client().sendBatchLink({ params: { id: batch }, body: { email: 'ali@ornek.com' } }), (err: unknown) => err instanceof RewloyError && err.status === status && err.code === code, code);
    }
  });

  it('documents the refusals in the typed answers of sendBatchLink', () => {
    type Refusals = Operations['sendBatchLink']['responses'];
    const archived: Refusals[409]['error']['code'] = 'PROGRAM_ARCHIVED';
    const gone: Refusals[410]['error']['code'][] = ['BATCH_CLOSED', 'BATCH_EXPIRED', 'BATCH_FULL'];
    assert.equal(archived, 'PROGRAM_ARCHIVED');
    assert.equal(gone.length, 3);
  });
});
