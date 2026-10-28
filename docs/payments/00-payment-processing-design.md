# Payment processing design (all gateways)

Status: **proposal, not built**. Audience: engineers and agents.

This is the gateway-independent contract. Each gateway doc (for example [razorpay.md](razorpay.md)) only describes how that gateway maps onto it. If a gateway cannot meet a rule here, its doc must say so explicitly.

Scope: UPI, debit/credit card, net banking, wallet, EMI, on top of the existing COD flow. Out of scope for now: subscriptions/mandates, international cards, saved cards/tokens, Pay Later, BNPL.

---

## 1. Principles

| #   | Rule                                                                                                                                                                          | Why                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| P1  | The Shopify order is created only after money is confirmed (captured, or authorised then captured). Never before.                                                             | No ghost orders; no stock held for unpaid carts.                                      |
| P2  | The browser is never the source of truth. It starts the payment and shows status. Server-verified gateway events (webhook, or a direct gateway API fetch) decide the outcome. | Tabs close, UPI apps switch away, and clients can forge messages.                     |
| P3  | The amount is computed on our server from the session, never taken from the client, and re-checked against the gateway amount before the order is created.                    | Stops tampering and mismatches.                                                       |
| P4  | Every money-moving step is idempotent (create gateway order, create Shopify order, capture, refund), keyed by our `paymentIntentId`.                                          | Retries and duplicate webhooks must not double-charge, double-order or double-refund. |
| P5  | Payment state is durable (MongoDB), not Redis. Redis stays for short-lived sessions, rate limits and locks.                                                                   | Redis can evict or restart; losing a paid-but-unordered record loses money.           |
| P6  | Every paid intent ends in exactly one of: order created, or refunded. A reconciler enforces it and alerts on anything stuck.                                                  | The core safety invariant.                                                            |
| P7  | We never touch card/UPI/bank credentials. Use the gateway's hosted checkout. Keys and webhook secrets are stored encrypted per brand and never sent to the browser or logged. | Keeps us out of card-data scope.                                                      |
| P8  | New public surfaces are only the webhook endpoint (signature-authenticated) and the status/pay routes (behind the existing proxy guard and rate limits).                      | Small abuse surface.                                                                  |
| P9  | COD stays the fallback when a prepaid component is down, if the merchant has COD on.                                                                                          | Checkout must still sell.                                                             |

---

## 2. Concepts and states

**Checkout session** (exists): cart, totals, address, coupon. Redis, 30 min TTL, deleted when an order is placed.

**Payment intent** (new): one attempt to pay one session, in MongoDB `paymentIntents`. It snapshots lines, address, totals, coupon and shop at creation so it can finish after the Redis session expires (UPI approvals and webhooks can arrive late).

```
created -> awaiting_payment -> paid -> order_creating -> completed
   |              |              |            |
   |              +-> failed     |            +-> order_failed -> refund_pending -> refunded
   |              +-> expired    +-> amount_mismatch ----------> refund_pending
   +-> abandoned
```

| State                         | Meaning                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `created`                     | Intent stored; gateway order not yet created            |
| `awaiting_payment`            | Gateway order exists; shopper may be paying             |
| `failed` / `expired`          | No confirmed payment (may still receive a late success) |
| `paid`                        | Gateway confirms full amount held/captured              |
| `order_creating`              | Shopify `orderCreate` in flight (lock held)             |
| `completed`                   | Shopify order exists and is linked (terminal)           |
| `order_failed`                | Paid but order could not be created; must resolve       |
| `amount_mismatch`             | Gateway amount differs from the snapshot; must resolve  |
| `refund_pending` / `refunded` | Refund requested / confirmed (`refunded` is terminal)   |
| `refund_failed`               | Gateway rejected refund; human needed, alerts           |

**Late success:** `failed`/`expired` can still become `paid` (banks confirm late; Razorpay polls banks for up to 3 days). Allow the transition, then apply the normal order-or-refund rules. Never discard these events.

---

## 3. Components

| Component            | Responsibility                                                                           | Planned location                                  |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Provider interface   | `createOrder`, `verifyClientResult`, `fetchPayment`, `capture`, `refund`, `parseWebhook` | `app/payments/provider.server.ts`                 |
| Gateway adapters     | One per gateway                                                                          | `app/payments/<gateway>.server.ts`                |
| Intent service       | State machine, locking, snapshots, idempotency                                           | `app/payments/intent.server.ts`                   |
| Order finaliser      | Turns a `paid` intent into one Shopify order, or hands it to refund                      | `app/payments/finalize.server.ts`                 |
| Refund service       | Create, retry, track refunds                                                             | `app/payments/refund.server.ts`                   |
| Webhook inbox        | Verify, dedupe, persist, ack, process                                                    | route `webhooks.payments.$gateway.$shop`          |
| Reconciler           | Scheduled sweeps that enforce P6                                                         | `app/payments/reconcile.server.ts` plus scheduler |
| Brand payment config | Gateway, methods, encrypted keys per brand                                               | extend `checkout-settings.server.ts`              |

