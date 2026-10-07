/**
 * Live tests: the library against a real Rewloy DEV server, end to end.
 * Everything goes through the library (`new Rewloy(...)`), never raw HTTP.
 *
 *   REWLOY_BASE_URL=https://dev.example REWLOY_API_KEY=rwk_test_… npm run test:live
 *
 * Without those two variables every test here is skipped, so `npm test` and
 * `node --test` stay unaffected. It refuses to run unless `GET /v1/meta` says
 * `"environment": "dev"` and the key is a test key (see support.ts).
 *
 * The areas run in order and share what the earlier ones made; each `describe`
 * is one line of the summary. What this file creates it cleans up (webhooks
 * deleted, codes closed, programmes archived); `resetTestEnvironment` at the
 * very end empties the test business of its customers and cards.
 *
 * Not covered yet (needs 1.3.0 operations, see test/live/TODO.md).
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { Rewloy, RewloyError, signWebhook, verifyWebhook } from '../../src/index.ts';
import { liveEnv, preflight, SKIP_REASON, type Checked } from './support.ts';

const env = liveEnv();
const RUN = `lt${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
/** An Idempotency-Key: 8–64 printable ASCII characters, new for every run. */
const key = (name: string): string => `${RUN}-${name}`;
const email = (n: number): string => `${RUN}-${String(n)}@example.com`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSING_UUID = '01a00000-0000-7000-8000-000000000000';

/** What the areas share. */
const ctx: {
  c?: Checked;
  locationId?: string;
  stampProgram?: string;
  giftProgram?: string;
  stampSerial?: string;
  giftSerial?: string;
  saleKey?: string;
  issuedAt?: number;
  batchId?: string;
  customerIssued: number;
  programs: string[];
  batches: string[];
  webhooks: string[];
} = { customerIssued: 0, programs: [], batches: [], webhooks: [] };

const skip = env ? false : SKIP_REASON;
const area = (name: string, fn: () => void): void => { void describe(name, { skip }, fn); };

/** The checked clients; throws before any request if the preflight did not pass. */
function client(): Rewloy {
  if (!ctx.c) throw new Error('preflight did not pass: nothing is sent to the server');
  return ctx.c.rewloy;
}
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is missing: an earlier step failed`);
  return value;
}
/** The error a call is expected to throw. */
async function refused(call: Promise<unknown>, status: number, code: string): Promise<RewloyError> {
  try {
    await call;
  } catch (err) {
    assert.ok(err instanceof RewloyError, `a RewloyError, got ${String(err)}`);
    assert.equal(`${String(err.status)} ${err.code}`, `${String(status)} ${code}`, err.detail);
    return err;
  }
  assert.fail(`expected ${String(status)} ${code}, but the call succeeded`);
}

/** Deletes what the run made, where the API allows; safe to run twice. */
async function cleanup(): Promise<string[]> {
  if (!ctx.c) return [];
  const rewloy = ctx.c.rewloy;
  const notes: string[] = [];
  for (const id of ctx.webhooks.splice(0)) {
    try { await rewloy.deleteWebhook({ params: { id } }); } catch (err) { if (!(err instanceof RewloyError && err.status === 404)) notes.push(`webhook ${id}: ${String(err)}`); }
  }
  for (const id of ctx.batches.splice(0)) {
    try { await rewloy.closeBatch({ params: { id } }); } catch (err) { notes.push(`batch ${id}: ${String(err)}`); }
  }
  for (const id of ctx.programs.splice(0)) {
    try { await rewloy.archiveProgram({ params: { id }, body: {} }); } catch (err) { if (!(err instanceof RewloyError && err.code === 'ALREADY_ARCHIVED')) notes.push(`programme ${id}: ${String(err)}`); }
  }
  return notes;
}

// A run that died half way still cleans up.
after(async () => { if (env) await cleanup().catch(() => undefined); });

area('preflight', () => {
  it('refuses a key that is not a test key, before any request', async () => {
    const e = env!;
    await assert.rejects(preflight({ ...e, apiKey: 'rwk_abcdef0123456789abcdef' }), /test key/);
  });

  it('refuses a server that does not say it is dev', async () => {
    // A stub standing in for a live server: the check must stop before the key is used.
    const { createServer } = await import('node:http');
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(`${req.method ?? ''} ${req.url ?? ''} auth=${String(req.headers.authorization !== undefined)}`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: { version: '1.2.2', apiVersion: 'v1', environment: 'live' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      await assert.rejects(preflight({ baseUrl: `http://127.0.0.1:${String(port)}`, apiKey: env!.apiKey, staffSession: undefined, merchant: undefined }), /not "dev"/);
      assert.deepEqual(seen, ['GET /v1/meta auth=false'], 'only the unauthenticated meta call was made');
    } finally {
      server.close();
    }
  });

  it('refuses a server that does not say anything about its environment', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: { version: '1.1.0', apiVersion: 'v1' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      await assert.rejects(preflight({ baseUrl: `http://127.0.0.1:${String(port)}`, apiKey: env!.apiKey, staffSession: undefined, merchant: undefined }), /environment=null/);
    } finally {
      server.close();
    }
  });

  it('passes against the server under test', async () => {
    ctx.c = await preflight(env!);
    assert.ok(ctx.c.version);
    console.log(`# server ${ctx.c.version} at ${new URL(env!.baseUrl).origin}, run ${RUN}`);
  });
});

