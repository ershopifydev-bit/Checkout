import React, { useState } from 'react';
import { useLiveOrders } from '../hooks/useLiveOrders';
import { useDashboard } from '../context/DashboardContext';

export const OrdersView: React.FC = () => {
  const { showToast } = useDashboard();
  const { orders, total, loading, error, refresh } = useLiveOrders();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      search === '' ||
      order._id.toLowerCase().includes(search.toLowerCase()) ||
      (order.shopifyOrderName &&
        order.shopifyOrderName.toLowerCase().includes(search.toLowerCase())) ||
      order.shop.toLowerCase().includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === 'All' || order.status.toUpperCase() === statusFilter.toUpperCase();

    return matchesSearch && matchesStatus;
  });

  const handleFlagReview = async (id: string) => {
    try {
      const res = await fetch(`/api/orders/${id}/flag-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        showToast(`Order ${id.slice(0, 8)} flagged for manual review`);
        void refresh();
      } else {
        showToast('Could not flag order');
      }
    } catch {
      showToast('Action failed');
    }
  };

  return (
    <>
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
            <h3 style={{ margin: 0 }}>
              Checkout Order Attempts<em>{total} recorded in MongoDB</em>
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
              Live audit from <code>checkoutOrderAttempts</code> collection
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn" onClick={() => void refresh()}>
              ↻ Refresh
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <input
            type="search"
            placeholder="Search by attempt ID, shop or Shopify order #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--line)',
              background: 'var(--card)',
              flex: 1,
              maxWidth: '380px',
            }}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--line)',
              background: 'var(--card)',
            }}
          >
            <option value="All">All statuses</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="FAILED">FAILED</option>
            <option value="MANUAL_REVIEW">MANUAL_REVIEW</option>
            <option value="CREATING">CREATING</option>
            <option value="VALIDATING">VALIDATING</option>
          </select>
        </div>

        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--mut)' }}>
            Loading order attempts from database...
          </div>
        ) : error ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              color: 'var(--or)',
              background: 'rgba(234, 88, 12, 0.08)',
              borderRadius: '8px',
              margin: '12px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
            }}
          >
            <span>{error}</span>
            <button className="btn l" onClick={() => void refresh()}>
              Retry connection
            </button>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--mut)' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>📦</div>
            <strong>No order attempts found</strong>
            <p style={{ margin: '6px 0 0', fontSize: '13px' }}>
              {search || statusFilter !== 'All'
                ? 'No order attempts match your search criteria.'
                : 'When shoppers place COD orders or trigger checkout attempts, they will be logged here with idempotency keys and Shopify order links.'}
            </p>
          </div>
        ) : (
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Attempt ID</th>
                  <th>Shop</th>
                  <th>Shopify Order</th>
                  <th>Status</th>
                  <th>Created At</th>
                  <th>Error / Note</th>
                  <th className="n">Amount</th>
                  <th className="n">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  let pillClass = 'n';
                  if (order.status === 'CONFIRMED') pillClass = 'g';
                  else if (order.status === 'FAILED') pillClass = 'o';
                  else if (order.status === 'MANUAL_REVIEW') pillClass = 'b';

                  const dateFormatted = order.createdAt
                    ? new Date(order.createdAt).toLocaleString('en-IN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—';

                  return (
                    <tr key={order._id} className="r">
                      <td>
                        <code title={order._id}>{order._id.slice(0, 16)}...</code>
                      </td>
                      <td>{order.shop}</td>
                      <td>
                        <strong>{order.shopifyOrderName || '—'}</strong>
                      </td>
                      <td>
                        <span className={`pill ${pillClass}`}>{order.status}</span>
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--mut)' }}>{dateFormatted}</td>
                      <td style={{ fontSize: '12px', color: 'var(--mut)', maxWidth: '200px' }}>
                        {order.lastErrorMessage ||
                          (order.status === 'CONFIRMED' ? 'Synced with Shopify' : '—')}
                      </td>
                      <td className="n">
                        <strong>{order.formattedAmount}</strong>
                      </td>
                      <td className="n">
                        {order.status !== 'CONFIRMED' && order.status !== 'MANUAL_REVIEW' && (
                          <button
                            className="btn"
                            style={{ fontSize: '11px', padding: '2px 8px' }}
                            onClick={() => void handleFlagReview(order._id)}
                          >
                            Flag review
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
