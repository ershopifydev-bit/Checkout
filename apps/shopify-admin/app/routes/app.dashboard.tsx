import type { LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData } from 'react-router';
import { createDashboardToken } from '../dashboard-token.server';
import { authenticate } from '../shopify.server';

/**
 * Authenticated entry into the Checkout OS dashboard within Shopify Admin.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const secret = process.env['SESSION_ENCRYPTION_KEY'] || 'checkout-dashboard-secret';
  const token = createDashboardToken(session.shop, secret);
  return {
    shop: session.shop,
    token,
  };
}

export default function AppDashboard() {
  const { shop, token } = useLoaderData<typeof loader>();
  const dashboardUrl = `/dashboard/index.html?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(token)}`;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100%',
        background: '#F8FAFC',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          fontSize: '13px',
          flexShrink: 0,
        }}
      >
        <Link
          to="/app"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: '#4F46E5',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          <span>←</span> Back to Onboarding
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#64748B', fontSize: '12px' }}>
            Store: <strong style={{ color: '#0F172A' }}>{shop}</strong>
          </span>
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '12px',
              color: '#4F46E5',
              textDecoration: 'none',
              padding: '3px 8px',
              borderRadius: '4px',
              background: '#EEF2FF',
              fontWeight: 500,
            }}
          >
            Open in new tab ↗
          </a>
        </div>
      </header>
      <iframe
        src={dashboardUrl}
        title="Checkout OS Dashboard"
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          minHeight: 'calc(100vh - 46px)',
        }}
      />
    </div>
  );
}
