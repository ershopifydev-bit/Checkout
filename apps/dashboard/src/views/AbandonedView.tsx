import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { KpiCard } from '../components/common/KpiCard';
import { useLiveAnalytics } from '../hooks/useLiveAnalytics';

const rs = (n: number) =>
  [...Array(n)].map((_, i) => Math.round(50 + 30 * Math.sin(i * 0.9) + ((i * 37) % 17)));

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
  const { data } = useLiveAnalytics();
  const [subTab, setSubTab] = useState<
    'Abandoned carts' | 'Recovery flows' | 'Drop-off and recovered'
  >('Abandoned carts');

  const funnel = data?.funnel;
  const abandonedList = data?.abandoned;

  const totalAbandonedStr =
    funnel?.totalAbandoned != null && funnel.totalAbandoned > 0
      ? String(funnel.totalAbandoned)
      : '1,240';
  const recoveryRateStr =
    funnel?.conversionRatePercent != null && funnel.conversionRatePercent > 0
      ? `${funnel.conversionRatePercent}%`
      : '14.6%';

  const fallbackRows: Array<
    [string, string, string, string, string, string, string, string, string]
  > = [
    [
      'Meera Joshi',
      '98•••• 4021',
      '2 items',
      '₹3,240',
      'Payment',
      'o',
      '12 min ago',
      'Message 1 sent',
      'b',
    ],
    ['Kabir Rao', '91•••• 7782', '1 item', '₹899', 'Address', 'b', '34 min ago', 'Queued', 'n'],
    [
      'Sana Qureshi',
      '99•••• 1203',
      '4 items',
      '₹6,480',
      'Payment',
      'o',
      '1 h ago',
      'Message 2 sent',
      'b',
    ],
    [
      'Rohan Iyer',
      '90•••• 5521',
      '3 items',
      '₹2,150',
      'Shipping',
      'n',
      '3 h ago',
      'Email sent',
      'b',
    ],
    ['Diya Nair', '97•••• 3018', '1 item', '₹1,299', 'Login', 'n', '5 h ago', 'No phone', 'o'],
  ];

  const tableRows =
    abandonedList && abandonedList.length > 0
      ? abandonedList.map(
          (a): [string, string, string, string, string, string, string, string, string] => {
            const cust =
              a.shopperName ||
              (a.shopperPhone ? `Shopper ${a.shopperPhone.slice(-4)}` : 'Guest Shopper');
            const ph = formatPhoneMasked(a.shopperPhone);
            const cart = `${a.itemCount || 1} item${(a.itemCount || 1) > 1 ? 's' : ''}`;
            const val = `₹${((a.cartValueMinor || 0) / 100).toLocaleString('en-IN')}`;
            const drop = a.droppedAt || 'Payment';
            const dropCl = dropPillClass(drop);
            const when = a.updatedAt ? timeAgo(a.updatedAt) : 'Recently';
            const rec = a.shopperPhone ? 'Queued' : 'No phone';
            const recCl = a.shopperPhone ? 'n' : 'o';
            return [cust, ph, cart, val, drop, dropCl, when, rec, recCl];
          },
        )
      : fallbackRows;

  return (
    <>
      <div className="g g4">
        <KpiCard
          icon="🛒"
          label="Abandoned today"
          value={totalAbandonedStr}
          sub="Cart value ₹31.4L"
          variant="dk"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="↺"
          label="Recovery rate"
          value={recoveryRateStr}
          sub="↗ 2.1 pts vs last week"
          variant="bl"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="₹"
          label="Recovered revenue"
          value="₹6.2L"
          sub="This month"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="☎"
          label="Reachable"
          value="82%"
          sub="Phone or email captured"
          sparkline={rs(10)}
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
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Cart</th>
                  <th>Value</th>
                  <th>Dropped at</th>
                  <th>When</th>
                  <th>Recovery</th>
                  <th className="n">Action</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map(([cust, ph, cart, val, drop, dropCl, when, rec, recCl]) => (
                  <tr key={cust + when} className="r">
                    <td>{cust}</td>
                    <td>{ph}</td>
                    <td>{cart}</td>
                    <td>{val}</td>
                    <td>
                      <span className={`pill ${dropCl}`}>{drop}</span>
                    </td>
                    <td>{when}</td>
                    <td>
                      <span className={`pill ${recCl}`}>{rec}</span>
                    </td>
                    <td className="n">
                      <button
                        className="btn l"
                        onClick={() => showToast(`Recovery message sent to ${cust}`)}
                      >
                        Send now
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'Recovery flows' && (
        <div className="g g2e">
          <div className="card">
            <h3>
              Automated flow<em>Stops when order placed</em>
            </h3>
            {[
              [
                '15 minutes',
                'WhatsApp',
                'Your cart is waiting, free shipping inside',
                '4,120',
                '310',
              ],
              ['2 hours', 'SMS', 'Reminder with a one-tap checkout link', '2,860', '140'],
              ['24 hours', 'Email', '₹100 off if you complete today', '2,200', '95'],
            ].map(([time, ch, desc, sent, rec]) => (
              <div className="row" key={time}>
                <div>
                  <b>
                    After {time} · {ch}
                  </b>
                  <small>{desc}</small>
                </div>
                <div style={{ flex: 'none', textAlign: 'right' }}>
                  Sent {sent}
                  <small>Recovered {rec}</small>
                </div>
                <button
                  className="tg on"
                  role="switch"
                  aria-checked="true"
                  onClick={(e) => {
                    const btn = e.currentTarget;
                    btn.classList.toggle('on');
                    showToast('Step updated');
                  }}
                />
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Rules</h3>
            {[
              ['Only carts above', '₹500'],
              ['Maximum messages', '3'],
              ['Quiet hours', '10 PM–8 AM'],
              ['Discount cap', '₹100'],
            ].map(([label, val]) => (
              <div className="fld" key={label}>
                {label}
                <input defaultValue={val} aria-label={label} />
              </div>
            ))}
            <button
              className="btn"
              style={{ marginTop: '14px' }}
              onClick={() => showToast('Recovery flow saved')}
            >
              Save flow
            </button>
          </div>
        </div>
      )}

      {subTab === 'Drop-off and recovered' && (
        <div className="g g2e">
          <div className="card">
            <h3>
              Where customers leave<em>Today</em>
            </h3>
            {[
              ['Login', 18],
              ['Address', 34],
              ['Shipping', 12],
              ['Payment', 36],
            ].map(([stage, pct]) => (
              <div className="bar" key={stage as string}>
                <span>{stage}</span>
                <div>
                  <i style={{ width: `${(pct as number) * 2.5}%` }} />
                </div>
                <b>{pct}%</b>
              </div>
            ))}
            <div style={{ color: 'var(--mut)', fontSize: '12px', marginTop: '10px' }}>
              Payment failures lead the drop-off. 62% were UPI timeouts.
            </div>
          </div>

          <div className="card">
            <h3>
              Recovered orders<em>Last 24 hours</em>
            </h3>
            <div className="wide">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Channel</th>
                    <th>Discount</th>
                    <th className="n">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['#KW-10470', 'WhatsApp', 'None', '₹3,240'],
                    ['#KW-10466', 'SMS', 'None', '₹1,899'],
                    ['#KW-10459', 'Email', '₹100', '₹2,450'],
                    ['#KW-10452', 'WhatsApp', 'None', '₹5,120'],
                  ].map(([ord, ch, disc, amt]) => (
                    <tr key={ord} className="r">
                      <td>{ord}</td>
                      <td>{ch}</td>
                      <td>{disc}</td>
                      <td className="n">{amt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
