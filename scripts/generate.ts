/**
 * npm run generate                          fetch the live document, keep it as
 *                                           openapi/openapi.json, write src/generated/
 * npm run generate -- --file <path>         generate from a saved document, e.g. the
 *                                           committed snapshot (reproducible builds)
 * npm run generate -- --url <url>           fetch from another address
 *
 * The document is checked (the generator refuses what it does not understand)
 * before anything is written; files that did not change are left alone.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './generator.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIVE = 'https://app.rewloy.com/v1/openapi.json';
const SNAPSHOT = join(ROOT, 'openapi', 'openapi.json');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

/** Writes when the content differs; returns whether it did. */
function put(path: string, content: string): boolean {
  let old: string | undefined;
  try { old = readFileSync(path, 'utf8'); } catch { /* new file */ }
  if (old === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

async function main(): Promise<void> {
  const file = arg('--file');
  let document: unknown;
  if (file) {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    const url = arg('--url') ?? LIVE;
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'rewloy-node-generator' }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`GET ${url}: HTTP ${String(res.status)}`);
    document = await res.json();
  }

  const files = generate(document);
  const changed: string[] = [];
  if (!file && put(SNAPSHOT, `${JSON.stringify(document, null, 2)}\n`)) changed.push(relative(ROOT, SNAPSHOT));
  for (const f of files) if (put(join(ROOT, f.path), f.content)) changed.push(f.path);

  const ops = (document as { paths: Record<string, Record<string, unknown>> }).paths;
  const count = Object.values(ops).reduce((n, item) => n + Object.keys(item).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).length, 0);
  console.log(`${String(count)} operations; ${changed.length ? `changed: ${changed.join(', ')}` : 'nothing changed'}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
