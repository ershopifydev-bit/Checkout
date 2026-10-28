import { useState, useEffect, useCallback } from 'react';

export type FunnelStats = {
  shop: string;
  totalStarted: number;
  totalLoggedIn: number;
  totalAddressAdded: number;
  totalDiscountApplied: number;
  totalCompleted: number;
  totalAbandoned: number;
  conversionRatePercent: number;
  dropOffByStep: {
    login: number;
    address: number;
    discounts: number;
    payment: number;
  };
};

export type AbandonedCheckoutSummary = {
  sessionId: string;
  shopperPhone?: string;
  shopperName?: string;
  cartValueMinor: number;
  itemCount: number;
  items: Array<{ title: string; quantity: number; amountMinor: number }>;
  droppedAt: string;
  updatedAt: string;
  createdAt: string;
};

export type LiveAnalyticsData = {
  shop: string;
  funnel: FunnelStats;
  abandoned: AbandonedCheckoutSummary[];
};

export function useLiveAnalytics() {
  const [data, setData] = useState<LiveAnalyticsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams(window.location.search);
      const token = p.get('token') || '';
      const shop = p.get('shop') || '';
      const q =
        token && shop
          ? `?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(token)}`
          : shop
            ? `?shop=${encodeURIComponent(shop)}`
            : '';
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers['x-dashboard-token'] = token;

      const res = await fetch('/api/analytics' + q, {
        credentials: 'same-origin',
        headers,
      });

      if (!res.ok) {
        setError('Could not load live analytics.');
        return;
      }

      const json = await res.json();
      setData(json);
      setError('');
    } catch {
      setError('Analytics in preview mode.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  return { data, loading, error, refresh: fetchAnalytics };
}
