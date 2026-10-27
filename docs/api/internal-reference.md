# Internal API reference

Date: 17 October 2026. Audience: engineers and agents working in this repo.  
Companion index: [README.md](README.md). Architecture context: [system-overview.md](../architecture/system-overview.md).

---

## 1. Stack cheat sheet

| Layer                                    | Technology                                      | Where                                                                                  |
| ---------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Live HTTP (Shopify)                      | React Router 7 loaders/actions, Express adapter | `apps/shopify-admin`                                                                   |
| Shopify auth                             | `@shopify/shopify-app-react-router`             | `app/shopify.server.ts`                                                                |
| Persistence                              | MongoDB (`mongodb` driver)                      | settings, encrypted Shopify sessions                                                   |
| Live checkout sessions + rate limits     | Redis (`ioredis`, `REDIS_URL`)                  | `redis.server.ts`, `checkout-session.server.ts`, `rate-limit.server.ts`                |
| Live Shopify Admin GraphQL               | `fetch` + offline session token                 | `shopify-cod-order.server.ts`, `shopify-discount.server.ts`, `checkout-auth.server.ts` |
| Foundation HTTP                          | Fastify 5 + Helmet + rate-limit                 | `apps/api`                                                                             |
| Shared schemas (foundation)              | Zod → JSON Schema / OpenAPI                     | `packages/contracts`                                                                   |
| Domain policy (unused on hot path today) | pure functions                                  | `packages/domain`                                                                      |
| Storefront UI                            | Vanilla JS + HTML/CSS                           | `apps/shopify-admin/public/checkout/`                                                  |
| Theme inject                             | Theme app extension                             | `extensions/cod-checkout-embed/`                                                       |

**Route registry (source of truth for admin app paths):**  
`apps/shopify-admin/app/routes.ts`

**Env / config:**  
`apps/shopify-admin/.env`, `apps/shopify-admin/app/config.server.ts`  
`apps/api` → `apps/api/src/config.ts`

---

## 2. How URL → file works (Shopify admin app)

React Router config maps URL segments to files under `app/routes/`:

| Pattern in `routes.ts`                                      | App URL                         | File                              |
| ----------------------------------------------------------- | ------------------------------- | --------------------------------- |
| `route('proxy/v1/sessions', 'routes/proxy.v1.sessions.ts')` | `/proxy/v1/sessions`            | `app/routes/proxy.v1.sessions.ts` |
| `route('proxy/v1/sessions/:sessionId', …)`                  | `/proxy/v1/sessions/:sessionId` | `proxy.v1.sessions.$sessionId.ts` |
| `route('proxy/panel.html', 'routes/proxy.panel[.]html.ts')` | `/proxy/panel.html`             | brackets escape the `.`           |
| `route('api/settings', …)`                                  | `/api/settings`                 | `api.settings.ts`                 |
| `route('app', …, [index, route('dashboard')])`              | `/app`, `/app/dashboard`        | `app.tsx` + children              |

**Convention:**

- `loader` → `GET` (and document requests)
- `action` → non-GET (`POST`, `PATCH`, `PUT`, `DELETE`)
- App proxy handlers always start with `await authenticate.public.appProxy(request)`
- Admin JSON/UI handlers use `await authenticate.admin(request)`
- Webhooks use `await authenticate.webhook(request)`

**Shopper `apiBase`:** theme embed sets `window.EasyCheckoutConfig.apiBase = '/apps/easy-checkout'`  
→ browser calls `/apps/easy-checkout/v1/...` on the **shop domain**  
→ Shopify proxies to `{application_url}/proxy/v1/...`.

Liquid config: `extensions/cod-checkout-embed/blocks/cod-checkout.liquid`  
Boot JS: `extensions/cod-checkout-embed/assets/embed.js`  
Overlay source of truth: `public/checkout/{panel.html,checkout.js,checkout.css}` (proxy serves these live; CDN assets in the extension can lag).

---

## 3. Supporting modules (logic behind handlers)

All under `apps/shopify-admin/app/` unless noted.

