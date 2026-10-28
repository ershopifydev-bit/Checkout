import React from 'react';
import { useDashboard } from '../context/DashboardContext';
import { KpiCard } from '../components/common/KpiCard';

const rs = (n: number) =>
  [...Array(n)].map((_, i) => Math.round(50 + 30 * Math.sin(i * 0.9) + ((i * 37) % 17)));

const NDR_REPORTS = [
  {
    awb: 'BD88213',
    cust: 'Diya Nair',
    reason: 'Customer not available',
    att: '2',
    toastMsg: 'Reattempt scheduled',
    btnLabel: 'Reattempt',
  },
  {
    awb: 'XB44102',
    cust: 'Kabir Rao',
    reason: 'Address incomplete',
    att: '1',
    toastMsg: 'Address request sent on WhatsApp',
    btnLabel: 'Ask address',
  },
  {
    awb: 'DL90311',
    cust: 'Sana Qureshi',
    reason: 'Refused COD',
    att: '1',
    toastMsg: 'Prepaid link sent',
    btnLabel: 'Offer prepaid',
  },
];

export const LogisticsView: React.FC = () => {
  const { showToast } = useDashboard();

  return (
    <>
      <div className="g g4">
        <KpiCard
          icon="▣"
          label="Delivered"
          value="91%"
          sub="↘ 2 pts vs October"
          variant="dk"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="➜"
          label="In transit"
          value="1,204"
          sub="Avg 3.4 days"
          variant="bl"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="↺"
          label="RTO"
          value="9.2%"
          sub="₹2.6L estimated loss"
          sparkline={rs(10).reverse()}
        />
        <KpiCard
          icon="!"
          label="NDR open"
          value="38"
          sub="12 need a call today"
          sparkline={rs(10)}
        />
      </div>

      <div className="card">
        <h3>
          Non-delivery reports<em>Act before courier return</em>
        </h3>
        <div className="wide">
          <table>
            <thead>
              <tr>
                <th>AWB</th>
                <th>Customer</th>
                <th>Reason</th>
                <th>Attempts</th>
                <th className="n">Action</th>
              </tr>
            </thead>
            <tbody>
              {NDR_REPORTS.map((r) => (
                <tr key={r.awb} className="r">
                  <td>{r.awb}</td>
                  <td>{r.cust}</td>
                  <td>{r.reason}</td>
                  <td>{r.att}</td>
                  <td className="n">
                    <button className="btn l" onClick={() => showToast(r.toastMsg)}>
                      {r.btnLabel}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};
