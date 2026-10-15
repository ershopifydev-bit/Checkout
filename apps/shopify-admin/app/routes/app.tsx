import { Outlet, useLoaderData, useRouteError } from 'react-router';
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { AppProvider } from '@shopify/shopify-app-react-router/react';
import { authenticate, publicApiKey } from '../shopify.server';
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return { apiKey: publicApiKey };
}
export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => boundary.headers(args);
