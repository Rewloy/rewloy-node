import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { EventStream, OPERATIONS, Rewloy, VERSION } from '../src/index.ts';
import { HOLDER, json, KEY, LOCATION, MERCHANT, SERIAL, STAFF, stub, type Stub } from './helpers.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('construction', () => {
  it('takes one credential of the right kind', () => {
    assert.equal(new Rewloy({ apiKey: KEY }).credential, 'key');
    assert.equal(new Rewloy({ staffSession: STAFF, merchant: MERCHANT }).merchant, MERCHANT);
    assert.equal(new Rewloy({ holderSession: HOLDER }).credential, 'holder');
    assert.equal(new Rewloy().credential, null);
    assert.throws(() => new Rewloy({ apiKey: STAFF }), /apiKey must start with "rwk_"/);
    assert.throws(() => new Rewloy({ staffSession: KEY }), /staffSession must start with "rws_"/);
    assert.throws(() => new Rewloy({ holderSession: 'abc' }), /holderSession must start with "rwh_"/);
    assert.throws(() => new Rewloy({ apiKey: KEY, holderSession: HOLDER } as never), /one credential/);
    assert.throws(() => new Rewloy({ apiKey: KEY, merchant: MERCHANT } as never), /merchant/);
  });

  it('has defaults', () => {
    const c = new Rewloy({ apiKey: KEY });
    assert.equal(c.baseUrl, 'https://app.rewloy.com');
    assert.equal(c.timeoutMs, 60_000);
    assert.equal(c.maxRetries, 2);
    assert.equal(new Rewloy({ baseUrl: 'http://localhost:3000/' }).baseUrl, 'http://localhost:3000');
  });

  it('says the same version as package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    assert.equal(VERSION, pkg.version);
  });

  it('has a method for every operation', () => {
    const c = new Rewloy();
    const ids = Object.keys(OPERATIONS);
    assert.ok(ids.length > 200);
    for (const id of ids) assert.equal(typeof (c as unknown as Record<string, unknown>)[id], 'function', id);
  });
});