area('meta and business', () => {
  it('getMeta: version, apiVersion, environment dev', async () => {
    const meta = await client().getMeta();
    assert.match(meta.version, /^\d+\.\d+\.\d+/);
    assert.equal(meta.apiVersion, 'v1');
    // `environment` is not in the 0.2.4 types (TODO.md); the wire carries it since 1.2.1.
    assert.equal((meta as { environment?: unknown }).environment, 'dev');
  });

  it('the answer carries the version and test mode headers', async () => {
    const res = await client().request('getMeta');
    assert.equal(res.status, 200);
    assert.equal(res.mode, 'test');
    assert.match(res.headers.get('rewloy-version') ?? '', /^\d+\.\d+\.\d+/);
    assert.match(res.requestId ?? '', UUID);
  });

  it('getBusiness: the test business', async () => {
    const b = await client().getBusiness();
    assert.match(b.id, UUID);
    assert.match(b.name, /Test/);
    assert.equal(typeof b.currency, 'string');
  });

  it('listLocations: the test branch', async () => {
    const locations = await client().listLocations();
    assert.ok(locations.length >= 1, 'a test business has a branch');
    ctx.locationId = locations[0]!.id;
    assert.match(ctx.locationId, UUID);
  });
});

area('programs', () => {
  it('createProgram: a stamp programme', async () => {
    const p = await client().createProgram({ body: { type: 'stamp', businessName: 'Live Tests', programName: `Damga ${RUN}`, maxStamps: 6 } });
    assert.match(p.id, UUID);
    assert.equal(p.type, 'stamp');
    assert.equal(p.status, 'active');
    ctx.stampProgram = p.id;
    ctx.programs.push(p.id);
  });

  it('createProgram: a gift card programme', async () => {
    const p = await client().createProgram({ body: { type: 'giftcard', businessName: 'Live Tests', programName: `Hediye ${RUN}` } });
    assert.equal(p.type, 'giftcard');
    ctx.giftProgram = p.id;
    ctx.programs.push(p.id);
  });

  it('listPrograms: both are there, active', async () => {
    const list = await client().listPrograms();
    for (const id of [need(ctx.stampProgram, 'stamp programme'), need(ctx.giftProgram, 'gift programme')]) {
      assert.equal(list.find((p) => p.id === id)?.status, 'active');
    }
  });

  it('getProgram: reads one back', async () => {
    const p = await client().getProgram({ params: { id: need(ctx.stampProgram, 'stamp programme') } });
    assert.equal(p.id, ctx.stampProgram);
    assert.equal(p.type, 'stamp');
  });

  it('a programme that does not exist is a 404 PROGRAM_NOT_FOUND', async () => {
    await refused(client().getProgram({ params: { id: MISSING_UUID } }), 404, 'PROGRAM_NOT_FOUND');
  });
});

