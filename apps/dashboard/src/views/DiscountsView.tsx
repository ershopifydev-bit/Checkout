import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';

export const DiscountsView: React.FC = () => {
  const { showToast } = useDashboard();
  const [coupons, setCoupons] = useState([
    {
      code: 'WELCOME10',
      offer: '10% off first order',
      used: '1,240',
      applies: 'All brands',
      active: true,
    },
    {
      code: 'UPI50',
      offer: '₹50 off on UPI',
      used: '3,880',
      applies: 'Nilgiri Tea Co.',
      active: true,
    },
    {
      code: 'FESTIVE20',
      offer: '20% off above ₹2,000',
      used: '612',
      applies: 'Kora Apparel',
      active: false,
    },
    {
      code: 'FREESHIP',
      offer: 'Free shipping above ₹999',
      used: '2,104',
      applies: 'All brands',
      active: true,
    },
  ]);

  const [newCode, setNewCode] = useState('DIWALI15');
  const [newDisc, setNewDisc] = useState('15%');
  const [newMin, setNewMin] = useState('₹1,500');
  const [newLimit, setNewLimit] = useState('500');

  const toggleCoupon = (idx: number) => {
    setCoupons((prev) => {
      const copy = [...prev];
      const item = copy[idx];
      if (item) {
        item.active = !item.active;
        showToast(`${item.code} ${item.active ? 'activated' : 'deactivated'}`);
      }
      return copy;
    });
  };

  const handleCreate = () => {
    if (!newCode) return;
    setCoupons([
      ...coupons,
      {
        code: newCode,
        offer: `${newDisc} off above ${newMin}`,
        used: '0',
        applies: 'All brands',
        active: true,
      },
    ]);
    showToast(`Coupon ${newCode} created`);
  };

  return (
    <div className="g g2">
      <div className="card">
        <h3>
          Coupons<em>Synced to Shopify discount codes</em>
        </h3>
        <div className="wide">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Offer</th>
                <th>Used</th>
                <th>Applies to</th>
                <th className="n">Active</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c, i) => (
                <tr key={c.code} className="r">
                  <td>{c.code}</td>
                  <td>{c.offer}</td>
                  <td>{c.used}</td>
                  <td>{c.applies}</td>
                  <td className="n">
                    <button
                      className={`tg ${c.active ? 'on' : ''}`}
                      role="switch"
                      aria-checked={c.active}
                      onClick={() => toggleCoupon(i)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>New coupon</h3>
        <div className="fld">
          Code
          <input value={newCode} onChange={(e) => setNewCode(e.target.value)} />
        </div>
        <div className="fld">
          Discount
          <input value={newDisc} onChange={(e) => setNewDisc(e.target.value)} />
        </div>
        <div className="fld">
          Minimum cart
          <input value={newMin} onChange={(e) => setNewMin(e.target.value)} />
        </div>
        <div className="fld">
          Usage limit
          <input value={newLimit} onChange={(e) => setNewLimit(e.target.value)} />
        </div>
        <button className="btn" style={{ marginTop: '14px' }} onClick={handleCreate}>
          Create coupon
        </button>
      </div>
    </div>
  );
};
