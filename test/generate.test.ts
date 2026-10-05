import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { generate, parseDeprecation } from '../scripts/generator.ts';

const root = new URL('..', import.meta.url);
const snapshot = (): unknown => JSON.parse(readFileSync(new URL('openapi/openapi.json', root), 'utf8'));

describe('generation', () => {
  it('is deterministic, and the committed output is current', () => {
    const first = generate(snapshot());
    const second = generate(snapshot());
    assert.deepEqual(first, second);
    assert.deepEqual(first.map((f) => f.path), ['src/generated/types.ts', 'src/generated/operations.ts', 'src/generated/methods.ts']);
    for (const f of first) {
      const committed = readFileSync(new URL(f.path, root), 'utf8');
      assert.ok(committed === f.content, `${f.path} is out of date: run \`npm run generate -- --file openapi/openapi.json\``);
    }
  });

  it('makes one method per operation of the snapshot', () => {
    const doc = snapshot() as { paths: Record<string, Record<string, { operationId: string }>> };
    const ids = Object.values(doc.paths).flatMap((item) => Object.values(item).map((op) => op.operationId));
    const methods = generate(doc).find((f) => f.path.endsWith('methods.ts'))!.content;
    for (const id of ids) assert.match(methods, new RegExp(`^  ${id}\\(args\\??: T\\.`, 'm'), id);
    assert.equal(ids.length, new Set(ids).size);
  });
});

/** A small document with the cases the live one does not have yet. */
function fixture(): Record<string, unknown> {
  const envelope = (data: unknown) => ({ content: { 'application/json': { schema: { type: 'object', required: ['data'], properties: { data } } } } });
  return {
    openapi: '3.1.0',
    info: { title: 'Fixture', version: '9.9.9' },
    paths: {
      '/v1/things/{id}': {
        get: {
          operationId: 'getThing', tags: ['Şeyler'], summary: 'Bir şey',
          deprecated: true,
          description: '**Kullanımdan kalkıyor:** 1 Nisan 2027 tarihine kadar çalışır; yerine `getThingV2`. Ayrıntı: https://rewloy.com/gelistiriciler/degisiklikler#getThing\n\nYorum */ kapanmasın.\n@internal bir etiket değil.',
          'x-credentials': ['key', 'staff'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'Rewloy-Merchant', in: 'header', required: false, schema: { type: 'string' } },
          ],
          responses: {
            200: envelope({ type: 'object', additionalProperties: false, required: ['state', 'weird-name'], properties: {
              state: { type: ['string', 'null'], enum: ['on', 'off', null] },
              'weird-name': { oneOf: [{ const: 'all' }, { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'integer' }] } }] },
              note: { type: 'string', description: "Tırnak ' ve ters bölü \\ içerir" },
              extra: { type: 'object', additionalProperties: { type: 'integer' } },
            } }),
            404: { description: 'x', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, examples: { NOT_FOUND: { summary: 'Bulunamadı', value: {} } } } } },
          },
        },
      },
      '/v1/things/{id}/events': {
        get: {
          operationId: 'thingEvents', tags: ['Şeyler'], summary: 'Akış', 'x-credentials': ['holder'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'x', content: { 'text/event-stream': { schema: { type: 'string', format: 'binary' } } } } },
        },
        delete: {
          operationId: 'forgetThing', tags: ['Şeyler'], summary: 'Sil', security: [{ apiKey: [] }, {}],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } }],
          responses: { 204: { description: 'Tamam — gövde yok.' } },
        },
      },
    },
    components: { schemas: {
      Error: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'requestId'], properties: {
        code: { type: 'string', enum: ['NOT_FOUND', 'INTERNAL'] }, message: { type: 'string' }, requestId: { type: 'string' } } } } },
    } },
  };
}

