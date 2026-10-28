import React from 'react';
import { useDashboard } from '../context/DashboardContext';

const REPORTS = [
  ['Daily sales', 'Orders and revenue by store'],
  ['Settlement report', 'Payouts, fees and UTRs'],
  ['RTO report', 'Returns by pincode and courier'],
  ['Abandoned carts', 'Drop-off stage and recovery'],
  ['Coupon usage', 'Redemptions and discount cost'],
  ['Payment performance', 'Success rate by method and bank'],
];

export const ReportsView: React.FC = () => {
  const { showToast } = useDashboard();

  return (
    <>
      <div className="g g3">
        {REPORTS.map(([title, desc]) => (
          <div className="card" key={title}>
            <h3>{title}</h3>
            <div style={{ color: 'var(--mut)', margin: '6px 0 14px' }}>{desc}</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn" onClick={() => showToast(`${title} is downloading`)}>
                Download
              </button>
              <button
                className="btn l"
                onClick={() => showToast(`${title} scheduled for Monday 9 AM`)}
              >
                Schedule
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>
          Need something custom?<em>Your account manager replies within a day</em>
        </h3>
        <div style={{ margin: '10px 0' }}>
          <button className="btn" onClick={() => showToast('Request sent to your account manager')}>
            Request a report
          </button>
        </div>
      </div>
    </>
  );
};
