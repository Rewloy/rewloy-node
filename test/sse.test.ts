import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Rewloy, RewloyError, RewloyTimeoutError, SseParser, type ServerSentEvent } from '../src/index.ts';
import { apiError, delay, HOLDER, json, KEY, recordingSleep, SERIAL, stub } from './helpers.ts';

/** Parses `text` fed in the given pieces. */
function parse(pieces: string[], lastEventId = ''): { events: ServerSentEvent[]; parser: SseParser } {
  const parser = new SseParser(lastEventId);
  const events = pieces.flatMap((p) => parser.push(p));
  return { events, parser };
}

/** Every way of cutting `text` in two, and one piece per character. */
function cuts(text: string): string[][] {
  const out: string[][] = [[text], [...text]];
  for (let i = 1; i < text.length; i++) out.push([text.slice(0, i), text.slice(i)]);
  return out;
}

describe('SseParser', () => {
  it('parses the API\'s own stream', () => {
    const text = 'retry: 5000\n\n: hb\n\nevent: event\ndata: {"kind":"earn","delta":2}\n\nevent: changed\ndata: 1\n\n';
    for (const pieces of cuts(text)) {
      const { events, parser } = parse(pieces);
      assert.deepEqual(events, [
        { event: 'event', data: '{"kind":"earn","delta":2}', id: '' },
        { event: 'changed', data: '1', id: '' },
      ], JSON.stringify(pieces));
      assert.equal(parser.retry, 5000);
    }
  });

  it('takes LF, CR and CRLF line endings, wherever a piece ends', () => {
    const expected = [{ event: 'message', data: 'a\nb', id: '' }, { event: 'x', data: 'c', id: '' }];
    for (const text of ['data: a\ndata: b\n\nevent: x\ndata: c\n\n', 'data: a\rdata: b\r\revent: x\rdata: c\r\r', 'data: a\r\ndata: b\r\n\r\nevent: x\r\ndata: c\r\n\r\n']) {
      for (const pieces of cuts(text)) assert.deepEqual(parse(pieces).events, expected, JSON.stringify(pieces));
    }
  });

  it('reads fields as the standard says', () => {
    const { events, parser } = parse([
      '﻿data:no space\n',           // BOM dropped; no space after the colon
      'data:  two spaces\n',             // only one space is removed
      'data\n',                          // a field name alone: empty value
      'ignored: field\n',
      'id: 7\n\n',
      'data: next\n\n',                  // the last event ID carries over
      'id: bad\0id\ndata: x\n\n',        // an id with NULL is ignored
      'retry: 12a\nretry: 250\n',        // only digits count
      'event: lonely\n\n',               // no data: no event, and the type resets
      'data: after\n\n',
      'id\ndata: cleared\n\n',           // an empty id clears it
      'data: unfinished',                // no blank line: dropped at the end
    ]);
    assert.deepEqual(events, [
      { event: 'message', data: 'no space\n two spaces\n', id: '7' },
      { event: 'message', data: 'next', id: '7' },
      { event: 'message', data: 'x', id: '7' },
      { event: 'message', data: 'after', id: '7' },
      { event: 'message', data: 'cleared', id: '' },
    ]);
    assert.equal(parser.retry, 250);
    parser.end();
    assert.deepEqual(parser.push('\n'), []);
  });

  it('dispatches an event whose data is empty', () => {
    assert.deepEqual(parse(['data\n\ndata:\n\n']).events, [{ event: 'message', data: '', id: '' }, { event: 'message', data: '', id: '' }]);
  });

  it('starts from a last event ID it is given', () => {
    assert.deepEqual(parse(['data: x\n\n'], '41').events, [{ event: 'message', data: 'x', id: '41' }]);
  });

  it('takes the last event ID at a blank line, even without data', () => {
    const { events, parser } = parse(['id: 5\n\n', 'id: 6\n']);
    assert.deepEqual(events, []);
    assert.equal(parser.lastEventId, '5');
    parser.push('\n');
    assert.equal(parser.lastEventId, '6');
  });
});

/** A fetch that answers with exactly these byte chunks. */
function chunked(chunks: Uint8Array[], headers: Record<string, string> = {}): typeof fetch {
  return async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } });
}

