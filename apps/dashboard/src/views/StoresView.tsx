import React from 'react';
import { useDashboard } from '../context/DashboardContext';
import { useLiveStores } from '../hooks/useLiveStores';

export const StoresView: React.FC = () => {
  const { showToast } = useDashboard();
  const { stores, loading, error, refresh } = useLiveStores();

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Connected Shopify Stores</h3>
          <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
            Real stores connected in MongoDB with active Shopify sessions and COD checkout embeds
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn l" onClick={() => refresh()}>
            ↻ Refresh
          </button>
          <button
            className="btn"
            onClick={() =>
              showToast(
                'To connect a new store, run `pnpm dev` with your Shopify development store URL.',
              )
            }
          >
            + Link new store
          </button>
        </div>
      </div>

      {loading && (
        <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--mut)' }}>
          Loading connected stores telemetry...
        </div>
      )}

      {error && !loading && (
        <div
          className="card"
          style={{ padding: '16px', color: 'var(--red)', marginBottom: '16px' }}
        >
          {error}
        </div>
      )}

      {!loading && stores.length === 0 && (
        <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
          <h4>No connected stores found</h4>
          <p style={{ color: 'var(--mut)', fontSize: '13px' }}>
            Run the Shopify App CLI to authenticate and register your store session in MongoDB.
          </p>
        </div>
      )}

      <div className="g g3">
        {stores.map((store) => (
          <div
            key={store.shop}
            className="card"
            style={{
              borderTop: `4px solid ${store.status === 'Connected' ? 'var(--blue)' : 'var(--mut)'}`,
            }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
            >
              <div>
                <b style={{ fontSize: '16px' }}>{store.brandName}</b>
                <div style={{ color: 'var(--mut)', fontSize: '12px', marginTop: '2px' }}>
                  {store.shop}
                </div>
              </div>
              <span className={`pill ${store.status === 'Connected' ? 'g' : 'b'}`}>
                {store.status === 'Connected' ? '● Live' : 'Configured'}
              </span>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--mut)', marginTop: '20px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border-light, #f0f0f0)',
                }}
              >
                <span>Shopify Session</span>
                <strong
                  style={{
                    color: store.hasSession ? 'var(--green, #10b981)' : 'var(--amber, #f59e0b)',
                  }}
                >
                  {store.hasSession ? 'Authenticated (Offline token)' : 'Needs auth'}
                </strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border-light, #f0f0f0)',
                }}
              >
                <span>Theme App Embed</span>
                <strong style={{ color: 'var(--ink)' }}>Active (COD Checkout)</strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border-light, #f0f0f0)',
                }}
              >
                <span>Recorded Events</span>
                <strong style={{ color: 'var(--ink)' }}>{store.eventCount} events</strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                }}
              >
                <span>Orders Placed</span>
                <strong style={{ color: 'var(--ink)' }}>
                  {store.confirmedCount} confirmed / {store.attemptCount} attempts
                </strong>
              </div>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', gap: '8px' }}>
              <a
                href={`https://${store.shop}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn l"
                style={{ textDecoration: 'none', textAlign: 'center', flex: 1 }}
              >
                Open store ↗
              </a>
              <button
                className="btn l"
                onClick={() => showToast(`Theme embed synced for ${store.brandName}`)}
              >
                Sync theme
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
