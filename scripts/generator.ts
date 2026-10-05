/**
 * The generator: Rewloy's OpenAPI 3.1 document in, the TypeScript of
 * src/generated/ out. Pure — no I/O — so that a test can run it on the
 * committed snapshot and compare (test/generate.test.ts); scripts/generate.ts
 * is the command around it.
 *
 * It reads only what the document says, the way the platform writes it
 * (src/api/openapi.ts there): inline JSON Schemas, `Error` and `PageMeta` as
 * components, `x-credentials` for the credential kinds, the `Rewloy-Merchant`
 * and `Idempotency-Key` header parameters, the `{ data[, meta] }` envelope and
 * one example per error code. Its own emitter, not openapi-typescript: the
 * subset is small, and one method per operation with named types per
 * operation is the shape the library wants.
 *
 * Output (deterministic: the document's order, no dates):
 *   types.ts       a type per operation part, the `Operations` map, ErrorCode
 *   operations.ts  the metadata table (OPERATIONS) and the error titles
 *   methods.ts     one method per operation, named by its operationId
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: Json } | boolean;
type Obj = { [key: string]: Json };

export interface GeneratedFile {
  /** Relative to the repository root. */
  path: string;
  content: string;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const MERCHANT_HEADER = 'rewloy-merchant';
const IDEMPOTENCY_HEADER = 'idempotency-key';
const SECURITY_KINDS: Record<string, string> = { apiKey: 'key', staffSession: 'staff', holderSession: 'holder' };
const REFERENCE = 'https://rewloy.com/gelistiriciler/api';
const CHANGELOG = 'https://rewloy.com/gelistiriciler/degisiklikler';

/** Names the client defines itself: an operationId may not take them. */
const RESERVED_METHODS = new Set(['request', 'paginate', 'stream', 'constructor', 'toString', 'valueOf']);
/** Type names the hand-written modules export: a generated name may not take them. */
const RESERVED_TYPES = new Set([
  'Rewloy', 'RewloyOptions', 'RewloyError', 'RateLimitError', 'RewloyConnectionError', 'RewloyTimeoutError',
  'WebhookSignatureError', 'WebhookEvent', 'PassEventData', 'VerifyWebhookOptions', 'SignWebhookOptions',
  'EventStream', 'ServerSentEvent', 'SseParser', 'ApiResponse', 'Page', 'RequestOptions', 'StreamOptions',
  'OperationMeta', 'AuthKind', 'HttpMethod', 'ResponseKind', 'RewloyMethods', 'Operations', 'OperationId',
  'PagedOperationId', 'StreamOperationId', 'ErrorCode', 'ErrorBody',
]);
const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/* ------------------------------------------------------------------ reading */

interface Param { name: string; schema: Schema; required: boolean; description: string | undefined }

