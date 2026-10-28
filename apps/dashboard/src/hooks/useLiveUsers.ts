import { useState, useEffect, useCallback } from 'react';
import type { TeamUserItem } from '../types';

export function useLiveUsers() {
  const [users, setUsers] = useState<TeamUserItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams(window.location.search);
      const token = p.get('token') || '';
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers['authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/users', {
        credentials: 'same-origin',
        headers,
      });

      if (!res.ok) {
        setError(`Could not load team users (${res.status})`);
        return;
      }

      const json = await res.json();
      setUsers(json.users || []);
      setTotal(json.total || 0);
      setError('');
    } catch {
      setError('Users service offline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  return { users, total, loading, error, refresh: fetchUsers };
}
