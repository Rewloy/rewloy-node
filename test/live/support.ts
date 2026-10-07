/**
 * Shared by the live tests: the environment variables, and the checks that
 * must pass before a single authenticated request is sent.
 *
 * The live tests are the one place where this library talks to a real
 * Rewloy server, so they are built to be unable to hurt a live one:
 *   1. the key must be a test key (`rwk_test_…`);
 *   2. `GET /v1/meta` (sent WITHOUT the key) must say `"environment": "dev"`;
 *   3. only then is a client with the key built, and the first answer it
 *      gets must carry `Rewloy-Mode: test`.
 */

import { Rewloy } from '../../src/index.ts';

export interface LiveEnv {
  baseUrl: string;
  apiKey: string;
  /** Optional: a staff session (`rws_…`) of the REAL business that owns the test business. Needed only for resetTestEnvironment. */
  staffSession: string | undefined;
  /** Optional: the real business's id for that staff session (`Rewloy-Merchant`). */
  merchant: string | undefined;
}

/** The environment, or `null` when the live tests are not configured (they then skip). */
export function liveEnv(env: NodeJS.ProcessEnv = process.env): LiveEnv | null {
  const baseUrl = env.REWLOY_BASE_URL?.trim();
  const apiKey = env.REWLOY_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, staffSession: env.REWLOY_STAFF_SESSION?.trim() || undefined, merchant: env.REWLOY_MERCHANT?.trim() || undefined };
}

export const SKIP_REASON = 'REWLOY_BASE_URL and REWLOY_API_KEY are not set (see README, "Live tests")';

/** The live tests refuse to run; the message says why. */
export class LiveRefusal extends Error {
  constructor(message: string) {
    super(`Rewloy live tests refuse to run: ${message}`);
    this.name = 'LiveRefusal';
  }
}

export interface Checked {
  /** Built with the key, only after the checks. */
  rewloy: Rewloy;
  /** The unauthenticated client the meta check used. */
  anonymous: Rewloy;
  /** A client with the staff session, or `null`. */
  staff: Rewloy | null;
  version: string;
}

/** Everything that must be true before the key is sent anywhere. Throws {@link LiveRefusal} otherwise. */
export async function preflight(env: LiveEnv): Promise<Checked> {
  if (!env.apiKey.startsWith('rwk_test_')) throw new LiveRefusal('REWLOY_API_KEY must be a test key (rwk_test_…); any other key is refused');
  if (env.staffSession !== undefined && !env.staffSession.startsWith('rws_')) throw new LiveRefusal('REWLOY_STAFF_SESSION must start with rws_');
  let url: URL;
  try {
    url = new URL(env.baseUrl);
  } catch {
    throw new LiveRefusal(`REWLOY_BASE_URL is not a URL: ${env.baseUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new LiveRefusal('REWLOY_BASE_URL must be an http(s) address');

  // 2. Ask the server which environment it is, without any credential.
  const anonymous = new Rewloy({ baseUrl: env.baseUrl, maxRetries: 0, timeoutMs: 15_000, userAgent: 'rewloy-live-tests' });
  let meta: { environment?: unknown; version?: unknown };
  try {
    meta = await anonymous.getMeta();
  } catch (err) {
    throw new LiveRefusal(`GET /v1/meta at ${url.origin} failed (${err instanceof Error ? err.message : String(err)}); not running without knowing the environment`);
  }
  if (meta.environment !== 'dev') {
    throw new LiveRefusal(`GET /v1/meta at ${url.origin} says environment=${JSON.stringify(meta.environment ?? null)}, not "dev"; the live tests only run against a dev server`);
  }

  // 3. A client with the key; the first answer must be test mode.
  const rewloy = new Rewloy({ baseUrl: env.baseUrl, apiKey: env.apiKey, maxRetries: 0, timeoutMs: 30_000, userAgent: 'rewloy-live-tests' });
  const first = await rewloy.request('getMeta');
  if (first.mode !== 'test') {
    throw new LiveRefusal(`the key was answered in mode ${JSON.stringify(first.mode)}, not "test" (Rewloy-Mode); refusing`);
  }
  const staff = env.staffSession
    ? new Rewloy({ baseUrl: env.baseUrl, staffSession: env.staffSession, ...(env.merchant ? { merchant: env.merchant } : {}), maxRetries: 0, timeoutMs: 30_000, userAgent: 'rewloy-live-tests' })
    : null;
  return { rewloy, anonymous, staff, version: String(meta.version ?? '?') };
}
