# ADR 0002: Shopify development-store installation

Date: 15 October 2026. Status: implemented locally; Shopify development-store verification pending.

## Objective and boundary

Add apps/shopify-admin using Shopify's supported React Router template patterns, alongside the existing Fastify checkout API. The first supported journey is installation and authenticated opening in codemadi.myshopify.com. The embedded home explains that checkout is not enabled yet. No shopper, payment, product mutation, or order access is introduced.

Use official Shopify authentication and webhook verification rather than custom OAuth. Derive the displayed merchant from the verified session. Use zero commerce scopes for this shell. Persist session contents encrypted with AES-256-GCM in MongoDB; bind encryption to session ID and shop. Keep credentials out of Git, HTTP responses, and logs. Database failures must fail operations, not acknowledge failed deletion. Signed uninstall events remove sessions by verified shop. Scope-update events invalidate sessions so the next authenticated request obtains current authorization.

Retain pnpm and the existing workspace. Both npm run dev and pnpm dev invoke the same Shopify CLI entry point. Shopify's CLI owns the development tunnel and app preview. A separately configured MongoDB service remains a prerequisite. Development is not a production deployment or a Shopify distribution decision.

## Verification

Use Vitest for session encryption, isolation, failure behavior and configuration. Exercise real MongoDB persistence, deletion and tamper rejection with an isolated local database. Run strict TypeScript, lint, formatting, SSR build, existing foundation tests and real browser checks. Store installation is a separate manual/external check and must remain pending until observed. No suppression of checks to accommodate the template.

## Sources

- https://github.com/Shopify/shopify-app-template-react-router
- https://shopify.dev/docs/api/shopify-app-react-router/latest
- https://shopify.dev/docs/apps/build/authentication-authorization
- https://shopify.dev/docs/apps/build/webhooks/subscribe/https

## Local commands

Use the pinned Node and pnpm versions. Run pnpm install, pnpm typecheck:admin, pnpm build:admin, and the root checks. Run pnpm config:link to select/create the development app, then npm run dev (or pnpm dev). MongoDB URI, database name and encryption key belong in the app-local ignored .env. The CLI supplies Shopify credentials and tunnel URL during development.

## Integration and rollback

Introduce this increment through a feature PR into development. No environment promotion or production deployment is included. Reverting the app code leaves the existing API intact; encrypted development sessions are separate in the configured MongoDB database. Do not delete or rotate their encryption key as part of a code rollback.

## Limits

The UI uses accessible HTML inside Shopify AppProvider. The current Polaris types conflict with exact optional property checks; no type-check suppression was added. React Router uses the 7.18.2 line pinned by Shopify's inspected template. The API baseline is 2026-10 for this installation shell; future commerce adapters still require their own feasibility evidence. No data-access scopes are requested by this shell. App Store distribution mode is the SDK's standard CLI development installation flow, not a decision to publish publicly. Privacy and production rollout remain gated.
