import React, { useState, useEffect } from 'react';
import { useDashboard } from '../context/DashboardContext';

interface TopBarProps {
  shopName?: string | undefined;
}

const SCOPES = ['All brands', 'Nilgiri Tea Co.', 'Kora Apparel', 'Aarav Home'];

export const TopBar: React.FC<TopBarProps> = ({ shopName }) => {
  const { portal, tab, scope, setScope, showToast } = useDashboard();
  const [timeStr, setTimeStr] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      setTimeStr(new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  const merchantLabel = shopName || 'Tezvix Store';
  const scopes = [merchantLabel, 'All brands'];

  return (
    <div className="top">
      <div>
        <div className="crumb" id="crumb">
          {portal === 'm' ? (
            <>
              {merchantLabel} ›{' '}
              <select
                id="sc"
                value={scope}
                aria-label="Brand scope"
                onChange={(e) => {
                  setScope(e.target.value);
                  showToast('Showing ' + e.target.value);
                }}
              >
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>{' '}
              › {tab}
            </>
          ) : (
            <>Admin › {tab}</>
          )}
        </div>
        <h1 id="h1">{tab}</h1>
      </div>

      <div className="status">
        <span className="dot" title="Operational" />
        <span id="clock">{timeStr}</span>
        <span id="stat">
          {portal === 'm' ? `${merchantLabel} · Sync active` : 'Internal Telemetry · Connected'}
        </span>
        <span className="pb" title="Shopify sync health">
          <i style={{ width: '100%' }} />
        </span>
      </div>
    </div>
  );
};