interface Op {
  id: string;
  type: string;                      // PascalCase id
  method: string;                    // GET, POST…
  path: string;
  tag: string;
  summary: string;
  description: string;
  auth: string[];
  deprecated: { sunset: string | null; use: string | null } | null;
  pathParams: Param[];
  queryParams: Param[];
  merchant: Param | undefined;
  idempotency: Param | undefined;
  otherHeaders: Param[];
  body: { schema: Schema; required: boolean } | undefined;
  response: 'json' | 'none' | 'blob' | 'raw-json' | 'stream';
  paged: boolean;
  dataSchema: Schema | undefined;
  successStatuses: string[];
  errors: { status: string; codes: string[] }[];
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: Json | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
const fail = (message: string): never => { throw new Error(`generate: ${message}`); };

export const pascal = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

function readParams(op: Obj, where: string): Param[] {
  const list = Array.isArray(op.parameters) ? op.parameters : [];
  return list.filter(isObj).filter((p) => p.in === where).map((p) => ({
    name: str(p.name) ?? fail('a parameter without a name'),
    schema: (isObj(p.schema) ? p.schema : {}) as Schema,
    required: p.required === true,
    description: str(p.description) ?? (isObj(p.schema) ? str(p.schema.description) : undefined),
  }));
}

/** "1 Nisan 2027" (the document's deprecation sentence) → "2027-04-01". */
export function parseDeprecation(description: string): { sunset: string | null; use: string | null } {
  const date = new RegExp(`(\\d{1,2}) (${TR_MONTHS.join('|')}) (\\d{4})`).exec(description);
  const use = /yerine `([A-Za-z0-9_]+)`/.exec(description);
  const sunset = date ? `${date[3]!}-${String(TR_MONTHS.indexOf(date[2]!) + 1).padStart(2, '0')}-${date[1]!.padStart(2, '0')}` : null;
  return { sunset, use: use ? use[1]! : null };
}

function readOp(path: string, method: string, op: Obj): Op {
  const id = str(op.operationId) ?? fail(`${method.toUpperCase()} ${path} has no operationId`);
  if (!/^[a-z][A-Za-z0-9]*$/.test(id)) fail(`operationId "${id}" is not camelCase`);
  if (RESERVED_METHODS.has(id)) fail(`operationId "${id}" collides with a client method`);

  const headers = readParams(op, 'header');
  const merchant = headers.find((h) => h.name.toLowerCase() === MERCHANT_HEADER);
  const idempotency = headers.find((h) => h.name.toLowerCase() === IDEMPOTENCY_HEADER);
  const otherHeaders = headers.filter((h) => h !== merchant && h !== idempotency);

  let auth: string[];
  if (Array.isArray(op['x-credentials'])) auth = op['x-credentials'].map((c) => String(c));
  else {
    const security = Array.isArray(op.security) ? op.security.filter(isObj) : [];
    auth = security.flatMap((s) => (Object.keys(s).length === 0 ? ['public'] : Object.keys(s).map((k) => SECURITY_KINDS[k] ?? k)));
  }

  let body: Op['body'];
  if (isObj(op.requestBody)) {
    const content = isObj(op.requestBody.content) ? op.requestBody.content : {};
    const json = content['application/json'];
    if (!isObj(json)) fail(`${id}: only application/json request bodies are supported`);
    body = { schema: (isObj((json as Obj).schema) ? (json as Obj).schema : {}) as Schema, required: op.requestBody.required === true };
  }

  const responses = isObj(op.responses) ? op.responses : fail(`${id} has no responses`);
  const successStatuses = Object.keys(responses).filter((s) => /^2\d\d$/.test(s)).sort();
  if (!successStatuses.length) fail(`${id} has no 2xx response`);
  const first = responses[successStatuses[0]!] as Obj;
  const content = isObj(first.content) ? first.content : undefined;
  let response: Op['response'];
  let paged = false;
  let dataSchema: Schema | undefined;
  if (!content || successStatuses[0] === '204') response = 'none';
  else {
    const [type, media] = Object.entries(content)[0]!;
    const schema = isObj(media) && isObj(media.schema) ? media.schema : {};
    const json = /^application\/([a-z.+-]+\+)?json\b/.test(type);
    if (type.startsWith('text/event-stream')) response = 'stream';
    else if (json && isObj(schema.properties) && 'data' in schema.properties) {
      response = 'json';
      dataSchema = schema.properties.data as Schema;
      paged = 'meta' in schema.properties;
    } else response = json ? 'raw-json' : 'blob';
  }

  const errors: Op['errors'] = [];
  for (const [status, r] of Object.entries(responses)) {
    if (!/^[45]\d\d$/.test(status) || !isObj(r)) continue;
    const media = isObj(r.content) ? r.content['application/json'] : undefined;
    const examples = isObj(media) && isObj(media.examples) ? Object.keys(media.examples) : [];
    errors.push({ status, codes: examples });
  }

  const description = str(op.description) ?? '';
  return {
    id, type: pascal(id), method: method.toUpperCase(), path,
    tag: Array.isArray(op.tags) && typeof op.tags[0] === 'string' ? op.tags[0] : '',
    summary: str(op.summary) ?? '', description,
    auth,
    deprecated: op.deprecated === true ? parseDeprecation(description) : null,
    pathParams: readParams(op, 'path'), queryParams: readParams(op, 'query'),
    merchant, idempotency, otherHeaders, body, response, paged, dataSchema, successStatuses, errors,
  };
}

/** Error titles, from each error code's example (`summary` is the catalogue's title). */
function errorTitles(paths: Obj): Map<string, string> {
  const titles = new Map<string, string>();
  for (const item of Object.values(paths)) {
    if (!isObj(item)) continue;
    for (const m of HTTP_METHODS) {
      const op = item[m];
      if (!isObj(op) || !isObj(op.responses)) continue;
      for (const r of Object.values(op.responses)) {
        const media = isObj(r) && isObj(r.content) ? r.content['application/json'] : undefined;
        if (!isObj(media) || !isObj(media.examples)) continue;
        for (const [code, ex] of Object.entries(media.examples)) {
          const title = isObj(ex) ? str(ex.summary) : undefined;
          if (title && !titles.has(code)) titles.set(code, title);
        }
      }
    }
  }
  return titles;
}

/* ------------------------------------------------------------------ emitting */

const lit = (v: Json): string => {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return 'unknown';
};

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (name: string): string => (IDENT.test(name) ? name : lit(name));

/**
 * A TSDoc block. In the document's text `*\/` cannot end it early and an `@`
 * at a line start is not a tag; `tags` are the generator's own (`@see`, …).
 */
export function doc(text: string | undefined, indent: string, tags: string[] = []): string {
  const safe = (text ?? '').trim().replace(/\*\//g, '*\\/').replace(/^(\s*)@/gm, '$1&#64;');
  const parts = [safe, ...tags].filter((x) => x !== '');
  if (!parts.length) return '';
  const text2 = parts.join('\n\n');
  if (!text2.includes('\n')) return `${indent}/** ${text2.trimEnd()} */\n`;
  const body = text2
    .split('\n')
    .map((line) => (line.trim() === '' ? `${indent} *` : `${indent} * ${line.trimEnd()}`))
    .join('\n');
  return `${indent}/**\n${body}\n${indent} */\n`;
}

/** A `|` or `&` outside any brackets: the type needs parentheses before `[]`. */
function compound(t: string): boolean {
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === "'") {
      for (i++; i < t.length && t[i] !== "'"; i++) if (t[i] === '\\') i++;
      continue;
    }
    // A doc comment inside an object literal: its text can hold any bracket.
    if (c === '/' && t[i + 1] === '*') {
      const end = t.indexOf('*/', i + 2);
      i = end === -1 ? t.length : end + 1;
      continue;
    }
    if (c === '{' || c === '<' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === '>' || c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === '|' || c === '&') && t[i - 1] === ' ') return true;
  }
  return false;
}

