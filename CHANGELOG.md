# Değişiklik günlüğü / Changelog

Bu kütüphanenin sürümleri. API'nin kendi değişiklikleri:
https://rewloy.com/gelistiriciler/degisiklikler

This library's releases. The API's own changes are listed at the link above.

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
