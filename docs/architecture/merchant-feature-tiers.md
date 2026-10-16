# Merchant feature tiers and eligibility

Reviewed: 16 October 2026 (Asia/Kolkata). Scope: checklist 1.1.1.2.1–1.1.1.2.4, implementing the feature-tier definitions in the master specification §§2–3.

This is the delivery policy for planned features. It does not certify any merchant, close Gate 0, select the final Shopify API baseline, or enable a checkout integration. The foundation currently implements only capability decisions; the shopper journeys below still need adapters and live-store verification.

## Standard: pre-checkout and Shopify handoff

Eligible non-Plus and Plus merchants can use the planned pre-checkout experience to prepare a cart and continue to Shopify-hosted checkout. Shopify documents cart creation, buyer context updates, and retrieval of `checkoutUrl` in its [Storefront cart guide](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage). Cart costs are estimates; Shopify checkout determines final totals.

Our delivery requirements are:

1. **Buy Now:** preserve the selected variant, quantity, and applicable selling plan when preparing the cart. Revalidate availability and totals before offering handoff.
2. **Existing cart:** preserve every line, quantity, attribute, and supported buyer context. Do not silently replace the cart or lose items when creating the platform session.
3. **Pre-checkout integrations:** offer branding, address entry, serviceability and eligible offer/loyalty quotes only after their own integration and data-access checks pass. A quote does not establish redemption, a confirmed delivery charge, or payment success.
4. **Handoff:** obtain a current Shopify checkout URL for the verified cart. Transfer only fields supported and tested for the chosen API and storefront. Unsupported contact, address, discount, or delivery preferences must have an explicit user-visible limitation; do not promise they will appear in checkout.
5. **Completion:** derive order/payment status from authenticated Shopify records and verified events. A redirect, browser success screen, or analytics event does not prove payment.

Standard requires an active installation, app entitlement, enabled handoff flag, and unexpired eligible evidence for the authenticated shop. Evidence must include successful Buy Now and existing-cart tests for the merchant's storefront, including the required buyer and selling-plan contexts. Installation alone is insufficient.

## Enhanced: independently eligible additions

Enhanced is a product grouping, not a blanket authorization or a current API tier value. Each feature needs its own server-side decision, entitlement, flag, tested implementation, and merchant-specific evidence. Its failure must not enable another restricted capability.

