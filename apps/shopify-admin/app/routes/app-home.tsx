import { useLoaderData } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { authenticate, publicApiKey } from '../shopify.server';

/** Liquid filename under extensions/.../blocks/ (not the extension handle). */
const COD_CHECKOUT_BLOCK_HANDLE = 'cod-checkout';

function themeEditorThemeId(): string {
  // While `shopify app dev` runs, embeds are only on the CLI host theme — not the published theme.
  // Copy the theme id from the CLI line: "Setup your theme app extension in the host theme".
  const hostThemeId = process.env['SHOPIFY_THEME_EXTENSION_HOST_THEME_ID']?.trim();
  if (hostThemeId && /^\d+$/.test(hostThemeId)) return hostThemeId;
  return 'current';
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const storeHandle = shop.replace(/\.myshopify\.com$/i, '');
  const themeId = themeEditorThemeId();
  // https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration#app-embed-block-deep-linking
  // Do not URL-encode the slash in activateAppId — Shopify expects api_key/handle literally.
  const enableEmbedUrl = `https://admin.shopify.com/store/${storeHandle}/themes/${themeId}/editor?context=apps&activateAppId=${publicApiKey}/${COD_CHECKOUT_BLOCK_HANDLE}`;
  return {
    shop,
    enableEmbedUrl,
    usesDevHostTheme: themeId !== 'current',
  };
}

export default function Overview() {
  const { shop, enableEmbedUrl, usesDevHostTheme } = useLoaderData<typeof loader>();
  return (
    <main className="welcome">
      <p className="eyebrow">Shopify connection</p>
      <h1>Checkout</h1>
      <section>
        <h2>Store connection</h2>
        <p>You’re connected to {shop} through Shopify.</p>
      </section>
      <section>
        <h2>COD checkout on the storefront</h2>
        <p>
          Enable the <strong>COD Checkout</strong> app embed so shoppers who click Checkout / Buy
          now open the one-page COD overlay on your store (same page), not a separate checkout site.
        </p>
        <p className="actions">
          <a className="button" href={enableEmbedUrl} target="_top" rel="noopener noreferrer">
            Enable COD Checkout on theme
          </a>
        </p>
        <p className="hint">
          {usesDevHostTheme
            ? 'Opens the Shopify CLI development host theme (required while pnpm dev is running). Turn COD Checkout on under App embeds, then Save.'
            : 'Opens the theme editor with the app embed ready to turn on. Click Save in the editor after enabling it.'}
        </p>
        <p>
          Demo orders stay local until Shopify Admin order sync is enabled. Prepaid methods remain
          disabled.
        </p>
      </section>
    </main>
  );
}
