import React, { useEffect } from 'react';
import { useDashboard } from './context/DashboardContext';
import { useLiveSettings } from './hooks/useLiveSettings';
import { Header } from './components/Header';
import { TopBar } from './components/TopBar';
import { Rail } from './components/Rail';
import { Toast } from './components/Toast';

import { DashboardView } from './views/DashboardView';
import { OrdersView } from './views/OrdersView';
import { AbandonedView } from './views/AbandonedView';
import { CheckoutView } from './views/CheckoutView';
import { PaymentsView } from './views/PaymentsView';
import { LogisticsView } from './views/LogisticsView';
import { CustomersView } from './views/CustomersView';
import { DiscountsView } from './views/DiscountsView';
import { StoresView } from './views/StoresView';
import { IntegrationsView } from './views/IntegrationsView';
import { ReportsView } from './views/ReportsView';
import { TeamView } from './views/TeamView';
import { SettingsView } from './views/SettingsView';

import { OverviewView } from './views/admin/OverviewView';
import { MerchantsView } from './views/admin/MerchantsView';
import { OnboardingView } from './views/admin/OnboardingView';
import { ReportRequestsView } from './views/admin/ReportRequestsView';

export const App: React.FC = () => {
  const { tab, portal, showToast } = useDashboard();
  const { settings, error, saveSettings, reloadSettings } = useLiveSettings();

  useEffect(() => {
    document.title = `Tezvix OS – ${tab}`;
  }, [tab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        showToast('Quick search: type store or order #');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showToast]);

  const renderActiveView = () => {
    if (portal === 'i') {
      switch (tab) {
        case 'Overview':
          return <OverviewView />;
        case 'Merchants':
          return <MerchantsView />;
        case 'Onboarding':
          return <OnboardingView />;
        case 'Report requests':
          return <ReportRequestsView />;
        default:
          return <OverviewView />;
      }
    }

    switch (tab) {
      case 'Dashboard':
        return <DashboardView />;
      case 'Orders':
        return <OrdersView />;
      case 'Abandoned':
        return <AbandonedView />;
      case 'Checkout':
        return (
          <CheckoutView
            settings={settings}
            onSavePayments={async (pays) => saveSettings({ payments: pays })}
          />
        );
      case 'Payments':
        return <PaymentsView />;
      case 'Logistics':
        return <LogisticsView />;
      case 'Customers':
        return <CustomersView />;
      case 'Discounts':
        return <DiscountsView />;
      case 'Stores':
        return <StoresView />;
      case 'Integrations':
        return <IntegrationsView />;
      case 'Reports':
        return <ReportsView />;
      case 'Team':
        return <TeamView />;
      case 'Settings':
        return (
          <SettingsView
            settings={settings}
            error={error}
            onSave={saveSettings}
            onReload={reloadSettings}
          />
        );
      default:
        return <DashboardView />;
    }
  };

  return (
    <>
      <Rail />
      <div className="wrap">
        <Header shopName={settings.shop} />
        <TopBar shopName={settings.shop} />
        <main id="view">{renderActiveView()}</main>
      </div>
      <Toast />
    </>
  );
};
