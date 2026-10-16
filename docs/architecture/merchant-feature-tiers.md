# Merchant feature tiers and eligibility

Reviewed: 16 October 2026 (Asia/Kolkata). Product direction: [ADR 0002](0002-standalone-cod-checkout.md). Supersedes the earlier “Standard = Shopify-hosted handoff” reading of checklist 1.1.1.2.1–1.1.1.2.4 for upcoming work.

This is delivery policy for planned features. It does not certify any merchant, close Gate 0, or enable live order writes. Foundation capability code still speaks `shopifyCheckoutHandoff` until an implementation PR renames it; treat that name as legacy until then.

## Standard (v1): standalone one-page COD checkout

Eligible merchants use **our** single-page checkout for Buy Now and existing-cart entry. Shopify remains catalog/cart source and the **order/fulfillment sink**. Shoppers do **not** complete purchase on Shopify hosted checkout in the v1 happy path.

Delivery requirements:

1. **Buy Now:** preserve selected variant, quantity, and selling plan into the platform session and cart reference.
2. **Existing cart:** preserve every line, quantity, attribute, and supported buyer context; never silently replace the cart.
3. **One-page UI:** phone-first contact, address, delivery when ready, order summary, **Cash on Delivery** as the only payment method in v1.
4. **Place order:** server revalidates quote/session, then creates a **COD/pending** order in Shopify via the reviewed Admin mutation (pin API version at implementation). Browser success is not order truth until Shopify confirms.
5. **Performance:** first usable shell p95 ≤2s; lightweight API p95 ≤300ms excluding providers; paint shell before async quotes; bounded timeouts and fail-closed eligibility.

Standard requires active installation, entitlement, enabled standalone-COD flag, and unexpired eligible evidence for the shop — including a verified theme/cart entry path when going live.

## Enhanced: independently eligible additions

Enhanced is a product grouping, not a blanket authorization. Each feature needs its own server-side decision and evidence. Examples deferred after COD v1: address autofill networks, COD OTP/RTO scoring, prepaid conversion offers, Plus checkout UI extensions (only if a merchant later opts into Shopify Checkout surfaces).

| Planned feature (post-v1)    | Notes                                                                   |
| ---------------------------- | ----------------------------------------------------------------------- |
| COD OTP / smart COD blocking | Own provider + consent; does not authorize prepaid capture.             |
| Prepaid / UPI / cards        | Separate gateway gate; not part of Standard v1.                         |
| Checkout UI extensions       | Only if a merchant path uses Shopify Checkout; Plus/target rules apply. |

## Prepaid and custom payment capture: unavailable

Card/UPI/net-banking capture and Payments Platform extensions stay disabled until a separate written gate. Ordinary Admin order write for **COD pending** is the selected v1 model under ADR 0002; it is not a license to mark arbitrary orders paid or to process cards.

Until that prepaid gate is satisfied, keep capture disabled. Do not treat Plus plan, gateway credentials, or app install as authorization.

## Unknown, expired, or revoked eligibility

Build capability context only from authenticated tenant state. Fail closed when installation, entitlement, flag, or evidence is missing, stale, or mismatched. If Standard is unavailable, leave the shopper on the merchant’s existing storefront journey; do not invent a checkout URL or claim an order was placed.

Re-evaluate before place-order. Evidence refresh and invalidation remain implementation tasks.

## Verification and remaining gates

Capability unit tests still describe the legacy handoff field names; update them with the capability rename PR. Still open for Gate 0: distribution model, Admin COD order-write verification, Storefront/theme entry, live COD order on a test store, API version pin, and sign-off.
