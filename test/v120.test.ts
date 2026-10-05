import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { OPERATIONS, Rewloy, RewloyError } from '../src/index.ts';
import { apiError, json, KEY, LOCATION, SERIAL, stub, type Stub } from './helpers.ts';

const WEBHOOK = '0192f7c1-0000-7000-8000-0000000000aa';

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
      if (url.startsWith('/v1/batches')) return json(res, 200, { data: [{ id: 'b1', status: 'open', state: 'archived' }], meta: { page: 1, pageSize: 50, total: 1 } });
      if (url === `/v1/developers/webhooks/${WEBHOOK}/rotate-secret`) return json(res, 200, { data: { secret: 'whsec_new', previousValidUntil: '2026-10-07T10:00:00.000Z' } });
      if (url === `/v1/developers/webhooks/${WEBHOOK}` && req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
      if (url === '/v1/developers/keys') return json(res, 201, { data: { token: 'rwk_x_y', baseUrl: 'https://app.rewloy.com' } });
      if (url === '/v1/test/environment/reset') return json(res, 200, { data: { keysRevoked: true } });
      if (url === '/v1/programs/p1/batches') return json(res, 409, apiError('PROGRAM_ARCHIVED', 409, 'Program arşivde'));
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
});
