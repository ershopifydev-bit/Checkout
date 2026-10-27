# Agent rules (all tools)

This file is the operating contract for **every** coding agent in this repo — Cursor, Claude, GPT, Gemini, Copilot, Codex, or anything else. Follow it in order. Do not invent a parallel process.

Cursor also loads `.cursor/rules/project-workflow.mdc`, which points here. Do not duplicate rules in tool-specific files; change **this** file.

Related: `docs/architecture/system-overview.md`, `docs/api/README.md`, `docs/api/internal-reference.md`.

---

## Branch and promotion (always)

- Start every new feature or maintenance task from the latest `origin/development` on a new branch named `feature/<short-kebab-case-description>`.
- Never implement directly on `development`, `qa`, `staging`, `prod`, or `main`.
- Before pushing a feature, review its diff and run checks appropriate to the change. Report actual results; do not claim unrun application tests passed.
- Push the feature branch, then use a pull request into `development`. Never directly push the feature commit to `development`.
- Promotion order is strictly `development` → `qa` → `staging` → `prod`, using pull requests. Do not skip environments or merge feature branches into later environments.
- After completing a change, do not automatically promote it beyond `development` unless the user requests that rollout.
- Keep `main` as the initial bootstrap branch; it is not an alternative integration path.
- Do not force-push or delete protected environment branches. Do not bypass branch protection or local hooks during normal work.
- Keep `Doc/`, `tasks/`, and `tools/` excluded from Git. Never force-add ignored documents, generated checklists, credentials, dependencies, or build output.
- Enable the local pre-push guard with `git config core.hooksPath .githooks`. Server-side GitHub rules remain the authoritative enforcement.
- The initial repository bootstrap is a one-time exception authorized by the user: initialize all five branches at the same reviewed commit before enabling protection. It does not permit future direct pushes.

---

## 0. Before any work

1. Confirm you are **not** on `development`, `qa`, `staging`, `prod`, or `main`. Those are protected.
2. If the user asked for a new feature or maintenance task and you are not already on a matching `feature/<short-kebab-case>` branch:
   - `git fetch origin`
   - `git checkout development && git pull origin development`
   - `git checkout -b feature/<short-kebab-case-description>`
3. Never implement on an environment branch. Never force-push or delete protected branches.
4. Enable hooks if missing: `git config core.hooksPath .githooks`.
5. Do not commit, push, or open a PR unless the user asked. Completing the work is not permission to ship.

---

## 1. Pick the task (understand before planning)

Do **not** start coding from a vague request.

1. Restate the user goal in one sentence (who, what, why now).
2. Identify which **part** of the monorepo owns it. Do not guess:

   | If the work is… | Own it in | Not here |
   |-----------------|-----------|----------|
   | Live storefront overlay, shopper APIs, merchant admin, settings, dashboard HTML | `apps/shopify-admin` | `apps/api` |
   | Theme hijack / Buy now / overlay boot | `apps/shopify-admin/extensions/cod-checkout-embed` | rewriting the overlay in the extension |
   | Overlay UI/JS/CSS | `apps/shopify-admin/public/checkout/*` (source of truth) | only the extension CDN copy |
   | Merchant settings / payment flags | `checkout-settings.server.ts` + `/v1/settings` + admin UI | a new storefront fetch |
   | Foundation health / OpenAPI / local demo COD | `apps/api` | live theme path |
   | Wire shapes for Fastify | `packages/contracts` | ad-hoc Fastify types |
   | Entitlement / capability decisions | `packages/domain` | HTTP or Mongo |

3. Trace the **real** flow end to end (caller → route → `*-server.ts` → store/Shopify). Find the route in `apps/shopify-admin/app/routes.ts` (live) or `apps/api/src/app.ts` (foundation). Logic lives in `apps/shopify-admin/app/*-server.ts`.
4. Surface assumptions explicitly if anything is ambiguous. Wait if a wrong choice would be expensive. Do not silently fill gaps.
5. If the same helper is already used, reuse it. Do not add a parallel settings payload, a second storefront GET, or a new payment row.

**Hard split:** shoppers hit Shopify **app proxy** `/apps/easy-checkout/*` → `apps/shopify-admin` `/proxy/*`. `apps/api` on port 3000 is a local playground only.

---

## 2. Plan (smallest slice that ships)

1. Write a short plan: files you will touch, what will change for the shopper/merchant, what you will **not** build.
2. Prefer one vertical slice (settings flag → same `/v1/settings` JSON → overlay applies it) over a rewrite.
3. YAGNI + reuse first. New dependency, new package, or new abstraction only if the user asked or the existing helper cannot do it.
4. Split only when a later piece is independent (e.g. payments config now; gateway capture later).
5. Prepaid UI may be shown/hidden by settings. **Only COD places a Shopify order.** Do not pretend UPI/card/netbanking collect money.

Record new public routes or settings fields in `docs/api/internal-reference.md` in the same change.

---

## 3. Implement (correct place, smallest diff)

### Live checkout (default for shopper-facing work)

1. Edit `apps/shopify-admin/public/checkout/{panel.html,checkout.js,checkout.css}` first.
2. Proxy already serves those files (`routes/proxy.panel[.]html.ts`, `proxy.checkout[.]js.ts`, `proxy.checkout[.]css.ts`) with `no-store`.
3. Copy to `extensions/cod-checkout-embed/assets/` only when that copy is still used as fallback.
4. Bump `assetVersion` in `extensions/cod-checkout-embed/blocks/cod-checkout.liquid` when embed-boot files change so the theme does not keep a stale CDN.

### Settings / visibility

