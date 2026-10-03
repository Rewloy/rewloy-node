// Build: a clean dist/, tsc, then the declaration files' relative imports
// rewritten from `.ts` to `.js`. The sources import `.ts` paths so that Node
// runs them directly (tests, scripts); tsc rewrites the JavaScript it emits
// (rewriteRelativeImportExtensions) but leaves declaration files as written.
//
// Plain JavaScript on purpose: `npm install github:Rewloy/rewloy-node` runs
// this through `prepare` on whatever Node 22 the installer has.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit' });

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]*?)\.ts\2/g;
for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;
  const file = join(entry.parentPath, entry.name);
  const text = readFileSync(file, 'utf8');
  const out = text.replace(SPECIFIER, (_m, lead, q, path) => `${lead}${q}${path}.js${q}`);
  if (out !== text) writeFileSync(file, out);
}