const collect = async (it: AsyncIterable<ServerSentEvent>): Promise<ServerSentEvent[]> => {
  const out: ServerSentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

describe('streams', () => {
  it('decodes UTF-8 split across chunks, and lines and events split anywhere', async () => {
    const bytes = new TextEncoder().encode('event: event\r\ndata: {"name":"Ayşe","location":"Moda Şubesi"}\r\n\r\n: hb\r\n\r\n');
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 3) chunks.push(bytes.slice(i, i + 3));
    const c = new Rewloy({ apiKey: KEY, fetch: chunked(chunks, { 'x-request-id': 'r-live', 'rewloy-mode': 'test' }) });
    const stream = c.stream('liveFeed', { reconnect: false });
    assert.deepEqual(await collect(stream), [{ event: 'event', data: '{"name":"Ayşe","location":"Moda Şubesi"}', id: '' }]);
    assert.equal(stream.requestId, 'r-live');
    assert.equal(stream.mode, 'test');
  });

  it('sends the credential, merchant and Accept, and parses events from the server', async () => {
    const s = await stub(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      res.write('retry: 5000\n\n');
      await delay(5);
      res.write('event: event\nda');
      await delay(5);
      res.write('ta: {"kind":"scan"}\n');
      await delay(5);
      res.end('\n');
    });
    try {
      const c = new Rewloy({ staffSession: 'rws_x', merchant: 'm-1', baseUrl: s.url });
      const stream = c.liveFeed({ reconnect: false });
      assert.deepEqual(await collect(stream), [{ event: 'event', data: '{"kind":"scan"}', id: '' }]);
      assert.equal(stream.retryMs, 5000);
      const h = s.requests[0]!.headers;
      assert.equal(h.accept, 'text/event-stream');
      assert.equal(h.authorization, 'Bearer rws_x');
      assert.equal(h['rewloy-merchant'], 'm-1');
      assert.equal(h['last-event-id'], undefined);
    } finally {
      await s.close();
    }
  });

  it('reconnects after the server\'s retry delay, with Last-Event-ID', async () => {
    const s = await stub((_req, res, n) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (n === 1) res.end('retry: 1234\n\nid: 7\nevent: changed\ndata: 1\n\n');
      else res.end('event: changed\ndata: 2\n\n');
    });
    const { sleeps, sleep } = recordingSleep();
    try {
      const c = new Rewloy({ holderSession: HOLDER, baseUrl: s.url, sleep });
      const got: ServerSentEvent[] = [];
      for await (const ev of c.holderCardEvents({ params: { serial: SERIAL } })) {
        got.push(ev);
        if (got.length === 2) break;
      }
      assert.deepEqual(got, [{ event: 'changed', data: '1', id: '7' }, { event: 'changed', data: '2', id: '7' }]);
      assert.deepEqual(sleeps, [1234]);
      assert.equal(s.requests[0]!.url, `/v1/holder/cards/${SERIAL}/events`);
      assert.equal(s.requests[1]!.headers['last-event-id'], '7');
    } finally {
      await s.close();
    }
  });

  it('ends quietly when the signal aborts, and closes the connection on break', async () => {
    let closed = 0;
    const s = await stub((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: event\ndata: first\n\n');
      req.socket.on('close', () => { closed++; });
    });
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
      const ac = new AbortController();
      const got: string[] = [];
      setTimeout(() => ac.abort(), 50);
      for await (const ev of c.liveFeed({ signal: ac.signal })) got.push(ev.data);
      assert.deepEqual(got, ['first']);

      for await (const _ of c.liveFeed()) break;
      const stream = c.liveFeed();
      setTimeout(() => stream.close(), 30);
      assert.deepEqual((await collect(stream)).map((e) => e.data), ['first']);
      await delay(30);
      assert.equal(closed, 3);
      assert.equal(s.requests.length, 3);
    } finally {
      await s.close();
    }
  });

  it('ends with the error a reconnection cannot fix', async () => {
    const s = await stub((_req, res, n) => {
      if (n === 1) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('event: changed\ndata: 1\n\n');
        return;
      }
      json(res, 401, apiError('TOKEN_INVALID', 401, 'Oturum geçersiz ya da süresi dolmuş; yeniden giriş yapın'));
    });
    const { sleep } = recordingSleep();
    try {
      const c = new Rewloy({ holderSession: HOLDER, baseUrl: s.url, sleep });
      const got: string[] = [];
      await assert.rejects(async () => {
        for await (const ev of c.holderCardEvents({ params: { serial: SERIAL } })) got.push(ev.data);
      }, (err: unknown) => err instanceof RewloyError && err.code === 'TOKEN_INVALID');
      assert.deepEqual(got, ['1']);
      assert.equal(s.requests.length, 2);
    } finally {
      await s.close();
    }
  });

  it('reconnects through transient failures', async () => {
    const s = await stub((_req, res, n) => {
      if (n <= 4) return json(res, 503, apiError('INTERNAL', 503, 'busy'));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: back\n\n');
    });
    const { sleeps, sleep } = recordingSleep();
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url, sleep, maxRetries: 1 });
      for await (const ev of c.liveFeed()) {
        assert.equal(ev.data, 'back');
        break;
      }
      // Two connections of two attempts each failed, the fifth request got through.
      assert.equal(s.requests.length, 5);
      assert.equal(sleeps.length, 4);
    } finally {
      await s.close();
    }
  });

  it('treats a silent connection as dropped', async () => {
    const s = await stub((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': hb\n\n');
    });
    try {
      const c = new Rewloy({ apiKey: KEY, baseUrl: s.url });
      await assert.rejects(collect(c.liveFeed({ reconnect: false, idleTimeoutMs: 40 })), (err: unknown) => err instanceof RewloyTimeoutError && /no data for 40 ms/.test(err.message));
    } finally {
      await s.close();
    }
  });
});
