import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as src from '../src/index.ts';
import { json, KEY, SERIAL, stub } from './helpers.ts';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const built = existsSync(join(dist, 'index.js'));

// CI builds before it tests; locally, `npm run build` first.
describe('the built package', { skip: built ? false : 'no dist/: run `npm run build`' }, () => {
  const load = async (): Promise<Record<string, unknown>> => await import(new URL('../dist/index.js', import.meta.url).href) as Record<string, unknown>;

  it('is what package.json points at', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: { '.': { types: string; default: string } } };
    assert.ok(existsSync(fileURLToPath(new URL(`../${pkg.exports['.'].default}`, import.meta.url))));
    assert.ok(existsSync(fileURLToPath(new URL(`../${pkg.exports['.'].types}`, import.meta.url))));
  });

  it('exports what the sources export', async () => {
    assert.deepEqual(Object.keys(await load()).sort(), Object.keys(src).sort());
  });

  it('has declaration files that import .js paths', () => {
    const files = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.d.ts'));
    assert.ok(files.length >= 8);
    for (const f of files) {
      const text = readFileSync(join(dist, f), 'utf8');
      assert.doesNotMatch(text, /(from\s*|import\s*\(\s*)['"]\.{1,2}\/[^'"]*\.ts['"]/, f);
    }
  });

  it('makes a call', async () => {
    const s = await stub((_req, res) => json(res, 200, { data: { serial: SERIAL } }));
    try {
      const { Rewloy, VERSION } = await load() as { Rewloy: typeof src.Rewloy; VERSION: string };
      assert.equal(VERSION, src.VERSION);
      assert.deepEqual(await new Rewloy({ apiKey: KEY, baseUrl: s.url }).getPass({ params: { serial: SERIAL } }), { serial: SERIAL });
      assert.equal(s.requests[0]!.headers['user-agent'], `rewloy-node/${VERSION} node/${process.versions.node}`);
    } finally {
      await s.close();
    }
  });
});
