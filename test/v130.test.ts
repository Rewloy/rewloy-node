import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ERROR_TITLES, OPERATIONS, Rewloy, RewloyError, signWebhook, verifyWebhook, type CreateWebhookBody, type ErrorCode, type WebhookEvent } from '../src/index.ts';
import { apiError, json, KEY, LOCATION, SERIAL, stub, type Stub } from './helpers.ts';

const NEW_OPERATIONS = [
  'addQrItems', 'cancelLocationFreeze', 'copyProgram', 'createEarnGroup', 'createEarnRule', 'deleteEarnGroup', 'deleteEarnRule', 'deleteEarnRules',
  'extendProgramCards', 'freezeLocation', 'getEarnGroup', 'getEarnRules', 'getLocationQrItems', 'holderBranch', 'ignoreSeenLine', 'joinHolderBranch',
  'listEarnGroups', 'listEarnRuleRevisions', 'listEarnSources', 'listEarnTemplates', 'listLocationFreezes', 'listSeenLines', 'locationQrPng',
  'locationQrSheetPdf', 'locationQrSheetSvg', 'locationQrSvg', 'previewEarn', 'previewLocationQr', 'previewSale', 'publicBranch', 'putEarnRules',
  'putLocationQrItems', 'unfreezeLocation', 'unignoreSeenLine', 'updateBatch', 'updateEarnGroup', 'updateEarnRule', 'updateLocationFreeze',
] as const;

const PROGRAM = '0192f7c1-0000-7000-8000-0000000000bb';
const GROUP = '0192f7c1-0000-7000-8000-0000000000cc';

const EARN = { source: 'rules', revision: 2, unit: 'stamps', lines: [{ lineId: '1', status: 'earned', rules: ['r1'], earned: 2 }], rules: [{ ruleId: 'r1', kind: 'stamp.perUnit', units: 2, lines: ['1'], text: '1 stamp for each item' }], total: { beforeRounding: '2', rounded: 2, receiptCap: null, promotion: null, caps: [], credited: 2 } };

