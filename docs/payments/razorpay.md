# Razorpay integration

Status: **proposal, not built**. Priority: Phase 1 (small), Essential (big), High (extra-big). Implements the contract in [00-payment-processing-design.md](00-payment-processing-design.md); read that first.

Sources: Razorpay docs (Standard Checkout, Orders, Payments, Capture, Webhooks, Refunds, EMI refunds, UPI Collect migration). Items marked **verify** were not confirmed from the docs and must be checked before building.

---

## 1. What we need from each brand

| Item                           | Notes                                                                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Razorpay account, KYC complete | Brand's own account (see open question 2 in the design doc)                                                                                                                      |
| Test and live API keys         | Key Id (public) and Key Secret. Stored encrypted per brand. Key Secret never reaches the browser                                                                                 |
| Webhook secret                 | Set by the brand when creating the webhook in Dashboard; separate test and live webhooks                                                                                         |
| Methods enabled in Dashboard   | UPI, cards, net banking, wallets, EMI (EMI types such as card, debit, cardless are enabled per account)                                                                          |
| Capture setting                | Default auto-capture within an authorise window of up to 3 days (Dashboard: min 12 minutes, max 3 days, or manual capture). Direct-settlement merchants are always auto-captured |
| Webhook URL registered         | `https://<app-host>/webhooks/payments/razorpay/<shop>`; ports 80/443 only; our IPs reachable by Razorpay's webhook IPs                                                           |

Onboarding screen in the merchant admin: paste Key Id, Key Secret, Webhook Secret, choose mode, run a "Test connection" (fetch a small order) and a "Verify webhook" check (we show whether a signed test event has arrived). Prepaid methods stay hidden until both pass.

---

## 2. Flow

1. `POST /v1/sessions/:id/pay` (ours): create the intent, then call Razorpay `POST /v1/orders`:
   - `amount` in paise (from our snapshot), `currency: INR`, `receipt: <intentId>`, `notes: { intentId, shop, sessionId }`.
   - Store the returned `order_id` on the intent.
2. Overlay opens Standard Checkout with `key` (Key Id), `order_id`, `prefill` (name, contact, email from the session address), and a **handler** for the success callback (recommended for web). `callback_url` is only for WebView/redirect cases and does not replace webhooks.
3. On the handler callback the overlay posts `{razorpay_order_id, razorpay_payment_id, razorpay_signature}` to our server. We verify: HMAC-SHA256 of `order_id|payment_id` with the Key Secret equals the signature (**verify** the exact formula in the current docs). This only triggers `finalizeIntent`; the outcome is still confirmed by fetching the payment.
4. Webhooks (below) drive the same `finalizeIntent`.
5. Finalise: `GET /v1/payments/:id` to confirm `status`, `amount`, `currency`, `order_id` match the intent. Then create the Shopify order and, if the payment is only `authorized`, `POST /v1/payments/:id/capture` with `amount` and `currency` from our stored snapshot.

Payments made without an `order_id` cannot be captured and are auto-refunded, so we always pass an order.

### States mapping

| Razorpay                              | Our intent                                                 |
| ------------------------------------- | ---------------------------------------------------------- |
| Order `created`                       | `awaiting_payment`                                         |
| Order `attempted`                     | `awaiting_payment` (an attempt exists; may have failed)    |
| Payment `failed`                      | stay `awaiting_payment` until deadline (shopper may retry) |
| Payment `authorized`                  | `paid` only after amount check, then capture               |
| Payment `captured` / Order `paid`     | `paid`, then order creation                                |
| Refund `created`/`processed`/`failed` | `refund_pending` / `refunded` / `refund_failed`            |

An order stays `paid` even after a refund, so use the **payment** and **refund** objects for money state, not only the order.

---

## 3. Webhooks

