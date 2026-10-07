# Decisions

Choices made while building v0.1 without the owner (3 Oct 2026). Each can be
revisited; most are a line to change.

## Generation

1. **Own emitter, not openapi-typescript.** The platform's document uses a
   small part of JSON Schema: inline schemas, nullable type arrays, enum,
   const, oneOf and anyOf, and `$ref` only to `Error` and `PageMeta`. One
   generator file (`scripts/generator.ts`) gives each operation named
   types: `PassActionParams`, `…Query`, `…Headers`, `…Body`, `…Data`,
   `…Item`, `…Args`. It also gives one method per operationId and the
   metadata table, with no dependency.
2. **Errors per status.** Each error status is typed with the codes the
   document's examples give it, as `ErrorBody<'INSUFFICIENT_BALANCE' | …>`.
   Error titles also come from those examples: `ERROR_TITLES`, and
   `RewloyError.title`.
3. **Sunset dates.** The document has no machine-readable sunset field. The
   generator reads the platform's sentence ("1 Nisan 2027 tarihine kadar
   çalışır; yerine `x`") for `@deprecated` and the table's `deprecated`. The
   runtime warning uses the `Sunset` header itself.
4. **The snapshot.** `openapi/openapi.json` is pretty-printed: 3.2 MB, but
   the regeneration pull requests show readable diffs. Output keeps the
   document's order and carries no dates, so it is deterministic.
5. **Refusals.** The generator refuses an operationId that collides with a
   client method (`request`, `paginate`, `stream`), duplicate ids and
   unknown constructs. A regeneration that needs a human fails loudly.

## Language and build

6. **Sources import `.ts` paths.** Node 22.18+ runs the tests and scripts
   directly (type stripping). `tsc` rewrites the emitted JavaScript;
   `scripts/build.mjs` rewrites the declaration files' imports to `.js`,
   which tsc leaves alone. The library needs Node 22; development needs
   22.18 or later.
7. **TypeScript 5.9, not 7.0.** 5.9 is what the platform uses, and the
   declaration output is well known. The only devDependencies are
   `typescript` and `@types/node`; `node_modules` is 26 MB.
8. **Language.** Library-authored text (TSDoc, errors, warnings) is in
   English. The API's descriptions stay Turkish in the TSDoc, and the README
   is bilingual, Turkish first.
9. **Package.** `"private": true` until the npm account exists. `prepare`
   builds, so `npm install github:Rewloy/rewloy-node` works. There is a
   default export as well as named ones.

## Client

10. **Argument shape.** Each method takes one object: `params`, `query`,
    `body`, `merchant`, `idempotencyKey`, `signal`, `timeoutMs` and
    `maxRetries`. It is optional when nothing in it is required. An
    all-optional body that is left out is sent as `{}`, because the API
    validates a body on those operations.
11. **Results.** A method resolves to `data`. Paged lists give
    `{ data, meta }` (the total matters), 204 gives `undefined`, files give a
    `Blob`, `openapi` gives the parsed document and streams give an
    `EventStream`. `request()` returns the whole answer.
12. **`User-Agent`, not `Rewloy-Client`.** The API's CORS allow-list
    (`authorization, content-type, idempotency-key, rewloy-merchant`) has no
    room for a custom header, so `Rewloy-Client` would fail a browser's
    preflight. The platform already records `User-Agent` in `action_log` and
    in the session list.
    - **Format:** `rewloy-node/0.1.0 node/<version> [suffix]`.
    - **Browsers:** it is not sent outside Node.
    - **Checked live:** the API (Cloudflare, Caddy, Fastify) accepts it, and
      an unknown header too.
13. **When the credential is left out.** A credential is not sent to an
    operation that does not accept its kind but accepts none, such as
    `login` or `openapi` with an API key. The API answers a refused kind with
    `CREDENTIAL_NOT_ALLOWED` even where no credential would do. In every
    other case the credential is sent and the API decides.
14. **Construction is checked.** The prefix must match the kind (`rwk_`,
    `rws_`, `rwh_`). A client without a credential is allowed, for the public
    endpoints that open sessions. `merchant` goes only with a staff session.
15. **Retries go a little beyond the brief:**
    - Cloudflare's 520–524 count with 502–504 (the API is behind
      Cloudflare);
    - `409 IDEMPOTENCY_IN_PROGRESS` is waited out (the platform's own
      advice);
    - backoff is 0.5 s doubling to 8 s, with jitter between half and all of
      it;
    - `Retry-After` is honoured up to 60 s; longer, and the error goes to
      the caller (a 15-minute lockout is not slept through).
