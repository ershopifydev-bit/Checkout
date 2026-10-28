# Cart-to-checkout feasibility spike

This local probe prepares checklist 1.2.1 (Buy Now and existing-cart handoff). It creates a synthetic cart, checks the returned selections, and reads that same cart reference without replacing it. It does not place orders, collect payments, expose a production endpoint, or establish merchant eligibility. Run it only against authorized test stores with synthetic data.

## Merchant evidence — 16 October 2026

| Store                         | Reported classification                        | Observed access                                                       | Outstanding evidence                                                                                         |
| ----------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `codemadi.myshopify.com`      | Plus development store, confirmed by merchant  | Tokenless Storefront query returned `Online Store channel is locked.` | Authenticated plan verification, storefront/provider/COD inventory, usable Storefront access, actual handoff |
| `newer-nonplus.myshopify.com` | Non-Plus test counterpart supplied by merchant | Same locked-channel response                                          | Authenticated plan verification, storefront/provider/COD inventory, usable Storefront access, actual handoff |

The user deferred live access setup. A locked-channel response is an access prerequisite, not proof that the store is ineligible. Neither merchant's complete eligibility checklist nor any live cart/handoff step is marked complete by this probe.

## Prepare access and fixtures

Use the repository's pinned Node and pnpm versions. Shopify documents [tokenless cart read/write and token-based Storefront access](https://shopify.dev/docs/api/storefront/latest#authentication). For locked stores, configure appropriate Storefront access, for example the Headless channel, then verify that the test products are published to that channel. Channel setup and possession of a token do not themselves prove cart access.

If using a **public Storefront access token**, put it in the ignored root `.env.cart-spike` file:

```dotenv
SHOPIFY_STOREFRONT_TOKEN=replace-locally
```

Never paste the value into a ticket or commit it. Do not use an Admin API token or a private Storefront token in this variable: this runner sends the public-token header. Omitting it attempts tokenless access.

Create a local JSON fixture, such as `tasks/nonplus-cart-fixture.json` (ignored). Replace the illustrative IDs below with published test variant IDs. Use a non-default variant from a product with multiple variants; record the selected option and expected price separately. Set `checkoutHost` only if the merchant's verified checkout domain differs from the shop domain.

```json
{
  "shop": "newer-nonplus.myshopify.com",
  "input": {
    "lines": [
      {
        "merchandiseId": "gid://shopify/ProductVariant/123",
        "quantity": 2,
        "attributes": [{ "key": "fixture", "value": "non-default-variant" }]
      },
      { "merchandiseId": "gid://shopify/ProductVariant/456", "quantity": 1 }
    ],
    "attributes": [{ "key": "spike", "value": "cart-preservation" }],
    "buyerIdentity": { "countryCode": "IN" }
  }
}
```

For Buy Now, use just the selected non-default variant. For the existing-cart case, use multiple lines and attributes. Include `sellingPlanId` on a line when the fixture product supports a selling plan; do not invent one. This probe seeds a new isolated cart and then exercises existing-reference retrieval. It does not import a browser's Ajax cart or test a theme integration.

The fixture allows 1–20 unique selections, quantities 1–100, and anonymous country context. Real customer fields, discount mutations, delivery addresses and authenticated buyer flows are deliberately outside this first probe. Do not put personal data in attributes. Missing or changed selection data, truncated line results, mutation warnings, unexpected hosts, and API-version fallback fail the probe rather than producing successful evidence.

## Run and inspect

Run from the repository root:

```sh
pnpm spike:cart tasks/nonplus-cart-fixture.json
```

The runner explicitly requests Storefront API `2026-10` and requires the response version header to match. This is a spike baseline; final project API selection remains gated by successful handoff. Each request has a 15-second timeout; redirects are rejected and mutations are not automatically retried.

On success, `.env.cart-spike-result.json` is created with mode `0600`, using exclusive creation. It contains the private cart reference, checkout URL, normalized line/price evidence, and `browserCheckout: "not_verified"`. The root `.gitignore` excludes it. Do not share the file or copy its URLs/cart secret into logs. Before another run, move the artifact to a private ignored location; an existing output file is never overwritten. A failed call or artifact write may still have created a test cart; do not interpret retry as idempotent.

Open the recorded checkout URL privately in the test browser and compare variant options, all quantities, prices/currency, and any selling plan against the fixture and API evidence. Check supported attributes and buyer context where visible. Do not submit payment. Record each observation separately in the local tracker. Reading a URL from the API is not evidence that Shopify checkout renders or preserves all context.

Expired/missing carts must produce a recoverable return to the original storefront journey. This runner fails on an unavailable cart; the actual shopper recovery UI remains to be implemented and verified. Authenticated/anonymous comparisons, expired-cart browser behavior, discounts, address propagation, and provider-specific flows remain separate checklist steps.

## Verification

```sh
pnpm test:cart-spike
pnpm check
```

The automated suite uses controlled Storefront responses to verify preservation and failure behavior. It runs in the normal quality command without store credentials. It does not certify Shopify GraphQL compatibility or live checkout behavior; those require the deferred test-store run. Prices are compared exactly as supplied by Shopify, without floating-point conversion. Any changed total stops the probe for investigation.

Official references reviewed on 16 October 2026: [cartCreate](https://shopify.dev/docs/api/storefront/2026-10/mutations/cartCreate), [cart retrieval](https://shopify.dev/docs/api/storefront/2026-10/queries/cart), and [cart creation and checkout URL guide](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage). Shopify's cart guide explains that cart IDs contain a secret component; preserve the complete ID privately.