Subscribe to: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed`. Add dispute events later.

Handling rules:

- **Verify** `X-Razorpay-Signature` = HMAC-SHA256 of the **raw** body with the webhook secret, constant-time compare. If the brand rotated the secret, old events retried by Razorpay are signed with the old secret, so keep the previous secret valid for a grace period.
- **Dedupe** on the `x-razorpay-event-id` header (delivery is at-least-once) via the unique `(gateway, eventId)` index.
- **Respond fast**: persist then return 2xx; process asynchronously. Non-2xx or a response slower than 5 s counts as a failure. Retries use exponential backoff for 24 hours, after which Razorpay disables the webhook and emails the brand.
- Events can arrive **out of order**. Never decide from the event alone: fetch the payment/refund, then apply the state machine.
- Recommended pattern from Razorpay: client handler for instant UX, webhooks for server automation, API fetch if a webhook is delayed. We do all three.
- Local development: Razorpay blocks tunnel hosts such as ngrok.io, webhook.site, requestbin.com, localhost, `.local`/`.internal`. Use a tunnel such as zrok.

---

## 4. Per-method specifics

| Method          | Razorpay behaviour and our handling                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UPI**         | UPI Collect (typing a VPA/mobile) was deprecated by NPCI on 28 Feb 2026, with exemptions (iOS app and mobile web, mandates, eRupi, some merchant categories). Hide it with checkout config `display.hide: [{method: "upi", flows: ["collect"]}]`. Desktop shows UPI QR; mobile web gets UPI Intent by default; UPI QR on mobile web is on-demand via Razorpay support. UPI Intent is not supported on desktop web |
| **Cards**       | 3-D Secure handled in Razorpay's hosted window. We store only masked info. Tokenisation/saved cards out of scope. International cards out of scope (**verify** account enablement)                                                                                                                                                                                                                                |
| **Net banking** | Redirect to bank inside Razorpay checkout. Treat the return as a hint only                                                                                                                                                                                                                                                                                                                                        |
| **Wallets**     | Enabled per wallet in Dashboard. Refund goes back to the wallet                                                                                                                                                                                                                                                                                                                                                   |
| **EMI**         | Card EMI, debit-card EMI and cardless EMI are separate enablements. We display only what the account has. Pay Later is out of scope. See refunds below                                                                                                                                                                                                                                                            |

Control which methods the shopper sees from our `payments` flags via checkout `config.display` blocks (hide a method when the brand has it off), so Dashboard and our settings never disagree. Our flag is the filter, the Dashboard enablement is the ceiling.

### Late authorisation

If the bank's status is not received, Razorpay keeps the payment `created` for about 10 minutes, marks it `failed` (timeout), keeps polling the bank for up to 3 days, and a success moves it to `authorized` (roughly 0.5% of payments). We must handle `payment.authorized` after a failure:

- If the intent is still open or `failed`/`expired` and stock/amount are fine: move to `paid`, create the order, capture.
- Otherwise do not capture; Razorpay auto-refunds uncaptured authorised payments after the capture window, or we refund immediately if already captured.

### Capture

- Auto-capture: payment becomes `captured` without our call; order creation follows `payment.captured`.
- Manual or delayed capture: we create the Shopify order first, then capture with the stored amount. Capture amount must equal the order amount we stored. Uncaptured payments are auto-refunded after the window, which covers the "order creation failed" case without a refund call.

---

## 5. Refunds

API: `POST /v1/payments/:id/refund` with optional `amount` (partial), `speed` (`normal` or `optimum`/instant, **verify** exact values), `notes`, `receipt`.

- Send `X-Refund-Idempotency` (at least 10 characters, letters/digits/hyphen/underscore). Our key: `rf_<intentId>_<reason>_<seq>`. The same key with a different body returns `BAD_REQUEST`; a concurrent duplicate returns 409. Treat both as "already in progress, fetch it".
- Normal refunds take about 5-7 working days; instant refunds are near-immediate with an extra fee and limited by payment method. Refunds are always to the original source. Normal refunds are not possible for payments older than 6 months.
- States: `pending`, `processed`, `failed`. `acquirer_data` holds ARN/RRN/UTR when available; show it to the merchant.
- Webhooks `refund.created/processed/failed` update our `refunds` record.
- Refund of an uncaptured `authorized` payment is not possible; let it lapse or capture then refund, whichever the merchant's setting makes cheaper (**verify**).

### EMI

- Interest paid on EMI is not refundable; banks may add cancellation charges.
- **Debit-card EMI**: only a full refund is allowed (no multiple partial refunds).
- **Credit-card EMI**: full refund returns the principal; a partial refund reduces the principal and the remaining EMIs are recalculated.
- Before any partial refund of an EMI payment, our refund service checks the method type and rejects unsupported partials with a clear dashboard message.

---

## 6. Errors and retries

| Situation                         | Handling                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create order fails (5xx, timeout) | Retry once with a short backoff; the intent is not yet `awaiting_payment` so it is safe. Then show COD fallback. Create order is not idempotent, so keep `receipt = intentId` and look up by receipt before retrying (**verify** receipt lookup) |
| 4xx auth error (bad key)          | Mark gateway `status: error`, hide prepaid for that brand, alert the merchant                                                                                                                                                                    |
| Rate limited                      | Back off with jitter; limits per Razorpay docs (**verify** current numbers)                                                                                                                                                                      |
| Fetch payment fails               | Retry later via the reconciler; never assume success                                                                                                                                                                                             |
| Webhook delivery fails for 24 h   | Razorpay disables the webhook; we detect via a daily check that a test event was received and by the reconciler finding paid payments with no webhook                                                                                            |

Circuit breaker, Mongo/Redis/Shopify outages and the reconciler follow the design doc sections 9 and 10.

---

## 7. Test mode

- Separate test keys and test webhook. Use test cards and UPI IDs from Razorpay's test docs (**verify** current values). The test-mode webhook setup OTP is `754081`.
- No real money moves in test mode.
- Minimum automated tests when built: signature verify (good, bad, tampered, reordered), webhook dedupe, out-of-order events, amount mismatch, late `payment.authorized` after `failed`, paid-then-orderCreate-fails produces a refund, refund idempotent retry, partial refund rejected for debit-card EMI.

---

## 8. Mapping to our code (planned)

| Concern  | Location                                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter  | `app/payments/razorpay.server.ts` implementing the provider interface                                                                         |
| Routes   | `proxy.v1.sessions.$sessionId.pay`, `proxy.v1.payments.$intentId.status`, `webhooks.payments.razorpay.$shop`                                  |
| Overlay  | `public/checkout/checkout.js` loads Razorpay checkout script only when the shopper picks a prepaid method (no extra request on checkout open) |
| Settings | `payments.{upi,card,netbanking,wallet,emi}` flags in the single `/v1/settings` body                                                           |
| Secrets  | Server-only per-brand structure, encrypted                                                                                                    |

Hard rules from AGENTS.md still apply: no second storefront settings fetch, and the overlay source of truth stays in `public/checkout/*`.

---

## 9. Go-live checklist

- [ ] Brand KYC done; live keys stored; webhook created with a secret and subscribed to the events above
- [ ] Capture setting decided and documented for the brand
- [ ] UPI Collect hidden; UPI Intent/QR verified on Android, iOS and desktop
- [ ] End-to-end test per method in test mode, including a forced failure and a closed tab
- [ ] Late-authorisation and webhook-retry behaviour exercised
- [ ] Refund tested: full, partial, and EMI rule
- [ ] Reconciler running with alerts; daily report reviewed
- [ ] Prepaid hidden automatically when the gateway is unhealthy; COD fallback verified

---

## 10. Open items specific to Razorpay

1. Confirm with Razorpay whether our model (brand-owned accounts) needs anything extra for UPI Intent on Shopify-hosted themes.
2. Decide whether to use Razorpay's own COD/Magic Checkout. It is a separate on-demand product and overlaps with our checkout; the current plan is not to use it.
3. Confirm instant-refund eligibility and fee per method for each brand.
