import { useState, useEffect, useCallback } from 'react';
import type { MonitorOverviewData } from '../types';

export function useLiveMonitor() {
  const [data, setData] = useState<MonitorOverviewData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams(window.location.search);
      const token =
        p.get('token') ||
        (typeof window !== 'undefined'
          ? window.localStorage.getItem('tezvix_dashboard_token')
          : null) ||
        '';
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers['authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/monitor/overview', {
        credentials: 'same-origin',
        headers,
      });

      if (!res.ok) {
        setError(`Could not load monitor telemetry (${res.status})`);
        return;
      }

      const json = await res.json();
      setData(json);
      setError('');
    } catch {
      setError('Telemetry service offline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
    // Poll every 30s for live telemetry
    const timer = setInterval(() => {
      void fetchOverview();
    }, 30000);
    return () => clearInterval(timer);
  }, [fetchOverview]);

  return { data, loading, error, refresh: fetchOverview };
}
