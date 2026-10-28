import React from 'react';
import { useDashboard } from '../context/DashboardContext';
import { useLiveSettings } from '../hooks/useLiveSettings';
import { useLiveMonitor } from '../hooks/useLiveMonitor';

export const StoresView: React.FC = () => {
  const { showToast } = useDashboard();
  const { settings } = useLiveSettings();
  const { data: monitor } = useLiveMonitor();

  const currentShop = settings.shop || 'codemadi.myshopify.com';
  const currentBrand = settings.brandName || 'RARE';
  const totalEvents = monitor?.eventStream.totalRecordedEvents || 0;
  const attempts = monitor?.ordersAndAttempts.totalAttempts || 0;
  const confirmed = monitor?.ordersAndAttempts.confirmed || 0;

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
            Stores linked with Tezvix OS COD checkout overlay and app proxy
          </span>
        </div>
        <button
          className="btn"
          onClick={() =>
            showToast('Install app on your development store using Shopify CLI: pnpm dev')
          }
        >
          + Link new store
        </button>
      </div>

      <div className="g g3">
        <div className="card" style={{ borderTop: `4px solid var(--blue)` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <b>{currentBrand}</b>
              <div style={{ color: 'var(--mut)', fontSize: '12px' }}>
                Primary Store · {currentShop}
              </div>
            </div>
            <span className="pill g">Live</span>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--mut)', marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>Theme App Embed</span>
              <strong style={{ color: 'var(--ink)' }}>Active (COD Checkout)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>Recorded Events</span>
              <strong style={{ color: 'var(--ink)' }}>{totalEvents}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>Orders Placed</span>
              <strong style={{ color: 'var(--ink)' }}>
                {confirmed} / {attempts} attempts
              </strong>
            </div>
          </div>

          <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
            <a
              href={`https://${currentShop}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn l"
              style={{ textDecoration: 'none', textAlign: 'center', flex: 1 }}
            >
              Open store ↗
            </a>
            <button
              className="btn l"
              onClick={() => showToast('Syncing theme embed configuration...')}
            >
              Sync theme
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