const union = (members: string[]): string => {
  const unique = [...new Set(members)];
  if (unique.includes('unknown')) return 'unknown';
  return unique.join(' | ') || 'never';
};

class Emitter {
  private readonly components: Map<string, string>;
  constructor(components: Map<string, string>) { this.components = components; }

  ref(ref: string): string {
    const name = /^#\/components\/schemas\/(.+)$/.exec(ref)?.[1];
    const mapped = name ? this.components.get(name) : undefined;
    return mapped ?? fail(`unsupported $ref ${ref}`);
  }

  /** The TypeScript type of a JSON Schema; `indent` is the indentation of the line it starts on. */
  type(schema: Schema | undefined, indent: string): string {
    if (schema === undefined || schema === true) return 'unknown';
    if (schema === false) return 'never';
    let out: string;
    if (typeof schema.$ref === 'string') out = this.ref(schema.$ref);
    else if ('const' in schema) out = lit(schema.const!);
    else if (Array.isArray(schema.enum)) out = union(schema.enum.map(lit));
    else if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
      const list = (schema.oneOf ?? schema.anyOf) as Json[];
      out = union(list.map((s) => this.wrap(this.type(s as Schema, indent))));
    } else if (Array.isArray(schema.allOf)) {
      out = schema.allOf.map((s) => this.wrap(this.type(s as Schema, indent))).join(' & ');
    } else {
      const declared = schema.type;
      const types = Array.isArray(declared) ? declared.map(String)
        : typeof declared === 'string' ? [declared]
        : isObj(schema.properties) || schema.additionalProperties !== undefined ? ['object']
        : schema.items !== undefined ? ['array'] : [];
      out = types.length ? union(types.map((t) => this.single(t, schema, indent))) : 'unknown';
    }
    if (schema.nullable === true && out !== 'unknown' && !out.split(' | ').includes('null')) out = `${out} | null`;
    return out;
  }

  private wrap(t: string): string {
    return compound(t) ? `(${t})` : t;
  }

  private single(type: string, schema: Obj, indent: string): string {
    switch (type) {
      case 'string': return schema.format === 'binary' ? 'Blob' : 'string';
      case 'integer':
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'null': return 'null';
      case 'array': {
        const items = this.type(schema.items as Schema | undefined, indent);
        return compound(items) ? `Array<${items}>` : `${items}[]`;
      }
      case 'object': return this.object(schema, indent);
      default: return 'unknown';
    }
  }

  /** An object literal type, its members one per line. */
  object(schema: Obj, indent: string): string {
    const props = isObj(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    const inner = `${indent}  `;
    const lines: string[] = [];
    for (const [name, prop] of Object.entries(props)) {
      const p = prop as Schema;
      const description = typeof p === 'object' ? str(p.description) : undefined;
      lines.push(`${doc(description, inner)}${inner}${key(name)}${required.has(name) ? '' : '?'}: ${this.type(p, inner)};`);
    }
    const extra = schema.additionalProperties;
    const rest = extra === undefined ? (lines.length ? undefined : 'unknown')
      : extra === false ? undefined
      : extra === true ? 'unknown' : this.type(extra as Schema, inner);
    if (!lines.length) return rest === undefined ? 'Record<string, never>' : `Record<string, ${rest}>`;
    const literal = `{\n${lines.join('\n')}\n${indent}}`;
    return rest === undefined ? literal : `${literal} & Record<string, ${rest}>`;
  }

  /** `export interface X {…}` for an object literal, `export type X = …` otherwise. */
  declare(name: string, schema: Schema | undefined, description?: string): string {
    const t = this.type(schema, '');
    const own = isObj(schema) ? str(schema.description) : undefined;
    const head = doc([description, own].filter(Boolean).join('\n\n'), '');
    if (t.startsWith('{\n') && t.endsWith('\n}') && !compound(t)) return `${head}export interface ${name} ${t}\n`;
    return `${head}export type ${name} = ${t};\n`;
  }
}

