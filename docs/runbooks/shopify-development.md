# Shopify development-store setup

The Shopify app lives in `apps/shopify-admin`. Run it with `pnpm dev` (Shopify CLI + tunnel). The Fastify API on port 3000 is a separate local demo only — it is **not** the storefront integration. Shopper COD checkout is injected on the live theme via the **COD Checkout** theme app embed (`extensions/cod-checkout-embed`) and the app proxy path `/apps/easy-checkout`.

The tracked development app is Checkout Development in EasyRewardz Software Services Private Limited (130952356), linked to `codemadi.myshopify.com`. Live installation verification is still pending.

## First-time setup

1. Use the Node and pnpm versions pinned in the repository, then run `pnpm install --frozen-lockfile`.
2. Start a local MongoDB service. For an isolated development instance on this machine:

   ```sh
   mkdir -p tools/runtime/mongodb-install-test
   mongod --dbpath tools/runtime/mongodb-install-test --bind_ip 127.0.0.1 --port 27028
   ```

   Keep it running in a terminal. `tools/` is ignored. Production needs authenticated MongoDB with TLS and the separately planned durability configuration.

3. Copy `apps/shopify-admin/.env.example` to `apps/shopify-admin/.env`. Set the MongoDB URI/database and generate a stable 32-byte base64 encryption key using the command in the example. Keep `.env` private; never commit or paste its contents. Losing/changing the key requires reauthentication of stored sessions. Key rotation is not implemented in this increment.
4. Run `npm run config:link` (or `pnpm config:link`). Select the organization owning `codemadi.myshopify.com`, then select/create the intended **development app**. Do not link an unrelated existing production app. The client ID is public configuration; the client secret belongs in the CLI-managed environment.
5. Review `apps/shopify-admin/shopify.app.toml` after linking. Preserve embedded mode, empty commerce scopes, the development-store domain, automatic development URL updates, and the two app lifecycle webhook subscriptions shown in this feature. Linking downloads remote configuration and may replace these settings.

## Daily development

```sh
npm run dev
# Equivalent: pnpm dev
```

This invokes Shopify CLI, starts the React Router app, and manages the development tunnel. Use the CLI preview URL (or press `p`) to install/open the app on the development store. Shopify CLI supplies the app URL and Shopify credentials. The Vite configuration accepts CLI versions that supply the tunnel URL as `HOST`, normalizing it to `SHOPIFY_APP_URL`. A running MongoDB service and the app-local `.env` are required. No separate TypeScript watcher is needed for this app.

Use the CLI preview URL for embedded Admin authentication. After the app is running:

1. In Shopify Admin → Online Store → Themes → Customize → **App embeds**, enable **COD Checkout**.
2. Save the theme.
3. On the storefront, add a product to cart and click **Checkout** (or Buy now). The one-page COD overlay should open on the same page.

`http://127.0.0.1:3000/` remains an optional local API playground only.

## Verification

```sh
pnpm check
MONGODB_TEST_URI=mongodb://127.0.0.1:27028 pnpm test:admin:db
pnpm audit --audit-level=moderate
```

The database tests use uniquely named test databases and delete only those databases. They exercise encrypted persistence, tenant-specific revocation, signed/forged webhooks, invalid/expired session tokens, and the compiled app over HTTP. CI supplies an ephemeral MongoDB service. The tests use synthetic credentials and do not prove a real Shopify installation.

For the compiled app outside Shopify CLI, configure `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `SHOPIFY_APP_URL` as well as the database variables, then run `pnpm build:admin` and `pnpm --filter @checkout/shopify-admin start`. The server defaults to loopback port 3001. Its custom launcher deliberately does not log request URLs because Shopify authentication query parameters may contain credentials.

## Verification still requiring a development store

- Link the correct app and install through Shopify's preview URL.
- Open the embedded home and verify its shop domain.
- Restart the app and verify session persistence.
- Uninstall, verify session removal, then reinstall and confirm fresh authorization.
- Verify the selected app's scopes/distribution and eventual privacy webhook requirements before merchant rollout.

No production distribution, customer-data access, or release approval follows from the local tests. App uninstall handling here revokes stored sessions; future scheduled work and capability caches must also participate in lifecycle revocation when implemented.
