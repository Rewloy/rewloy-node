# Değişiklik günlüğü / Changelog

Bu kütüphanenin sürümleri. API'nin kendi değişiklikleri:
https://rewloy.com/gelistiriciler/degisiklikler

This library's releases. The API's own changes are listed at the link above.

## 0.3.0 (2026-10-07)

Rewloy API 1.3.2'yi izler (API sürümü, `info.version`): 298 işlem (0.2.4'te 260),
hiçbiri kaldırılmadı; 38 yeni işlem, 31 yeni hata kodu, yeni alanlar ve
webhook olayları. Fiş satırları ve kazanım kuralları, ürün grupları, kazanım ve
satış önizlemesi, satır iadesi, şube QR'ı (herkese açık sayfa, QR ve sayfa
dosyaları, liste), şube dondurma, kodlar için düzenleme, kopya ve uzatma. Her
şey eklemedir; kırılan bir şey yok (ayrıntı aşağıda).

Follows Rewloy API 1.3.2 (the product version in `info.version`): 298
operations (260 in 0.2.4), none removed; 38 new operations, 31 new error codes,
new fields and webhook events. Additive: nothing in 0.2.4's public API
changed (see "Compatibility" below).

- **Receipt lines and earn rules.** `recordSale` takes `lines` (typed:
  `lineId`, `name`, `sku`, `category` as a path string or array, `quantity` as a
  number or a decimal string, `unit`, `unitPriceMinor`, `discountMinor`,
  `totalMinor`, `kind`, `tags`) and `receiptDiscountMinor`; its answer carries
  `earn`, the explanation of what was written (`source` `legacy` or `rules`,
  the rule revision, each line's `status`, `groups` and `rules`, the rules with
  their units and a sentence, and the total step by step with every cap that
  cut it). New refusals: `LINES_TOTAL_MISMATCH`, `LINE_AMOUNT_INVALID`,
  `TOO_MANY_LINES`; new `reason` values `no_earning_lines`, `no_lines`,
  `daily_cap_reached`, `monthly_cap_reached`. The lines are part of the
  request's fingerprint for `Idempotency-Key`.
- **Earn groups** (`listEarnGroups`, `createEarnGroup`, `getEarnGroup`,
  `updateEarnGroup`, `deleteEarnGroup`) and the categories the tills send
  (`listSeenLines`, `listEarnSources`, `ignoreSeenLine`, `unignoreSeenLine`).
- **Earn rules** of a programme (`getEarnRules`, `putEarnRules` with the
  `revision` you read, `createEarnRule`, `updateEarnRule`, `deleteEarnRule`,
  `deleteEarnRules`, `listEarnRuleRevisions`), the ready-made sets
  (`listEarnTemplates`), and the two dry runs: `previewEarn` (a programme, with an
  unsaved `ruleSet` and a card `context`) and `previewSale` (a card: the
  answer `recordSale` would give now, `preview: true`, nothing written, no
  `Idempotency-Key`). New codes `REVISION_CONFLICT`, `RULE_KIND_NOT_FOR_TYPE`,
  `EARN_RULES_NOT_FOUND`, `EARN_RULE_NOT_FOUND`.
- **Line refunds.** `reverseSale` takes `lines: [{ lineId, quantity?,
  amountMinor? }]`; the sale is judged again without them under the rules of
  its day and only the difference is taken back. The answer carries `earn` and
  `linesLeft`; `reversed` can be `0`. New codes `LINE_NOT_FOUND`,
  `LINE_ALREADY_REFUNDED`. `reverseSale`'s `Idempotency-Key` is now declared
  (optional in the document, required by the server for a refund of lines): the
  client makes a UUID when you give none, as for every operation with an
  optional key; give your own key for a refund of lines so a retry after a crash
  is safe.
- **Branch QR.** A branch (`listLocations`, `getLocation`, `createLocation`,
  `updateLocation`, `archiveLocation`, `restoreLocation`) carries `qr` (`code`,
  `url`, `state`), `frozen` and `stats.qrCards30`. `publicBranch` (the page the
  QR opens, no credential), `holderBranch` and `joinHolderBranch` (a Rewloy
  Cüzdan session), the files `locationQrPng`, `locationQrSvg`,
  `locationQrSheetPdf`, `locationQrSheetSvg` (a `Blob`), and the QR's list
  (`getLocationQrItems`, `putLocationQrItems`, `addQrItems`,
  `previewLocationQr`). `createLocation` takes `qrListFrom` and `programIds`;
  `joinProgram` takes `locationId`; `claimHolderCode` and `joinHolderProgram`
  take `branchCode`; `programJoinQr` takes `branchCode` and `format`. New codes
  `QR_LIST_CHANGED`, `QR_ITEM_INVALID`, `BRANCH_NOT_FOUND`, `BRANCH_GONE`,
  `NOT_VALID_HERE`, `ITEM_NOT_OFFERED`.
