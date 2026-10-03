/**
 * A local stub of the API for the tests: a real HTTP server on 127.0.0.1
 * that records every request and answers with whatever the test says.
 */

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Answers request number `n` (1-based). */
export type Handler = (req: IncomingMessage, res: ServerResponse, n: number, body: string) => void | Promise<void>;

export interface Stub {
  url: string;
  requests: Seen[];
  close(): Promise<void>;
}

export async function stub(handler: Handler): Promise<Stub> {
  const requests: Seen[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => { body += c; });
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      Promise.resolve(handler(req, res, requests.length, body)).catch((err: unknown) => {
        res.destroy(err instanceof Error ? err : new Error(String(err)));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'req-0001', ...headers });
  res.end(JSON.stringify(body));
}

/** An error body as the API writes it. */
export function apiError(code: string, status: number, message: string, details?: unknown): unknown {
  return { error: { code, message, requestId: 'req-body', status, docs: `https://rewloy.com/gelistiriciler/hatalar#${code}`, ...(details === undefined ? {} : { details }) } };
}

/** A sleep that only records how long it was asked to wait. */
export function recordingSleep(): { sleeps: number[]; sleep: (ms: number, signal?: AbortSignal) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number, signal?: AbortSignal) => {
      sleeps.push(ms);
      signal?.throwIfAborted();
    },
  };
}

export const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const SERIAL = 'ABCD-EFGH-JKLM';
export const LOCATION = '0192f7c1-8b2e-7a31-9c1d-2e4f5a6b7c8d';
export const MERCHANT = '0192f7c1-0000-7000-8000-000000000001';
export const KEY = 'rwk_abcdefghij_secretpart';
export const STAFF = 'rws_staffsessiontoken';
export const HOLDER = 'rwh_holdersessiontoken';