| Module                        | Role                                                               | Used by                             |
| ----------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| `shopify.server.ts`           | Shopify app factory, Mongo client, `authenticate`                  | every authenticated route           |
| `checkout-session.server.ts`  | Session CRUD, quote, place-COD orchestration, `publicSessionView`  | session proxy routes                |
| `checkout-auth.server.ts`     | OTP, shopper token, customer create, `x-ec-shopper`                | auth proxy routes, place-cod        |
| `checkout-settings.server.ts` | Mongo `checkoutSettings`, `publicCheckoutSettings`, payments flags | settings proxy + admin API + offers |
| `shopify-cod-order.server.ts` | Admin API `orderCreate` COD                                        | place-cod                           |
| `redis.server.ts`             | Shared Redis client (`REDIS_URL`)                                  | session store, rate limiter         |
| `rate-limit.server.ts`        | Per-IP limits, per-brand policy resolver                           | `proxy-guard.server.ts`             |
| `proxy-guard.server.ts`       | Rate limit + live-session/shop check for proxy routes              | every `/proxy/v1/sessions/*`, auth  |
| `shopify-discount.server.ts`  | Coupon resolve/list via Admin API                                  | session patch, offers               |
| `demo-checkout.server.ts`     | In-memory fixture sessions                                         | demo proxy routes                   |
| `session-storage.server.ts`   | Encrypted Shopify OAuth sessions in Mongo                          | install / Admin API token           |
| `session-crypto.server.ts`    | Encryption helpers for session storage                             | session-storage                     |
| `config.server.ts`            | Zod-validated env                                                  | shopify.server                      |

**Mongo collections (typical):**

| Collection                           | Contents                                                             |
| ------------------------------------ | -------------------------------------------------------------------- |
| Shopify sessions (encrypted storage) | Offline/online tokens for Admin API                                  |
| `checkoutSettings`                   | Per-shop branding, payments, loyalty, GV flags (`_id` = shop domain) |

**Redis keys (checkout runtime state, not Mongo):**

| Key                          | Contents                                                  | TTL                                                                  |
| ---------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `ec:sess:<sessionId>`        | Checkout session JSON, written when checkout opens        | `CHECKOUT_SESSION_TTL_SECONDS` (default 1800), slides on every write |
| `ec:sess-lock:<sessionId>`   | One-order-per-session lock held while `orderCreate` runs  | 60 s                                                                 |
| `ec:sess-placed:<sessionId>` | Placed-order result, replayed if the same session retries | 900 s                                                                |
| `ec:rl:<shop>:<group>:<ip>`  | Rate-limit counter                                        | the policy window                                                    |

Production requires `REDIS_URL`; without it checkout routes answer `503 SERVICE_UNAVAILABLE`. Outside production, an unset `REDIS_URL` falls back to in-process memory.

### 3.1 Session gate (all `/v1/sessions/:sessionId/*` routes)

Checkout starts when the shopper opens the block: the overlay calls `POST /v1/sessions` once and the session lives in Redis. Every later call (`GET`/`PATCH`, `quote`, `offers`, `place-cod`) needs that session. If it is missing, expired, or belongs to another shop, the request fails with `404 NOT_FOUND` and nothing else runs; there is no silent re-creation. Two concurrent `place-cod` calls cannot both create an order: the second gets `409 ORDER_IN_PROGRESS`, and a retry after success returns the original order instead of creating another.

### 3.2 IP rate limits

Applied after app-proxy signature verification, on `sessions` (create/read/write), `place-cod`, `auth/otp/*` and `auth/customer`. Counters are keyed by shop + route group + client IP, so one brand's traffic never uses another's budget. Over the limit: `429 { error: { code: "RATE_LIMITED" } }` with `Retry-After`. If Redis is unreachable the limiter fails open and logs (the session store still fails closed).