area('passes', () => {
  it('issuePass: a stamp card for a new customer', async () => {
    ctx.issuedAt = Date.now();
    const r = await client().issuePass({
      body: { programId: need(ctx.stampProgram, 'stamp programme'), email: email(1), firstName: 'Ada', kvkkConsent: true },
      idempotencyKey: key('issue-stamp'),
    });
    assert.match(r.serial, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.equal(r.created, true);
    assert.ok(r.cardUrl.includes(r.serial));
    ctx.stampSerial = r.serial;
    ctx.customerIssued++;
  });

  it('issuePass: a gift card with a face value', async () => {
    const r = await client().issuePass({ body: { programId: need(ctx.giftProgram, 'gift programme'), faceMinor: 5000 }, idempotencyKey: key('issue-gift') });
    ctx.giftSerial = r.serial;
  });

  it('getPass: the stamp card, empty', async () => {
    const card = await client().getPass({ params: { serial: need(ctx.stampSerial, 'stamp card') } });
    assert.equal(card.serial, ctx.stampSerial);
    assert.equal(card.type, 'stamp');
    assert.equal(card.status, 'active');
    assert.deepEqual(card.stamps, { count: 0, max: 6 });
    assert.equal(card.customer?.name, 'Ada');
    assert.ok(card.actions.some((a) => a.action === 'earn-stamps' && a.ready));
  });

  it('getPass: the gift card carries its money', async () => {
    const card = await client().getPass({ params: { serial: need(ctx.giftSerial, 'gift card') } });
    assert.equal(card.money?.amountMinor, 5000);
    assert.equal(card.balance, 5000);
  });

  it('getPassTill: the till view at the branch', async () => {
    const till = await client().getPassTill({ params: { serial: need(ctx.stampSerial, 'stamp card') }, query: { locationId: need(ctx.locationId, 'branch') } });
    assert.equal(till.allowed, true);
    assert.ok(Array.isArray(till.notices));
  });

  it('getPass: an unknown card is a 404 PASS_NOT_FOUND', async () => {
    await refused(client().getPass({ params: { serial: 'AAAA-BBBB-CCCC' } }), 404, 'PASS_NOT_FOUND');
  });

  it('issuePass: a programme that does not exist is refused', async () => {
    const err = await refused(client().issuePass({ body: { programId: MISSING_UUID, email: email(90), kvkkConsent: true }, idempotencyKey: key('issue-missing') }), 404, 'PROGRAM_NOT_FOUND');
    assert.ok(err.requestId);
  });
});

area('sales and actions', () => {
  it('recordSale without receipt lines: the stamp card earns one', async () => {
    const serial = need(ctx.stampSerial, 'stamp card');
    ctx.saleKey = key('sale-1');
    const sale = await client().recordSale({
      params: { serial },
      body: { locationId: need(ctx.locationId, 'branch'), amountMinor: 4550, reference: `fis-${RUN}-1` },
      idempotencyKey: ctx.saleKey,
    });
    assert.equal(sale.applied, 'stamps');
    assert.equal(sale.credited, 1);
    assert.equal(sale.balance, 1);
    assert.equal(sale.duplicate, false);
    assert.equal(sale.reversed, false);
    assert.equal(sale.card?.serial, serial);
    assert.equal(sale.card?.stamps?.count, 1);
  });

  it('recordSale: the same key again writes nothing (duplicate, card at its current state)', async () => {
    const res = await client().request('recordSale', {
      params: { serial: need(ctx.stampSerial, 'stamp card') },
      body: { locationId: need(ctx.locationId, 'branch'), amountMinor: 4550, reference: `fis-${RUN}-1` },
      idempotencyKey: need(ctx.saleKey, 'sale key'),
    });
    // A sale is replayed from the ledger: `duplicate: true` in the body (issuePass replays by stored answer and header).
    assert.equal(res.data.duplicate, true);
    assert.equal(res.data.balance, 1);
    assert.equal(res.data.card?.stamps?.count, 1);
  });

  it('recordSale with an occurredAt in the past (an offline till queue)', async () => {
    // After the card was issued (else `before_issue`), not in the future beyond the 2 minutes the API forgives.
    const at = new Date(need(ctx.issuedAt, 'issue time') + 5000).toISOString();
    const sale = await client().recordSale({
      params: { serial: need(ctx.stampSerial, 'stamp card') },
      body: { locationId: need(ctx.locationId, 'branch'), amountMinor: 1200, reference: `fis-${RUN}-2`, occurredAt: at },
      idempotencyKey: key('sale-queued'),
    });
    assert.equal(sale.duplicate, false);
    assert.equal(sale.balance, 2);
  });

  it('recordSale with an occurredAt in the future is a 400 VALIDATION naming the reason', async () => {
    const err = await refused(client().recordSale({
      params: { serial: need(ctx.stampSerial, 'stamp card') },
      body: { amountMinor: 100, occurredAt: new Date(Date.now() + 3600_000).toISOString() },
      idempotencyKey: key('sale-future'),
    }), 400, 'VALIDATION');
    assert.ok(Array.isArray(err.details));
  });

  it('recordSale with receipt lines: this API version either takes them or names the field it does not know', async () => {
    // Receipt lines arrive with 1.3.0 (TODO.md); the 0.2.x library has no typed field for them.
    // The server of the release under test answers one of two ways, and nothing else is acceptable.
    const body = { locationId: need(ctx.locationId, 'branch'), amountMinor: 3000, reference: `fis-${RUN}-3`, lines: [{ sku: 'KAHVE', name: 'Filtre kahve', quantity: 2, unitPriceMinor: 1500 }] };
    try {
      const sale = await client().recordSale({ params: { serial: need(ctx.stampSerial, 'stamp card') }, body: body as never, idempotencyKey: key('sale-lines') });
      assert.equal(typeof sale.balance, 'number');
      console.log('# the server accepts receipt lines: add typed tests in the 0.3.0 regeneration (test/live/TODO.md)');
    } catch (err) {
      assert.ok(err instanceof RewloyError);
      assert.equal(`${String(err.status)} ${err.code}`, '400 VALIDATION');
      assert.ok(JSON.stringify(err.details).includes('lines'), 'the error names the field "lines"');
    }
  });

  it('passAction earn-stamps up to a full card, then redeem-stamps', async () => {
    const serial = need(ctx.stampSerial, 'stamp card');
    const locationId = need(ctx.locationId, 'branch');
    const before = (await client().getPass({ params: { serial } })).stamps!.count;
    const earn = await client().passAction({ params: { serial }, body: { action: 'earn-stamps', count: 6 - before, locationId }, idempotencyKey: key('earn-fill') });
    assert.equal(earn.duplicate, false);
    assert.equal('balance' in earn ? earn.balance : -1, 6);
    assert.equal(earn.card?.rewardReady, true);
    const redeem = await client().passAction({ params: { serial }, body: { action: 'redeem-stamps', locationId, reference: `odul-${RUN}` }, idempotencyKey: key('redeem-1') });
    assert.equal('balance' in redeem ? redeem.balance : -1, 0);
    assert.equal(redeem.card?.stamps?.count, 0);
  });

  it('passAction: redeeming again on an empty card is refused', async () => {
    const err = await client().passAction({
      params: { serial: need(ctx.stampSerial, 'stamp card') },
      body: { action: 'redeem-stamps', locationId: need(ctx.locationId, 'branch') },
      idempotencyKey: key('redeem-2'),
    }).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof RewloyError, 'a RewloyError');
    assert.ok(err.status === 409 || err.status === 422, `a 409/422, got ${String(err.status)} ${err.code}`);
  });

  it('passAction spend on the gift card', async () => {
    const spend = await client().passAction({
      params: { serial: need(ctx.giftSerial, 'gift card') },
      body: { action: 'spend', amountMinor: 1500, locationId: need(ctx.locationId, 'branch'), reference: `hediye-${RUN}` },
      idempotencyKey: key('gift-spend'),
    });
    assert.equal('balance' in spend ? spend.balance : -1, 3500);
    assert.equal(spend.card?.money?.amountMinor, 3500);
  });

  it('reverseAction gives the redeemed stamps back; the second call is a duplicate', async () => {
    const serial = need(ctx.stampSerial, 'stamp card');
    const first = await client().reverseAction({ params: { serial }, body: { actionKey: key('redeem-1') } });
    assert.equal(first.undone, 'redeem');
    assert.equal(first.restored, 6);
    assert.equal(first.duplicate, false);
    assert.equal(first.balance, 6);
    const second = await client().reverseAction({ params: { serial }, body: { actionKey: key('redeem-1') } });
    assert.equal(second.duplicate, true);
    assert.equal(second.balance, 6);
  });

  it('reverseAction on the gift card spend (found by its reference)', async () => {
    const back = await client().reverseAction({ params: { serial: need(ctx.giftSerial, 'gift card') }, body: { reference: `hediye-${RUN}` } });
    assert.equal(back.undone, 'spend');
    assert.equal(back.restored, 1500);
    assert.equal(back.balance, 5000);
  });

  it('reverseSale takes the sale back; the second call is a duplicate', async () => {
    const serial = need(ctx.stampSerial, 'stamp card');
    const first = await client().reverseSale({ params: { serial }, body: { saleKey: need(ctx.saleKey, 'sale key') } });
    assert.equal(first.reversed, 1);
    assert.equal(first.duplicate, false);
    assert.equal(first.balance, 5);
    const second = await client().reverseSale({ params: { serial }, body: { saleKey: ctx.saleKey! } });
    assert.equal(second.duplicate, true);
  });

  it('reverseSale for a key that wrote nothing is a 404', async () => {
    const err = await client().reverseSale({ params: { serial: need(ctx.stampSerial, 'stamp card') }, body: { saleKey: key('never-sold') } }).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof RewloyError);
    assert.equal(err.status, 404, `${err.code}`);
  });

  it('passAction without an Idempotency-Key is refused by the library, before any request', async () => {
    await assert.rejects(
      client().passAction({ params: { serial: need(ctx.stampSerial, 'stamp card') }, body: { action: 'earn-stamps', count: 1 } } as never),
      (err: unknown) => err instanceof TypeError && /idempotencyKey/.test(err.message),
    );
  });
});

