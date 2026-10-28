import React from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { KpiCard } from '../../components/common/KpiCard';

const rs = (n: number) =>
  [...Array(n)].map((_, i) => Math.round(50 + 30 * Math.sin(i * 0.9) + ((i * 37) % 17)));

const ATTENTION_STORES = [
  {
    store: 'D2C Store',
    brand: 'Kora Apparel',
    issue: 'Webhook failing',
    issueCl: 'o',
    owner: 'Erin C.',
    toastMsg: 'Webhook retried',
    btnLabel: 'Retry',
  },
  {
    store: 'Pune Store',
    brand: 'Nilgiri Tea Co.',
    issue: 'Domain SSL expiring',
    issueCl: 'o',
    owner: 'Tom L.',
    toastMsg: 'Reminder sent',
    btnLabel: 'Remind',
  },
  {
    store: 'Main Store',
    brand: 'Aarav Home',
    issue: 'Slow payments',
    issueCl: 'n',
    owner: 'Noor H.',
    toastMsg: 'Gateway switched for 30 min',
    btnLabel: 'Switch gateway',
  },
];

export const OverviewView: React.FC = () => {
  const { showToast } = useDashboard();

  return (
    <>
      <div className="g g4">
        <KpiCard
          icon="▦"
          label="Live stores"
          value="412"
          sub="Across 96 merchants"
          variant="dk"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="₹"
          label="Platform GMV, today"
          value="₹4.8Cr"
          sub="↗ 6% vs last Tuesday"
          variant="bl"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="◔"
          label="Payment success"
          value="93.7%"
          sub="Cashfree degraded"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="✉"
          label="Open tickets"
          value="27"
          sub="6 breaching SLA"
          sparkline={rs(10).reverse()}
        />
      </div>

      <div className="g g2">
        <div className="card">
          <h3>
            Stores needing attention<em>5</em>
          </h3>
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Brand</th>
                  <th>Issue</th>
                  <th>Owner</th>
                  <th className="n">Action</th>
                </tr>
              </thead>
              <tbody>
                {ATTENTION_STORES.map((s) => (
                  <tr key={s.store} className="r">
                    <td>{s.store}</td>
                    <td>{s.brand}</td>
                    <td>
                      <span className={`pill ${s.issueCl}`}>{s.issue}</span>
                    </td>
                    <td>{s.owner}</td>
                    <td className="n">
                      <button className="btn l" onClick={() => showToast(s.toastMsg)}>
                        {s.btnLabel}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>System health</h3>
          {[
            ['Shopify sync', 'Healthy', true],
            ['Razorpay', 'Healthy', true],
            ['Cashfree', 'Degraded', false],
            ['WhatsApp provider', 'Healthy', true],
          ].map(([svc, status, ok]) => (
            <div className="row" key={svc as string}>
              <span className="dot" style={{ background: ok ? 'var(--gr)' : 'var(--or)' }} />
              <div>{svc}</div>
              <span>{status}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
