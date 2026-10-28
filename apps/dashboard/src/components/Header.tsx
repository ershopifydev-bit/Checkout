import React from 'react';
import { useDashboard } from '../context/DashboardContext';
import type { NavItem } from '../types';

interface HeaderProps {
  shopName?: string | undefined;
}

const NAV_CONFIG: Record<'m' | 'i', NavItem[]> = {
  m: [
    ['Dashboard', 0],
    ['Orders', 3],
    ['Abandoned', 12],
    ['Checkout', 0],
    ['Payments', 1],
    ['Logistics', 2],
    ['Customers', 0],
    ['Discounts', 0],
    ['Stores', 0],
    ['Integrations', 1],
    ['Reports', 0],
    ['Team', 0],
    ['Settings', 0],
  ],
  i: [
    ['Overview', 0],
    ['Merchants', 0],
    ['Onboarding', 3],
    ['Report requests', 5],
  ],
};

export const Header: React.FC<HeaderProps> = ({ shopName }) => {
  const { portal, setPortal, tab, setTab, showToast } = useDashboard();
  const navList = NAV_CONFIG[portal];
  const brandLabel = shopName || 'Tezvix Store';

  return (
    <header>
      <button
        className="logo"
        onClick={() => setTab(portal === 'm' ? 'Dashboard' : 'Overview')}
        title="Tezvix OS"
      >
        <b>✓</b>
        <span>
          Tezvix
          <small id="who">{portal === 'm' ? brandLabel : 'Internal console'}</small>
        </span>
      </button>

      <nav id="nav" aria-label="Sections">
        {navList.map(([name, count]) => (
          <button key={name} className={tab === name ? 'on' : ''} onClick={() => setTab(name)}>
            {name}
            {count > 0 && <span className="bd">{count}</span>}
          </button>
        ))}
      </nav>

      <div className="sp1" />

      <div className="seg" id="portal">
        <button className={portal === 'm' ? 'on' : ''} onClick={() => setPortal('m')}>
          Merchant
        </button>
        <button className={portal === 'i' ? 'on' : ''} onClick={() => setPortal('i')}>
          In-house team
        </button>
      </div>

      <div className="ic" title="Notifications" onClick={() => showToast('No unread alerts')}>
        🔔
        <i />
      </div>

      <div
        className="av"
        title="Account profile"
        onClick={() => showToast('Logged in as Administrator')}
      >
        TX
      </div>
    </header>
  );
};