area('operations list and pagination', () => {
  it('listPassOperations: the ledger of the stamp card, newest first, with undo hints', async () => {
    const res = await client().request('listPassOperations', { params: { serial: need(ctx.stampSerial, 'stamp card') } });
    assert.ok(res.data.length >= 5, `several operations, got ${String(res.data.length)}`);
    assert.equal(res.meta?.page, 1);
    assert.equal(res.meta?.total, res.data.length);
    const times = res.data.map((o) => Date.parse(o.at));
    assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
    const withSaleKey = res.data.find((o) => o.saleKey === ctx.saleKey);
    assert.ok(withSaleKey, 'the first sale is in it, with its key');
    assert.equal(withSaleKey.undoWith, 'sale/reverse');
    assert.ok(res.data.some((o) => o.reversedBy !== null), 'the reversed sale says by what');
  });

  it('paginate walks every page of the ledger (limit 2) and sees each operation once', async () => {
    const serial = need(ctx.stampSerial, 'stamp card');
    const all = await client().request('listPassOperations', { params: { serial }, query: { limit: 100 } });
    const ids: string[] = [];
    for await (const op of client().paginate('listPassOperations', { params: { serial }, query: { limit: 2 } })) ids.push(op.id);
    assert.ok(ids.length > 2, 'more than one page');
    assert.equal(new Set(ids).size, ids.length, 'no operation twice');
    assert.deepEqual(ids, all.data.map((o) => o.id));
  });

  it('a page past the end is empty and still says the total', async () => {
    const res = await client().request('listPassOperations', { params: { serial: need(ctx.stampSerial, 'stamp card') }, query: { page: 99, limit: 10 } });
    assert.equal(res.data.length, 0);
    assert.ok(res.meta && res.meta.total > 0);
  });
});

