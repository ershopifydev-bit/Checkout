import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { KpiCard } from '../components/common/KpiCard';

const rs = (n: number) =>
  [...Array(n)].map((_, i) => Math.round(50 + 30 * Math.sin(i * 0.9) + ((i * 37) % 17)));

export const CustomersView: React.FC = () => {
  const { showToast } = useDashboard();
  const [blocks, setBlocks] = useState([
    { val: '98•••• 1144', reason: 'Fake orders', term: 'Permanent' },
    { val: 'Pincode 110099', reason: 'Zero deliveries', term: '30 days' },
    { val: 'IP 49.36.•••', reason: 'Card testing', term: '7 days' },
  ]);
  const [newVal, setNewVal] = useState('');

  const handleRemove = (val: string) => {
    setBlocks(blocks.filter((b) => b.val !== val));
    showToast(`${val} removed from blocklist`);
  };

  const handleAdd = () => {
    if (!newVal.trim()) return;
    setBlocks([...blocks, { val: newVal.trim(), reason: 'Manual block', term: 'Permanent' }]);
    setNewVal('');
    showToast('Added to blocklist');
  };

  return (
    <>
      <div className="g g4">
        <KpiCard
          icon="☺"
          label="Customers"
          value="48,210"
          sub="+1,420 this month"
          variant="dk"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="↻"
          label="Repeat rate"
          value="31%"
          sub="↗ 2 pts vs September"
          variant="bl"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="₹"
          label="Average lifetime value"
          value="₹4,180"
          sub="Across all brands"
          sparkline={rs(10)}
        />
        <KpiCard
          icon="⚑"
          label="High RTO risk"
          value="612"
          sub="Prepaid only or blocked"
          sparkline={rs(10).reverse()}
        />
      </div>

      <div className="g g2">
        <div className="card">
          <h3>
            Customers<em>Segments: new, repeat, VIP, high RTO risk</em>
          </h3>
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>City</th>
                  <th>Orders</th>
                  <th>COD share</th>
                  <th>Segment</th>
                  <th className="n">Lifetime value</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Aarav Mehta', 'Mumbai', '14', '12%', 'VIP', 'g', '₹28,400'],
                  ['Diya Nair', 'Kochi', '3', '100%', 'High RTO risk', 'o', '₹6,150'],
                  ['Rohan Iyer', 'Pune', '6', '20%', 'Repeat', 'b', '₹11,900'],
                  ['Meera Joshi', 'Jaipur', '1', '0%', 'New', 'n', '₹2,050'],
                ].map(([cust, city, ords, cod, seg, segCl, ltv]) => (
                  <tr key={cust} className="r">
                    <td>{cust}</td>
                    <td>{city}</td>
                    <td>{ords}</td>
                    <td>{cod}</td>
                    <td>
                      <span className={`pill ${segCl}`}>{seg}</span>
                    </td>
                    <td className="n">{ltv}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>Blocklist</h3>
          {blocks.map((b) => (
            <div className="row" key={b.val}>
              <div>
                {b.val}
                <small>
                  {b.reason} · {b.term}
                </small>
              </div>
              <button className="btn l" onClick={() => handleRemove(b.val)}>
                Remove
              </button>
            </div>
          ))}
          <div className="fld">
            Add phone, pincode or IP
            <input
              style={{ width: '140px' }}
              placeholder="Value to block"
              value={newVal}
              onChange={(e) => setNewVal(e.target.value)}
              aria-label="Value to block"
            />
          </div>
          <button className="btn" style={{ marginTop: '10px' }} onClick={handleAdd}>
            Block
          </button>
        </div>
      </div>
    </>
  );
};
