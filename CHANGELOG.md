# Değişiklik günlüğü / Changelog

Bu kütüphanenin sürümleri. API'nin kendi değişiklikleri:
https://rewloy.com/gelistiriciler/degisiklikler

This library's releases. The API's own changes are listed at the link above.

## 0.2.4 (2026-10-06)

Rewloy API 1.2.0'ı izler (API sürümü, `info.version`): 260 işlem (0.2.2'de 256),
hiçbiri kaldırılmadı. Kasa yazımlarının yanıtında `card`, kartın işlem listesi,
webhook sırrını yenileme ve silme, POS anahtarları, test ortamını silmeden
sıfırlama, bütün kodların listesi. Webhook nesnesinde `pausedUntil` ve
`resumableUntil`; kod bağlantısı göndermede `BATCH_CLOSED`, `BATCH_EXPIRED`,
`BATCH_FULL` ve `PROGRAM_ARCHIVED` hataları. Ayrıca README'deki `rewardReady`
örneği `actions[].ready` okuyacak şekilde düzeltildi. 0.2.3 yalnız .NET ve
Kotlin'in paket sürümüydü; beş kütüphane 0.2.4'te aynı sürüme gelir.

Follows Rewloy API 1.2.0 (the product version in `info.version`): 260
operations (256 in 0.2.2), none removed. All five client libraries are 0.2.4.
Additive, except that `closed` in the test-reset answer is now always `null`
and `sendBatchLink` now refuses a code that issues no card (see below).

- **New operation `listPassOperations`** (`GET /v1/passes/{serial}/operations`,
  paged): a card's ledger operations and coupon / discount-card uses, newest
  first, for a till's "last operations" list. Each carries `kind`, signed
  `delta` and `unit`, `at` (and `occurredAt` for a sale written later),
  `reference`, `source`, `byCaller`, and what undoes it: `undoWith`
  (`sale/reverse` or `actions/reverse`), `reversible` and, when not,
  `reason`; for this credential's own operations `saleKey` / `actionKey` to pass
  straight to the reverse call; `reversedBy`, `reversedAt`, `reverses`.
  Needs `passes.read`.
- **`card` on write answers** (`recordSale`, `passAction`, `reverseSale`,
  `reverseAction`): the card after the write, the fields of `getPass` except
  `customer` (`programName`, `currency`, `stamps` / `points` / `money`,
  `rewardReady`, `actions`, `sale`…), read in the same transaction. On a replay
  (`duplicate: true`) it is the card's current state. It is `null` when the
  credential lacks `passes.read` in the card's programme (a till-only plugin
  key), so the type is nullable. No second `getPass` is needed to draw a receipt.
- **`reversed` on `recordSale` and `passAction` answers**: `true` only on a
  replay of a sale that was taken back since (`credited` is what the first
  request wrote, the card no longer carries it); send a new key to write the
  receipt again.
- **`occurredAt` errors**: a rejected `occurredAt` is a `400 VALIDATION` whose
  `details[0].reason` says which limit: `in_future`, `too_old` (over 72 hours),
  `before_issue` (the card did not exist then: resend without `occurredAt`),
  `invalid`. Treat an unknown reason as `invalid`. (Documented on the error
  details; the field stays optional.)
- **New operations `rotateWebhookSecret`** (`POST /v1/developers/webhooks/{id}/rotate-secret`)
  and **`deleteWebhook`** (`DELETE /v1/developers/webhooks/{id}`, `204`). A
  rotation returns the new `secret` once; the old one keeps signing for 24
  hours, so `Rewloy-Signature` carries two `v1` values and the delivery has
  `Rewloy-Signature-Rotating: 1`. `verifyWebhook` already tried every `v1` and
  several secrets: pass `[new, old]` while you switch. Deleting removes the
  delivery history too.
