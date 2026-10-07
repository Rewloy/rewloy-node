# Live tests: what is not covered yet

The live suite (`live.test.ts`) covers what a test business can do through a test key
(and, optionally, a staff session): the operations of 0.2.4, and since 0.3.0 receipt lines,
earn groups and rules, previews, line refunds, `copyProgram`, the branch QR and its
downloads, and branch freezing. What is left below needs a credential or a clock a test
key cannot give. Add a test per item when it can be reached, then delete the line here.

- [ ] Branch QR: seasonal programmes (`startsOn` / `endsOn`, needs a clock or a dated list), the
      session-reuse multi-join (`joinHolderBranch`, needs a holder session), the QR of a code
      (`updateBatch` with `channels.branchQr`), `addQrItems` across branches, `cardScope: "branch"`.
- [ ] Branch freeze beyond one freeze: a planned freeze (`startsOn` in the future), `FREEZE_LIMIT`
      (4 starts in 12 months), `pass.extended` after reopening (webhook delivery needs a public receiver).
- [ ] Earn rules beyond stamps: points and cashback rules, `spendShareMaxPct` (`BILL_REQUIRED`,
      `SPEND_SHARE_EXCEEDED`), daily and monthly caps over several receipts, shop lines (`rewloy` platform).
- [ ] Code cards single-entry joins (`joinProgram` through a code), and `BATCH_EXPIRED` / `BATCH_FULL`
      refusals of `sendBatchLink` (need a code that has expired or run out; needs a holder session or a clock).
- [ ] Holder side (`holderLogin`, `holderSession`, Rewloy Cüzdan operations): needs a holder session in the
      environment; not reachable with a test key.
- [ ] Operations that need a staff session beyond the reset: keys (`createApiKey`, `revokeApiKey`),
      team, locations, segments, campaigns, automations, promotions, exports (the suite uses a staff session
      only for `resetTestEnvironment` and `freezeLocation`).
- [ ] Shops and checkout codes (`createShop`, `holdCheckoutCode`, `captureCheckoutOrder` ...).
- [ ] `liveFeed` (SSE) against the server: connect, receive an event after an `issuePass`, close.
- [ ] Webhook delivery to a reachable receiver: a local listener cannot be reached from a dev server, so
      this needs a public test receiver; `testWebhook` and `listWebhookDeliveries` follow.
- [ ] `resetTestEnvironment` with `revokeKeys: true` (it would revoke the key the suite runs with).
- [ ] Run the suite against the built `dist/` as well as `src/` (the published shape).