Adapters stay thin; state, idempotency and Shopify logic live in shared services, so a new gateway is only an adapter.

| Collection       | Key                                        | Contents                                                                   |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `paymentIntents` | `pi_...`; unique `(shop, gatewayOrderId)`  | state, snapshot, method, gateway ids, amounts, `shopifyOrderId`, `version` |
| `paymentEvents`  | unique `(gateway, eventId)`                | raw webhook body, signature result, times; dedupe and audit                |
| `refunds`        | `rf_...`; unique `(intentId, reason, seq)` | amount, gateway refund id, status, idempotency key, source                 |
| `paymentLedger`  | append-only                                | every state change with actor and reason                                   |

---

## 4. Happy path (all methods)

1. Overlay calls `POST /v1/sessions/:id/pay` (proxy guard, live session, rate limit).
2. Server recomputes the amount, snapshots into `paymentIntents`, creates the gateway order, returns `{intentId, gatewayOrderId, publicKey}`.
3. Shopper pays in the gateway's hosted checkout.
4. Gateway sends a signed webhook. Server verifies, dedupes, persists, acks 2xx.
5. Server fetches the payment from the gateway (verify status and amount), locks the intent, creates the Shopify order (paid), captures if only authorised, marks `completed`.
6. Overlay polls `GET /v1/payments/:intentId/status` until `completed`, `failed` or deadline.

The webhook and the client return both call the same idempotent `finalizeIntent(intentId)`. First one does the work; the other sees the lock or `completed` and returns the same result. The webhook, the client return and the reconciler together guarantee the outcome.

### 4.1 Shopify order for prepaid

Today `createCodOrderInShopify` creates `financialStatus: PENDING` with a COD transaction. Prepaid adds a sibling creating: `financialStatus: PAID`, one SALE/SUCCESS transaction for the paid amount with the gateway name, tags (`easy-checkout`, `prepaid`, `<gateway>`), note attributes (gateway order id, payment id, method), and the same `DECREMENT_OBEYING_POLICY` inventory behaviour. If stock is unavailable the order fails and we refund (§7).

---

## 5. Per-method behaviour

| Method                    | Result known                        | Edge cases                                                                                                  | Refund                                                                                                             |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| UPI                       | Seconds to minutes (approve in app) | Never approved (pending then expires); app switch kills page; late success; Collect/VPA entry is deprecated | Same VPA; normal 5-7 working days or instant                                                                       |
| Debit/credit card         | Seconds (3-D Secure/OTP)            | OTP fail/timeout, issuer decline, 3DS window closed, late authorisation                                     | Same card; 5-7 working days                                                                                        |
| Net banking               | Seconds to a minute (bank redirect) | Bank downtime, abandon at bank, late success                                                                | Source account; 5-7 working days                                                                                   |
| Wallet                    | Seconds                             | Insufficient balance, provider outage                                                                       | Back to the wallet; per provider SLA                                                                               |
| EMI (card/debit/cardless) | Seconds to minutes                  | Eligibility/limit failures; partial refund rules differ; interest not refunded                              | Debit-card EMI: full refund only. Credit-card EMI: partial reduces principal, EMI recalculated. No interest refund |

- **UPI:** show Intent (mobile) and QR (desktop) only, no collect. On `pending` show "Waiting for approval in your UPI app" and poll status. Never create the order on `pending`.
- **Cards/net banking:** a browser return is a hint only. A closed bank tab is not a failure.
- **EMI:** cart must be eligible (minimum amount, merchant EMI enabled). Cancellation must check the EMI type before allowing a partial refund; otherwise full cancel only or manual review.
- **Wallet:** treat as a gateway method like cards. We do not build our own wallet.

---

## 6. Payment failure and abnormal outcomes

