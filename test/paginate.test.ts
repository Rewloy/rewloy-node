import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Rewloy } from '../src/index.ts';
import { json, KEY, stub } from './helpers.ts';

/** A stub list of `total` customers, paged as the API pages. */
async function customers(total: number) {
  return stub((req, res) => {
    const q = new URL(req.url ?? '/', 'http://x').searchParams;
    const page = Number(q.get('page') ?? 1);
    const size = Number(q.get('limit') ?? 50);
    const data = Array.from({ length: Math.max(0, Math.min(size, total - (page - 1) * size)) }, (_, i) => ({ personId: `p${String((page - 1) * size + i + 1)}` }));
    json(res, 200, { data, meta: { page, pageSize: size, total } });
  });
}

const ids = async (it: AsyncIterable<{ personId: string }>): Promise<string[]> => {
  const out: string[] = [];
  for await (const x of it) out.push(x.personId);
  return out;
};

describe('paginate', () => {
  it('walks every page and stops at the total', async () => {
    const s = await customers(5);
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
      assert.deepEqual(await ids(c.paginate('listCustomers', { query: { limit: 2, consent: 'yes' } })), ['p1', 'p2', 'p3', 'p4', 'p5']);
      assert.deepEqual(s.requests.map((r) => r.url), [
        '/v1/customers?limit=2&consent=yes&page=1',
        '/v1/customers?limit=2&consent=yes&page=2',
        '/v1/customers?limit=2&consent=yes&page=3',
      ]);
    } finally {
      await s.close();
    }
  });

  it('does not ask past a full last page', async () => {
    const s = await customers(4);
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
      assert.deepEqual(await ids(c.paginate('listCustomers', { query: { limit: 2 } })), ['p1', 'p2', 'p3', 'p4']);
      assert.equal(s.requests.length, 2);
    } finally {
      await s.close();
    }
  });

  it('starts at the page given, and handles an empty list', async () => {
    const s = await customers(5);
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
      assert.deepEqual(await ids(c.paginate('listCustomers', { query: { limit: 2, page: 2 } })), ['p3', 'p4', 'p5']);
    } finally {
      await s.close();
    }
    const empty = await customers(0);
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: empty.url });
      assert.deepEqual(await ids(c.paginate('listCustomers')), []);
      assert.equal(empty.requests.length, 1);
    } finally {
      await empty.close();
    }
  });

  it('stops asking when the caller stops reading', async () => {
    const s = await customers(500);
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
      let n = 0;
      for await (const _ of c.paginate('listCustomers', { query: { limit: 10 } })) if (++n === 15) break;
      assert.equal(s.requests.length, 2);
    } finally {
      await s.close();
    }
  });

  it('gives a page with its meta through the method itself', async () => {
    const s = await customers(3);
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
      const page = await c.listCustomers({ query: { limit: 2 } });
      assert.equal(page.data.length, 2);
      assert.deepEqual(page.meta, { page: 1, pageSize: 2, total: 3 });
    } finally {
      await s.close();
    }
  });
});
