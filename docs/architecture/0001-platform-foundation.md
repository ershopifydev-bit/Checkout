# ADR 0001: Establish a conservative, runnable foundation

Date: 14 October 2026. Status: implemented for local development; no production release approval.

## Context and decision

The supplied v1.0 architecture selects a modular TypeScript API, pnpm, Fastify, and separate workers. Merchant feasibility, OAuth access, provider choices, and live handoff evidence remain open. Implement the parts that can be validated locally without pretending those gates have passed.

- `packages/contracts` owns strict Zod runtime schemas and generated transport schemas.
- `packages/domain` owns pure capability decisions and depends only on the public contracts package.
- `apps/api` owns transport and process lifecycle. It currently has health/documentation endpoints only.
- TypeScript project references and package exports establish build boundaries. Imports use `workspace:*` dependencies rather than paths into another package's source. Tests resolve the public package entrypoints to source.

The remaining applications, adapters, database, queue, and extensions will be introduced with working slices. Empty implementations and simulated successful checkout/payment routes were rejected because they would obscure what actually works. Separate microservices were rejected for this increment because the supplied architecture already calls for a modular API.

## Capability trust boundary

The resolver accepts a context assembled from authenticated server state. There is no HTTP capability endpoint yet and no mechanism to accept a browser-supplied tenant or eligibility assertion. Future callers must authenticate, authorize, validate persisted/provider state, and construct this context themselves.

Capability allow decisions require an active installation, entitlement, enabled feature flag, and unexpired eligibility evidence for the same shop. Unknown, invalid, stale, or mismatched evidence denies access. The evidence issuer will set expiry according to its verified Shopify/provider source; this increment does not invent a validity period.

Checkout extensions return `NOT_IMPLEMENTED`. Prepaid/custom card capture returns `APPROVAL_REQUIRED` and cannot be enabled by a flag. The resolver field `shopifyCheckoutHandoff` is legacy naming from the foundation increment; product Standard for upcoming work is **standalone COD checkout** per [ADR 0002](0002-standalone-cod-checkout.md). The resolver is a policy foundation, not proof that a merchant can place live COD orders.

## Threats and controls in this increment

| Boundary/threat                           | Implemented control and evidence                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Forged request/correlation identity       | Server-generated UUID; forwarded IP headers are not trusted; no tenant APIs exposed                                     |
| Oversized or malformed requests           | 64 KiB body limit, bounded network timeouts, parser-failure tests                                                       |
| URL guessing/request floods               | 100 requests/minute/IP/process, including unknown routes; health probes exempt                                          |
| Secrets in logs or errors                 | Generic public errors; allowlisted request logs; serializer/redaction tests                                             |
| Stale or cross-tenant capability evidence | Explicit deny reasons; expiry and tenant-mismatch tests                                                                 |
| Supply-chain changes                      | Exact direct versions, lockfile, immutable CI action references, strict peer and release-age policies, dependency audit |

Rate limits are process-local until a shared store or edge policy is implemented. TLS, authentication, global throttling, telemetry export, and persistence remain deployment prerequisites. No production data is processed here. A reverse proxy must not be enabled by simply trusting all forwarded headers.

## Versioning and maintenance

The initial internal packages are `0.1.0`. Future checkout/merchant HTTP APIs use the specification's `/v1` namespace. Health paths are infrastructure endpoints. Breaking contract changes require an explicit version/migration decision and compatibility tests; new fields and enum values still require consumer review. Generate schemas from Zod rather than editing OpenAPI by hand.

Node 24.22.0, pnpm 12.11.2, and dependencies are pinned. TypeScript 6.0.3 is retained because TypeScript ESLint 8.71.2 declares support below 6.1. A supported major is not a reason to use an old patch indefinitely. Review advisories weekly and dependency updates monthly, with immediate review for security fixes; maintainers own those reviews until an individual owner is assigned.

Shopify/provider API versions remain unselected until the live spike. When adapters land, record the verified version, scopes, deprecation date, and named upgrade owner; review before each merchant rollout and quarterly thereafter.

## Verification, rollout, and rollback

`pnpm check` verifies source behavior and the compiled process. Unit/injection coverage is reported separately from compiled-process tests; no production performance or capacity claim follows from either. No browser checkout or live-store tests have run in this increment.

Integrate through a PR into development. No deployment or promotion is included. Revert the additive feature commits through another PR to roll back; there is no database migration or merchant enablement to compensate.

## Official implementation references

- [Node release support](https://nodejs.org/en/about/previous-releases)
- [pnpm workspaces](https://pnpm.io/workspaces)
- [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Zod JSON Schema conversion](https://zod.dev/json-schema)
- [Fastify testing](https://fastify.dev/docs/latest/Guides/Testing/), [server options](https://fastify.dev/docs/latest/Reference/Server/), and [logging](https://fastify.dev/docs/latest/Reference/Logging/)
- [Fastify rate limiting](https://github.com/fastify/fastify-rate-limit) and [security headers](https://github.com/fastify/fastify-helmet)