- **POS keys**: `createApiKey` takes a second body shape, `kind: "pos"` with
  `locationId` and optional `register` (the built-in till role, one branch, named
  "POS · branch · register"), and answers with `baseUrl`; `listApiKeys` and
  `getApiKey` rows carry `pos` (`{ locationId, register } | null`) and
  `requestsToday`, and `listApiKeys` filters with `kind` (`pos` | `standard`).
- **Test environment reset** (`resetTestEnvironment`) keeps the test business: the
  body takes `revokeKeys` (default `false`; `true` also revokes the keys, closes
  the webhooks and cancels open store-link codes), and the answer counts
  `deleted` (`customers`, `cards`, `codes`, `outbox`, `webhookDeliveries`), `kept`
  (`programs`, `keys`, `webhooks`), `created`, `keysRevoked` and
  `walletCardsVoided`; `closed` is now always `null`. New error code
  `TEST_RESET_BUSY` (`409`).
- **New operation `listAllBatches`** (`GET /v1/batches`, paged): every gift-card,
  coupon and discount code of the business, newest first; filters `programId`,
  `type`, `status` and `q`. Each row's `state` (and the `status` filter) takes
  **`archived`**: the code itself is open but its card (programme) is archived,
  so its link issues nothing; `status` on the row stays `open` | `closed`. New error
  code `PROGRAM_ARCHIVED` (`409`) on `createBatch` for an archived programme.
- **Programme rows** (`listPrograms`, `getProgram`, `createProgram`,
  `updateProgram`) carry `programName`, always equal to `name` (the field name
  that `createProgram` takes and `getPass` returns).
- **Webhook state: `pausedUntil` and `resumableUntil`** on every webhook object
  (the rows of `listWebhooks`, and the `webhook` of `createWebhook`, `getWebhook`,
  `setWebhookStatus` and `rotateWebhookSecret`). Both are always present, a
  date-time or `null`. `pausedUntil`: an open webhook is paused (its receiver
  failed twice in a row with a `5xx`, a `429`, a connection error or no answer):
  its deliveries wait until this moment and are retried on their own, 60
  seconds; `null` when it is not paused or the webhook is off.
  `resumableUntil`: the rules turned the webhook off and keep its pending
  deliveries; turned on before this moment (24 hours after it was closed, with
  `setWebhookStatus` `{ "active": true }`) it carries on where it stopped, the
  kept deliveries go at once and the events that happened meanwhile arrive too;
  `null` while it is on, when a person or a key turned it off, or once the time
  has passed.
- **`sendBatchLink` refusals** (`POST /v1/batches/{id}/send`): the link of a code
  is e-mailed only while the code issues a card. A stopped code answers
  `410 BATCH_CLOSED`, one past its date `410 BATCH_EXPIRED`, one whose cards
  are all given `410 BATCH_FULL`, and a code whose programme is archived
  `409 PROGRAM_ARCHIVED` (a new `409` on this operation); no mail goes. Before
  1.2.0 the last three were sent anyway. The error codes were already in the
  library's list of codes; the operation's description now names all four.
- Descriptions only: `earnRate` / `cashbackRate` round down on a sale
  (`floor(amountMinor / 100 × earnRate)`, `floor(amountMinor × cashbackRate / 100)`);
  `currencyLocked` also for an open amount-valued coupon; `actions30` on a key
  now counts reads; `rewardReady` means "reward ready" only on stamp and points
  cards (always `true` on VIP, any balance on cashback and gift cards): read
  `actions[].ready` to know what can be done now; `kvkkConsent` on `issuePass`;
  `me` → `key.abilities` is not the key's permissions (those are `permissions`).
- **Fixed in the README**: the first example read `rewardReady` as "ready to
  redeem". It now reads `actions[].ready` (see `getPass`).
- Node: `pausedUntil` and `resumableUntil` are `string | null` on the webhook
  types; `Operations['sendBatchLink']['responses']` types `409`
  (`PROGRAM_ARCHIVED`) and `410` (`BATCH_CLOSED` | `BATCH_EXPIRED` |
  `BATCH_FULL` | `TOKEN_INVALID`).
