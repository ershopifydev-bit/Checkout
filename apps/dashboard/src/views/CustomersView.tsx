import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { KpiCard } from '../components/common/KpiCard';
import { useLiveAnalytics } from '../hooks/useLiveAnalytics';

export const CustomersView: React.FC = () => {
  const { showToast } = useDashboard();
  const { data: analytics } = useLiveAnalytics();
  const [blocks, setBlocks] = useState([
    { val: 'Pincode 110099', reason: 'Repeated zero delivery area', term: '30 days' },
  ]);
  const [newVal, setNewVal] = useState('');
  const [reason, setReason] = useState('High RTO risk');

  const funnel = analytics?.funnel;
  const loggedInCount = funnel?.totalLoggedIn || 0;
  const totalStarted = funnel?.totalStarted || 0;
  const abandonedList = analytics?.abandoned || [];
  const knownShoppersCount = abandonedList.filter((a) => Boolean(a.shopperPhone)).length;

  const handleRemove = (val: string) => {
    setBlocks(blocks.filter((b) => b.val !== val));
    showToast(`${val} removed from risk blocklist`);
  };

  const handleAdd = () => {
    if (!newVal.trim()) return;
    setBlocks([...blocks, { val: newVal.trim(), reason, term: 'Permanent' }]);
    setNewVal('');
    showToast(`${newVal} added to risk blocklist`);
  };

  return (
    <>
      <div className="g g4">
        <KpiCard
          icon="☺"
          label="OTP verified shoppers"
          value={String(loggedInCount)}
          sub={`From ${totalStarted} total sessions`}
          variant="dk"
        />
        <KpiCard
          icon="📱"
          label="Identified phones"
          value={String(knownShoppersCount)}
          sub="Stored in checkout session"
          variant="bl"
        />
        <KpiCard
          icon="⚑"
          label="Active blocklist"
          value={String(blocks.length)}
          sub="Blocked for COD"
        />
        <KpiCard icon="↺" label="RTO risk score" value="Normal" sub="No suspicious spikes" />
      </div>

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
            <h3 style={{ margin: 0 }}>RTO & Fraud Risk Blocklist</h3>
            <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
              Phone numbers, pincodes, or IP addresses restricted from placing Cash on Delivery
              (COD) orders
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <input
            type="text"
            placeholder="Add phone (+91...), pincode or IP"
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--line)',
              background: 'var(--card)',
              flex: 1,
              maxWidth: '320px',
            }}
          />
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--line)',
              background: 'var(--card)',
            }}
          >
            <option value="High RTO risk">High RTO risk</option>
            <option value="Fake order attempt">Fake order attempt</option>
            <option value="Unserviceable pincode">Unserviceable pincode</option>
          </select>
          <button className="btn" onClick={handleAdd}>
            + Add block
          </button>
        </div>

        <div className="wide">
          <table>
            <thead>
              <tr>
                <th>Identifier</th>
                <th>Reason</th>
                <th>Duration</th>
                <th className="n">Action</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.val} className="r">
                  <td>
                    <strong>{b.val}</strong>
                  </td>
                  <td>{b.reason}</td>
                  <td>
                    <span className="pill n">{b.term}</span>
                  </td>
                  <td className="n">
                    <button className="btn l" onClick={() => handleRemove(b.val)}>
                      Remove
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