describe('requests', () => {
  let s: Stub;
  before(async () => {
    s = await stub((req, res) => {
      const url = req.url ?? '';
      if (url.startsWith('/v1/customers')) return json(res, 200, { data: [{ personId: 'p1' }], meta: { page: 1, pageSize: 50, total: 1 } });
      if (url.startsWith('/v1/developers/keys/')) { res.writeHead(204, { 'x-request-id': 'r-204' }); res.end(); return; }
      if (url.endsWith('/map.png')) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47])); return; }
      if (url === '/v1/openapi.json') return json(res, 200, { openapi: '3.1.0', paths: {} });
      if (url === '/v1/campaigns' && req.method === 'POST') return json(res, 201, { data: { id: 'c1' } }, { 'idempotent-replayed': 'true', 'rewloy-mode': 'test', 'x-request-id': 'r-campaign' });
      return json(res, 200, { data: { ok: true } });
    });
  });
  after(() => s.close());
  const last = () => s.requests[s.requests.length - 1]!;

  it('sends the API key, the client and no merchant', async () => {
    const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, userAgent: 'KasaPOS/4.2' });
    assert.deepEqual(await c.getPass({ params: { serial: SERIAL } }), { ok: true });
    const r = last();
    assert.equal(r.method, 'GET');
    assert.equal(r.url, `/v1/passes/${SERIAL}`);
    assert.equal(r.headers.authorization, `Bearer ${KEY}`);
    assert.equal(r.headers['user-agent'], `rewloy-node/${VERSION} node/${process.versions.node} KasaPOS/4.2`);
    assert.equal(r.headers.accept, 'application/json');
    assert.equal(r.headers['rewloy-merchant'], undefined);
    assert.equal(r.headers['content-type'], undefined);
    assert.equal(r.headers['idempotency-key'], undefined);
  });

  it('sends a staff session with its merchant, overridable per call', async () => {
    const c = new Rewloy({ staffSession: STAFF, merchant: MERCHANT, baseUrl: s.url });
    await c.listPrograms();
    assert.equal(last().headers.authorization, `Bearer ${STAFF}`);
    assert.equal(last().headers['rewloy-merchant'], MERCHANT);
    await c.listPrograms({ merchant: 'other-merchant' });
    assert.equal(last().headers['rewloy-merchant'], 'other-merchant');
    // An operation without the header never gets it.
    await c.login({ body: { email: 'a@b.co', password: 'x' } });
    assert.equal(last().headers['rewloy-merchant'], undefined);
  });

  it('sends a holder session', async () => {
    const c = new Rewloy({ holderSession: HOLDER, baseUrl: s.url });
    await c.holderCards({ query: { merchant: 'kahve-dukkani' } });
    assert.equal(last().headers.authorization, `Bearer ${HOLDER}`);
    assert.equal(last().url, '/v1/holder/cards?merchant=kahve-dukkani');
  });

  it('calls an operation that does not take this credential, but works without one, without it', async () => {
    const key = new Rewloy({ apiKey: KEY, baseUrl: s.url });
    await key.login({ body: { email: 'a@b.co', password: 'x' } });
    assert.equal(last().headers.authorization, undefined);
    await key.holderProviderNonce({ body: { provider: 'google' } });
    assert.equal(last().headers.authorization, undefined);
    const holder = new Rewloy({ holderSession: HOLDER, baseUrl: s.url });
    await holder.holderProviderNonce({ body: { provider: 'google' } });
    assert.equal(last().headers.authorization, `Bearer ${HOLDER}`);
    await holder.publicProgram({ params: { id: LOCATION } });
    assert.equal(last().headers.authorization, `Bearer ${HOLDER}`);
    // Not public: the credential goes, and the API answers whether it may.
    await key.holderCards();
    assert.equal(last().headers.authorization, `Bearer ${KEY}`);
    await new Rewloy({ baseUrl: s.url }).holderCards();
    assert.equal(last().headers.authorization, undefined);
  });

  it('sends JSON bodies, and {} when an all-optional body is left out', async () => {
    const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
    await c.issuePass({ body: { programId: LOCATION, email: 'ayse@example.com', kvkkConsent: true } });
    assert.equal(last().method, 'POST');
    assert.equal(last().headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(last().body), { programId: LOCATION, email: 'ayse@example.com', kvkkConsent: true });
    await c.updateProgram({ params: { id: LOCATION } });
    assert.equal(last().method, 'PATCH');
    assert.equal(last().body, '{}');
    await c.closeBatch({ params: { id: LOCATION } });
    assert.equal(last().body, '');
    assert.equal(last().headers['content-type'], undefined);
  });

  it('generates an Idempotency-Key when none is given, and sends the given one', async () => {
    const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
    await c.passAction({ params: { serial: SERIAL }, body: { action: 'earn-stamps', locationId: LOCATION, count: 2 } });
    assert.match(String(last().headers['idempotency-key']), UUID);
    await c.passAction({ params: { serial: SERIAL }, body: { action: 'earn-stamps', locationId: LOCATION }, idempotencyKey: 'fis-000123' });
    assert.equal(last().headers['idempotency-key'], 'fis-000123');
  });

  it('encodes path parameters and the query', async () => {
    const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
    await c.getPass({ params: { serial: 'AB/CD EF' } });
    assert.equal(last().url, '/v1/passes/AB%2FCD%20EF');
    await c.listCustomers({ query: { q: 'Ayşe Yılmaz', blocked: false, page: 2, limit: 10, status: undefined } });
    assert.equal(last().url, '/v1/customers?q=Ay%C5%9Fe+Y%C4%B1lmaz&blocked=false&page=2&limit=10');
    await assert.rejects(c.getPass({ params: {} } as never), /getPass needs params\.serial/);
  });

  it('reads each kind of answer', async () => {
    const c = new Rewloy({ staffSession: STAFF, baseUrl: s.url });
    const page = await c.listCustomers();
    assert.deepEqual(page, { data: [{ personId: 'p1' }], meta: { page: 1, pageSize: 50, total: 1 } });
    assert.equal(await c.revokeApiKey({ params: { id: LOCATION } }), undefined);
    const png = await c.locationMap({ params: { id: LOCATION } });
    assert.ok(png instanceof Blob);
    assert.equal(png.type, 'image/png');
    assert.deepEqual([...new Uint8Array(await png.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47]);
    assert.deepEqual(await c.openapi(), { openapi: '3.1.0', paths: {} });
  });

  it('gives the whole answer through request()', async () => {
    const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
    const res = await c.request('sendCampaign', { body: { body: 'Bu hafta kahveler 2 damga!' } });
    assert.equal(res.status, 201);
    assert.deepEqual(res.data, { id: 'c1' });
    assert.equal(res.meta, undefined);
    assert.equal(res.requestId, 'r-campaign');
    assert.equal(res.mode, 'test');
    assert.equal(res.replayed, true);
    assert.ok(res.headers instanceof Headers);
    const list = await c.request('listCustomers');
    assert.deepEqual(list.meta, { page: 1, pageSize: 50, total: 1 });
    assert.equal(list.mode, null);
    assert.equal(list.replayed, false);
  });

  it('opens streams through their methods, not request()', async () => {
    const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
    const stream = c.liveFeed({ reconnect: false });
    assert.ok(stream instanceof EventStream);
    stream.close();
    // What the types forbid, for callers without them.
    const loose = c as unknown as { request(id: string): Promise<unknown>; paginate(id: string): unknown };
    await assert.rejects(loose.request('liveFeed'), /liveFeed is a stream/);
    assert.throws(() => loose.paginate('getPass'), /not a paged list/);
    await assert.rejects(loose.request('noSuchOperation'), /unknown operation/);
  });

  it('uses an injected fetch', async () => {
    const calls: string[] = [];
    const c = new Rewloy({
      apiKey: KEY, baseUrl: 'https://example.invalid',
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ data: { serial: SERIAL } }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.deepEqual(await c.getPass({ params: { serial: SERIAL } }), { serial: SERIAL });
    assert.deepEqual(calls, [`https://example.invalid/v1/passes/${SERIAL}`]);
  });
});
