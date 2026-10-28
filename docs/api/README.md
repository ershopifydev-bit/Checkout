# API documentation (internal)

Internal catalog of every HTTP surface in this monorepo: where it lives, how to find the file, stack, auth, and request/response notes.

| Doc                                                | Purpose                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| **[internal-reference.md](internal-reference.md)** | **Start here** — full route catalog, file map, tech, auth, bodies         |
| `openapi.json` (generated)                         | Machine contract for **foundation** Fastify routes only (`pnpm api:spec`) |
| Live OpenAPI                                       | Served by foundation API at `GET /openapi.json`                           |

## Two HTTP apps (do not confuse them)

| App                                  | Path                 | Tech                                   | Role                                                                   |
| ------------------------------------ | -------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| **Live storefront + merchant admin** | `apps/shopify-admin` | React Router 7 + Express + Shopify App | App proxy COD APIs, OAuth, webhooks, admin settings, dashboard HTML    |
| **Foundation / local demo**          | `apps/api`           | Fastify 5                              | Health, OpenAPI, fixture demo COD — **not** the live theme integration |

Shoppers on a Shopify store hit **app proxy** → `apps/shopify-admin` (`/apps/easy-checkout/*`).  
`apps/api` on port 3000 is a separate playground; see [runbooks/shopify-development.md](../runbooks/shopify-development.md).

## How to find a route in 30 seconds

1. **Shopify admin / proxy / webhooks** → open [`apps/shopify-admin/app/routes.ts`](../../apps/shopify-admin/app/routes.ts). Every path is registered there with the exact handler file.
2. **Handler file** → `apps/shopify-admin/app/routes/<name>.ts(x)` (React Router file-based naming: `proxy.v1.sessions.ts` = `/proxy/v1/sessions`).
3. **Business logic** → `apps/shopify-admin/app/*-server.ts` (e.g. `checkout-session.server.ts`).
4. **Foundation Fastify** → all routes are inline in [`apps/api/src/app.ts`](../../apps/api/src/app.ts).
5. **Shared Zod / OpenAPI fragments** → [`packages/contracts/src/index.ts`](../../packages/contracts/src/index.ts).

## App proxy URL rewrite

Configured in [`apps/shopify-admin/shopify.app.toml`](../../apps/shopify-admin/shopify.app.toml):

```toml
[app_proxy]
url = "…/proxy"          # app origin + /proxy
subpath = "easy-checkout"
prefix = "apps"
```

| Shopper sees (on storefront origin)             | Hits admin app                    |
| ----------------------------------------------- | --------------------------------- |
| `https://{shop}/apps/easy-checkout/v1/sessions` | `https://{app}/proxy/v1/sessions` |
| `https://{shop}/apps/easy-checkout/panel.html`  | `https://{app}/proxy/panel.html`  |

Shopify appends signed query params (`shop`, `timestamp`, `signature`, …). Handlers call `authenticate.public.appProxy(request)`.

## Quick route index

### Storefront (app proxy) — hot path

| Method                | Shopper path (`/apps/easy-checkout…`)          | Handler file                                       |
| --------------------- | ---------------------------------------------- | -------------------------------------------------- |
| `POST`                | `/v1/sessions`                                 | `routes/proxy.v1.sessions.ts`                      |
| `GET`                 | `/v1/sessions/:sessionId`                      | `routes/proxy.v1.sessions.$sessionId.ts`           |
| `PATCH`/`POST`        | `/v1/sessions/:sessionId`                      | same                                               |
| `POST`                | `/v1/sessions/:sessionId/quote`                | `routes/proxy.v1.sessions.$sessionId.quote.ts`     |
| `GET`                 | `/v1/sessions/:sessionId/offers`               | `routes/proxy.v1.sessions.$sessionId.offers.ts`    |
| `POST`                | `/v1/sessions/:sessionId/place-cod`            | `routes/proxy.v1.sessions.$sessionId.place-cod.ts` |
| `POST`                | `/v1/auth/otp/request`                         | `routes/proxy.v1.auth.otp.request.ts`              |
| `POST`                | `/v1/auth/otp/verify`                          | `routes/proxy.v1.auth.otp.verify.ts`               |
| `GET`/`POST`/`DELETE` | `/v1/auth/customer`                            | `routes/proxy.v1.auth.customer.ts`                 |
| `GET`                 | `/v1/settings`                                 | `routes/proxy.v1.settings.ts`                      |
| `GET`                 | `/panel.html`, `/checkout.js`, `/checkout.css` | `routes/proxy.panel[.]html.ts` etc.                |
| `GET`/`POST`          | `/v1/demo/*`                                   | demo proxy routes (playground)                     |

### Merchant admin (embedded app)

| Method                     | App path                | Handler file                                              |
| -------------------------- | ----------------------- | --------------------------------------------------------- |
| `GET`/`POST`               | `/app`                  | `routes/app-home.tsx` (onboarding UI + form save)         |
| `GET`                      | `/app/dashboard`        | `routes/app.dashboard.tsx` → redirect to static dashboard |
| `GET`/`PUT`/`POST`/`PATCH` | `/api/settings`         | `routes/api.settings.ts`                                  |
| Static                     | `/dashboard/index.html` | `public/dashboard/index.html`                             |

### Webhooks & auth

| Method | Path                          | Handler                    |
| ------ | ----------------------------- | -------------------------- |
| `POST` | `/webhooks/app/uninstalled`   | `routes/uninstalled.tsx`   |
| `POST` | `/webhooks/app/scopes_update` | `routes/scopes-update.tsx` |
| —      | `/auth/*`, `/auth/login`      | Shopify OAuth              |

### Foundation Fastify (`apps/api`)

| Method | Path                                             | Defined in            |
| ------ | ------------------------------------------------ | --------------------- |
| `GET`  | `/health/live`, `/health/ready`                  | `apps/api/src/app.ts` |
| `GET`  | `/openapi.json`                                  | same                  |
| `GET`  | `/v1/demo/checkout`                              | same                  |
| `POST` | `/v1/demo/cod-orders`                            | same                  |
| `GET`  | `/`, `/checkout`, `/checkout/*`, `/storefront/*` | same                  |

Full detail (bodies, modules, Mongo, errors): **[internal-reference.md](internal-reference.md)**.

## Related docs

- [Architecture system overview](../architecture/system-overview.md)
- [ADR 0004 — fast COD path](../architecture/0004-fast-cod-checkout-path.md)
- [Shopify scopes](../architecture/shopify-operation-scopes.md)
