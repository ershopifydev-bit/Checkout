import React from 'react';
import { useDashboard } from '../context/DashboardContext';

const STORES = [
  {
    brand: 'Nilgiri Tea Co.',
    store: 'Mumbai Store',
    domain: 'nilgiri-mumbai.myshopify.com',
    color: 'blue',
    stats: [2430, 41.8, 9.2],
  },
  {
    brand: 'Nilgiri Tea Co.',
    store: 'Pune Store',
    domain: 'nilgiri-pune.myshopify.com',
    color: 'blue',
    stats: [1210, 39.5, 8.1],
  },
  {
    brand: 'Kora Apparel',
    store: 'D2C Store',
    domain: 'kora.in',
    color: 'or',
    stats: [3180, 36.2, 12.4],
  },
  {
    brand: 'Aarav Home',
    store: 'Main Store',
    domain: 'aaravhome.in',
    color: 'gr',
    stats: [960, 44.3, 6.7],
  },
];

export const StoresView: React.FC = () => {
  const { showToast } = useDashboard();

  return (
    <div className="g g3">
      {STORES.map((s, k) => (
        <div key={s.store} className="card" style={{ borderTop: `4px solid var(--${s.color})` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <b>{s.store}</b>
              <div style={{ color: 'var(--mut)', fontSize: '12px' }}>
                {s.brand} · {s.domain}
              </div>
            </div>
            <button
              className="tg on"
              role="switch"
              aria-checked="true"
              aria-label="Checkout live"
              onClick={(e) => {
                e.currentTarget.classList.toggle('on');
                showToast('Store status updated');
              }}
            />
          </div>
          <div style={{ fontSize: '12px', color: 'var(--mut)', marginTop: '12px' }}>
            Checkout health, last 60 days
          </div>
          <div className="grid">
            {[...Array(60)].map((_, i) => (
              <i
                key={i}
                className={
                  (i * 7 + k * 5) % 11 === 0
                    ? 'b'
                    : (i * 3 + k) % 13 === 0
                      ? ''
                      : s.color === 'blue'
                        ? 'a'
                        : s.color === 'or'
                          ? 'b'
                          : 'c'
                }
              />
            ))}
          </div>
          <div className="mini">
            <div>
              Orders<b>{s.stats[0]?.toLocaleString('en-IN')}</b>
            </div>
            <div>
              Conversion<b>{s.stats[1]}%</b>
            </div>
            <div>
              RTO<b>{s.stats[2]}%</b>
            </div>
          </div>
        </div>
      ))}

      <div
        className="card"
        style={{ display: 'grid', placeItems: 'center', textAlign: 'center', minHeight: '240px' }}
      >
        <div>
          <div style={{ fontSize: '30px' }}>+</div>
          <b>Add a store</b>
          <div style={{ color: 'var(--mut)', margin: '4px 0 12px' }}>
            Connect Shopify, set payments, run a test order.
          </div>
          <button className="btn" onClick={() => showToast('Add store wizard opened')}>
            Start setup
          </button>
        </div>
      </div>
    </div>
  );
};
