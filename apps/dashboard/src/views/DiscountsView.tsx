import React from 'react';
import { useDashboard } from '../context/DashboardContext';
import { useLiveAnalytics } from '../hooks/useLiveAnalytics';
import { useLiveMonitor } from '../hooks/useLiveMonitor';

export const DiscountsView: React.FC = () => {
  const { showToast } = useDashboard();
  const { data: analytics } = useLiveAnalytics();
  const { data: monitor } = useLiveMonitor();

  const totalDiscountCount = analytics?.funnel?.totalDiscountApplied || 0;
  const recentEvents = monitor?.eventStream.latestEvents || [];
  const discountEvents = recentEvents.filter((e) => e.event === 'discount_applied');

  return (
    <>
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
            <h3 style={{ margin: 0 }}>
              Storefront Coupons & Discount Telemetry
              <em>{totalDiscountCount} applied in sessions</em>
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
              Coupons validated live against Shopify Discount API during overlay checkout
            </span>
          </div>
          <button
            className="btn"
            onClick={() => showToast('Discounts are managed directly in your Shopify Admin store')}
          >
            Manage in Shopify Admin ↗
          </button>
        </div>

        {discountEvents.length === 0 ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--mut)' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>🎟️</div>
            <strong>No discount events recorded in recent timeline</strong>
            <p style={{ margin: '6px 0 0', fontSize: '13px' }}>
              When shoppers enter promo codes or apply automatic discounts in the checkout overlay,
              the validation events, codes, and discount amounts will appear here in real time.
            </p>
          </div>
        ) : (
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Session ID</th>
                  <th>Shop</th>
                  <th>Coupon Code</th>
                  <th>Timestamp</th>
                  <th className="n">Status</th>
                </tr>
              </thead>
              <tbody>
                {discountEvents.map((evt) => (
                  <tr key={evt._id} className="r">
                    <td>
                      <code>{evt.sessionId.slice(0, 16)}...</code>
                    </td>
                    <td>{evt.shop}</td>
                    <td>
                      <span className="pill g">CD02</span>
                    </td>
                    <td style={{ fontSize: '12px', color: 'var(--mut)' }}>
                      {new Date(evt.timestamp).toLocaleString('en-IN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="n">
                      <span className="pill g">Applied</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
