import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import stylesheet from './styles.css?url';

export function links() {
  return [{ rel: 'stylesheet', href: stylesheet }];
}
export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