16. **Timeouts.** The timeout is 60 s per attempt, covering the whole body.
    For a stream it covers only the headers.
17. **Idempotency keys.** Where the API's document marks the header
    `required` (`recordSale`, `passAction`, `sendCampaign`,
    `refundShopRedemption`) `idempotencyKey` is a required argument and a call
    without it throws a `TypeError` before sending: a random key would defeat
    safe retries across a restart of the caller's process. Where it is
    `optional` the client generates a UUID v4 (`node:crypto`) and reuses it for
    every retry of the call. A key given by the caller must be printable ASCII
    (0x21–0x7E), 8–64 characters, checked before the request (a header value
    cannot hold anything else; `fetch` would throw a bare `TypeError`).
18. **One error hierarchy.**
    - `RewloyError` keeps `status`, `code`, `title`, `detail` (the API's
      `message`), `details`, `docs`, `requestId` (the header first),
      `body`, `headers` and `operation`.
    - No answer means status 0, with `CONNECTION_ERROR` or `TIMEOUT`.
    - A non-Rewloy error body gets `HTTP_<status>`, and an undocumented 2xx
      body `INVALID_RESPONSE`.
    - Subclasses: `RateLimitError`, `RewloyConnectionError` and
      `RewloyTimeoutError`.
19. **Deprecation warnings** use `type: 'DeprecationWarning'` and
    `code: 'REWLOY_DEPRECATED'`. There is one per operation per process,
    whatever the number of clients. `--no-deprecation` silences them.
20. **Test mode is `mode`.** It is on `request()`'s answer and on the event
    stream, read from `Rewloy-Mode`, `null` when absent. There is no
    `client.lastMode`, which would race under concurrent calls.

## Streams and webhooks

21. **Streams reconnect by default**, as a browser's `EventSource` does, and
    as the API's docs ask ("koparsa yeniden bağlanın").
    - **When:** after the server's `retry:` (5000 ms on Rewloy), with
      backoff up to 30 s while it fails.
    - **What ends a stream:** 401, 403 and 404.
    - **Idle check:** after 60 s without a byte (heartbeats every 25 s).
    - **Stopping:** abort, `break` and `close()` end it quietly.
    - **The last event ID** carries over to a new connection; the API sends
      no ids today.
22. **Webhooks.**
    - **Several signatures:** any `v1` entry and any of several secrets are
      accepted. The platform sends one, but rotation (moving to a new
      webhook) costs nothing to allow.
    - **Tolerance** works both ways (±300 s).
    - **`now`** is a `Date` or Unix seconds.
    - **A parsed object** as the payload is a `TypeError`, a programming
      error, not a refusal.
    - **`signWebhook`** is exported so that users can test their own
      handlers.

## CI

23. **Actions.** `actions/checkout@v7` and `actions/setup-node@v7` are the
    current majors. `npm ci --ignore-scripts`, then typecheck, build and
    test, on Node 22 and 24.
24. **Regeneration.**
    - **Branch:** the job force-pushes its own branch,
      `regenerate/openapi`, and opens or updates one pull request.
    - **Checks:** a pull request opened with `GITHUB_TOKEN` does not start
      CI, so the job runs typecheck, build and test itself and reports the
      outcome in the pull request.
    - **On failure:** it fails when the regenerated code fails.
    - **Cache:** none in that write-enabled job.

## 0.3.0 (API 1.3.0)

25. **Webhook events are a union by `type`.** `WebhookEvent` keeps its first
    member (`pass.issued`, `pass.activity`, `pass.voided`) and gains
    `pass.extended` (`PassExtendedData`: `reason`, `from`, `to`) and the four
    branch and business events (`LocationEventData`), each a member of its
    own so a `switch (event.type)` narrows `data`. The document describes
    events only in prose, so these shapes are written by hand from the API
    documentation; `PassEventData` keeps its index signature, so a field the
    platform adds later still reads.
26. **`reverseSale` now sends an `Idempotency-Key`.** The document declares
    the header (optional; the server requires it for a refund of lines), and the
    client makes a UUID for an optional key, as it does for every operation.
    A retry of one call is safe; a caller who may repeat the call after a
    crash gives its own key (the README says so).
27. **Live suite.** The freezing test needs a staff session and its person's
    password (`REWLOY_STAFF_PASSWORD`), read from the environment, used only
    for `freezeLocation` and never printed; without it the test is skipped.
    A freeze is always lifted again in a `finally`, and the reset removes
    any left over.
