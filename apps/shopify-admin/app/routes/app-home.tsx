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
        <h2>Checkout is not enabled yet</h2>
        <p>
          This development version supports app installation and authenticated access. Your store
          continues to use its existing checkout.
        </p>
        <p>
          Shopper journeys, delivery integrations, and checkout handoff will be available in later
          increments. Custom payments remain unavailable.
        </p>
      </section>
    </main>
  );
}
