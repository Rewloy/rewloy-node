# Live tests: what 0.2.4 cannot do yet

For the 0.3.0 regeneration (API 1.3.0). The live suite (`live.test.ts`) covers the
operations of the 0.2.4 library. Each item below needs an operation, a field or a
type that 0.2.4 does not have; add a test per item once the library has it, then
delete the line here.

- [ ] `getMeta`: type `environment` (`'live' | 'dev'`). The test reads it through a cast today.
- [ ] `recordSale` with receipt `lines` (1.3.0): typed lines, the earn rules they trigger, and the
      replay with the same key. Today the test accepts either "the server takes `lines`" or "400 VALIDATION naming
      `lines`"; when the server takes them, assert the credited amount from the rules.
- [ ] Earn rules: create, list, update and delete a rule (programme groups and the line-item schema),
      and a sale that earns by them.
- [ ] Branch QR: one QR per branch with curated and seasonal programmes, session-reuse multi-join,
      branch freeze.
- [ ] Code cards single-entry joins (`joinProgram` through a code), and `BATCH_EXPIRED` / `BATCH_FULL`
      refusals of `sendBatchLink` (need a code that has expired or run out; needs a holder session or a clock).
- [ ] Holder side (`holderLogin`, `holderSession`, Rewloy Cüzdan operations): needs a holder session in the
      environment; not reachable with a test key.
- [ ] Operations that need a staff session beyond the reset: keys (`createApiKey`, `revokeApiKey`),
      team, locations, segments, campaigns, automations, promotions, exports (the suite uses a staff session
      only for `resetTestEnvironment`).
- [ ] Shops and checkout codes (`createShop`, `holdCheckoutCode`, `captureCheckoutOrder` ...).
- [ ] `liveFeed` (SSE) against the server: connect, receive an event after an `issuePass`, close.
- [ ] Webhook delivery to a reachable receiver: a local listener cannot be reached from a dev server, so
      this needs a public test receiver; `testWebhook` and `listWebhookDeliveries` follow.
- [ ] `resetTestEnvironment` with `revokeKeys: true` (it would revoke the key the suite runs with).
- [ ] Run the suite against the built `dist/` as well as `src/` (the published shape).