| Group           | Routes                              | Default (per IP) | Env override                |
| --------------- | ----------------------------------- | ---------------- | --------------------------- |
| `sessionCreate` | `POST /v1/sessions`                 | 10 / 60 s        | `RATE_LIMIT_SESSION_CREATE` |
| `sessionRead`   | `GET /v1/sessions/:id`, `…/offers`  | 60 / 60 s        | `RATE_LIMIT_SESSION_READ`   |
| `sessionWrite`  | `PATCH /v1/sessions/:id`, `…/quote` | 30 / 60 s        | `RATE_LIMIT_SESSION_WRITE`  |
| `placeOrder`    | `POST …/place-cod`                  | 5 / 60 s         | `RATE_LIMIT_PLACE_ORDER`    |
| `otpRequest`    | `POST /v1/auth/otp/request`         | 5 / 600 s        | `RATE_LIMIT_OTP_REQUEST`    |
| `otpVerify`     | `POST /v1/auth/otp/verify`          | 10 / 600 s       | `RATE_LIMIT_OTP_VERIFY`     |
| `customer`      | `GET/POST/DELETE /v1/auth/customer` | 30 / 60 s        | `RATE_LIMIT_CUSTOMER`       |

Override format: `RATE_LIMIT_PLACE_ORDER=5/60` (requests/windowSeconds).

**Client IP:** read from `X-Forwarded-For`, counted from the right (left entries are client-controlled). `TRUSTED_PROXY_HOPS` (default `0`) is the number of your own proxies (load balancer, tunnel) between Shopify and the app; `0` uses the last entry. If every shopper ends up sharing one bucket, raise it.

**Per-brand limits later:** `rate-limit.server.ts` exposes `setRateLimitPolicyResolver(({ shop, name }) => policy)`. Today it resolves env override then the defaults above. To make limits per brand, install a resolver that reads them from `checkoutSettings` for `shop`; no route needs to change.

Not rate limited: `GET /v1/settings` and the static `panel.html` / `checkout.js` / `checkout.css` (fetched on every page view).

---

## 4. Storefront APIs (app proxy) — detail

Base (shopper): `/apps/easy-checkout`  
Base (app): `/proxy`  
Auth: Shopify app proxy signature via `authenticate.public.appProxy`  
Common query: Shopify injects `shop` (and signature fields). Handlers that need the shop read `shop` from the query string.

Error shape (most proxy JSON routes):

```json
{ "error": { "code": "STRING_CODE", "message": "Human-safe message" } }
```

Header used after OTP login: `x-ec-shopper: <token>`

---

### 4.1 Create checkout session

|                   |                                                                              |
| ----------------- | ---------------------------------------------------------------------------- |
| **Method / path** | `POST /v1/sessions`                                                          |
| **App URL**       | `POST /proxy/v1/sessions`                                                    |
| **File**          | `apps/shopify-admin/app/routes/proxy.v1.sessions.ts`                         |
| **Logic**         | `createCheckoutSession`, `publicSessionView` in `checkout-session.server.ts` |
| **Auth**          | App proxy                                                                    |
| **Does not**      | Create a Shopify order                                                       |

**Request JSON:**

```json
{
  "source": "cart" | "buy_now",
  "discountMinor": 0,
  "lines": [
    {
      "variantId": "gid://… or numeric",
      "productId": "…",
      "lineKey": "cart line key",
      "sku": "…",
      "title": "…",
      "variantTitle": "…",
      "quantity": 1,
      "price": 999.0,
      "amountMinor": 99900,
      "imageUrl": "https://…",
      "compareAtPrice": 1299.0,
      "lineDiscountMinor": 0
    }
  ]
}
```

**Response:** `publicSessionView` — `sessionId`, `source`, `currency`, `paymentMethod`, `lines`, `totals`, `address`, `shipping`, `couponCode`, `coupon`.

**Errors:** `400 EMPTY_CART`, `400 INVALID_REQUEST`, `405` if not POST.

---

### 4.2 Get session

|                   |                                                     |
| ----------------- | --------------------------------------------------- |
| **Method / path** | `GET /v1/sessions/:sessionId`                       |
| **File**          | `routes/proxy.v1.sessions.$sessionId.ts` → `loader` |
| **Logic**         | `getCheckoutSession`                                |

**Response:** same `publicSessionView`. **404** `NOT_FOUND`.

---

### 4.3 Patch session (address / coupon / GV / loyalty)

|                   |                                                                  |
| ----------------- | ---------------------------------------------------------------- |
| **Method / path** | `PATCH` or `POST /v1/sessions/:sessionId`                        |
| **File**          | `routes/proxy.v1.sessions.$sessionId.ts` → `action`              |
| **Logic**         | `patchCheckoutSession` (+ `shopify-discount.server` for coupons) |

