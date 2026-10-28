import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import type { OrderItem } from '../types';

const INITIAL_ORDERS: OrderItem[] = [
  {
    id: '#KW-10482',
    customer: 'Aarav Mehta',
    city: 'Mumbai',
    mode: 'UPI',
    status: 'Paid',
    riskCheck: 'All checks passed',
    riskCheckType: 'g',
    amount: '₹2,499',
  },
  {
    id: '#KW-10481',
    customer: 'Diya Nair',
    city: 'Kochi',
    mode: 'COD',
    status: 'Pending',
    riskCheck: 'High RTO risk',
    riskCheckType: 'o',
    amount: '₹3,150',
  },
  {
    id: '#KW-10480',
    customer: 'Rohan Iyer',
    city: 'Pune',
    mode: 'Card',
    status: 'Paid',
    riskCheck: 'All checks passed',
    riskCheckType: 'g',
    amount: '₹1,899',
  },
  {
    id: '#KW-10479',
    customer: 'Sana Qureshi',
    city: 'Delhi',
    mode: 'COD',
    status: 'Pending',
    riskCheck: 'Address fixed',
    riskCheckType: 'b',
    amount: '₹4,299',
  },
  {
    id: '#KW-10478',
    customer: 'Kabir Rao',
    city: 'Bengaluru',
    mode: 'UPI',
    status: 'Failed',
    riskCheck: 'Retry sent',
    riskCheckType: 'n',
    amount: '₹899',
  },
  {
    id: '#KW-10477',
    customer: 'Meera Joshi',
    city: 'Jaipur',
    mode: 'Wallet',
    status: 'Paid',
    riskCheck: 'All checks passed',
    riskCheckType: 'g',
    amount: '₹2,050',
  },
];

export const OrdersView: React.FC = () => {
  const { showToast } = useDashboard();
  const [filter, setFilter] = useState<'All' | 'Prepaid' | 'COD' | 'Failed'>('All');
  const [selectedId, setSelectedId] = useState<string>('#KW-10482');

  const filteredOrders = INITIAL_ORDERS.filter((o) => {
    if (filter === 'All') return true;
    if (filter === 'COD') return o.mode === 'COD';
    if (filter === 'Prepaid') return o.mode !== 'COD' && o.status === 'Paid';
    if (filter === 'Failed') return o.status === 'Failed';
    return true;
  });

  const selectedOrder = INITIAL_ORDERS.find((o) => o.id === selectedId) || INITIAL_ORDERS[0]!;

  return (
    <div className="g g2">
      <div className="card">
        <div className="chips">
          {(['All', 'Prepaid', 'COD', 'Failed'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
          <span className="sp1" />
          <button className="btn l" onClick={() => showToast('Exporting orders as CSV')}>
            Export
          </button>
        </div>

        <div className="wide">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>City</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Risk check</th>
                <th className="n">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((x) => (
                <tr
                  key={x.id}
                  className={`r ${x.id === selectedId ? 'sel' : ''}`}
                  onClick={() => setSelectedId(x.id)}
                >
                  <td>{x.id}</td>
                  <td>{x.customer}</td>
                  <td>{x.city}</td>
                  <td>{x.mode}</td>
                  <td>
                    <span
                      className={`pill ${x.status === 'Paid' ? 'g' : x.status === 'Failed' ? 'o' : 'n'}`}
                    >
                      {x.status}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${x.riskCheckType}`}>{x.riskCheck}</span>
                  </td>
                  <td className="n">{x.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>
          {selectedOrder.id}
          <em>{selectedOrder.amount}</em>
        </h3>
        <div style={{ color: 'var(--mut)', margin: '4px 0 6px' }}>
          {selectedOrder.customer} · {selectedOrder.city} · {selectedOrder.mode}
        </div>
        <span className={`pill ${selectedOrder.riskCheckType}`}>{selectedOrder.riskCheck}</span>

        <ul className="tl">
          <li>
            Checkout started
            <small>10:02 AM · phone OTP verified</small>
          </li>
          <li>
            Address validated
            <small>Pincode serviceable, COD allowed</small>
          </li>
          <li className={selectedOrder.status === 'Paid' ? '' : 'w'}>
            {selectedOrder.status === 'Paid' ? 'Payment captured' : 'Waiting for payment'}
            <small>
              {selectedOrder.mode} · gateway ref GW-{selectedOrder.id.slice(-4)}
            </small>
          </li>
          <li>
            Synced to Shopify
            <small>Order created in the store</small>
          </li>
        </ul>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' }}>
          <button
            className="btn"
            onClick={() => showToast(`Refund started for ${selectedOrder.id}`)}
          >
            Refund
          </button>
          <button
            className="btn l"
            onClick={() => showToast(`Prepaid link sent to ${selectedOrder.customer}`)}
          >
            Send prepaid link
          </button>
          <button className="btn l" onClick={() => showToast('Re-synced with Shopify')}>
            Re-sync
          </button>
        </div>
      </div>
    </div>
  );
};
