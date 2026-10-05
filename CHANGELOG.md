# Değişiklik günlüğü / Changelog

Bu kütüphanenin sürümleri. API'nin kendi değişiklikleri:
https://rewloy.com/gelistiriciler/degisiklikler

This library's releases. The API's own changes are listed at the link above.

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
