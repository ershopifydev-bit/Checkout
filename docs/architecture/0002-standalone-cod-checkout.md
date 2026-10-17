# ADR 0002: Standalone one-page COD checkout (v1 product direction)

Date: 16 October 2026. Status: accepted for product direction; implementation not started in this record.

## Context

The v1.0 master specification and the initial checklist treated **Shopify-hosted checkout handoff** as the Standard path, with independent payment/order finalization as a separate approval-gated track. Market products used by India D2C merchants (GoKwik / Kwik COD, Shiprocket fastrr, Breeze, Razorpay Magic) instead own a **fast single-page checkout** and sync resulting orders into Shopify. Stakeholders confirmed that model for this project, with **COD only** in the first delivery.

ADR 0001 remains valid for workspace boundaries, Fastify foundation, and conservative capability construction. This ADR **supersedes the product meaning of “Standard”** for upcoming work: Standard is no longer “prepare cart → Shopify Checkout URL.”

## Decision

1. **Shopper path (v1):** Theme Buy Now / Checkout opens **our** one-page checkout. The shopper completes phone, address, delivery (when ready), and **Cash on Delivery**. We do not redirect to Shopify’s hosted `/checkouts/...` as the happy path.
2. **Payment scope (v1):** COD only. No card, UPI, or net-banking capture in our UI until a later, separately gated increment.
3. **Shopify role:** Catalog and cart context via Storefront (or theme cart reference); **order + fulfillment sink** via Admin order creation for COD (pending/manual COD financial status). Inventory and merchant Ops stay in Shopify Admin.
4. **Distribution:** Prefer **custom / merchant-install** apps first. Public App Store review for checkout-bypass patterns is a separate commercial/legal gate; do not claim App Store approval from this ADR.
5. **Performance bar (non-negotiable targets to measure, not assume):**
   - First usable checkout shell p95 ≤ **2s** on documented device/network profiles.
   - Lightweight API p95 ≤ **300ms** excluding external providers.
   - Durable webhook ack p95 ≤ **200ms** after persistence.
   - Shell must paint before provider fan-out; quotes and serviceability load asynchronously with explicit timeouts and safe fallbacks.
   - Stateless API replicas, no sticky sessions; workers scale on queue age; Redis cache for serviceability/capabilities with tenant-safe keys; edge/CDN for static checkout assets when deployed.
   - **Session-first, order-on-confirm** (see [ADR 0004](0004-fast-cod-checkout-path.md)): Buy now creates our checkout session only — never a Shopify order. Shopify `orderCreate` runs on Place COD. Overlay stays on the merchant storefront (Shopflo-like speed); hijack matches GoKwik hardness.
6. **Out of v1:** Prepaid incentives that require a PG, bank/card offers, partial COD collection, RTO intelligence networks, and Shopify Checkout Extensibility as the primary UX.

## Alternatives considered

### Keep Shopify-hosted handoff as Standard

Matches ADR 0001 and much of the original checklist. Rejected for v1 because stakeholders require a GoKwik-like standalone COD experience.

### Dual-path (handoff + standalone) in one release

Increases surface area and confuses capability flags. Rejected for v1; handoff may return later as an optional merchant mode after COD standalone is proven.

### Full prepaid + COD in the first UI

Rejected; prepaid needs gateway, reconciliation, and a stronger compliance review. COD-only shrinks the first visible slice.

## Consequences

- Checklist leaves and local `tasks/` trackers that describe Shopify Checkout URL continuation must be rewritten to **COD place-order + Admin sync**.
- Capability contracts expose `standaloneCodCheckout` for the Standard path and hard-deny `customPayment` (prepaid/card capture only). Admin COD order write is gated by `standaloneCodCheckout`, not by enabling `customPayment`.
- Existing cart-preservation spike code remains useful for **reading cart lines** into our checkout; it is not deleted. It must not be treated as proof of Shopify Checkout handoff product delivery.
- Gate 0 now includes: distribution model, verified Admin order-write model for COD, Storefront/theme entry, and live COD order evidence on a test store — not “retrieve checkoutUrl and complete Shopify Checkout.”

## Official references

- Shopify Admin [`orderCreate`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/ordercreate) (COD/manual pending orders; pin version at implementation).
- [Storefront Cart](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage) for merchandise context (not Shopify Checkout URL as completion).
- Partner/App review guidance on checkout bypass — re-read before any public listing.

## Rollback

Revert this ADR via a new ADR if product direction returns to Shopify-hosted handoff. No production merchants are enabled by this document alone.