/* ------------------------------------------------------------------ files */

const HEADER = (version: string) => [
  '// Generated by scripts/generate.ts from the Rewloy OpenAPI document',
  `// (openapi/openapi.json, API ${version}). Do not edit: run \`npm run generate\`.`,
  '',
].join('\n');

function reference(op: Op): string {
  return `{@link ${REFERENCE}#op-${op.id} | API referansı}`;
}

function deprecationNote(op: Op): string {
  if (!op.deprecated) return '';
  const { sunset, use } = op.deprecated;
  return [
    sunset ? `The API stops answering this operation after ${sunset}.` : 'The API will stop answering this operation.',
    use ? `Use \`${use}\` instead.` : '',
    `${CHANGELOG}#${op.id}`,
  ].filter(Boolean).join(' ');
}

function argsInterface(op: Op, e: Emitter): string {
  const lines: string[] = [];
  const member = (description: string | undefined, line: string) => lines.push(`${doc(description, '  ')}  ${line}`);
  if (op.pathParams.length) member('Path parameters.', `params: ${op.type}Params;`);
  if (op.queryParams.length) member('Query parameters.', `query${op.queryParams.some((p) => p.required) ? '' : '?'}: ${op.type}Query;`);
  if (op.body) {
    const required = op.body.required && !isRequiredFree(op.body.schema);
    member('The JSON body.', `body${required ? '' : '?'}: ${op.type}Body;`);
  }
  if (op.idempotency) {
    const note = op.idempotency.required
      ? '`Idempotency-Key`, required: 8–64 printable ASCII characters. The client never makes one up (a generated key would not survive a restart of your app); it sends this one on every retry of the call.'
      : '`Idempotency-Key`: 8–64 printable ASCII characters. When omitted, the client generates a UUID and sends the same one on every retry of this call.';
    member([op.idempotency.description ?? '', note].filter(Boolean).join('\n\n'),
      op.idempotency.required ? 'idempotencyKey: string;' : 'idempotencyKey?: string | undefined;');
  }
  if (op.merchant) {
    member([op.merchant.description ?? '', '`Rewloy-Merchant`. Defaults to the client\'s `merchant`.'].filter(Boolean).join('\n\n'),
      'merchant?: string | undefined;');
  }
  if (op.otherHeaders.length) {
    member('Other header parameters.', `headers${op.otherHeaders.some((h) => h.required) ? '' : '?'}: {\n${op.otherHeaders.map((h) => `${doc(h.description, '    ')}    ${key(h.name)}${h.required ? '' : '?'}: ${e.type(h.schema, '    ')};`).join('\n')}\n  };`);
  }
  const bases = op.response === 'stream' ? 'RequestOptions, StreamOptions' : 'RequestOptions';
  const head = doc(`Arguments of \`${op.id}\`.`, '');
  if (!lines.length) return `${head}export interface ${op.type}Args extends ${bases} {}\n`;
  return `${head}export interface ${op.type}Args extends ${bases} {\n${lines.join('\n')}\n}\n`;
}