**Request JSON (all fields optional):**

```json
{
  "address": {
    "phone": "9876543210",
    "fullName": "…",
    "addressLine1": "…",
    "locality": "…",
    "region": "…",
    "postalCode": "560001",
    "email": "optional@example.com"
  },
  "couponCode": "SAVE10",
  "giftVoucher": { "code": "…", "pin": "…" },
  "loyaltyRedeemPoints": 100
}
```

**Errors (selected):** `INVALID_COUPON`, `COUPON_INACTIVE`, `COUPON_UNSUPPORTED`, `INVALID_GIFT_*`, `INVALID_LOYALTY_POINTS`, `DISCOUNT_UNAVAILABLE` (503), `DISCOUNT_LOOKUP_FAILED` (502).

---

### 4.4 Quote shipping by PIN

|                   |                                                |
| ----------------- | ---------------------------------------------- |
| **Method / path** | `POST /v1/sessions/:sessionId/quote`           |
| **File**          | `routes/proxy.v1.sessions.$sessionId.quote.ts` |
| **Logic**         | `quoteCheckoutSession`                         |

**Request:** `{ "postalCode": "560001" }`  
**Response:** updated `publicSessionView` (includes `shipping` handle / EDD text when set).

---

### 4.5 Offers (coupons + loyalty + GV flags)

|                   |                                                 |
| ----------------- | ----------------------------------------------- |
| **Method / path** | `GET /v1/sessions/:sessionId/offers`            |
| **File**          | `routes/proxy.v1.sessions.$sessionId.offers.ts` |
| **Logic**         | `listShopifyCoupons`, `getCheckoutSettings`     |

**Response:**

```json
{
  "coupons": [],
  "topCoupons": [],
  "recommendedCode": "",
  "loyalty": { "partnerName": "EasyRewardz", "points": 1250, "redeemableMinor": 12500 },
  "giftVouchersEnabled": true,
  "giftVoucherVerifyMode": "pin"
}
```

`loyalty` is `null` when loyalty is disabled in settings.

---

### 4.6 Place COD order

|                   |                                                                       |
| ----------------- | --------------------------------------------------------------------- |
| **Method / path** | `POST /v1/sessions/:sessionId/place-cod`                              |
| **File**          | `routes/proxy.v1.sessions.$sessionId.place-cod.ts`                    |
| **Logic**         | `placeCodFromSession` → `shopify-cod-order.server.ts` (`orderCreate`) |
| **Header**        | `x-ec-shopper` (optional; attaches Shopify `customerId` when present) |

**Request:** address fields at top level (`phone`, `fullName`, `addressLine1`, `locality`, `region`, `postalCode`, optional `email`).

**Success response (shape):**

```json
{
  "orderId": "…",
  "orderName": "#1001",
  "orderGid": "gid://shopify/Order/…",
  "status": "placed",
  "paymentMethod": "cod",
  "sessionId": "…",
  "source": "cart",
  "totals": {},
  "lines": [],
  "message": "Order #1001 placed. Pay cash on delivery."
}
```

Session is deleted after success; a retry with the same `sessionId` returns the same order for 15 minutes (idempotent).  
**Errors:** `NOT_FOUND` (no live session, or session belongs to another shop), `ORDER_IN_PROGRESS` (409), `RATE_LIMITED` (429), `SERVICE_UNAVAILABLE` (503, session store down), `NOT_SERVICEABLE`, `ADMIN_TOKEN_MISSING` (503), `ORDER_CREATE_FAILED` (502), `INVALID_ADDRESS`.

**Scopes required:** `write_orders` (and install offline session). See `shopify.app.toml` / [shopify-operation-scopes.md](../architecture/shopify-operation-scopes.md).

---

### 4.7 OTP request

|                   |                                           |
| ----------------- | ----------------------------------------- |
| **Method / path** | `POST /v1/auth/otp/request`               |
| **File**          | `routes/proxy.v1.auth.otp.request.ts`     |
| **Logic**         | `requestOtp` in `checkout-auth.server.ts` |

**Request:** `{ "phone": "9876543210" }`  
**Response:** `{ "phone", "expiresInSec", "otpLength", "devCode"? }` — `devCode` only when not production.

