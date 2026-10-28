import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { PortalType, ConnectorItem } from '../types';

interface DashboardContextType {
  portal: PortalType;
  setPortal: (p: PortalType) => void;
  tab: string;
  setTab: (t: string) => void;
  scope: string;
  setScope: (s: string) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  toastMsg: string;
  showToast: (m: string) => void;
  connectors: ConnectorItem[];
  toggleConnector: (idx: number) => void;
}

const initialConnectors: ConnectorItem[] = [
  { name: 'Shopify', description: 'Orders, products and discounts sync', connected: true },
  { name: 'Razorpay', description: 'Payments and refunds', connected: true },
  { name: 'Shiprocket', description: 'Courier aggregator', connected: true },
  { name: 'Delhivery', description: 'Direct courier', connected: false },
  { name: 'WhatsApp (Gupshup)', description: 'Recovery and order updates', connected: true },
  { name: 'Klaviyo', description: 'Email and segments', connected: false },
  { name: 'Meta Pixel', description: 'Server-side purchase events', connected: true },
  { name: 'Google Analytics 4', description: 'Checkout funnel events', connected: true },
  { name: 'Zoho Books', description: 'Invoices and ledger', connected: false },
  { name: 'Slack', description: 'Alerts for failures', connected: false },
];

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export const DashboardProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [portal, setPortal] = useState<PortalType>('m');
  const [tab, setTab] = useState<string>('Dashboard');
  const [scope, setScope] = useState<string>('All brands');
  const [connectors, setConnectors] = useState<ConnectorItem[]>(initialConnectors);
  const [toastMsg, setToastMsg] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
      setTheme('dark');
      document.documentElement.dataset['theme'] = 'dark';
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset['theme'] = next;
    showToast(`${next === 'dark' ? 'Dark' : 'Light'} theme active`);
  };

  const showToast = (m: string) => {
    setToastMsg(m);
  };

  const toggleConnector = (idx: number) => {
    setConnectors((prev) => {
      const copy = [...prev];
      const item = copy[idx];
      if (item) {
        item.connected = !item.connected;
        showToast(`${item.name} ${item.connected ? 'connected' : 'disconnected'}`);
      }
      return copy;
    });
  };

  return (
    <DashboardContext.Provider
      value={{
        portal,
        setPortal: (p) => {
          setPortal(p);
          setTab(p === 'm' ? 'Dashboard' : 'Overview');
        },
        tab,
        setTab,
        scope,
        setScope,
        theme,
        toggleTheme,
        toastMsg,
        showToast,
        connectors,
        toggleConnector,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
};

export const useDashboard = () => {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
};
