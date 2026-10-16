# ADR 0004: Fast COD checkout path (session-first, order-on-confirm)

Date: 16 October 2026. Status: accepted for implementation direction under [ADR 0002](0002-standalone-cod-checkout.md).

Evidence: live storefront captures — Levi’s / **GoKwik** (order `#1930877`) and The Sleep Company / **Shopflo** (order `#20725183`). Mid-checkout request bodies were incomplete across origins; end-state models and merchant configs are sufficient for this decision.

## Context

We need a GoKwik/Shopflo-class COD checkout that feels **extremely fast**, while still writing a correct Shopify COD order. The open question was whether competitors create the Shopify order when the shopper clicks **Buy now** (or earlier “behind the scenes”), or only when they confirm COD.

## Finding: when is the Shopify order created?

| Moment | GoKwik (Levi’s) | Shopflo (Sleep Co) |
| ------ | --------------- | ------------------ |
| Page load / hijack ready | SDK + embed warm | `bridge.shopflo.com` + Flo config warm |
| Buy now / Checkout click | Opens **their checkout session** (cart/variant context). Does **not** finalize Shopify order. | Opens Flo checkout with `checkoutId` / session UUIDs. `is_buy_now` was false on the captured cart flow; Buy now can be enabled per merchant. Still **not** a completed Shopify order. |
| During form fill | Session updates (phone OTP, address, quotes). GoKwik may hold an internal order row before merchant sync. | Session + address book; shipping handles; pricing. Optional draft concepts exist in platform; completed capture had `is_draft_order: false`. |
| Place COD | Confirm → sync Shopify (`is_order_created_merchant`, `shopify_order_name`). | Confirm → **Shopify order** with `financial_status: pending`, gateways `Cash on Delivery (COD)`, tags `COD, Shopflo`. |
| Thank you | Hosted `*.addons.gokwik.co/thank-you?token=…` | Merchant `/pages/order-status?tokenId=…&checkoutId=…` |

**Conclusion:** Neither product creates the **final Shopify order on Buy now**. Speed comes from **warm assets + instant backend session + overlay paint**, not from pre-creating Shopify orders (which would spam Admin with abandoned drafts and confuse inventory).

What they *do* early (the real speed tricks):

1. Prefetch SDK/CSS/JS on the storefront.
2. On intent/click, create a **checkout session** on their API with cart/variant lines (parallel with opening UI).
3. Returning shopper recognition (phone cookie / SSO) to skip typing.
4. Async serviceability / EDD / discounts after shell is visible.
5. Shopify `orderCreate` (or equivalent) only on **Place order**.

## Decision

### 1. Session-first; order-on-confirm

- **Buy now / Checkout** → `POST /v1/sessions` (or app-proxy equivalent) with `{ source: "buy_now" | "cart", variantId?, quantity?, cartToken? }` → return `{ sessionId, lines, currency, totals }`.
- Overlay opens immediately; bind UI to `sessionId` (never the fixture hoodie in production path).
- **Place COD** → revalidate session → Shopify Admin COD/`pending` order → return `{ orderId, orderName }`.
- Do **not** call Shopify `orderCreate` on Buy now, hover, or session create.

### 2. Shell and navigation (prefer Shopflo speed)

- Keep checkout as a **same-origin / in-page overlay** (theme app embed + app proxy). Do not navigate shoppers to a third-party hostname for the happy path.
- Thank-you v1: success state inside the overlay; optional merchant page later (`tokenId` + `sessionId` query) modeled on Shopflo.

### 3. Hijack hardness (prefer GoKwik)

- While embed hijack is enabled: remove accelerated Buy it now hosts, intercept Checkout submits, block in-page `/checkout` navigation. Native Shopify checkout must not win.

### 4. Performance budget (how we stay fast)