area('customers', () => {
  it('listCustomers q: finds the customer by e-mail, with the card', async () => {
    const res = await client().request('listCustomers', { query: { q: email(1) } });
    assert.equal(res.meta?.total, 1);
    const c = res.data[0]!;
    assert.equal(c.email, email(1));
    assert.equal(c.firstName, 'Ada');
    assert.equal(c.marketingConsent, true);
    assert.ok(c.cards.some((k) => k.serial === ctx.stampSerial));
  });

  it('listCustomers q: nobody is an empty page, not an error', async () => {
    const res = await client().request('listCustomers', { query: { q: `${RUN}-nobody-at-all` } });
    assert.deepEqual(res.data, []);
    assert.equal(res.meta?.total, 0);
  });

  it('getCustomer reads one back; an unknown id is a 404', async () => {
    const found = await client().listCustomers({ query: { q: email(1) } });
    const c = await client().getCustomer({ params: { id: found.data[0]!.personId } });
    assert.ok(c);
    await refused(client().getCustomer({ params: { id: MISSING_UUID } }), 404, 'CUSTOMER_NOT_FOUND');
  });

  it('paginate listCustomers sees every customer once', async () => {
    for (let n = 2; n <= 4; n++) {
      await client().issuePass({ body: { programId: need(ctx.stampProgram, 'stamp programme'), email: email(n), kvkkConsent: true }, idempotencyKey: key(`issue-c${String(n)}`) });
      ctx.customerIssued++;
    }
    const ids: string[] = [];
    for await (const c of client().paginate('listCustomers', { query: { limit: 2 } })) ids.push(c.personId);
    assert.ok(ids.length >= ctx.customerIssued, `at least ${String(ctx.customerIssued)} customers, got ${String(ids.length)}`);
    assert.equal(new Set(ids).size, ids.length);
  });
});

