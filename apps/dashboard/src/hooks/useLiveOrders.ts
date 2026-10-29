import { useState, useEffect, useCallback } from 'react';
import type { OrderAttemptRecord } from '../types';

export function useLiveOrders() {
  const [orders, setOrders] = useState<OrderAttemptRecord[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams(window.location.search);
      const token = p.get('token') || '';
      const shop = p.get('shop') || '';
      const q =
        token && shop
          ? `?limit=50&shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(token)}`
          : shop
            ? `?limit=50&shop=${encodeURIComponent(shop)}`
            : '?limit=50';
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) {
        headers['authorization'] = `Bearer ${token}`;
        headers['x-dashboard-token'] = token;
      }

      const res = await fetch('/api/orders' + q, {
        credentials: 'same-origin',
        headers,
      });

      if (!res.ok) {
        setError(`Could not load orders (${res.status})`);
        return;
      }

      const json = await res.json();
      setOrders(json.orders || []);
      setTotal(json.total || 0);
      setError('');
    } catch (err) {
      console.error('Failed to load orders:', err);
      setError('Orders service offline or unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  return { orders, total, loading, error, refresh: fetchOrders };
}