- Shopper-visible flags go on the **existing** `GET /v1/settings` body (`publicCheckoutSettings`). Checkout applies them in the same `loadCheckoutSettings` / `applyBrand` fetch.
- **Never** add a second storefront settings request. Checkout performance is a hard constraint.
- Writes: admin form (`app-home.tsx`), `PUT /api/settings` (`api.settings.ts`), Checkout OS (`public/dashboard/index.html`). Same Mongo `checkoutSettings`.
- Defaults: COD on; prepaid off. If every payment method is off, keep COD on (`normalizePaymentMethods`).

### New HTTP

1. Register in `apps/shopify-admin/app/routes.ts` (or Fastify `apps/api/src/app.ts`).
2. Thin route file. Logic in `*-server.ts`.
3. App proxy: `authenticate.public.appProxy`. Admin JSON/UI: `authenticate.admin`. Webhooks: `authenticate.webhook`.
4. Shopper after OTP: header `x-ec-shopper`.
5. Foundation-only routes: Zod in `packages/contracts`, then `pnpm api:spec`.

### Do not

- Implement on `development` / `qa` / `staging` / `prod` / `main`.
- Put live storefront APIs in `apps/api`.
- Commit `.env`, secrets, `Doc/`, `tasks/`, `tools/`, `node_modules`, or build output. Never force-add gitignored files.
- Skip hooks (`--no-verify`).
- Expand Bro Pay or other removed demo payment brands.
- Hold inventory at checkout start; inventory is checked on place.
- Drive-by refactors, extra abstractions, or “while we’re here” cleanups.

Keep diffs small. Prefer deletion over addition. Reuse helpers already in the tree.

---

## 4. Test (evidence, then claim)

A task is not done because it “looks right”. Report **actual** command output. Never claim unrun tests passed.

### Choose checks from what you touched

| Touched | Run |
|---------|-----|
| Settings / payments / `*-server.ts` logic | `pnpm exec vitest run tests/unit/checkout-settings.test.ts` (or the matching unit file) |
| Foundation / contracts | `pnpm test` and, if schemas changed, `pnpm api:spec` |
| Admin TypeScript routes | `pnpm typecheck:admin` |
| Broader confidence before push | `pnpm check` (format, lint, typecheck, coverage, runtime, admin typecheck/build) |
| Overlay UI | Exercise the real flow (open overlay, login/OTP, address, pay rows, place COD). A screenshot is not enough. |
| Admin / dashboard UI | Load `/app` onboarding and, if settings changed, Checkout OS Settings/Payments save + confirm `/v1/settings` reflects it |

Local Mongo for admin: typically `MONGODB_URI` port **27028** (not 27017). See `docs/runbooks/shopify-development.md`.

### Overlay / admin UI

- Verify the path you changed **and** sibling surfaces that read the same state (app home form, dashboard, storefront overlay).
- Edge states: empty cart, disabled payment method, settings fetch failure (checkout must still open with safe defaults).
- If browser tools are unavailable, say what you verified with tests/`curl` and what you could not click.

### Before you call it done

- Diff review: only intended files; no secrets; no accidental `apps/api` vs admin mix-up.
- If you added a route or settings field, docs updated.
- Non-trivial logic left **one** runnable check that fails if the logic breaks.

---

## 5. Ship (only when the user asks)

Order is fixed:

```
pick branch from origin/development
  → implement on feature/<kebab>
  → test with evidence
  → commit (if asked)
  → push feature branch (if asked)
  → PR into development (if asked)
```

1. **Commit** (user asked): message = why, not a file list. Do not amend a pushed commit. If a hook rejects, fix and make a **new** commit. Do not skip hooks.
2. **Push**: `git push -u origin HEAD` of the **feature** branch only. Pre-push blocks environment branches and non-`feature/<kebab>` names.
3. **PR**: into `development` only. Do not merge the feature into `qa` / `staging` / `prod`.
4. **Promote**: `development` → `qa` → `staging` → `prod` via PRs. Do not skip. Do not promote past `development` unless the user requests that rollout.
5. `main` is bootstrap only — not an integration branch.

---

## 6. Recurring product rules (do not regress)

- **Two backends:** live = `shopify-admin` + app proxy. Demo = `apps/api`.
- **One settings fetch** on the storefront. Flags ride `/v1/settings`.
- **Customize checkout** in the Shopify admin onboarding (`app-home.tsx`) writes the same Mongo document the overlay reads.
- **Payments:** `payments: { cod, upi, card, netbanking }`. Hidden when off. Place = COD only until a gateway exists.
- **Overlay source of truth:** `public/checkout/*`, served through the proxy.
- **Dev embed:** while `pnpm dev` runs, embeds live on the CLI host theme. Set `SHOPIFY_THEME_EXTENSION_HOST_THEME_ID` from the CLI line and enable the **COD Checkout** embed (`cod-checkout` block).
- **Scopes:** `read_customers,write_customers,write_orders,read_orders,read_discounts` in `shopify.app.toml`. Scope changes need re-auth; `app/scopes_update` clears sessions.
- **Errors:** shopper-safe `{ error: { code, message } }`. No stack traces or secrets in responses.

---

## 7. Definition of done (every change)

- [ ] Correct `feature/*` branch from latest `origin/development`
- [ ] Right package/file; flow traced
- [ ] Smallest diff; no extra storefront requests
- [ ] Checks actually run; results reported
- [ ] UI exercised if UI changed
- [ ] API/settings docs updated when the contract changed
- [ ] No commit/push/PR unless the user asked
- [ ] If shipping: PR targets `development` only