| Situation                                   | Detected by                       | Action                                                                                                                                                 |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Payment fails (decline, wrong OTP, balance) | `payment.failed` / client error   | Stay `awaiting_payment` until deadline (gateway allows retry on same order); record attempt. No order, nothing to refund. Shopper can retry or use COD |
| Shopper closes tab after paying             | Webhook or reconciler             | Finalise from snapshot; order created without the browser                                                                                              |
| Webhook missing or delayed                  | Client return or reconciler sweep | `finalizeIntent` is also triggered by client return and sweeps of `awaiting_payment`                                                                   |
| Duplicate webhook                           | unique `(gateway, eventId)`       | Ignore, return 2xx                                                                                                                                     |
| Out-of-order webhooks                       | State machine                     | Decide from fetched gateway facts, not arrival order                                                                                                   |
| Late success after we showed "failed"       | Webhook / reconciler              | Finalise if stock allows, else refund; notify the shopper                                                                                              |
| Gateway amount differs from snapshot        | Fetch before finalising           | `amount_mismatch`, no order, refund, alert                                                                                                             |
| Two successful payments for one intent      | Second `paid` on a paid intent    | Keep first, auto-refund the extra                                                                                                                      |
| Order cannot be created                     | `orderCreate` error               | Retry transient; permanent goes `order_failed` then refund                                                                                             |
| Refund fails                                | `refund.failed` / API error       | `refund_failed`, retry with same idempotency key, alert ops for manual refund                                                                          |
| Double click on Pay                         | One active intent per session     | Return the existing intent                                                                                                                             |
| Session expired before payment              | Session lookup at `pay`           | 404 "reopen checkout". An existing intent still finishes from its snapshot                                                                             |

---

## 7. Order creation fails after payment

1. Persist `paid` before calling Shopify.
2. Take a per-intent lock; set `order_creating`.
3. Look up Shopify for an existing order carrying this gateway order id (tag/note attribute). If found, link and finish (handles crash after create).
4. Call `orderCreate`. Success: store `shopifyOrderId`, `completed`.
5. Errors: **transient** (timeout, 429, 5xx) release lock and retry with backoff; **permanent** (inventory, invalid address/PIN, missing scope/token, removed product) go `order_failed`, full refund, `refunded`. Alert on config errors (token/scope) since every order will fail.
6. Deadline: still `paid` with no order after N minutes (default 30, per brand) means refund.

If the merchant uses delayed/manual capture, create the order before capture; on permanent failure we never capture and the authorisation is released. Capture mode is a merchant dashboard setting, so the refund path must always work.

---

## 8. Cancellation and refunds

| Source                                        | Trigger                                                           | Behaviour                                                       |
| --------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Merchant cancels/refunds in Shopify           | `orders/cancelled`, `refunds/create` webhooks (new subscriptions) | Find intent by order id; refund the matching amount via gateway |
| Automatic (mismatch, duplicate, order failed) | Internal state machine                                            | Full refund of the extra/failed payment                         |
| Shopper self-service cancel                   | Not in v1                                                         | Direct to merchant; add later behind a merchant-set window      |
| Manual refund in gateway dashboard            | Gateway `refund.*` webhooks                                       | Mirror into `refunds` and Shopify so records agree              |

Rules:

1. Source refund only: money returns to the original instrument.
2. Idempotent: one record per `(intent, reason, seq)` with an idempotency key sent to the gateway; retries reuse it.
3. Total refunded never exceeds captured amount. Partial refunds are allowed for cards, UPI, net banking, wallet, credit-card EMI. Debit-card EMI: full only. EMI interest is never refunded.
4. Orders with no intent are COD and ignored.
5. Loop prevention: refunds we initiate are marked so the resulting webhook does not trigger another refund.
6. If only `authorized`, cancelling means "do not capture", not a refund.
7. Gateways may reject old payments (Razorpay: normal refunds not possible beyond 6 months); route to ops for manual transfer.
8. COD cancellations stay Shopify-only.
9. Expose `refund_pending`, `refunded`, `refund_failed` in the dashboard with gateway refund id and ARN/UTR when available.

Timing is the gateway's (about 5-7 working days normally; instant where offered). Show "refund initiated", not a promise.

---

## 9. When a system is down

| Down                                   | New payments                                                                                  | In flight / paid                                                                            | Recovery                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Gateway API                            | Disable prepaid for the attempt, offer COD; circuit breaker (e.g. 5 failures/60 s opens 30 s) | Existing payments still finish via webhook/poll later                                       | Breaker half-opens and probes; reconciler                                      |
| Gateway checkout JS blocked            | "Couldn't load payment window", retry or COD                                                  | none                                                                                        | n/a                                                                            |
| One bank/UPI network                   | Payment fails with reason; offer another method                                               | Late success still handled                                                                  | Webhook / reconciler                                                           |
| Our app                                | Checkout can't start (as today)                                                               | Gateway retries webhooks (Razorpay: backoff up to 24 h, then disables webhook)              | Startup sweep of non-terminal intents (last 3 days); alert on disabled webhook |
| Our webhook endpoint erroring          | none                                                                                          | Non-2xx only for transient errors; 2xx for duplicates/handled events                        | Fix, then reconcile                                                            |
| MongoDB                                | Fail closed (503); never create gateway orders without durable intent                         | Webhooks return 5xx to be retried; client shows "confirming"                                | Reconciler                                                                     |
| Redis                                  | Checkout already 503 (session store fails closed)                                             | Intents are in Mongo, so paid flows finish                                                  | n/a                                                                            |
| Shopify Admin API / rate limit / token | Block new prepaid when health check fails (COD also depends on Shopify)                       | Paid intents retried with backoff (30 s, 2 m, 10 m, 30 m, 2 h) to the deadline, then refund | Alert; `ADMIN_TOKEN_MISSING` means reinstall                                   |
| SMS/email                              | none                                                                                          | Queue and retry; never block order or refund                                                | n/a                                                                            |
| Reconciler/scheduler                   | none                                                                                          | Webhooks still work; stuck cases not swept                                                  | Heartbeat metric; alert if no run in 15 min                                    |