area('batches (codes)', () => {
  it('createBatch: a gift card code', async () => {
    const b = await client().createBatch({ params: { id: need(ctx.giftProgram, 'gift programme') }, body: { name: `Kod ${RUN}`, valueMinor: 5000, capacity: 5 } });
    assert.match(b.id, UUID);
    assert.match(b.code, /^[0-9A-Z]{6,}$/);
    assert.equal(b.status, 'open');
    assert.equal(b.valueMinor, 5000);
    assert.equal(b.capacity, 5);
    ctx.batchId = b.id;
    ctx.batches.push(b.id);
  });

  it('listBatches (one programme) and getBatch', async () => {
    const id = need(ctx.batchId, 'batch');
    const list = await client().listBatches({ params: { id: need(ctx.giftProgram, 'gift programme') } });
    assert.ok(list.some((b) => b.id === id));
    const one = await client().getBatch({ params: { id } });
    assert.equal(one.id, id);
  });

  it('listAllBatches: filtered by programme, and paginated', async () => {
    const id = need(ctx.batchId, 'batch');
    const res = await client().request('listAllBatches', { query: { programId: need(ctx.giftProgram, 'gift programme'), limit: 1 } });
    assert.equal(res.meta?.pageSize, 1);
    assert.ok(res.data.some((b) => b.id === id));
    const seen: string[] = [];
    for await (const b of client().paginate('listAllBatches', { query: { limit: 1 } })) seen.push(b.id);
    assert.ok(seen.includes(id), 'the walk reaches it');
    assert.equal(new Set(seen).size, seen.length);
  });

  it('sendBatchLink: queued in the test business (nothing is sent)', async () => {
    const r = await client().sendBatchLink({ params: { id: need(ctx.batchId, 'batch') }, body: { email: email(5) } });
    assert.equal(r.result, 'queued');
  });

  it('sendBatchLink refusals: bad address 400, unknown code 404', async () => {
    await refused(client().sendBatchLink({ params: { id: need(ctx.batchId, 'batch') }, body: { email: 'not-an-address' } }), 400, 'VALIDATION');
    await refused(client().sendBatchLink({ params: { id: MISSING_UUID }, body: { email: email(5) } }), 404, 'BATCH_NOT_FOUND');
  });

  it('createBatch refusals: expired date 422, a stamp programme has no codes 422, an archived programme 409', async () => {
    await refused(client().createBatch({ params: { id: need(ctx.giftProgram, 'gift programme') }, body: { name: 'x', valueMinor: 1000, validUntil: '2020-01-01' } }), 422, 'INVALID_BATCH');
    await refused(client().createBatch({ params: { id: need(ctx.stampProgram, 'stamp programme') }, body: { name: 'x', valueMinor: 1000 } }), 422, 'NOT_AN_INSTRUMENT');
    const p = await client().createProgram({ body: { type: 'giftcard', businessName: 'Live Tests', programName: `Arşiv ${RUN}` } });
    await client().archiveProgram({ params: { id: p.id }, body: {} });  // archived here: nothing left to clean up
    await refused(client().createBatch({ params: { id: p.id }, body: { name: 'x', valueMinor: 1000 } }), 409, 'PROGRAM_ARCHIVED');
  });

  it('closeBatch, then sendBatchLink on it is a 410 BATCH_CLOSED and no e-mail goes', async () => {
    const id = need(ctx.batchId, 'batch');
    const closed = await client().closeBatch({ params: { id } });
    assert.equal(closed.status, 'closed');
    await refused(client().sendBatchLink({ params: { id }, body: { email: email(5) } }), 410, 'BATCH_CLOSED');
    ctx.batches.splice(ctx.batches.indexOf(id), 1);
  });
});

