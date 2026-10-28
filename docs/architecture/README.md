# Architecture docs

| Doc                                                                                        | Purpose                                                          |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [system-overview.md](system-overview.md)                                                   | **Start here** — monorepo parts, diagrams, how they interconnect |
| [../payments/00-payment-processing-design.md](../payments/00-payment-processing-design.md) | Proposed prepaid payments design (all gateways)                  |
| [../payments/razorpay.md](../payments/razorpay.md)                                         | Proposed Razorpay integration                                    |
| [../api/README.md](../api/README.md)                                                       | API index — proxy vs Fastify, how to find route files            |
| [../api/internal-reference.md](../api/internal-reference.md)                               | Full internal API catalog (auth, bodies, modules)                |
| [0001-platform-foundation.md](0001-platform-foundation.md)                                 | ADR: contracts, domain, Fastify foundation                       |
| [0002-standalone-cod-checkout.md](0002-standalone-cod-checkout.md)                         | ADR: standalone COD product path                                 |
| [0003-shopify-installation.md](0003-shopify-installation.md)                               | ADR: Shopify app install                                         |
| [0004-fast-cod-checkout-path.md](0004-fast-cod-checkout-path.md)                           | ADR: session-first overlay speed path                            |
| [merchant-feature-tiers.md](merchant-feature-tiers.md)                                     | Entitlement / tier notes                                         |
| [shopify-operation-scopes.md](shopify-operation-scopes.md)                                 | Least-privilege scope map                                        |