When prepaid is unavailable, `GET /v1/settings` must not expose prepaid methods, or the overlay degrades to COD at `pay` time without a second settings request.

---

## 10. Reconciliation (enforces P6)

| Job                      | Frequency | Action                                                                                                  |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------- |
| Stuck-intent sweep       | 1 min     | `awaiting_payment` past soft deadline: fetch gateway; paid means finalise; else expire after final poll |
| Paid-without-order sweep | 1 min     | `paid`/`order_failed`: retry order; past deadline refund                                                |
| Refund tracker           | 5 min     | `refund_pending` too long: fetch, update, retry or alert                                                |
| Daily gateway-vs-Shopify | daily     | Compare captured payments to orders/refunds; list exceptions; alert                                     |

Metrics: intents by state, time in `paid` without order, refund failures, webhook lag, signature failures, breaker state, per-method success rate. Alert on: any intent in `paid` over 10 min, any `refund_failed`, signature-failure spike, `orderCreate` failure rate.

---

## 11. Security

- Per-brand secrets (key id/secret, webhook secret) encrypted with the existing encryption-key mechanism; never returned by APIs or logged. Only the public key id reaches the browser.
- Webhooks: read the raw body, verify the signature in constant time before parsing. Reject invalid with 401. Bind the shop in the webhook path so one brand's secret cannot authenticate another's events.
- Client-return signature checks run server-side only.
- `pay` and status routes use the existing proxy guard, live-session check and IP rate limits (add `payInit` and `payStatus` groups, overridable per brand via the existing policy resolver).
- Unguessable intent ids; the status route returns only state, order name and message, and requires session/intent binding.
- No card/UPI data in logs or DB; masked method info only (last 4, bank name).
- Raw webhook bodies live in a restricted collection, not info logs.

---

## 12. Merchant configuration

Extend `checkoutSettings` (still one `GET /v1/settings`):

```
payments: { cod, upi, card, netbanking, wallet, emi }   // wallet, emi new
paymentGateway: { provider, mode: 'test'|'live', status } // public fields only
```

Secrets live in a server-only structure, not in `publicCheckoutSettings`. Defaults stay: COD on, prepaid off. A prepaid method is exposed only when the gateway is connected, tested, and its webhook verified healthy.

---

## 13. Changes to existing rules

- AGENTS.md says "Only COD places a Shopify order". When this ships, change to: prepaid orders are placed only after a server-verified paid intent.
- Update `docs/api/internal-reference.md` with routes, collections and settings when built.
- Verify scopes and webhook subscriptions (`orders/cancelled`, `refunds/create`) against Shopify docs for the pinned API version.

---

## 14. Delivery plan

1. Foundations: intents, events, state machine, provider interface, locks, reconciler skeleton, metrics.
2. Razorpay adapter, `pay`/status routes, webhook, prepaid Shopify order. UPI and cards first, then net banking and wallet.
3. Refund service and Shopify cancel/refund webhooks.
4. EMI (eligibility display, refund rules).
5. Cashfree (proves the interface), then PayU, Easebuzz, PhonePe, CCAvenue, bank gateways.

Each slice ships behind a per-brand flag and leaves COD untouched.

---

## 15. Open questions

1. Capture mode: require delayed/manual capture, or support auto-capture only? Proposal: support both, recommend delayed.
2. Credentials: each brand brings its own gateway account (assumed) vs a platform/aggregator account (needs partner onboarding, settlement, KYC).
3. Is a 30 min paid-to-refund deadline right for all brands?
4. Who sends "payment received / refund started" messages: us, Shopify notifications, or both?
5. Where do sweeps run: in-process timer with a Redis lock, or external cron/worker?
6. Shopify: confirm how to attach payment details to a PAID `orderCreate`, whether it has an idempotency key, and the cancel/refund mutation arguments.