---

### 4.8 OTP verify

|                   |                                      |
| ----------------- | ------------------------------------ |
| **Method / path** | `POST /v1/auth/otp/verify`           |
| **File**          | `routes/proxy.v1.auth.otp.verify.ts` |
| **Logic**         | `verifyOtp`                          |

**Request:** `{ "phone", "code" }`  
**Response:** shopper object (`token`, `phone`, `isNew`, `customerId`, `fullName`, `address`, `needsAddress` via public view after verify — check handler return; verify returns shopper then client stores `token`).

**Errors:** `OTP_EXPIRED`, `OTP_INVALID`, `OTP_LOCKED` (429), `INVALID_PHONE`.

---

### 4.9 Customer (load / save address / logout)

|                    |                                                            |
| ------------------ | ---------------------------------------------------------- |
| **Methods / path** | `GET` / `POST` / `DELETE /v1/auth/customer`                |
| **File**           | `routes/proxy.v1.auth.customer.ts`                         |
| **Logic**          | `getShopper`, `createCustomerWithAddress`, `logoutShopper` |
| **Auth token**     | Header `x-ec-shopper` or body `token`                      |

| Method   | Behavior                                                             |
| -------- | -------------------------------------------------------------------- |
| `GET`    | Current shopper public view; 401 if missing/invalid token            |
| `POST`   | Save address (+ Shopify customer create/update when Admin available) |
| `DELETE` | Logout / invalidate shopper token                                    |

---

### 4.10 Public checkout settings (storefront)

|                   |                                                  |
| ----------------- | ------------------------------------------------ |
| **Method / path** | `GET /v1/settings`                               |
| **File**          | `routes/proxy.v1.settings.ts`                    |
| **Logic**         | `getCheckoutSettings` → `publicCheckoutSettings` |
| **Cache**         | `Cache-Control: private, max-age=30`             |

**Response fields:**

```json
{
  "brandMode": "name" | "logo",
  "brandName": "RARE",
  "logoUrl": "",
  "requireCodConfirmation": true,
  "showUpsell": true,
  "giftVouchersEnabled": true,
  "giftVoucherVerifyMode": "pin" | "otp",
  "loyaltyPartnerEnabled": true,
  "loyaltyPartnerName": "EasyRewardz",
  "loyaltyPointsBalance": 1250,
  "payments": {
    "cod": true,
    "upi": false,
    "card": false,
    "netbanking": false
  },
  "upiConfig": {
    "vpa": "",
    "merchantName": "RARE",
    "discountBadge": "₹50 Off",
    "cashbackBadge": "Win Cashback",
    "apps": ["paytm", "phonepe", "gpay", "amazonpay", "bhim", "cred"]
  }
}
```

**Performance note:** Checkout applies branding + payment visibility from this **single** fetch (`checkout.js` `loadCheckoutSettings` / `applyBrand`). Do not add a second storefront settings round-trip.

**Written by:** admin form (`app-home.tsx`), `PUT /api/settings`, Checkout OS dashboard.

---

### 4.11 Proxy static assets

| Shopper path    | App path              | File                                                                |
| --------------- | --------------------- | ------------------------------------------------------------------- |
| `/panel.html`   | `/proxy/panel.html`   | `routes/proxy.panel[.]html.ts` → reads `public/checkout/panel.html` |
| `/checkout.js`  | `/proxy/checkout.js`  | `routes/proxy.checkout[.]js.ts` → `public/checkout/checkout.js`     |
| `/checkout.css` | `/proxy/checkout.css` | `routes/proxy.checkout[.]css.ts` → `public/checkout/checkout.css`   |

Auth: app proxy. `cache-control: no-store` so theme always gets latest `public/checkout` during dev.

---

### 4.12 Demo proxy (not live cart path)

| Method | Path                  | File                          | Notes                                         |
| ------ | --------------------- | ----------------------------- | --------------------------------------------- |
| `GET`  | `/v1/demo/checkout`   | `proxy.v1.demo.checkout.ts`   | Fixture session via `demo-checkout.server.ts` |
| `POST` | `/v1/demo/cod-orders` | `proxy.v1.demo.cod-orders.ts` | Local accept; **no** Shopify order            |

