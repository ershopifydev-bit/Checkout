import React from 'react';
import { useDashboard } from '../context/DashboardContext';
import { KpiCard } from '../components/common/KpiCard';
import { useLiveMonitor } from '../hooks/useLiveMonitor';

export const LogisticsView: React.FC = () => {
  const { showToast } = useDashboard();
  const { data: monitor } = useLiveMonitor();

  const confirmedCount = monitor?.ordersAndAttempts.confirmed || 0;

  return (
    <>
      <div className="g g4">
        <KpiCard
          icon="📦"
          label="Confirmed orders"
          value={String(confirmedCount)}
          sub="Ready for dispatch"
          variant="dk"
        />
        <KpiCard icon="➜" label="In transit" value="0" sub="No active courier sync" variant="bl" />
        <KpiCard icon="↺" label="RTO rate" value="0%" sub="0 return orders" />
        <KpiCard icon="⚑" label="NDR open" value="0" sub="Non-delivery reports" />
      </div>

      <div className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Courier Integrations & NDR Telemetry</h3>
            <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
              Order tracking and automated NDR reattempt workflows
            </span>
          </div>
          <button className="btn" onClick={() => showToast('Configure in Integrations tab')}>
            Manage couriers
          </button>
        </div>

        <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--mut)' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🚚</div>
          <strong>No pending NDR (Non-Delivery Reports) found</strong>
          <p style={{ margin: '6px 0 0', fontSize: '13px' }}>
            When orders are shipped and couriers (Shiprocket, Delhivery, Bluedart) report address
            issues or customer refusal, reattempt requests and WhatsApp address-fix automations will
            appear here.
          </p>
        </div>
      </div>
    </>
  );
};