/** No required property at the top level: `{}` is a valid body. */
function isRequiredFree(schema: Schema): boolean {
  return typeof schema !== 'object' || !Array.isArray(schema.required) || schema.required.length === 0;
}

function paramsInterface(name: string, params: Param[], e: Emitter, description: string): string {
  const lines = params.map((p) => `${doc(p.description, '  ')}  ${key(p.name)}${p.required ? '' : '?'}: ${e.type(p.schema, '  ')};`);
  return `${doc(description, '')}export interface ${name} {\n${lines.join('\n')}\n}\n`;
}

/** What the method resolves to and what `data` holds; `ns` qualifies the generated names (`T.`). */
function resultType(op: Op, ns = ''): { result: string; data: string } {
  switch (op.response) {
    case 'none': return { result: 'void', data: 'void' };
    case 'blob': return { result: 'Blob', data: 'Blob' };
    case 'raw-json': return { result: 'unknown', data: 'unknown' };
    case 'stream': return { result: 'EventStream', data: 'never' };
    case 'json': {
      if (op.paged) return { result: `Page<${ns}${op.type}Item>`, data: `${ns}${op.type}Item[]` };
      return { result: `${ns}${op.type}Data`, data: `${ns}${op.type}Data` };
    }
  }
}

function typesFile(version: string, components: Obj, ops: Op[], codes: string[], e: Emitter, names: Map<string, string>): string {
  const out: string[] = [HEADER(version)];
  out.push("import type { EventStream } from '../sse.ts';");
  out.push("import type { Page, RequestOptions, StreamOptions } from '../types.ts';");
  out.push('');

  // Components. `Error` becomes the generic ErrorBody<C>: an error status narrows `code` to what it can carry.
  out.push(`${doc('Every error code the API can answer with (the catalogue: https://rewloy.com/gelistiriciler/hatalar). New codes may be added without notice: keep a default branch.', '')}export type ErrorCode =\n${codes.map((c) => `  | ${lit(c)}`).join('\n')};\n`);
  for (const [name, schema] of Object.entries(components)) {
    const tsName = names.get(name)!;
    if (name === 'Error' && isObj(schema) && isObj(schema.properties) && isObj(schema.properties.error)) {
      const inner = schema.properties.error as Obj;
      const props = isObj(inner.properties) ? inner.properties : {};
      const required = new Set(Array.isArray(inner.required) ? inner.required.map(String) : []);
      const lines = Object.entries(props).map(([k, p]) => {
        const t = k === 'code' ? 'C' : e.type(p as Schema, '    ');
        return `${doc(isObj(p) ? str(p.description) : undefined, '    ')}    ${key(k)}${required.has(k) ? '' : '?'}: ${t};`;
      });
      out.push(`${doc('The body of an error answer. `C` narrows `error.code` to the codes a status can carry.', '')}export interface ${tsName}<C extends string = ErrorCode> {\n  error: {\n${lines.join('\n')}\n  };\n}\n`);
      continue;
    }
    out.push(e.declare(tsName, schema as Schema, isObj(schema) ? str(schema.description) : undefined));
  }

  for (const op of ops) {
    out.push(`// ${'-'.repeat(70)}\n// ${op.id} · ${op.method} ${op.path}\n`);
    if (op.pathParams.length) out.push(paramsInterface(`${op.type}Params`, op.pathParams, e, `Path parameters of \`${op.id}\`.`));
    if (op.queryParams.length) out.push(paramsInterface(`${op.type}Query`, op.queryParams, e, `Query parameters of \`${op.id}\`.`));
    const headers = [op.merchant, op.idempotency, ...op.otherHeaders].filter((h): h is Param => h !== undefined);
    if (headers.length) out.push(paramsInterface(`${op.type}Headers`, headers, e, `Header parameters of \`${op.id}\`, as sent on the wire.`));
    if (op.body) out.push(e.declare(`${op.type}Body`, op.body.schema, `Request body of \`${op.id}\`.`));
    if (op.response === 'json') {
      const data = op.dataSchema;
      const items = isObj(data) && data.type === 'array' ? data.items as Schema | undefined : undefined;
      if (op.paged || (items !== undefined && isObj(items) && (items.type === 'object' || isObj(items.properties)))) {
        out.push(e.declare(`${op.type}Item`, items, `One item of \`${op.id}\`'s list.`));
        if (!op.paged) out.push(`${doc(`The \`data\` of \`${op.id}\`'s answer.`, '')}export type ${op.type}Data = ${op.type}Item[];\n`);
      } else {
        out.push(e.declare(`${op.type}Data`, data, `The \`data\` of \`${op.id}\`'s answer.`));
      }
    }
    out.push(argsInterface(op, e));
  }

  // The map: everything about an operation by its id.
  out.push(`// ${'-'.repeat(70)}\n`);
  out.push(`${doc('Every operation by its operationId: its arguments, what its method resolves to (`result`), what an answer\'s `data` holds (`data`) and the body of each documented status (`responses`).', '')}export interface Operations {`);
  for (const op of ops) {
    const { result, data } = resultType(op);
    const statuses: string[] = [];
    for (const s of op.successStatuses) {
      const body = op.response === 'json' ? (op.paged ? `{ data: ${data}; meta: PageMeta }` : `{ data: ${data} }`)
        : op.response === 'none' ? 'void' : op.response === 'stream' ? 'string' : data;
      statuses.push(`      ${s}: ${body};`);
    }
    for (const err of op.errors) statuses.push(`      ${err.status}: ErrorBody${err.codes.length ? `<${err.codes.map(lit).join(' | ')}>` : ''};`);
    out.push(`  ${op.id}: {\n    args: ${op.type}Args;\n    result: ${result};\n    data: ${data};\n    responses: {\n${statuses.join('\n')}\n    };\n  };`);
  }
  out.push('}\n');
  out.push(`${doc('Every operationId.', '')}export type OperationId = keyof Operations;\n`);
  const paged = ops.filter((o) => o.paged).map((o) => lit(o.id));
  const streams = ops.filter((o) => o.response === 'stream').map((o) => lit(o.id));
  out.push(`${doc('The paged lists: `Rewloy.paginate` walks them.', '')}export type PagedOperationId =\n${paged.map((x) => `  | ${x}`).join('\n') || '  never'};\n`);
  out.push(`${doc('The server-sent event streams: `Rewloy.stream` opens them.', '')}export type StreamOperationId =\n${streams.map((x) => `  | ${x}`).join('\n') || '  never'};\n`);
  return out.join('\n');
}