area('webhooks', () => {
  it('createWebhook to an https address that does not resolve: created (test business) or refused as documented', async () => {
    try {
      const r = await client().createWebhook({ body: { url: `https://no-such-host-${RUN}.invalid/hook`, events: ['pass.issued'] } });
      ctx.webhooks.push(r.webhook.id);
      assert.match(r.secret, /^whsec_/);
      assert.equal(r.webhook.status, 'active');
      console.log('# the test business accepts a webhook address that does not resolve');
    } catch (err) {
      assert.ok(err instanceof RewloyError);
      assert.equal(`${String(err.status)} ${err.code}`, '422 BAD_WEBHOOK_URL');
    }
  });

  let id = '';
  let secret = '';
  it('createWebhook to a public https address: a secret is shown once', async () => {
    const r = await client().createWebhook({ body: { url: `https://example.com/rewloy-live-tests/${RUN}`, events: ['pass.issued', 'pass.activity'] } });
    id = r.webhook.id;
    secret = r.secret;
    ctx.webhooks.push(id);
    assert.match(secret, /^whsec_/);
    assert.deepEqual([...r.webhook.events].sort(), ['pass.activity', 'pass.issued']);
    assert.equal(r.webhook.status, 'active');
  });

  it('listWebhooks and getWebhook show it, without the secret', async () => {
    const list = await client().listWebhooks();
    const found = list.find((w) => w.id === id);
    assert.ok(found);
    assert.ok(!JSON.stringify(list).includes(secret), 'the secret is not in the list');
    const one = await client().getWebhook({ params: { id } });
    assert.equal(one.id, id);
    assert.ok(!JSON.stringify(one).includes(secret));
  });

  it('createWebhook refusals: no events 400, an unknown event 400', async () => {
    await refused(client().createWebhook({ body: { url: 'https://example.com/x', events: [] } }), 400, 'VALIDATION');
    await refused(client().createWebhook({ body: { url: 'https://example.com/x', events: ['nope.nope'] as never } }), 400, 'VALIDATION');
  });

  it('rotateWebhookSecret: a new secret that signs what the library verifies', async () => {
    const r = await client().rotateWebhookSecret({ params: { id } });
    assert.match(r.secret, /^whsec_/);
    assert.notEqual(r.secret, secret);
    assert.equal(r.webhook.id, id);
    // The new secret and the library's own signer/verifier agree (offline).
    const payload = JSON.stringify({ id: 'evt_1', type: 'pass.issued', data: {} });
    const header = signWebhook({ payload, secret: r.secret });
    const verified = verifyWebhook<{ type: string }>({ payload, header, secret: r.secret });
    assert.equal(verified.type, 'pass.issued');
    secret = r.secret;
  });

  it('deleteWebhook; afterwards it is a 404', async () => {
    assert.equal(await client().deleteWebhook({ params: { id } }), undefined);
    ctx.webhooks.splice(ctx.webhooks.indexOf(id), 1);
    await refused(client().getWebhook({ params: { id } }), 404, 'WEBHOOK_NOT_FOUND');
    await refused(client().deleteWebhook({ params: { id } }), 404, 'WEBHOOK_NOT_FOUND');
  });
});

area('idempotency', () => {
  it('issuePass with the same key replays the same answer, flagged', async () => {
    const body = { programId: need(ctx.stampProgram, 'stamp programme'), email: email(10), kvkkConsent: true as const };
    const first = await client().request('issuePass', { body, idempotencyKey: key('idem-issue') });
    const again = await client().request('issuePass', { body, idempotencyKey: key('idem-issue') });
    ctx.customerIssued++;
    assert.equal(first.replayed, false);
    assert.equal(again.replayed, true);
    assert.equal(again.status, first.status);
    assert.deepEqual(again.data, first.data);
  });

  it('the same key with another body is a 422 IDEMPOTENCY_KEY_REUSED', async () => {
    await refused(client().issuePass({
      body: { programId: need(ctx.stampProgram, 'stamp programme'), email: email(11), kvkkConsent: true },
      idempotencyKey: key('idem-issue'),
    }), 422, 'IDEMPOTENCY_KEY_REUSED');
  });

  it('recordSale replays with the card: same answer, duplicate, card at its current state', async () => {
    const serial = need(ctx.stampSerial, 'stamp card');
    const args = { params: { serial }, body: { locationId: need(ctx.locationId, 'branch'), amountMinor: 700, reference: `fis-${RUN}-idem` }, idempotencyKey: key('idem-sale') };
    const first = await client().request('recordSale', args);
    const again = await client().request('recordSale', args);
    assert.equal(first.data.duplicate, false);
    assert.equal(again.data.duplicate, true);
    assert.equal(again.data.credited, first.data.credited);
    assert.equal(again.data.card?.serial, serial);
    assert.equal(again.data.card?.balance, first.data.card?.balance);
  });

  it('an Idempotency-Key that is not printable ASCII is refused by the library', async () => {
    await assert.rejects(
      client().issuePass({ body: { programId: need(ctx.stampProgram, 'stamp programme'), email: email(12), kvkkConsent: true }, idempotencyKey: 'çok-güzel-anahtar' }),
      (err: unknown) => err instanceof TypeError && /ASCII/.test(err.message),
    );
  });
});