| Planned feature                                   | Eligibility and evidence required                                                                                                                                                                                                                                                                                                                                                                                                                       | Behavior while unavailable                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Information-step UI extension                     | Shopify Plus; supported target/API; approved data access where needed; extension deployed, configured, and tested on that merchant's checkout. [Checkout UI reference](https://shopify.dev/docs/api/checkout-ui-extensions/latest)                                                                                                                                                                                                                      | Omit the additional fields/content; retain Standard only if independently eligible. |
| Shipping-step UI extension                        | Same Plus and target checks, plus verification against the merchant's actual delivery flow. [Checkout UI reference](https://shopify.dev/docs/api/checkout-ui-extensions/latest)                                                                                                                                                                                                                                                                         | Do not promise custom delivery controls inside Shopify checkout.                    |
| Payment-step UI extension                         | Same Plus and target checks; data and network capabilities must match the approved implementation. A UI extension supplies no independent payment authorization. [Checkout UI reference](https://shopify.dev/docs/api/checkout-ui-extensions/latest)                                                                                                                                                                                                    | Keep Shopify's supported payment flow; disable the additional UI.                   |
| Rename, reorder, or hide existing payment methods | Verify app distribution, plan, country, payment method, checkout surface, and operation-specific restrictions. Public App Store apps containing Functions can serve plans allowed by the individual API; custom apps containing Functions require Plus. [Function availability](https://shopify.dev/docs/api/functions/latest#api-availability), [Payment Customization reference](https://shopify.dev/docs/api/functions/latest/payment-customization) | Leave Shopify's configured methods unchanged; do not substitute a custom gateway.   |

Payment customization is scoped here to presentation of existing methods. Payment terms, review rules, and other Function operations require separate requirements and verification. Thank-you/order-status surfaces also need separate target-specific eligibility; do not apply the checkout-step Plus rule to every extension surface.

For each future feature, record the shop, plan, distribution model, exact target and API version, scopes/data access, provider prerequisites, test evidence, reviewer, review time, expiry, and revocation conditions. Public documentation establishes platform conditions; only merchant-specific evidence can establish that our implementation works for that shop. No Enhanced feature is currently implemented.

## Approved payments: unavailable pending written authorization

Shopify limits Payments Platform extensions to approved partners; custom payment extensions also require confirmation of merchant eligibility. See [Extensions for payments](https://shopify.dev/docs/apps/build/payments).

Our separate release gate requires written Shopify authorization identifying the partner, merchant audience, extension/integration type, permitted operations, and restrictions, plus the applicable provider approval, security review, and operational verification. Record approver, date, evidence link, and scope before implementation can enable execution. A Plus subscription, gateway account, API credentials, or successful app installation is not that authorization.

Until this gate is satisfied, `customPayment` stays disabled with `APPROVAL_REQUIRED`. Do not offer independent capture, mark an order paid, or imply that ordinary Admin API access authorizes bypassing Shopify checkout. Approved payments is not exposed as an enabled tier by the current contract.

## Unknown, expired, or revoked eligibility

The [resolver](../../packages/domain/src/capabilities.ts) consumes trusted server-side merchant context. Never construct that context from a shopper-supplied shop ID, plan name, or enabled flag. The [contract](../../packages/contracts/src/index.ts) currently exposes only `standard` and `unavailable` tiers.

The following table matches the resolver's current precedence; the first failing Standard condition wins. The messages describe intended UI behavior, not an implemented screen.

| Condition                                                                                                        | Reason                   | Required behavior                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Installation uninstalled or suspended                                                                            | `MERCHANT_INACTIVE`      | Disable the platform journey; merchant must restore a valid installation.                                            |
| Handoff flag off                                                                                                 | `FEATURE_DISABLED`       | Do not expose platform handoff.                                                                                      |
| Standard entitlement absent                                                                                      | `NOT_ENTITLED`           | Explain that the feature is unavailable for this app entitlement.                                                    |
| Evidence absent, for another shop, future-dated, malformed in its timestamps, or evaluated with an invalid clock | `ELIGIBILITY_UNVERIFIED` | Disable handoff and request a merchant eligibility recheck.                                                          |
| Evidence expired                                                                                                 | `ELIGIBILITY_EXPIRED`    | Disable handoff until refreshed evidence passes.                                                                     |
| Current evidence records ineligibility                                                                           | `NOT_ELIGIBLE`           | Explain that this store's integration is unsupported.                                                                |
| All Standard conditions pass                                                                                     | `ELIGIBLE`               | Permit the Standard capability decision; the future adapter must still validate the cart and URL before redirecting. |
| Checkout UI extension requested today                                                                            | `NOT_IMPLEMENTED`        | Keep extension controls unavailable regardless of plan.                                                              |
| Custom payment requested today                                                                                   | `APPROVAL_REQUIRED`      | Keep custom payment execution unavailable.                                                                           |

Unknown eligibility must never default to Standard. If an Enhanced capability is unavailable, Standard remains an option only when its own checks pass. If Standard is unavailable, preserve the existing storefront cart and let the shopper return to the merchant's existing checkout journey; do not invent a URL, send them through an unverified platform handoff, or claim checkout completed. This fallback is a requirement for future storefront integration.

Re-evaluate trusted state before protected actions; do not reuse an earlier allow decision after uninstall, suspension, entitlement/flag changes, or evidence expiry. Evidence storage, refresh, and invalidation remain implementation tasks. The foundation resolver does not fetch Shopify evidence or expose an authenticated capability endpoint.

## Verification and remaining gates

The existing [capability tests](../../tests/unit/capabilities.test.ts) cover eligible Standard decisions, inactive installations, flags, entitlements, missing/cross-shop/invalid/expired evidence, and revocation. They also verify that extensions and custom payments remain disabled. These synthetic tests do not certify live merchant eligibility.

The references above were reviewed on 16 October 2026. The checkout UI reference displayed 2026-07; the Function references displayed 2026-10. These observations are documentation evidence, not a project API-version selection. Recheck the exact version and target when implementing each feature.

Still open: representative non-Plus/Plus merchant matrix; storefront/provider/COD evidence; scopes and protected-data review; distribution and billing decisions; real cart/handoff tests; API baseline selection; and Gate 0 sign-off. This document completes the four tier-definition checklist steps only.
