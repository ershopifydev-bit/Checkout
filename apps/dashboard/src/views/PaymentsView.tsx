import React from 'react';
import { useDashboard } from '../context/DashboardContext';
import { KpiCard } from '../components/common/KpiCard';
import { useLiveMonitor } from '../hooks/useLiveMonitor';
import { useLiveSettings } from '../hooks/useLiveSettings';

export const PaymentsView: React.FC = () => {
  const { showToast } = useDashboard();
  const { data: monitor } = useLiveMonitor();
  const { settings } = useLiveSettings();

  const orders = monitor?.ordersAndAttempts;
  const pays = settings.payments || { cod: true, upi: false, card: false, netbanking: false };

  return (
    <>
      <div className="g g4">
        <KpiCard
          icon="₹"
          label="Confirmed revenue"
          value={orders?.confirmedRevenue.formatted || '₹0'}
          sub={`${orders?.confirmed ?? 0} successful orders`}
          variant="dk"
        />
        <KpiCard
          icon="📦"
          label="COD Orders"
          value={String(orders?.confirmed ?? 0)}
          sub={pays.cod ? 'COD active on storefront' : 'COD disabled'}
          variant="bl"
        />
        <KpiCard
          icon="ϟ"
          label="UPI Gateway"
          value={pays.upi ? 'Enabled' : 'Disabled'}
          sub="Instant UPI app switch"
        />
        <KpiCard
          icon="💳"
          label="Card / Netbanking"
          value={pays.card || pays.netbanking ? 'Enabled' : 'Disabled'}
          sub="Cards & 42 banks"
        />
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
            <h3 style={{ margin: 0 }}>Payment Method Configuration</h3>
            <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
              Storefront payment methods currently configured in <code>checkoutSettings</code>
            </span>
          </div>
          <button className="btn" onClick={() => showToast('Manage in Checkout tab')}>
            Configure methods
          </button>
        </div>

        <div className="wide">
          <table>
            <thead>
              <tr>
                <th>Payment Mode</th>
                <th>Status</th>
                <th>Gateway Channel</th>
                <th className="n">Order Settlement</th>
              </tr>
            </thead>
            <tbody>
              <tr className="r">
                <td>
                  <strong>Cash on Delivery (COD)</strong>
                </td>
                <td>
                  <span className={`pill ${pays.cod ? 'g' : 'o'}`}>
                    {pays.cod ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>Direct Shopify Order Creation</td>
                <td className="n">Collected upon delivery</td>
              </tr>
              <tr className="r">
                <td>
                  <strong>UPI / QR</strong>
                </td>
                <td>
                  <span className={`pill ${pays.upi ? 'g' : 'n'}`}>
                    {pays.upi ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>Google Pay, PhonePe, Paytm</td>
                <td className="n">Direct to merchant VPA</td>
              </tr>
              <tr className="r">
                <td>
                  <strong>Cards (Debit & Credit)</strong>
                </td>
                <td>
                  <span className={`pill ${pays.card ? 'g' : 'n'}`}>
                    {pays.card ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>Visa, MasterCard, RuPay</td>
                <td className="n">T+1 via Gateway</td>
              </tr>
              <tr className="r">
                <td>
                  <strong>Netbanking</strong>
                </td>
                <td>
                  <span className={`pill ${pays.netbanking ? 'g' : 'n'}`}>
                    {pays.netbanking ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>42 Supported Indian Banks</td>
                <td className="n">T+1 via Gateway</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};