Mirror of foundation demo contracts; still behind app proxy auth when called through the shop.

---

## 5. Merchant admin APIs & pages

### 5.1 Onboarding + customize (HTML form)

|          |                                                                     |
| -------- | ------------------------------------------------------------------- |
| **Path** | `/app` (embedded)                                                   |
| **File** | `routes/app-home.tsx` (+ layout `routes/app.tsx`)                   |
| **Auth** | `authenticate.admin`                                                |
| **Save** | `POST` form → `saveCheckoutSettings` (same Mongo as `/v1/settings`) |

UI steps: enable theme embed → customize checkout → optional Checkout OS.

Theme deep link built with `publicApiKey` + block handle `cod-checkout` (see loader in `app-home.tsx`).

---

### 5.2 Admin settings JSON API (dashboard)

|            |                                                                   |
| ---------- | ----------------------------------------------------------------- |
| **Path**   | `GET` / `PUT`                                                     | `POST` | `PATCH` `/api/settings` |
| **File**   | `routes/api.settings.ts`                                          |
| **Auth**   | `authenticate.admin` (merchant session cookie / embedded session) |
| **Not on** | storefront hot path                                               |

**GET response:** `{ shop, ...publicCheckoutSettings }`  
**PUT body:** partial patch — branding, flags, `payments: { cod, upi, card, netbanking }`. Unspecified fields keep current values (`saveCheckoutSettings` merges).

Consumed by: `public/dashboard/index.html` (Checkout OS Settings / Payments pages).

---

### 5.3 Dashboard entry

| Path                    | File                          | Behavior                                             |
| ----------------------- | ----------------------------- | ---------------------------------------------------- |
| `/app/dashboard`        | `routes/app.dashboard.tsx`    | Admin auth, then `redirect('/dashboard/index.html')` |
| `/dashboard/index.html` | `public/dashboard/index.html` | Static Checkout OS UI; calls `/api/settings`         |

---

### 5.4 Misc admin routes

| Path                     | File                     | Notes                               |
| ------------------------ | ------------------------ | ----------------------------------- |
| `/`                      | `routes/home.tsx`        | Non-embedded landing                |
| `/json/version`          | `routes/json.version.ts` | `{ status: "ok" }` health-ish probe |
| `/auth/login`, `/auth/*` | `login.tsx`, `auth.tsx`  | Shopify OAuth                       |

---

## 6. Webhooks

Configured in `shopify.app.toml` → `[webhooks.subscriptions]`.

| Topic               | URI                           | File                       | Action                               |
| ------------------- | ----------------------------- | -------------------------- | ------------------------------------ |
| `app/uninstalled`   | `/webhooks/app/uninstalled`   | `routes/uninstalled.tsx`   | Delete shop sessions                 |
| `app/scopes_update` | `/webhooks/app/scopes_update` | `routes/scopes-update.tsx` | Delete shop sessions (force re-auth) |

Auth: `authenticate.webhook`. API version: `2026-10` (toml).

---

## 7. Foundation API (`apps/api`) — detail

|               |                                                                   |
| ------------- | ----------------------------------------------------------------- |
| **Entry**     | `apps/api/src/server.ts` → `buildApp()` in `apps/api/src/app.ts`  |
| **Tech**      | Fastify, `@fastify/helmet`, `@fastify/rate-limit`                 |
| **Contracts** | `@checkout/contracts` Zod schemas                                 |
| **OpenAPI**   | `apps/api/src/openapi.ts` + `pnpm api:spec` → repo `openapi.json` |
| **Static**    | `apps/api/src/static-assets.ts` → `apps/api/public/…`             |

| Method | Path                  | Purpose                                                       |
| ------ | --------------------- | ------------------------------------------------------------- |
| `GET`  | `/health/live`        | Liveness (`status: alive`, `scope: foundation`)               |
| `GET`  | `/health/ready`       | Readiness (`status: ready`) — process only, not Mongo/Shopify |
| `GET`  | `/openapi.json`       | OpenAPI document                                              |
| `GET`  | `/v1/demo/checkout`   | Fixture COD session                                           |
| `POST` | `/v1/demo/cod-orders` | Demo place; body validated by `PlaceCodOrderRequestSchema`    |
| `GET`  | `/`                   | Demo storefront HTML                                          |
| `GET`  | `/checkout`           | Redirect `/?checkout=open`                                    |
| `GET`  | `/checkout/*`         | Overlay assets from `public/checkout`                         |
| `GET`  | `/storefront/*`       | Storefront static assets                                      |

