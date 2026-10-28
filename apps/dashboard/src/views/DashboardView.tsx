import React from 'react';
import { KpiCard } from '../components/common/KpiCard';

const rs = (n: number) =>
  [...Array(n)].map((_, i) => Math.round(50 + 30 * Math.sin(i * 0.9) + ((i * 37) % 17)));

export const DashboardView: React.FC = () => {
  const todayStr = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();

  const areaDataA = [90, 70, 75, 110, 150, 190, 220, 200, 170, 150, 130, 100];
  const areaDataB = [40, 32, 36, 50, 70, 88, 103, 95, 80, 70, 62, 48];
  const months = [
    'Dec',
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
  ];

  const width = 640;
  const height = 190;
  const maxVal = 250;

  const pointsA = areaDataA
    .map(
      (v, i) =>
        `${((i * width) / (areaDataA.length - 1)).toFixed(0)},${(height - (v / maxVal) * height).toFixed(0)}`,
    )
    .join(' ');
  const pointsB = areaDataB
    .map(
      (v, i) =>
        `${((i * width) / (areaDataB.length - 1)).toFixed(0)},${(height - (v / maxVal) * height).toFixed(0)}`,
    )
    .join(' ');

  return (
    <>
      <div className="g g2">
        <div className="card hero">
          <small>{todayStr}</small>
          <h2>Good day, Partner.</h2>
          <div style={{ color: 'var(--mut)', maxWidth: '430px' }}>
            212 orders placed today, 3 shipments need an address fix and 1 store has a slow payment
            gateway.
          </div>
          <svg viewBox="0 0 520 40" width="100%" style={{ marginTop: '18px' }}>
            <line x1="0" y1="20" x2="520" y2="20" stroke="var(--line)" strokeWidth="2" />
            <line x1="0" y1="20" x2="330" y2="20" stroke="var(--blue)" strokeWidth="2" />
            {[40, 80, 120, 190, 230, 300].map((x, i) => (
              <circle key={x} cx={x} cy="20" r="5" fill={i % 2 ? 'var(--or)' : 'var(--blue)'} />
            ))}
            <circle cx="330" cy="20" r="6" fill="none" stroke="var(--or)" strokeWidth="2" />
          </svg>
        </div>

        <div className="card">
          <h3>
            Pending settlement<em>View payments</em>
          </h3>
          <div className="kv" style={{ fontSize: '32px' }}>
            ₹8,42,300
          </div>
          <span className="pill g">+₹2.1L in 14 days</span>
          <svg viewBox="0 0 200 60" width="100%" style={{ marginTop: '10px' }}>
            {rs(14).map((v, i) => (
              <rect
                key={i}
                x={i * 14.2}
                y={i % 4 === 3 ? 30 : 30 - v / 4}
                width="10"
                height={i % 4 === 3 ? v / 5 : v / 4}
                rx="2"
                fill={i % 4 === 3 ? 'var(--or)' : 'var(--gr)'}
              />
            ))}
          </svg>
        </div>
      </div>

      <div className="g g4">
        <KpiCard
          icon="₹"
          label="GMV this month"
          value="₹93.4L"
          sub="11 days in · pace for ₹2.5Cr"
          variant="dk"
          sparkline={rs(12)}
        />
        <KpiCard
          icon="◔"
          label="Checkout conversion"
          value="41.8%"
          sub="↗ 3.2 pts vs last week"
          variant="bl"
          sparkline={rs(12)}
        />
        <KpiCard
          icon="▤"
          label="Prepaid share"
          value="68%"
          sub="COD 32% · was 38%"
          sparkline={rs(12)}
        />
        <KpiCard
          icon="↺"
          label="RTO rate"
          value="9.2%"
          sub="▲ 1.1 pts from September"
          sparkline={rs(12).reverse()}
        />
      </div>

      <div className="g g2">
        <div className="card">
          <h3>
            Revenue and cost of goods<em>Last 12 months</em>
          </h3>
          <svg
            viewBox={`0 0 ${width} ${height + 24}`}
            width="100%"
            role="img"
            aria-label="Revenue and cost of goods by month"
          >
            <polygon
              points={`0,${height} ${pointsA} ${width},${height}`}
              fill="var(--bs)"
              opacity=".7"
            />
            <polyline points={pointsA} fill="none" stroke="var(--blue)" strokeWidth="2.4" />
            <polyline
              points={pointsB}
              fill="none"
              stroke="var(--mut)"
              strokeWidth="2"
              strokeDasharray="5 4"
            />
            {months.map((m, i) => (
              <text
                key={m}
                x={(i * width) / 11}
                y={height + 18}
                fontSize="11"
                fill="var(--mut)"
                textAnchor={i === 0 ? 'start' : i === 11 ? 'end' : 'middle'}
              >
                {m}
              </text>
            ))}
          </svg>
        </div>

        <div className="card">
          <h3>
            Checkout funnel<em>Today</em>
          </h3>
          {[
            ['Cart viewed', 100, '5,820'],
            ['Address added', 72, '4,190'],
            ['Payment started', 55, '3,200'],
            ['Order placed', 42, '2,430'],
          ].map(([stage, pct, count]) => (
            <div className="bar" key={stage as string}>
              <span>{stage}</span>
              <div>
                <i style={{ width: `${pct}%` }} />
              </div>
              <b>{count}</b>
            </div>
          ))}
          <div style={{ color: 'var(--mut)', fontSize: '12px', marginTop: '12px' }}>
            Biggest drop is cart to address (28%). A phone-first OTP login lifts completion by up to
            14%.
          </div>
        </div>
      </div>

      <div className="card">
        <h3>
          Orders that need a look<em>3 open</em>
        </h3>
        <div className="wide">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Mode</th>
                <th>Risk check</th>
                <th className="n">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="r">
                <td>#KW-10481</td>
                <td>Diya Nair</td>
                <td>COD</td>
                <td>
                  <span className="pill o">High RTO risk</span>
                </td>
                <td className="n">₹3,150</td>
              </tr>
              <tr className="r">
                <td>#KW-10479</td>
                <td>Sana Qureshi</td>
                <td>COD</td>
                <td>
                  <span className="pill b">Address fixed</span>
                </td>
                <td className="n">₹4,299</td>
              </tr>
              <tr className="r">
                <td>#KW-10478</td>
                <td>Kabir Rao</td>
                <td>UPI</td>
                <td>
                  <span className="pill n">Retry sent</span>
                </td>
                <td className="n">₹899</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};