describe('Rewloy API 1.3.0 operations', () => {
  let s: Stub;
  before(async () => {
    s = await stub((req, res, _n, body) => {
      const url = req.url ?? '';
      if (url === `/v1/passes/${SERIAL}/sale/preview`) return json(res, 200, { data: { type: 'stamp', applied: 'stamps', credited: 2, balance: 2, duplicate: false, reversed: false, rewardReady: false, rewardsReady: 0, card: null, earn: EARN, preview: true } });
      if (url === `/v1/passes/${SERIAL}/sale` && req.method === 'POST') {
        if (body.includes('"qty"')) return json(res, 400, apiError('VALIDATION', 400, 'lines.0: qty tanınmıyor'));
        return json(res, 200, { data: { type: 'stamp', applied: 'stamps', credited: 2, balance: 2, duplicate: false, reversed: false, rewardReady: false, rewardsReady: 0, card: null, earn: EARN } });
      }
      if (url === `/v1/passes/${SERIAL}/sale/reverse`) {
        return json(res, 200, { data: { type: 'stamp', applied: 'stamps', reversed: 0, balance: 2, duplicate: false, rewardReady: false, rewardsReady: 0, card: null, earn: EARN, linesLeft: [{ lineId: '1', quantity: 1, amountMinor: 9500 }] } });
      }
      if (url === `/v1/programs/${PROGRAM}/earn-rules/preview`) return json(res, 200, { data: { credited: 2, unit: 'stamps', earn: EARN } });
      if (url === `/v1/programs/${PROGRAM}/earn-rules` && req.method === 'PUT') return json(res, 200, { data: { programId: PROGRAM, active: true, revision: 3, rules: [], warnings: [] } });
      if (url === `/v1/programs/${PROGRAM}/copy`) return json(res, 422, apiError('NOT_AN_INSTRUMENT', 422, 'Yalnız hediye kartı, kupon ve indirim kartının kopyası oluşturulur'));
      if (url === '/v1/earn-groups') return json(res, 201, { data: { id: GROUP, name: 'Hazırlanan içecekler', members: [], lines30d: 0, usedBy: [], warnings: [] } });
      if (url.startsWith('/v1/earn-groups/seen')) return json(res, 200, { data: [{ key: 'içecek', label: 'İçecek', kind: 'category', lines30d: 4, groups: [GROUP], ignored: false }], meta: { page: 1, pageSize: 100, total: 1 } });
      if (url === `/v1/locations/${LOCATION}/qr.png`) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47])); return; }
      if (url === `/v1/locations/${LOCATION}/qr/sheet.pdf?form=a6`) { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF-1.7'); return; }
      if (url === `/v1/locations/${LOCATION}/freeze`) return json(res, 409, apiError('ALREADY_FROZEN', 409, 'Şube zaten donuk'));
      if (url === '/v1/public/branches/GBLAYS') return json(res, 200, { data: { code: 'GBLAYS', url: 'https://rewloy.com/s/GBLAYS', branch: { name: 'Moda', state: 'paused', reopensOn: '2026-11-15' }, featured: null, items: [], test: false } });
      if (url === `/v1/passes/${SERIAL}/sale` ) return json(res, 409, apiError('LOCATION_FROZEN', 409, 'Şube donuk'));
      return json(res, 200, { data: { ok: true } });
    });
  });
  after(() => s.close());
  const last = () => s.requests[s.requests.length - 1]!;
  const client = () => new Rewloy({ apiKey: KEY, baseUrl: s.url, maxRetries: 0 });

  it('has all 38 new operations, and none of 0.2.4\'s is gone', () => {
    for (const id of NEW_OPERATIONS) assert.ok(id in OPERATIONS, id);
    assert.equal(Object.keys(OPERATIONS).length, 298);
    for (const id of ['recordSale', 'reverseSale', 'listPassOperations', 'resetTestEnvironment', 'createApiKey']) assert.ok(id in OPERATIONS, id);
  });

  it('knows the shapes of the new operations (method, path, answer kind)', () => {
    assert.deepEqual([OPERATIONS.previewSale.method, OPERATIONS.previewSale.path], ['POST', '/v1/passes/{serial}/sale/preview']);
    assert.equal(OPERATIONS.listSeenLines.paged, true);
    assert.equal(OPERATIONS.locationQrPng.response, 'blob');
    assert.equal(OPERATIONS.locationQrSheetPdf.response, 'blob');
    assert.deepEqual(OPERATIONS.holderBranch.auth, ['public', 'holder', 'staff', 'key'].filter((a) => OPERATIONS.holderBranch.auth.includes(a as never)));
    assert.equal(OPERATIONS.reverseSale.idempotency, 'optional');
  });

  it('records a sale with receipt lines and reads the earn explanation', async () => {
    const sale = await client().recordSale({
      params: { serial: SERIAL },
      body: {
        locationId: LOCATION, amountMinor: 21000, receiptDiscountMinor: 0,
        lines: [{ lineId: '1', sku: 'LATTE', name: 'Latte', category: ['İçecek', 'Sıcak'], quantity: '2', unit: 'piece', unitPriceMinor: 9500, tags: ['kampanya'] }, { name: 'Tost', unitPriceMinor: 2000, kind: 'item' }],
      },
      idempotencyKey: 'kasa3-z0187-fis0042',
    });
    assert.equal(sale.earn?.source, 'rules');
    assert.equal(sale.earn?.lines[0]?.status, 'earned');
    assert.equal(sale.earn?.total.credited, sale.credited);
    const sent = JSON.parse(last().body) as { lines: { category: string[]; quantity: string }[] };
    assert.deepEqual(sent.lines[0]!.category, ['İçecek', 'Sıcak']);
    assert.equal(sent.lines[0]!.quantity, '2');
  });

  it('previews a sale without an Idempotency-Key, and the answer says so', async () => {
    const p = await client().previewSale({ params: { serial: SERIAL }, body: { amountMinor: 21000, lines: [{ name: 'Latte', unitPriceMinor: 10500, quantity: 2 }] } });
    assert.equal(p.preview, true);
    assert.equal(p.credited, 2);
    assert.equal(last().url, `/v1/passes/${SERIAL}/sale/preview`);
    assert.equal(last().headers['idempotency-key'], undefined);
  });

  it('refunds one line of a sale and reads what is left', async () => {
    const r = await client().reverseSale({ params: { serial: SERIAL }, body: { saleKey: 'kasa3-z0187-fis0042', lines: [{ lineId: '1', quantity: 1 }] }, idempotencyKey: 'iade-0001-latte' });
    assert.equal(r.reversed, 0);
    assert.deepEqual(r.linesLeft, [{ lineId: '1', quantity: 1, amountMinor: 9500 }]);
    assert.equal(last().headers['idempotency-key'], 'iade-0001-latte');
    assert.deepEqual(JSON.parse(last().body), { saleKey: 'kasa3-z0187-fis0042', lines: [{ lineId: '1', quantity: 1 }] });
  });

  it('previews earn with a draft rule set and a card state', async () => {
    const r = await client().previewEarn({
      params: { id: PROGRAM },
      body: { amountMinor: 21000, lines: [{ name: 'Latte', unitPriceMinor: 10500, quantity: 2 }], ruleSet: { settings: { dailyCap: 3 }, rules: [{ kind: 'stamp.perUnit', groupId: GROUP, stamps: 1 }] }, context: { earnedToday: 1 } },
    });
    assert.equal(r.unit, 'stamps');
    assert.equal(r.earn.rules[0]?.units, 2);
    assert.equal(r.earn.total.caps.length, 0);
  });

  it('writes the earn rules with the revision it read', async () => {
    const saved = await client().putEarnRules({ params: { id: PROGRAM }, body: { revision: 2, rules: [{ kind: 'points.rate', points: 1, everyMinor: 100 }] } });
    assert.equal(saved.revision, 3);
    assert.equal(last().method, 'PUT');
  });

  it('creates a group and walks the seen categories', async () => {
    const g = await client().createEarnGroup({ body: { name: 'Hazırlanan içecekler', members: [{ effect: 'include', match: 'category', value: 'İçecek' }] } });
    assert.equal(g.id, GROUP);
    const seen: string[] = [];
    for await (const row of client().paginate('listSeenLines')) seen.push(row.label);
    assert.deepEqual(seen, ['İçecek']);
  });

  it('copyProgram of a loyalty card is a NOT_AN_INSTRUMENT error with a title', async () => {
    await assert.rejects(client().copyProgram({ params: { id: PROGRAM }, body: {} }), (err: unknown) => {
      assert.ok(err instanceof RewloyError);
      assert.equal(err.status, 422);
      assert.equal(err.code, 'NOT_AN_INSTRUMENT');
      assert.ok(err.title);
      return true;
    });
    assert.ok('NOT_AN_INSTRUMENT' in ERROR_TITLES);
  });

  it('has the new error codes in the ErrorCode type and the titles', () => {
    const codes: ErrorCode[] = ['LOCATION_FROZEN', 'BUSINESS_FROZEN', 'NOT_AN_INSTRUMENT', 'LINES_TOTAL_MISMATCH', 'LINE_NOT_FOUND', 'LINE_ALREADY_REFUNDED', 'REVISION_CONFLICT', 'GROUP_IN_USE', 'QR_LIST_CHANGED'];
    for (const c of codes) assert.ok(c in ERROR_TITLES, c);
  });

  it('downloads the branch QR and the printable sheet as files', async () => {
    const png = await client().locationQrPng({ params: { id: LOCATION } });
    assert.ok(png instanceof Blob);
    assert.equal(png.type, 'image/png');
    const pdf = await client().locationQrSheetPdf({ params: { id: LOCATION }, query: { form: 'a6' } });
    assert.equal(pdf.type, 'application/pdf');
    assert.equal(await pdf.text(), '%PDF-1.7');
  });

  it('reads the public branch page with no credential; a frozen branch is paused with a reopening day', async () => {
    const anonymous = new Rewloy({ baseUrl: s.url });
    const page = await anonymous.publicBranch({ params: { code: 'GBLAYS' } });
    assert.equal(page.branch.state, 'paused');
    assert.equal(page.branch.reopensOn, '2026-11-15');
    assert.equal(last().headers.authorization, undefined);
  });

  it('answers the freeze refusals as errors', async () => {
    await assert.rejects(client().freezeLocation({ params: { id: LOCATION }, body: { reason: 'renovation', reopensOn: '2026-11-15', password: 'x' } }), (err: unknown) => err instanceof RewloyError && err.code === 'ALREADY_FROZEN');
  });
});

