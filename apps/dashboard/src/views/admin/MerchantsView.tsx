import React from 'react';
import { useDashboard } from '../../context/DashboardContext';

export const MerchantsView: React.FC = () => {
  const { showToast } = useDashboard();

  return (
    <div className="card">
      <h3>
        Merchant directory
        <em>
          <button
            className="btn"
            onClick={() => showToast('Viewing as Sahyadri Group, read-only for 30 min')}
          >
            View as merchant
          </button>
        </em>
      </h3>
      <div style={{ height: '8px' }} />
      <div className="wide">
        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Brands</th>
              <th>Stores</th>
              <th>Manager</th>
              <th>Plan</th>
              <th className="n">GMV, 30 days</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Sahyadri Group', '3', '4', 'Noor H.', 'Growth', 'b', '₹3.1Cr'],
              ['Brightleaf Foods', '2', '2', 'Erin C.', 'Scale', 'g', '₹1.8Cr'],
              ['Urban Looms', '1', '1', 'Tom L.', 'Starter', 'n', '₹42L'],
              ['Kestrel Sports', '4', '6', 'Noor H.', 'Scale', 'g', '₹2.6Cr'],
            ].map(([m, b, s, mgr, plan, planCl, gmv]) => (
              <tr key={m} className="r">
                <td>{m}</td>
                <td>{b}</td>
                <td>{s}</td>
                <td>{mgr}</td>
                <td>
                  <span className={`pill ${planCl}`}>{plan}</span>
                </td>
                <td className="n">{gmv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
