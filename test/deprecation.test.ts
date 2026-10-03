import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Rewloy } from '../src/index.ts';
import { apiError, json, KEY, LOCATION, SERIAL, stub, tick, type Stub } from './helpers.ts';

/** What the platform sends on every answer of a deprecated operation (src/api/kit.ts deprecationHeaders). */
function deprecated(id: string): Record<string, string> {
  const link = `https://rewloy.com/gelistiriciler/degisiklikler#${id}`;
  return {
    deprecation: `@${String(Math.floor(Date.parse('2026-10-03T00:00:00Z') / 1000))}`,
    sunset: new Date('2027-04-01T00:00:00Z').toUTCString(),
    link: `<${link}>; rel="deprecation"; type="text/html", <${link}>; rel="sunset"; type="text/html"`,
  };
}

describe('deprecation warnings', () => {
  let s: Stub;
  const warnings: Error[] = [];
  const listen = (w: Error): void => { warnings.push(w); };
  before(async () => {
    process.on('warning', listen);
    s = await stub((req, res) => {
      if (req.url?.startsWith('/v1/passes/')) return json(res, 200, { data: { serial: SERIAL } }, deprecated('getPass'));
      if (req.url === '/v1/programs') return json(res, 200, { data: [] });
      json(res, 404, apiError('PROGRAM_NOT_FOUND', 404, 'Program bulunamadı'), deprecated('getProgram'));
    });
  });
  after(async () => {
    process.off('warning', listen);
    await s.close();
  });

  it('warns once per operation, naming the sunset and the link', async () => {
    const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
    await c.getPass({ params: { serial: SERIAL } });
    await tick();
    assert.equal(warnings.length, 1);
    const w = warnings[0]! as Error & { code?: string };
    assert.equal(w.name, 'DeprecationWarning');
    assert.equal(w.code, 'REWLOY_DEPRECATED');
    assert.match(w.message, /getPass \(GET \/v1\/passes\/\{serial\}\) is deprecated/);
    assert.match(w.message, /Sunset: Thu, 01 Apr 2027 00:00:00 GMT/);
    assert.match(w.message, /See https:\/\/rewloy\.com\/gelistiriciler\/degisiklikler#getPass/);

    await c.getPass({ params: { serial: SERIAL } });
    await new Rewloy({ apiKey: KEY, baseUrl: s.url }).getPass({ params: { serial: SERIAL } });
    await tick();
    assert.equal(warnings.length, 1, 'still one for getPass, from any client');
  });

  it('says nothing for an operation that is not deprecated', async () => {
    await new Rewloy({ apiKey: KEY, baseUrl: s.url }).listPrograms();
    await tick();
    assert.equal(warnings.length, 1);
  });

  it('warns on an error answer too', async () => {
    const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, maxRetries: 0 });
    await assert.rejects(c.getProgram({ params: { id: LOCATION } }), { code: 'PROGRAM_NOT_FOUND' });
    await tick();
    assert.equal(warnings.length, 2);
    assert.match(warnings[1]!.message, /getProgram .* is deprecated/);
  });
});
