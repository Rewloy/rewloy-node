/**
 * One command for the live tests: checks the environment, runs test/live/live.test.ts
 * against the dev server it names, prints passed/failed per area and exits non-zero on any failure.
 *
 *   REWLOY_BASE_URL=… REWLOY_API_KEY=rwk_test_… npm run test:live
 *
 * `--require` makes a missing environment an error (exit 2) instead of a skip (exit 0).
 */

import { run } from 'node:test';
import { fileURLToPath } from 'node:url';
import { liveEnv, preflight } from '../test/live/support.ts';

const require = process.argv.includes('--require');
const env = liveEnv();
if (!env) {
  console.log('Rewloy live tests: SKIPPED (REWLOY_BASE_URL and REWLOY_API_KEY are not set).');
  process.exit(require ? 2 : 0);
}

// The refusal comes here first, with its plain message, before any test starts.
try {
  const checked = await preflight(env);
  console.log(`Rewloy live tests against ${new URL(env.baseUrl).origin} (server ${checked.version}, dev, test mode)`);
  console.log(`staff session for the reset: ${env.staffSession ? 'given' : 'not given (the reset area is skipped)'}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

interface Area { passed: number; failed: number; skipped: number }
const areas = new Map<string, Area>();
const failures: string[] = [];
let area = '';
const slot = (name: string): Area => {
  let a = areas.get(name);
  if (!a) areas.set(name, (a = { passed: 0, failed: 0, skipped: 0 }));
  return a;
};

const stream = run({ files: [fileURLToPath(new URL('../test/live/live.test.ts', import.meta.url))], concurrency: false });
stream.on('test:start', (e) => { if (e.nesting === 0) { area = e.name; slot(area); } });
stream.on('test:stdout', (e) => { process.stdout.write(e.message); });
stream.on('test:stderr', (e) => { process.stderr.write(e.message); });
stream.on('test:pass', (e) => {
  if (e.nesting === 0) return;
  if (e.skip) { slot(area).skipped++; console.log(`  skip  ${area} › ${e.name}${typeof e.skip === 'string' ? ` (${e.skip})` : ''}`); }
  else slot(area).passed++;
});
stream.on('test:fail', (e) => {
  if (e.nesting === 0) return;
  slot(area).failed++;
  const cause = (e.details.error.cause ?? e.details.error) as Error;
  const message = String(cause.message ?? cause).split('\n').slice(0, 6).join('\n        ');
  failures.push(`  FAIL  ${area} › ${e.name}\n        ${message}`);
});

await new Promise<void>((resolve) => { stream.on('end', resolve); stream.on('close', resolve); stream.resume?.(); });

console.log('\nLive tests, per area');
let passed = 0, failed = 0, skipped = 0;
for (const [name, a] of areas) {
  passed += a.passed; failed += a.failed; skipped += a.skipped;
  console.log(`  ${a.failed ? 'FAIL' : 'ok  '}  ${name.padEnd(34)} ${String(a.passed)} passed, ${String(a.failed)} failed${a.skipped ? `, ${String(a.skipped)} skipped` : ''}`);
}
if (failures.length) console.log(`\n${failures.join('\n')}`);
console.log(`\n${String(passed)} passed, ${String(failed)} failed, ${String(skipped)} skipped`);
process.exit(failed > 0 ? 1 : 0);
