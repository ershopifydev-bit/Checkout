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
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers['authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/orders?limit=50', {
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
    } catch {
      setError('Orders service offline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  return { orders, total, loading, error, refresh: fetchOrders };
}