- **Freezing a branch.** `freezeLocation` (a staff session and the person's
  password; a key is `403 CREDENTIAL_NOT_ALLOWED`), `updateLocationFreeze`,
  `cancelLocationFreeze`, `unfreezeLocation`, `listLocationFreezes`. A till
  operation at a frozen branch is `409 LOCATION_FROZEN`, and while every
  branch is frozen an operation with no branch (and a campaign, a checkout
  hold) is `409 BUSINESS_FROZEN`; both are in the `409` of `recordSale`,
  `passAction`, `issuePass`, `joinProgram`, `claimCode`, `sendCampaign` and the
  checkout operations. `getPassTill` carries `frozen`; `listNotifications`
  takes `kind: 'branch'`; `getPlan` has `billing.days`. New codes
  `ALREADY_FROZEN`, `NOT_FROZEN`, `FREEZE_STARTED`, `FREEZE_LIMIT`,
  `LOCATION_ARCHIVED`, `LOCATION_FROZEN`, `BUSINESS_FROZEN`.
- **Cards and codes.** `copyProgram` (a gift-card, coupon or discount-card
  programme; a loyalty card is `422 NOT_AN_INSTRUMENT`), `extendProgramCards`
  (`until` or `days`), `updateBatch`. A programme takes `giftValueMinor`,
  `offerValueMinor`, `usage`, `usageLimit`, `validity`, `joinWindow` and
  `terms` (`createProgram`, `updateProgram`, `previewProgram`); a code takes
  `claimFrom`, `claimUntil`, `channels`, `qrLocationIds` and `proofRequired`
  and `publicCode` answers `branchNames`, `validity`, `claimOpensOn`, `terms`.
  `listAllBatches` takes `state: 'scheduled'`. New codes `PROOF_REQUIRED`,
  `BATCH_NOT_OPEN`, `BATCH_CAP_REQUIRED`, `BATCH_PER_PERSON_REQUIRED`,
  `CAPACITY_BELOW_CLAIMED`, `CLAIM_AFTER_CARD_END`.
- **Spending a share of the bill.** `passAction` takes `billMinor`; with a cap
  on the share payable with cashback a spend without it is `422 BILL_REQUIRED`
  and above the cap `409 SPEND_SHARE_EXCEEDED` (`holdCheckoutCode` the same with
  `orderTotalMinor`).
- **Shops.** A shop has `lines` (what its orders sent), orders carry
  `earnSource`, and `platform` takes `rewloy` (a shop that signs Rewloy's own
  order body).
- **Webhook events.** `pass.extended`, `location.frozen`, `location.unfrozen`,
  `business.paused` and `business.resumed` in `createWebhook`'s `events` and in
  every webhook object. `WebhookEvent` (the type `verifyWebhook` returns) gains
  `pass.extended` (`PassExtendedData`: `reason` `merchant` or `branch_frozen`,
  `from`, `to`) and the four branch and business events (`LocationEventData`: `card`
  and `customer_id` are `null`, `location_id` is the branch); `PassEventData` gets
  `partial` (a `pass.activity` `adjust` when only some lines of a sale were
  refunded).
- **Small things.** `getMeta` types `environment` (`'live' | 'dev'`);
  `holderCard` carries `notices` (a frozen branch's strip) and
  `holderMerchantPrograms` `validAt`; `getPlan` `billing.days`; `createWebhook`
  takes the new events.
- **Compatibility.** Every 0.2.4 operation, exported type and method is still
  there with the same name. The document changed in these places that can touch
  code which was exhaustive over 0.2.4's types: the `events` of a webhook, the
  `kind` filter of `listNotifications`, the `state` and `status` of code lists,
  `recordSale`'s `reason`, a shop's `platform` and `lastDelivery.result` and
  `WebhookEvent`'s `type` each gained values, so keep a default branch in a
  `switch` on them (the library has always said new values may appear).
  `reverseSale`'s answer `reversed` may now be `0` (a line refund); a field of an
  answer that is always sent (`frozen`, `qr`, `channels`...) is a required field
  of the new type. No request body gained a required field and nothing was removed.
  **No breaking change.**
- Descriptions of the API moved (the document is Turkish and the TSDoc follows
  it); `openapi/openapi.json` is the 1.3.2 document of core tag `v1.3.2`, the same
  file in all five libraries. 1.3.2 adds no operation over 1.3.0: the
  error-code enum gained six console-only values (`DPA_DRAFT`,
  `SUMMARY_REQUIRED`, `PREVIEW_CHANGED`, `DAY_CHANGED`, `NOTHING_TO_SEND`,
  `NOTICE_TOO_LATE`; `/v1` never returns them) and one description changed.
- Node: `test/v130.test.ts` (offline: the 38 new operations are there, a sale with
  lines and its `earn`, `previewSale`, a line refund, files as `Blob`, the
  public branch page, the new error codes and webhook events);
  `test/live/` now covers receipt lines, groups and rules, the previews, line
  refunds, `copyProgram`, the branch QR and its downloads and, with a staff
  session and password (`REWLOY_STAFF_PASSWORD`), freezing a branch: 106 tests
  against a local Rewloy 1.3.0 server.

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