- Node: new tests in `test/v120.test.ts` (the four new operations, paging,
  `kind: "pos"`, `revokeKeys`, a replayed sale with `card: null`,
  `PROGRAM_ARCHIVED`, the webhook state fields, the four refusals of
  `sendBatchLink`); `RewloyError.details` documents `reason`.

## 0.2.2 (2026-10-05)

Rewloy 1.1.0'a (API sürümü) göre yeniden üretildi: 256 işlem (0.2.1'de 255). Kasa
için `reverseAction`, `recordSale`'de `occurredAt`, `passAction`'da `reference`;
yanıtlarda `RateLimit-*` başlıkları.

Regenerated from Rewloy 1.1.0 (the product version in `info.version`): 256
operations (255 in 0.2.1).

- **New operation: `reverseAction`** (`POST /v1/passes/{serial}/actions/reverse`).
  Voids a till action made with `passAction` (`spend`, `spend-points`,
  `redeem-stamps`, `redeem-reward`, `use`), found by its `actionKey` (the
  `Idempotency-Key` it was sent with) or its `reference`. It needs no
  `Idempotency-Key`: an action is voided once and a repeat answers
  `duplicate: true`. New error codes `ACTION_NOT_FOUND`, `ACTION_AMBIGUOUS`,
  `ACTION_NOT_REVERSIBLE`.
- **`recordSale` takes an optional `occurredAt`**: when the sale really happened
  (ISO 8601 with offset), for a till that queues sales while offline.
- **`passAction` takes an optional `reference`**, and its answer is now a union
  type: the balance-card answer (`balance`, `detail`, `promotion`) or the coupon /
  discount-card answer (`status`, `uses`, `usesLeft`). Narrow with `'uses' in r`.
- **Rate limit headers.** `ApiResponse.rateLimit` (`{ limit, remaining, reset }`,
  from `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; `null` when the
  answer has none) and `RewloyError.rateLimit` (including `RateLimitError`).
  `parseRateLimit(headers)` is exported. Additive.
- Webhook-creation responses may carry `warnings` (a non-live installation whose
  URL production would refuse); the `Idempotency-Key` parameter documents its
  8–64 printable ASCII rule; the API's descriptions no longer contain internal
  `ADR n` references. README: the till example has a void step and a note on
  `occurredAt` for offline queues.

## 0.2.1 (2026-10-05)

Dışarıdan geliştiricilerin bulduğu üç sorun düzeltildi.

Three problems found by outside developers, fixed.

- **`Idempotency-Key` is checked before sending.** A key with non-ASCII
  characters (`fiş-0042`) made `fetch` throw a bare `TypeError` about the header
  value. Now the client refuses any key that is not printable ASCII
  (0x21–0x7E), 8–64 characters, with a clear `TypeError` ("Idempotency-Key
  yalnız ASCII karakterler içerebilir …") and sends nothing. The API will also
  answer `400 VALIDATION` for such a key in its next release.
- **`baseUrl` takes the address with or without `/v1`.** The documentation and
  the OpenAPI document show `https://app.rewloy.com/v1`; the client wanted the
  origin only. Now both work; a trailing `/v1` or `/v1/` and trailing slashes
  are stripped (`rewloy.baseUrl` is the origin).
- **`idempotencyKey` is required where the API requires it.** For `recordSale`,
  `passAction`, `sendCampaign` and `refundShopRedemption` the OpenAPI document
  marks the header required, but the client made up a random UUID when it was
  missing, which does not survive a restart of your app. `idempotencyKey` is now
  a required argument of those methods (a type error in TypeScript, a
  `TypeError` before sending in JavaScript). Where the header is optional
  (`issuePass`, …) a UUID is still generated and reused on every retry.
  **Breaking for callers that relied on the generated key** (a small break,
  taken in a patch release because the old behaviour could write a sale twice).

## 0.2.0 (2026-10-05)

Rewloy API 1.0.5'e göre yeniden üretildi: 255 işlem (0.1.0'da 237). Kasa için
`recordSale` ve `reverseSale`; README'de yeni bir kasa örneği, test modu ve
`baseUrl`.

