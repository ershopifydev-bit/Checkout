import { useLoaderData } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
}

export default function Overview() {
  const { shop } = useLoaderData<typeof loader>();
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
          Enable the <strong>COD Checkout</strong> app embed in Online Store → Themes → Customize →
          App embeds. Shoppers who click Checkout / Buy now open the one-page COD overlay on your
          store (same page), not a separate checkout site.
        </p>
        <p>
          Demo orders stay local until Shopify Admin order sync is enabled. Prepaid methods remain
          disabled.
        </p>
      </section>
    </main>
  );
}