function operationsFile(version: string, ops: Op[], titles: [string, string][]): string {
  const out: string[] = [HEADER(version)];
  out.push("import type { OperationMeta } from '../types.ts';");
  out.push("import type { OperationId } from './types.ts';");
  out.push('');
  out.push(`${doc('The version of the API document this was generated from (`info.version`).', '')}export const API_VERSION = ${lit(version)};\n`);
  out.push(`${doc('The metadata table: per operation, its method and path, the credential kinds it accepts, whether it takes `Rewloy-Merchant` and `Idempotency-Key`, how its answer is read and whether it is paged, streams or is deprecated.', '')}export const OPERATIONS: { readonly [K in OperationId]: OperationMeta } = {`);
  for (const op of ops) {
    const fields = [
      `method: ${lit(op.method)}`,
      `path: ${lit(op.path)}`,
      `auth: [${op.auth.map(lit).join(', ')}]`,
      `merchant: ${String(op.merchant !== undefined)}`,
      `idempotency: ${op.idempotency ? lit(op.idempotency.required ? 'required' : 'optional') : 'null'}`,
      `body: ${String(op.body !== undefined)}`,
      `response: ${lit(op.response)}`,
      `paged: ${String(op.paged)}`,
      `stream: ${String(op.response === 'stream')}`,
      `deprecated: ${op.deprecated ? `{ sunset: ${op.deprecated.sunset ? lit(op.deprecated.sunset) : 'null'}, use: ${op.deprecated.use ? lit(op.deprecated.use) : 'null'} }` : 'null'}`,
    ];
    out.push(`  ${op.id}: { ${fields.join(', ')} },`);
  }
  out.push('};\n');
  out.push(`${doc('Each error code\'s one-line title in the catalogue (https://rewloy.com/gelistiriciler/hatalar).', '')}export const ERROR_TITLES: { readonly [code: string]: string } = {\n${titles.map(([c, t]) => `  ${key(c)}: ${lit(t)},`).join('\n')}\n};\n`);
  return out.join('\n');
}