describe('the generator on a fixture', () => {
  const files = Object.fromEntries(generate(fixture()).map((f) => [f.path.split('/').pop()!, f.content]));

  it('marks a deprecated operation with its sunset and replacement', () => {
    assert.deepEqual(parseDeprecation('**Kullanımdan kalkıyor:** 1 Nisan 2027 tarihine kadar çalışır; yerine `getThingV2`.'), { sunset: '2027-04-01', use: 'getThingV2' });
    assert.deepEqual(parseDeprecation('**Kullanımdan kalkıyor:** 15 Aralık 2026 tarihine kadar çalışır.'), { sunset: '2026-12-15', use: null });
    assert.match(files['methods.ts']!, /@deprecated The API stops answering this operation after 2027-04-01\. Use `getThingV2` instead\. https:\/\/rewloy\.com\/gelistiriciler\/degisiklikler#getThing/);
    assert.match(files['operations.ts']!, /getThing: \{ method: 'GET', path: '\/v1\/things\/\{id\}', auth: \['key', 'staff'\], merchant: true, idempotency: null, body: false, response: 'json', paged: false, stream: false, deprecated: \{ sunset: '2027-04-01', use: 'getThingV2' \} \}/);
  });

  it('keeps comments closed and text out of tags', () => {
    assert.match(files['methods.ts']!, /Yorum \*\\\/ kapanmasın\./);
    assert.match(files['methods.ts']!, /\* &#64;internal bir etiket değil\./);
  });

  it('writes the types the schemas say', () => {
    const types = files['types.ts']!;
    assert.match(types, /state: 'on' \| 'off' \| null;/);
    assert.match(types, /'weird-name': 'all' \| Array<string \| number>;/);
    assert.match(types, /note\?: string;/);
    assert.match(types, /extra\?: Record<string, number>;/);
    assert.match(types, /404: ErrorBody<'NOT_FOUND'>;/);
    assert.match(types, /export type ErrorCode =\n {2}\| 'NOT_FOUND'\n {2}\| 'INTERNAL';/);
    assert.match(types, /export interface ThingEventsArgs extends RequestOptions, StreamOptions \{/);
    assert.match(types, /export interface ForgetThingArgs extends RequestOptions \{/);
  });

  it('reads streams, empty answers and credentials from security', () => {
    const ops = files['operations.ts']!;
    assert.match(ops, /thingEvents: \{ method: 'GET', path: '\/v1\/things\/\{id\}\/events', auth: \['holder'\], merchant: false, idempotency: null, body: false, response: 'stream', paged: false, stream: true, deprecated: null \}/);
    assert.match(ops, /forgetThing: \{ method: 'DELETE', path: '\/v1\/things\/\{id\}\/events', auth: \['key', 'public'\], merchant: false, idempotency: 'optional', body: false, response: 'none'/);
    assert.match(ops, /export const API_VERSION = '9\.9\.9';/);
    assert.match(ops, /NOT_FOUND: 'Bulunamadı',/);
    const methods = files['methods.ts']!;
    assert.match(methods, /thingEvents\(args: T\.ThingEventsArgs\): EventStream \{\n {4}return this\._open\('thingEvents', args\);/);
    assert.match(methods, /forgetThing\(args: T\.ForgetThingArgs\): Promise<void> \{/);
  });

  it('makes the idempotencyKey argument required where the document requires the header', () => {
    assert.match(files['types.ts']!, /export interface ForgetThingArgs extends RequestOptions \{[^}]*idempotencyKey\?: string \| undefined;/);
    const required = fixture();
    const forget = (required.paths as Record<string, Record<string, { parameters: { name: string; required?: boolean }[] }>>)['/v1/things/{id}/events']!.delete!;
    forget.parameters.find((p) => p.name === 'Idempotency-Key')!.required = true;
    const out = Object.fromEntries(generate(required).map((f) => [f.path.split('/').pop()!, f.content]));
    assert.match(out['types.ts']!, /export interface ForgetThingArgs extends RequestOptions \{[^}]*\n {2}idempotencyKey: string;/);
    assert.match(out['operations.ts']!, /forgetThing: .*idempotency: 'required'/);
  });

  it('refuses what it cannot generate', () => {
    assert.throws(() => generate({}), /not an OpenAPI 3 document/);
    assert.throws(() => generate({ openapi: '3.1.0', paths: {} }), /no operations/);
    const dup = fixture();
    (dup.paths as Record<string, Record<string, { operationId: string }>>)['/v1/things/{id}/events']!.get!.operationId = 'getThing';
    assert.throws(() => generate(dup), /used twice/);
    const reserved = fixture();
    (reserved.paths as Record<string, Record<string, { operationId: string }>>)['/v1/things/{id}/events']!.get!.operationId = 'paginate';
    assert.throws(() => generate(reserved), /collides with a client method/);
  });
});