Regenerated from Rewloy API 1.0.5: 255 operations (237 in 0.1.0).

- **New operations (18).**
  - *Till:* `recordSale` (`POST /v1/passes/{serial}/sale`: write a completed
    sale to a card; the card type decides what is written) and `reverseSale`
    (`POST /v1/passes/{serial}/sale/reverse`: take a refunded sale back).
  - *Checkout codes and shop connections:* `quoteCheckoutCode`,
    `holdCheckoutCode`, `captureCheckoutOrder`, `releaseCheckoutOrder`,
    `refundCheckoutOrder`, `listOrderRedemptions`, `listShopRedemptions`,
    `releaseShopRedemption`, `refundShopRedemption`, `setShopSettings`,
    `setShopCeiling`, `setShopPluginAbilities`, and for the card holder
    `holderCheckoutCodes`, `mintHolderCheckoutCode`, `cancelHolderCheckoutCode`.
  - `getMeta` (`GET /v1/meta`): the API's version.
- **`getPass`** now also returns `programName`, `currency`, `stamps`
  (`count`, `max`), `points`, `money` (`amountMinor`, `currency`), `customer`
  (with `customers.read`), `actions` and `sale`.
- **Webhooks.** `webhooks.manage` API keys manage webhooks (`createWebhook`,
  `listWebhooks`, `getWebhook`, `setWebhookStatus`, `testWebhook`,
  `listWebhookDeliveries`, `webhookEvents`); a webhook reports `createdByKey`.
- **Other fields.** `issuePass` returns `created`; business lists and `me`
  carry `currency`; programs carry `sale`; batches `onlineValue`; shops
  `accepts`, `settings`, `shopName`, `unbacked` and the plugin key's
  `abilities`.
- **Generator.** A doc comment holding an unbalanced bracket no longer
  breaks an object union such as the answer of `me`.
- **README.**
  - A till example with `recordSale`, the structured fields of `getPass` and
    a refund with `reverseSale`.
  - `Idempotency-Key`: a key is unique for good per credential. The
    receipt number alone is not a key (fiscal receipt numbers restart after
    the Z report): use register + Z number + receipt number, or a UUID
    stored with the sale. The receipt number goes in `reference`.
  - Test mode exists: `rwk_test_` keys and a test business. The "being
    prepared" wording is gone.
  - How to set a custom base URL (staging), and a link to the developer
    docs, https://rewloy.com/gelistiriciler.

## 0.1.0 (2026-10-04)


İlk önizleme, npm'de ilk sürüm. Rewloy API 1.0.0'a göre üretildi: 237 işlem.

First preview and first npm release, generated from Rewloy API 1.0.0 (237 operations):

- **Client.** `new Rewloy({ apiKey } | { staffSession, merchant } | { holderSession })`
  with `baseUrl`, `timeoutMs`, `maxRetries`, `fetch` and `userAgent`.
- **Methods.** One method per operation, named by its operationId, typed
  from the OpenAPI document. `request()` returns the whole answer (`status`,
  `requestId`, `mode`, `replayed`).
- **Retries** on network errors, timeouts, 429 and 502–504, with
  exponential backoff, jitter and `Retry-After`. Only safe requests are
  retried.
- **`Idempotency-Key`** for till actions and campaigns: generated when
  omitted, reused across retries.
- **Pagination** with `paginate()`.
- **Server-sent events** with `stream()`, `liveFeed()` and
  `holderCardEvents()`, with reconnection and `Last-Event-ID`.
- **Webhooks:** `verifyWebhook()` and `signWebhook()`.
- **Errors:** `RewloyError`, `RateLimitError`, `RewloyConnectionError` and
  `RewloyTimeoutError`.
- **Deprecations:** a `DeprecationWarning` per deprecated operation, and
  `@deprecated` in the types.
- **Regeneration:** `npm run generate`, plus a daily workflow that opens a
  pull request when the live document changes.