**Cross-cutting (Fastify):**

- `x-correlation-id` on responses
- `Cache-Control: no-store`
- Rate limit 100/min (health exempt)
- Public errors via `apps/api/src/errors.ts` — no stack/credentials in body

**Not used by** live theme embed. Live path = Shopify admin app proxy only.

---

## 8. Shared contracts package

|             |                                                                                    |
| ----------- | ---------------------------------------------------------------------------------- |
| **Path**    | `packages/contracts/src/index.ts`                                                  |
| **Package** | `@checkout/contracts`                                                              |
| **Used by** | `apps/api`, `packages/domain`, tests                                               |
| **Not yet** | fully wired into every shopify-admin proxy handler (those use local types + Mongo) |

Exports: `MoneySchema`, `ErrorResponseSchema`, `CapabilitiesSchema`, `HealthResponseSchema`, demo session + place-COD schemas, `contractSchemas` for OpenAPI.

Domain decisions: `packages/domain` → `resolveCapabilities()` (foundation / entitlement; not the storefront hot path today).

---

## 9. Client call sites (where APIs are invoked)

| Client           | Path                          | Calls                                         |
| ---------------- | ----------------------------- | --------------------------------------------- |
| Overlay runtime  | `public/checkout/checkout.js` | `/v1/sessions*`, `/v1/auth/*`, `/v1/settings` |
| Theme boot       | `extensions/.../embed.js`     | Loads panel/js/css via `apiBase`              |
| Checkout OS      | `public/dashboard/index.html` | `/api/settings`                               |
| Admin onboarding | `routes/app-home.tsx`         | Form POST to same route (settings save)       |

Grep tip for a route from the storefront:

```bash
rg "v1/sessions|v1/settings|v1/auth" apps/shopify-admin/public/checkout/checkout.js
```

---

## 10. Auth matrix

| Surface                             | Mechanism                          | Module                                                           |
| ----------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| App proxy JSON/assets               | Shopify proxy signature            | `authenticate.public.appProxy`                                   |
| Embedded admin UI / `/api/settings` | Shopify admin session              | `authenticate.admin`                                             |
| Webhooks                            | HMAC topic verify                  | `authenticate.webhook`                                           |
| Shopper after OTP                   | Opaque token header `x-ec-shopper` | `checkout-auth.server.ts` (in-memory map; not a Shopify session) |
| Shopify Admin GraphQL               | Offline session from Mongo         | `session-storage.server.ts`                                      |

---

## 11. Access scopes (Shopify)

From `shopify.app.toml`:

`read_customers,write_customers,write_orders,read_orders,read_discounts`

| Scope         | Why                                    |
| ------------- | -------------------------------------- |
| customers R/W | OTP customer lookup + address create   |
| orders R/W    | COD `orderCreate` + reads              |
| discounts R   | Coupon validate/list on session/offers |

Changing scopes requires re-auth; `app/scopes_update` clears stored sessions.

---

## 12. Intentionally missing / future

- Prepaid capture (UPI/card/netbanking) — UI + settings flags only; place path is COD-only
- Bro Pay — removed
- RabbitMQ / Redis readiness — not in foundation probes yet
- Unifying shopify-admin handlers onto `@checkout/contracts` OpenAPI — future hardening
- Separate `apps/dashboard` Node service — currently static HTML + `/api/settings` on admin app

---

## 13. Maintenance checklist

When adding an API:

1. Register in `apps/shopify-admin/app/routes.ts` (or Fastify `app.ts`).
2. Implement thin route file; put logic in `*-server.ts`.
3. Document the row in this file + the quick table in [README.md](README.md).
4. If foundation: update Zod in `packages/contracts` and run `pnpm api:spec`.
5. Prefer extending existing `/v1/settings` for shopper-visible flags (no new hot-path GETs).