function methodsFile(version: string, ops: Op[]): string {
  const out: string[] = [HEADER(version)];
  out.push("import type { EventStream } from '../sse.ts';");
  out.push("import type { Page } from '../types.ts';");
  out.push("import type * as T from './types.ts';");
  out.push('');
  out.push(`${doc('One method per operation of the API, named by its operationId. `Rewloy` extends it.', '')}export abstract class RewloyMethods {`);
  out.push('  protected abstract _call<K extends Exclude<T.OperationId, T.StreamOperationId>>(id: K, args: T.Operations[K][\'args\'] | undefined): Promise<T.Operations[K][\'result\']>;');
  out.push('  protected abstract _open<K extends T.StreamOperationId>(id: K, args: T.Operations[K][\'args\'] | undefined): EventStream;');
  let tag: string | null = null;
  for (const op of ops) {
    if (op.tag !== tag) {
      tag = op.tag;
      out.push(`\n  // ${'-'.repeat(60)} ${tag}`);
    }
    const { result: type } = resultType(op, 'T.');
    const optional = argsOptional(op);
    const extra = [
      `\`${op.method} ${op.path}\``,
      `@see ${reference(op)}`,
      ...(op.deprecated ? [`@deprecated ${deprecationNote(op)}`] : []),
    ];
    const text = [op.summary, op.description].filter(Boolean).join('\n\n');
    out.push('');
    out.push(doc(text, '  ', extra).trimEnd());
    const param = `args${optional ? '?' : ''}: T.${op.type}Args`;
    if (op.response === 'stream') {
      out.push(`  ${op.id}(${param}): ${type} {\n    return this._open(${lit(op.id)}, args);\n  }`);
    } else {
      out.push(`  ${op.id}(${param}): Promise<${type}> {\n    return this._call(${lit(op.id)}, args);\n  }`);
    }
  }
  out.push('}\n');
  return out.join('\n');
}