describe('webhook events of 1.3.0', () => {
  const secret = 'whsec_test';
  const deliver = (event: unknown): WebhookEvent => {
    const payload = JSON.stringify(event);
    return verifyWebhook({ payload, header: signWebhook({ payload, secret }), secret });
  };

  it('createWebhook takes the new event names', () => {
    const body: CreateWebhookBody = { url: 'https://ornek.com/hook', events: ['pass.extended', 'location.frozen', 'location.unfrozen', 'business.paused', 'business.resumed'] };
    assert.equal(body.events.length, 5);
  });

  it('pass.extended carries the old and the new last day', () => {
    const e = deliver({ id: 'e1', type: 'pass.extended', created_at: '2026-10-07T10:00:00.000Z', data: { kind: 'extend', card: SERIAL, program_id: 'p', location_id: null, customer_id: 'c', reason: 'branch_frozen', from: '2026-12-31', to: '2027-01-14' } });
    assert.equal(e.type, 'pass.extended');
    if (e.type !== 'pass.extended') return;
    assert.equal(e.data.reason, 'branch_frozen');
    assert.equal(e.data.to, '2027-01-14');
  });

  it('the branch and business events are not card events', () => {
    const e = deliver({ id: 'e2', type: 'location.frozen', created_at: '2026-10-07T10:00:00.000Z', data: { card: null, customer_id: null, location_id: LOCATION, reason: 'renovation', startsOn: '2026-10-07', reopensOn: '2026-11-15' } });
    assert.equal(e.type, 'location.frozen');
    if (e.type !== 'location.frozen') return;
    assert.equal(e.data.card, null);
    assert.equal(e.data.reopensOn, '2026-11-15');
  });

  it('a partial refund marks the pass.activity adjustment', () => {
    const e = deliver({ id: 'e3', type: 'pass.activity', created_at: '2026-10-07T10:00:00.000Z', data: { kind: 'adjust', card: SERIAL, program_id: 'p', location_id: null, customer_id: 'c', partial: true } });
    assert.equal(e.type, 'pass.activity');
    if (e.type === 'pass.activity') assert.equal(e.data.partial, true);
  });
});
