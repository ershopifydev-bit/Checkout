import { redirect, Link } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.has('shop')) return redirect(`/app${url.search}`);
  return null;
}
export default function Home() {
  return (
    <main className="welcome">
      <img
        className="tezvix-brand-logo"
        src="/branding/tezvix-logo.svg"
        alt="Tezvix"
        width="144"
        height="50"
      />
      <p className="eyebrow">Checkout · Development</p>
      <h1>Connect your Shopify store</h1>
      <p>Open Checkout from Shopify Admin to view your store connection.</p>
      <Link className="button" to="/auth/login">
        Open with Shopify
      </Link>
      <section>
        <h2>What you can test</h2>
        <p>
          Install the app and sign in through Shopify. Shopper checkout and payment features are
          still in development and are not enabled.
        </p>
      </section>
    </main>
  );
}
