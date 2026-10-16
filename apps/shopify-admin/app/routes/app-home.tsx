import { useLoaderData } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { authenticate, publicApiKey } from '../shopify.server';

const COD_CHECKOUT_EMBED_HANDLE = 'cod-checkout-embed';

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const storeHandle = shop.replace(/\.myshopify\.com$/i, '');
  // https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration#app-embed-block-deep-linking
  const enableEmbedUrl = `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?context=apps&activateAppId=${encodeURIComponent(`${publicApiKey}/${COD_CHECKOUT_EMBED_HANDLE}`)}`;
  return { shop, enableEmbedUrl };
}

export default function Overview() {
  const { shop, enableEmbedUrl } = useLoaderData<typeof loader>();
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
          Opens the theme editor with the app embed ready to turn on. Click <strong>Save</strong> in
          the editor after enabling it.
        </p>
        <p>
          Demo orders stay local until Shopify Admin order sync is enabled. Prepaid methods remain
          disabled.
        </p>
      </section>
    </main>
  );
}
