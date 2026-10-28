import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { KpiCard } from '../components/common/KpiCard';
import { useLiveAnalytics } from '../hooks/useLiveAnalytics';

function formatPhoneMasked(phone?: string) {
  if (!phone) return 'No phone';
  const clean = phone.replace(/\D/g, '').slice(-10);
  if (clean.length < 10) return phone;
  return `${clean.slice(0, 2)}•••• ${clean.slice(-4)}`;
}

function timeAgo(dateString: string) {
  const diffSec = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ago`;
  return `${Math.floor(diffSec / 86400)} d ago`;
}

function dropPillClass(droppedAt: string) {
  switch (droppedAt.toLowerCase()) {
    case 'payment':
      return 'o';
    case 'address':
      return 'b';
    case 'login':
      return 'n';
    case 'discounts':
      return 'b';
    default:
      return 'n';
  }
}

export const AbandonedView: React.FC = () => {
  const { showToast } = useDashboard();
  const { data, loading, error, refresh } = useLiveAnalytics();
  const [subTab, setSubTab] = useState<
    'Abandoned carts' | 'Recovery flows' | 'Drop-off and recovered'
  >('Abandoned carts');

  const funnel = data?.funnel;
  const abandonedList = data?.abandoned || [];

  const totalAbandoned = funnel?.totalAbandoned || 0;
  const recoveryRate = funnel?.conversionRatePercent || 0;

  const reachableCount = abandonedList.filter((a) => Boolean(a.shopperPhone)).length;
  const reachablePercent =
    abandonedList.length > 0 ? Math.round((reachableCount / abandonedList.length) * 100) : 0;

  const totalAbandonedValueMinor = abandonedList.reduce(
    (acc, curr) => acc + (curr.cartValueMinor || 0),
    0,
  );
  const formattedAbandonedValue = `₹${(totalAbandonedValueMinor / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`;

  return (
    <>
      <div className="g g4">
        <KpiCard
          icon="🛒"
          label="Abandoned carts"
          value={String(totalAbandoned)}
          sub={`Value ${formattedAbandonedValue}`}
          variant="dk"
        />
        <KpiCard
          icon="↺"
          label="Checkout conversion"
          value={`${recoveryRate}%`}
          sub="Storefront completion rate"
          variant="bl"
        />
        <KpiCard
          icon="₹"
          label="Abandoned value"
          value={formattedAbandonedValue}
          sub={`Across ${abandonedList.length} sessions`}
        />
        <KpiCard
          icon="☎"
          label="Reachable phone"
          value={`${reachablePercent}%`}
          sub={`${reachableCount} of ${abandonedList.length} have phone`}
        />
      </div>

      <div className="chips">
        {(['Abandoned carts', 'Recovery flows', 'Drop-off and recovered'] as const).map((t) => (
          <button key={t} className={subTab === t ? 'on' : ''} onClick={() => setSubTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {subTab === 'Abandoned carts' && (
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
                Abandoned Checkout Sessions<em>{abandonedList.length} in database</em>
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
                Real-time sessions from <code>checkoutFunnels</code>
              </span>
            </div>
            <button className="btn" onClick={() => void refresh()}>
              ↻ Refresh
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--mut)' }}>
              Loading abandoned sessions...
            </div>
          ) : error ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--or)' }}>
              {error}
            </div>
          ) : abandonedList.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--mut)' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>🛒</div>
              <strong>No abandoned checkout sessions recorded yet</strong>
              <p style={{ margin: '6px 0 0', fontSize: '13px' }}>
                When shoppers abandon checkout at login, address, or payment step, their details and
                cart contents will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="wide">
              <table>
                <thead>
                  <tr>
                    <th>Customer / Session</th>
                    <th>Phone</th>
                    <th>Cart Items</th>
                    <th>Value</th>
                    <th>Dropped at</th>
                    <th>When</th>
                    <th>Recovery status</th>
                    <th className="n">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {abandonedList.map((a) => {
                    const cust =
                      a.shopperName ||
                      (a.shopperPhone ? `Shopper (${a.shopperPhone.slice(-4)})` : 'Guest Shopper');
                    const ph = formatPhoneMasked(a.shopperPhone);
                    const cart = `${a.itemCount || 1} item${(a.itemCount || 1) > 1 ? 's' : ''}`;
                    const val = `₹${((a.cartValueMinor || 0) / 100).toLocaleString('en-IN')}`;
                    const drop = a.droppedAt || 'Payment';
                    const dropCl = dropPillClass(drop);
                    const when = a.updatedAt ? timeAgo(a.updatedAt) : 'Recently';
                    const rec = a.shopperPhone ? 'Queued' : 'No phone';
                    const recCl = a.shopperPhone ? 'n' : 'o';

                    return (
                      <tr key={a.sessionId} className="r">
                        <td>
                          <strong>{cust}</strong>
                          <br />
                          <small style={{ color: 'var(--mut)' }}>
                            {a.sessionId.slice(0, 16)}...
                          </small>
                        </td>
                        <td>{ph}</td>
                        <td>
                          {cart}
                          {a.items && a.items.length > 0 && (
                            <small style={{ display: 'block', color: 'var(--mut)' }}>
                              {a.items[0]?.title}
                            </small>
                          )}
                        </td>
                        <td>
                          <strong>{val}</strong>
                        </td>
                        <td>
                          <span className={`pill ${dropCl}`}>{drop}</span>
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--mut)' }}>{when}</td>
                        <td>
                          <span className={`pill ${recCl}`}>{rec}</span>
                        </td>
                        <td className="n">
                          <button
                            className="btn l"
                            onClick={() => showToast(`Recovery notification triggered for ${cust}`)}
                          >
                            Send now
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'Recovery flows' && (
        <div className="g g2e">
          <div className="card">
            <h3>
              Automated recovery sequence<em>Active for {reachableCount} reachable carts</em>
            </h3>
            {[
              ['15 minutes', 'WhatsApp', 'Cart reminder with one-tap checkout link'],
              ['2 hours', 'SMS', 'Reminder with exclusive discount code'],
              ['24 hours', 'Email', 'Special offer before cart expires'],
            ].map(([time, ch, desc]) => (
              <div className="row" key={time}>
                <div>
                  <b>
                    After {time} · {ch}
                  </b>
                  <small>{desc}</small>
                </div>
                <button
                  className="tg on"
                  role="switch"
                  aria-checked="true"
                  onClick={(e) => {
                    const btn = e.currentTarget;
                    btn.classList.toggle('on');
                    showToast(`${ch} flow updated`);
                  }}
                />
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Rules & suppression</h3>
            <div style={{ color: 'var(--mut)', fontSize: '13px', lineHeight: 1.6 }}>
              • Stop sequence immediately upon Shopify order placement.
              <br />
              • Never send notifications between 10 PM and 8 AM.
              <br />• Only message shoppers who completed the mobile OTP step.
            </div>
          </div>
        </div>
      )}

      {subTab === 'Drop-off and recovered' && (
        <div className="card">
          <h3>
            Drop-off step breakdown<em>Live checkout analytics</em>
          </h3>
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Funnel Step</th>
                  <th className="n">Drop-offs</th>
                </tr>
              </thead>
              <tbody>
                <tr className="r">
                  <td>Login / OTP</td>
                  <td className="n">{funnel?.dropOffByStep.login ?? 0}</td>
                </tr>
                <tr className="r">
                  <td>Address details</td>
                  <td className="n">{funnel?.dropOffByStep.address ?? 0}</td>
                </tr>
                <tr className="r">
                  <td>Coupon & discounts</td>
                  <td className="n">{funnel?.dropOffByStep.discounts ?? 0}</td>
                </tr>
                <tr className="r">
                  <td>Payment method selection</td>
                  <td className="n">{funnel?.dropOffByStep.payment ?? 0}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};
