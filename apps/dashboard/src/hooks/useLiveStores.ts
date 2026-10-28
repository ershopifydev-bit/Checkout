import { useState, useEffect, useCallback } from 'react';
import type { StoreItem } from '../types';

export function useLiveStores() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams(window.location.search);
      const token = p.get('token') || '';
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers['authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/stores', {
        credentials: 'same-origin',
        headers,
      });

      if (!res.ok) {
        setError(`Could not load stores (${res.status})`);
        return;
      }

      const json = await res.json();
      setStores(json.stores || []);
      setTotal(json.total || 0);
      setError('');
    } catch {
      setError('Stores service offline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStores();
  }, [fetchStores]);

  return { stores, total, loading, error, refresh: fetchStores };
}
