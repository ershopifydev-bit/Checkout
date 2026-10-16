import { index, route, type RouteConfig } from '@react-router/dev/routes';
export default [
  index('routes/home.tsx'),
  route('auth/login', 'routes/login.tsx'),
  route('auth/*', 'routes/auth.tsx'),
  route('app', 'routes/app.tsx', [index('routes/app-home.tsx')]),
  route('webhooks/app/uninstalled', 'routes/uninstalled.tsx'),
  route('webhooks/app/scopes_update', 'routes/scopes-update.tsx'),
  route('proxy/v1/demo/checkout', 'routes/proxy.v1.demo.checkout.ts'),
  route('proxy/v1/demo/cod-orders', 'routes/proxy.v1.demo.cod-orders.ts'),
  route('proxy/panel.html', 'routes/proxy.panel[.]html.ts'),
] satisfies RouteConfig;