area('rate limit and errors', () => {
  it('the rate-limit headers are read: limit, remaining, reset', async () => {
    const a = await client().request('getBusiness');
    const b = await client().request('getBusiness');
    for (const r of [a.rateLimit, b.rateLimit]) {
      assert.ok(r, 'RateLimit-* headers present');
      assert.ok(Number.isInteger(r.limit) && r.limit > 0);
      assert.ok(r.remaining >= 0 && r.remaining <= r.limit);
      assert.ok(r.reset >= 0);
    }
    assert.ok(b.rateLimit!.remaining <= a.rateLimit!.remaining || b.rateLimit!.reset >= a.rateLimit!.reset, 'the budget shrinks within a window');
  });

  it('a 404 error object: code, status, requestId, title, body', async () => {
    const err = await refused(client().getPass({ params: { serial: 'ZZZZ-ZZZZ-ZZZZ' } }), 404, 'PASS_NOT_FOUND');
    assert.match(err.requestId ?? '', UUID);
    assert.equal(err.operation, 'getPass');
    assert.ok(err.detail);
    assert.ok(err.headers?.get('x-request-id'));
    assert.equal((err.body as { error: { code: string } }).error.code, 'PASS_NOT_FOUND');
  });

  it('a validation error object lists the fields', async () => {
    const err = await refused(client().createProgram({ body: { type: 'nope' } as never }), 400, 'VALIDATION');
    assert.match(err.requestId ?? '', UUID);
    const details = err.details as { field: string; rule: string }[];
    assert.ok(Array.isArray(details) && details.length >= 1);
    assert.ok(details.some((d) => d.field === 'type'));
  });

  it('a wrong key is a 401 INVALID_API_KEY', async () => {
    const bad = new Rewloy({ baseUrl: env!.baseUrl, apiKey: 'rwk_test_0000000000_notarealkeynotarealkeynotarealkey00', maxRetries: 0 });
    const err = await refused(bad.getBusiness(), 401, 'INVALID_API_KEY');
    assert.ok(err.requestId);
  });

  it('an operation that takes a staff session refuses an API key: 403 CREDENTIAL_NOT_ALLOWED', async () => {
    await refused(client().getTestEnvironment(), 403, 'CREDENTIAL_NOT_ALLOWED');
  });
});

area('cleanup', () => {
  it('deletes webhooks, closes codes, archives the programmes it made', async () => {
    const programs = [...ctx.programs];
    const notes = await cleanup();
    assert.deepEqual(notes, []);
    assert.deepEqual(ctx.programs, []);
    const archived = await client().listPrograms({ query: { status: 'archived' } });
    for (const id of programs) assert.equal(archived.find((p) => p.id === id)?.status, 'archived', `programme ${id} archived`);
    assert.deepEqual((await client().listWebhooks()).filter((w) => w.url.includes(RUN)), []);
  });
});

area('test reset', () => {
  const staffNeeded = !env?.staffSession ? 'REWLOY_STAFF_SESSION is not set (resetTestEnvironment takes a staff session of the real business, never an API key)' : false;

  it('resetTestEnvironment: empties customers and cards, keeps the business, programmes and key', { skip: staffNeeded }, async () => {
    const staff = need(ctx.c?.staff ?? undefined, 'staff client');
    // Never reset a test business other than the one this key belongs to.
    const mine = await client().getBusiness();
    const state = await staff.getTestEnvironment(env!.merchant ? { merchant: env!.merchant } : undefined);
    assert.equal(state.inTest, false, 'the staff session must act for the REAL business');
    assert.equal(state.test?.merchantId, mine.id, 'the staff session\'s test environment is the key\'s business');
    assert.ok(state.customers >= ctx.customerIssued);

    const r = await staff.resetTestEnvironment({ ...(env!.merchant ? { merchant: env!.merchant } : {}), body: {} });
    assert.equal(r.merchantId, mine.id);
    assert.equal(r.created, false);
    assert.equal(r.closed, null);
    assert.equal(r.keysRevoked, false);
    assert.ok(r.deleted.customers >= ctx.customerIssued, `deleted ${String(r.deleted.customers)} customers`);
    assert.ok(r.deleted.cards >= ctx.customerIssued + 1);
    assert.ok(r.kept.keys >= 1 && r.kept.programs >= 2);
  });

  it('after the reset: the key still works, no customers, the cards are gone, the same Idempotency-Key writes afresh', { skip: staffNeeded }, async () => {
    const business = await client().getBusiness();
    assert.match(business.name, /Test/);
    const customers = await client().request('listCustomers');
    assert.equal(customers.meta?.total, 0);
    await refused(client().getPass({ params: { serial: need(ctx.stampSerial, 'stamp card') } }), 404, 'PASS_NOT_FOUND');
    // The archived programmes are kept, so a card cannot be issued on them; the reset clears the stored answer all the same.
    const err = await client().issuePass({ body: { programId: need(ctx.stampProgram, 'stamp programme'), email: email(1), kvkkConsent: true }, idempotencyKey: key('issue-stamp') }).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof RewloyError, 'not a replay of the deleted card');
    assert.notEqual(err.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.notEqual(err.status, 401);
  });

  it('resetTestEnvironment refuses an API key', async () => {
    await refused(client().resetTestEnvironment({ body: {} }), 403, 'CREDENTIAL_NOT_ALLOWED');
  });
});
