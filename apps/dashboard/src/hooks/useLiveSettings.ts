import { useState, useEffect, useCallback } from 'react';
import type { CheckoutSettings } from '../types';

export const defaultSettings: CheckoutSettings = {
  shop: 'demo.myshopify.com',
  brandMode: 'name',
  brandName: 'Tezvix Store',
  logoUrl: '',
  requireCodConfirmation: true,
  showUpsell: true,
  giftVouchersEnabled: true,
  giftVoucherVerifyMode: 'pin',
  loyaltyPartnerEnabled: true,
  loyaltyPartnerName: 'Tezvix Rewards',
  loyaltyPointsBalance: 1250,
  payments: { cod: true, upi: false, card: false, netbanking: false },
};

export function useLiveSettings() {
  const [settings, setSettings] = useState<CheckoutSettings>(defaultSettings);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const getAuthQueryAndHeaders = useCallback(() => {
    const p = new URLSearchParams(window.location.search);
    const token =
      p.get('token') ||
      (typeof window !== 'undefined'
        ? window.localStorage.getItem('tezvix_dashboard_token')
        : null) ||
      '';
    const shop = p.get('shop') || '';
    const q =
      token && shop
        ? `?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(token)}`
        : shop
          ? `?shop=${encodeURIComponent(shop)}`
          : '';
    const h: Record<string, string> = {};
    if (token) h['x-dashboard-token'] = token;
    return { q, h, shop, token };
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const { q, h } = getAuthQueryAndHeaders();
      const r = await fetch('/api/settings' + q, {
        credentials: 'same-origin',
        headers: { accept: 'application/json', ...h },
      });
      if (r.status === 401 || r.status === 302) {
        setError('Open from Shopify Admin (App → Tezvix OS) to load live store settings.');
        setSettings(defaultSettings);
        return;
      }
      if (!r.ok) {
        setError(`Could not load settings (${r.status}). Preview mode active.`);
        setSettings(defaultSettings);
        return;
      }
      const data = await r.json();
      setSettings(data);
      setError('');
    } catch {
      setError('Running in standalone preview mode.');
      setSettings(defaultSettings);
    } finally {
      setLoading(false);
    }
  }, [getAuthQueryAndHeaders]);

  const saveSettings = useCallback(
    async (body: Partial<CheckoutSettings>) => {
      const { q, h } = getAuthQueryAndHeaders();
      const r = await fetch('/api/settings' + q, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...h },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(j?.error?.message || `Save failed (${r.status})`);
      }
      setSettings(j);
      setError('');
      return j;
    },
    [getAuthQueryAndHeaders],
  );

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return {
    settings,
    setSettings,
    loading,
    error,
    saveSettings,
    reloadSettings: fetchSettings,
  };
}
