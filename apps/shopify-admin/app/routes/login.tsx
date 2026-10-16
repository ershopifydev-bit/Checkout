import { Form, useActionData, useLoaderData, useNavigation } from 'react-router';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { LoginErrorType } from '@shopify/shopify-app-react-router/server';
import { login } from '../shopify.server';

export async function loader({ request }: LoaderFunctionArgs) {
  return login(request);
}
export async function action({ request }: ActionFunctionArgs) {
  return login(request);
}
export default function Login() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  const error = (submitted ?? loaded).shop;
  const pending = useNavigation().state !== 'idle';
  return (
    <main className="welcome">
      <p className="eyebrow">Checkout · Shopify</p>
      <h1>Open your store</h1>
      <p>Use your store’s myshopify.com domain to continue securely through Shopify.</p>
      <Form method="post">
        <label htmlFor="shop">Shop domain</label>
        <input
          id="shop"
          name="shop"
          type="text"
          required
          autoComplete="off"
          placeholder="your-store.myshopify.com"
          aria-describedby="shop-help shop-error"
          aria-invalid={Boolean(error)}
        />
        <p id="shop-help">For example: codemadi.myshopify.com</p>
        <p id="shop-error" role="alert">
          {error === LoginErrorType.InvalidShop
            ? 'Enter a valid myshopify.com store domain.'
            : error === LoginErrorType.MissingShop
              ? 'Enter your store domain.'
              : ''}
        </p>
        <button type="submit" disabled={pending}>
          {pending ? 'Connecting…' : 'Continue to Shopify'}
        </button>
      </Form>
    </main>
  );
}
