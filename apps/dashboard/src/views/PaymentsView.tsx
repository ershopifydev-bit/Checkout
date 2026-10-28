import React from 'react';
import { useDashboard } from '../context/DashboardContext';
import { KpiCard } from '../components/common/KpiCard';

const rs = (n: number) =>
  [...Array(n)].map((_, i) => Math.round(50 + 30 * Math.sin(i * 0.9) + ((i * 37) % 17)));

const SETTLEMENTS: Array<{
  cycle: string;
  store: string;
  utr: string;
  fee: string;
  st: string;
  stCl: string;
  amt: string;
}> = [
  {
    cycle: '27 Oct',
    store: 'All stores',
    utr: '—',
    fee: '₹12,410',
    st: 'Processing',
    stCl: 'o',
    amt: '₹8,42,300',
  },
  {
    cycle: '24 Oct',
    store: 'Mumbai Store',
    utr: 'HDFC2410245',
    fee: '₹9,880',
    st: 'Settled',
    stCl: 'g',
    amt: '₹6,95,100',
  },
  {
    cycle: '21 Oct',
    store: 'D2C Store',
    utr: 'ICIC2110212',
    fee: '₹7,240',
    st: 'Settled',
    stCl: 'g',
    amt: '₹5,10,880',
  },
  {
    cycle: '18 Oct',
    store: 'Pune Store',
    utr: 'HDFC1810181',
    fee: '₹4,010',
    st: 'Settled',
    stCl: 'g',
    amt: '₹2,87,400',
  },
];

export const PaymentsView: React.FC = () => {
  const { showToast } = useDashboard();

  return (
    <>
      <div className="g g4">
        <KpiCard
          icon="₹"
          label="Collected"
          value="₹61.2L"
          sub="This month"
          variant="dk"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="◔"
          label="Success rate"
          value="94.1%"
          sub="UPI 96% · Cards 91%"
          variant="bl"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="⏱"
          label="Next settlement"
          value="₹8.4L"
          sub="Arrives 29 Oct"
          sparkline={rs(10)}
        />
        <KpiCard icon="↩" label="Refunds" value="₹1.1L" sub="23 open" sparkline={rs(10)} />
      </div>

      <div className="g g2">
        <div className="card">
          <h3>Settlements</h3>
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Cycle</th>
                  <th>Store</th>
                  <th>UTR</th>
                  <th>Fees</th>
                  <th>Status</th>
                  <th className="n">Amount</th>
                </tr>
              </thead>
              <tbody>
                {SETTLEMENTS.map((s) => (
                  <tr key={s.cycle + s.store} className="r">
                    <td>{s.cycle}</td>
                    <td>{s.store}</td>
                    <td>{s.utr}</td>
                    <td>{s.fee}</td>
                    <td>
                      <span className={`pill ${s.stCl}`}>{s.st}</span>
                    </td>
                    <td className="n">{s.amt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>Gateway health</h3>
          {[
            ['Razorpay', '99.2%', true, 'Healthy'],
            ['PayU', '97.8%', true, 'Healthy'],
            ['Cashfree', '88.4%', false, 'Slow responses on cards'],
          ].map(([gw, pct, ok, desc]) => (
            <div className="row" key={gw as string}>
              <span className="dot" style={{ background: ok ? 'var(--gr)' : 'var(--or)' }} />
              <div>
                {gw}
                <small>{desc as string}</small>
              </div>
              <b>{pct}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="g g2" style={{ marginTop: '14px' }}>
        <div className="card">
          <h3>
            Gateway details
            <em>
              <button className="btn" onClick={() => showToast('Gateway credentials form opened')}>
                Add gateway
              </button>
            </em>
          </h3>
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Gateway</th>
                  <th>Merchant ID</th>
                  <th>Mode</th>
                  <th>Methods</th>
                  <th>MDR</th>
                  <th>Success</th>
                  <th className="n">Webhook</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    'Razorpay',
                    'rzp_live_••••8Kx2',
                    'Live',
                    'g',
                    'UPI, Cards, Netbanking',
                    '1.9%',
                    '99.2%',
                    'Receiving',
                    'g',
                  ],
                  [
                    'PayU',
                    'pu_••••3310',
                    'Live',
                    'g',
                    'Cards, Wallets, EMI',
                    '2.0%',
                    '97.8%',
                    'Receiving',
                    'g',
                  ],
                  [
                    'Cashfree',
                    'cf_••••7721',
                    'Test',
                    'o',
                    'UPI, Cards',
                    '1.8%',
                    '88.4%',
                    'Delayed',
                    'o',
                  ],
                ].map(([gw, mid, mode, modeCl, meth, mdr, succ, wh, whCl]) => (
                  <tr key={gw} className="r">
                    <td>{gw}</td>
                    <td>{mid}</td>
                    <td>
                      <span className={`pill ${modeCl}`}>{mode}</span>
                    </td>
                    <td>{meth}</td>
                    <td>{mdr}</td>
                    <td>{succ}</td>
                    <td className="n">
                      <span className={`pill ${whCl}`}>{wh}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn l" onClick={() => showToast('Razorpay connection tested: OK')}>
              Test connection
            </button>
            <button
              className="btn l"
              onClick={() => showToast('New secret generated. Copy it now.')}
            >
              Rotate secret
            </button>
          </div>
        </div>

        <div className="card">
          <h3>
            Routing rules<em>Top rule wins</em>
          </h3>
          {[
            ['UPI', 'Razorpay', 'Fallback: Cashfree'],
            ['Cards above ₹5,000', 'PayU', 'Fallback: Razorpay'],
            ['Wallets and EMI', 'PayU', 'No fallback'],
            ['Failures above 8% in 15 min', 'Auto-switch', 'Alert sent to Slack'],
          ].map(([rule, gw, sub]) => (
            <div className="row" key={rule}>
              <div>
                {rule}
                <small>{sub}</small>
              </div>
              <b>{gw}</b>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
