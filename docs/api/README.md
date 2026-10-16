# API contracts

`openapi.json` is generated with `pnpm api:spec` from the implemented routes and shared Zod schemas. It is also served at `/openapi.json`. CI rejects generated-file drift. Live Shopify session/order routes from the master plan are not present yet.

| Route                      | Meaning                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `GET /health/live`         | Process can serve a request; `status: alive`, `scope: foundation` |
| `GET /health/ready`        | Foundation is initialized; `status: ready`, `scope: foundation`   |
| `GET /v1/demo/checkout`    | Creates a fixture COD checkout session (demo line items, INR)     |
| `POST /v1/demo/cod-orders` | Accepts a demo COD order locally; does **not** write to Shopify   |
| `GET /`                    | Demo storefront; Buy now opens the in-page COD checkout overlay   |
| `GET /checkout`            | Redirects to `/?checkout=open` (same-origin overlay)              |
| `GET /checkout/*`          | Overlay assets (`embed.js`, `panel.html`, CSS/JS)                 |

### Planned storefront session APIs (ADR 0004 — not implemented yet)

App-proxy paths under `/apps/easy-checkout` (mirror on Fastify when the API owns traffic):

| Route | Meaning |
| ----- | ------- |
| `POST /v1/sessions` | Create session from `buy_now` (variant+qty) or `cart`; returns lines/totals. **No Shopify order.** |
| `GET /v1/sessions/:id` | Load session for overlay |
| `PATCH /v1/sessions/:id` | Phone, address, pincode, optional coupon |
| `POST /v1/sessions/:id/quote` | Shipping/EDD/totals after pincode or discount (async-friendly) |
| `POST /v1/sessions/:id/place-cod` | Revalidate → Shopify COD `orderCreate` → `{ orderId, orderName }` |

Readiness does not certify MongoDB, RabbitMQ, Redis, Shopify, or checkout availability. Register dependency-aware readiness when those integrations are introduced. These probes are exempt from the process-local rate limit.

All application responses carry a server-generated `x-correlation-id` and `Cache-Control: no-store`. Handled errors contain `{ error: { code, message }, correlationId }`. Messages are deliberately generic; internal exception messages, request contents, credentials, and stack traces are not exposed. Transport failures before Fastify creates a request can use Node's native HTTP errors.

`Money` uses an explicit three-letter uppercase currency and a signed safe integer `amountMinor`. The provider adapter must validate supported currency codes, determine currency exponents, and enforce operation-specific sign/range rules. Do not calculate money using floating-point major units or sum values beyond JavaScript's safe integer range.

Capabilities use a discriminated decision: enabled requires `ELIGIBLE`; disabled requires a denial reason. This schema is an internal contract only until authenticated merchant routes are implemented. See the architecture decision for evidence requirements and versioning.