/** Nothing required: the method's argument can be left out. */
function argsOptional(op: Op): boolean {
  if (op.pathParams.length) return false;
  if (op.queryParams.some((p) => p.required)) return false;
  if (op.body && op.body.required && !isRequiredFree(op.body.schema)) return false;
  if (op.otherHeaders.some((h) => h.required)) return false;
  return true;
}

/* ------------------------------------------------------------------ entry */

export function generate(input: unknown): GeneratedFile[] {
  if (!isObj(input)) fail('the document is not an object');
  const docObj = input as Obj;
  if (typeof docObj.openapi !== 'string' || !docObj.openapi.startsWith('3.')) fail('not an OpenAPI 3 document');
  const info = isObj(docObj.info) ? docObj.info : {};
  const version = str(info.version) ?? '0.0.0';
  const paths = isObj(docObj.paths) ? docObj.paths : fail('the document has no paths');
  const components = isObj(docObj.components) && isObj(docObj.components.schemas) ? docObj.components.schemas : {};

  const names = new Map<string, string>();
  for (const name of Object.keys(components)) {
    const tsName = name === 'Error' ? 'ErrorBody' : pascal(name.replace(/[^A-Za-z0-9_]/g, '_'));
    if (name !== 'Error' && RESERVED_TYPES.has(tsName)) fail(`component "${name}" collides with a library type`);
    names.set(name, tsName);
  }
  const e = new Emitter(names);

  const ops: Op[] = [];
  const seen = new Set<string>();
  for (const [path, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    for (const m of HTTP_METHODS) {
      const op = item[m];
      if (!isObj(op)) continue;
      const o = readOp(path, m, op);
      if (seen.has(o.id)) fail(`operationId "${o.id}" is used twice`);
      seen.add(o.id);
      ops.push(o);
    }
  }
  if (!ops.length) fail('the document has no operations');

  const typeNames = new Set<string>(names.values());
  for (const op of ops) {
    for (const suffix of ['Params', 'Query', 'Headers', 'Body', 'Data', 'Item', 'Args']) {
      const n = `${op.type}${suffix}`;
      if (RESERVED_TYPES.has(n) || typeNames.has(n)) fail(`type name ${n} collides`);
    }
  }

  const errorSchema = isObj(components.Error) ? components.Error : {};
  const codeSchema = isObj(errorSchema.properties) && isObj(errorSchema.properties.error) && isObj(errorSchema.properties.error.properties)
    ? errorSchema.properties.error.properties.code : undefined;
  const codes = isObj(codeSchema) && Array.isArray(codeSchema.enum) ? codeSchema.enum.map(String) : [];
  const titleMap = errorTitles(paths);
  const titles: [string, string][] = [...codes.filter((c) => titleMap.has(c)), ...[...titleMap.keys()].filter((c) => !codes.includes(c))]
    .map((c) => [c, titleMap.get(c)!]);

  return [
    { path: 'src/generated/types.ts', content: typesFile(version, components, ops, codes.length ? codes : [...titleMap.keys()], e, names) },
    { path: 'src/generated/operations.ts', content: operationsFile(version, ops, titles) },
    { path: 'src/generated/methods.ts', content: methodsFile(version, ops) },
  ];
}