| Phase | Target | Technique |
| ----- | ------ | --------- |
| Embed idle | Negligible main-thread | Small `hijack-core` + deferred `embed.js`; CSS hide accelerated checkout |
| Click → shell visible | p95 ≤ **2s** (ADR 0002) | Prefetch panel HTML/CSS/JS after idle; `open()` does not wait on quotes |
| Click → session bound | p95 ≤ **500ms** API | `POST /sessions` in parallel with panel mount; optimistic skeleton lines from theme DOM if needed |
| Pincode → shipping/EDD | Async, non-blocking | Debounced quote; show shell totals first |
| Place COD → success | Dominated by Shopify Admin | Persist local intent, then Admin write; surface Shopify name when confirmed |

Warm path (implementation checklist):

1. On embed load: prefetch `panel.html`, `checkout.css`, `checkout.js` (idle callback).
2. On Buy now / Checkout: `preventDefault` → paint overlay skeleton → `POST /sessions` with real merchandise.
3. Optional: on `pointerenter` of Checkout (desktop only), prefetch session create for current cart (cancel if unused) — **never** create Shopify orders here.
4. Cache last address / phone in `localStorage` (shopper device) for autofill; server session remains source of truth.
5. Stateless session store (Mongo); no sticky sessions.

### 5. Shipping, discounts, bank offers

| Capability | v1 | Notes |
| ---------- | -- | ----- |
| Shipping | One COD-capable handle + optional EDD string after pincode | Shopflo `available_shipping_handles` shape |
| Discounts | Shopify cart auto-discounts in session totals + optional single coupon apply | Shopflo `discounts.mode: SHOPIFY`; stack length 1 |
| Bank / card offers | **Out of v1** | Prepaid-only; defer with payment methods |
| OTP / RTO | Out of v1 shell-critical path | May add post-COD verify later (`POST_COD`-style) without slowing first paint |

### 6. Observability (track everything that matters)

Emit correlation-id’d events (no PII in logs):

| Event | When |
| ----- | ---- |
| `checkout.hijack` | Checkout/Buy now intercepted |
| `checkout.shell_visible` | Overlay painted (mark TTFB/click→paint) |
| `checkout.session_created` | Session API ok (+ duration_ms, source) |
| `checkout.session_failed` | Session API error code |
| `checkout.quote_updated` | Pincode/shipping/discount apply |
| `checkout.place_started` / `place_succeeded` / `place_failed` | COD confirm |
| `checkout.shopify_order_synced` | Admin order id/name stored |

Store timing histograms for click→shell, click→session, place→Shopify. Dashboards later; structured logs first.

## Alternatives considered

### Create Shopify draft orders on Buy now

Rejected for v1. Speeds nothing the shopper sees if Admin is slow; pollutes Orders with abandoneds; inventory/reservation side effects. Session on our DB is enough.

### Hosted third-party checkout domain (GoKwik addons host)

Rejected for happy path: extra navigation hurts p95. May revisit only for thank-you branding if merchants demand it.

### Wait for full quote before opening overlay

Rejected: violates shell-first budget.

## Consequences

- Demo fixture routes remain for local playground only; storefront embed must use real session APIs.
- App proxy gains `POST/GET/PATCH /v1/sessions` and `POST /v1/sessions/:id/place-cod`.
- Theme embed Buy now reads product form variant + qty (and cart.js for cart checkout).
- ADR 0002 performance numbers stay the bar; this ADR defines **how** we hit them.

## Implementation plan (ordered)

1. **Session API** — Mongo session model; `POST/GET/PATCH` + quote; wire app proxy; keep demo routes for playground only.
2. **Embed wiring** — Buy now / Checkout: paint shell → `POST /sessions` with variant or `/cart.js` lines; drop fixture `GET /v1/demo/checkout` from production overlay path.
3. **Warm path** — idle prefetch of panel assets; optional desktop hover prefetch of cart session (cancellable).
4. **Address + pincode quote** — shipping handle + EDD string; totals include discount/shipping/COD fee.
5. **Place COD** — Admin `orderCreate` pending/COD; overlay success with order name; structured timing events.
6. **Measure** — click→shell, click→session, place→Shopify on codemadi host theme; adjust until ADR 0002 budgets hold.

## Rollback

If session-first proves wrong for a merchant program that requires Shopify draft holds, add an optional draft-order mode behind a separate ADR — do not change the default Buy-now path.
