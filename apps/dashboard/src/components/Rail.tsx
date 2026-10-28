import React from 'react';
import { useDashboard } from '../context/DashboardContext';

export const Rail: React.FC = () => {
  const { toggleTheme, setTab, setPortal, showToast } = useDashboard();

  return (
    <div className="rail" aria-label="Quick actions">
      <button title="Search (⌘K)" id="rs" onClick={() => showToast('Search opens with ⌘K')}>
        ⌕
      </button>
      <button
        title="New store"
        id="rn"
        onClick={() => {
          setPortal('m');
          setTab('Stores');
          showToast('Add a store from the Stores tab');
        }}
      >
        +
      </button>
      <button title="Toggle light/dark theme" id="rt" onClick={toggleTheme}>
        ◐
      </button>
      <button
        title="Help & documentation"
        id="rh"
        onClick={() => showToast('Help centre opens here')}
      >
        ?
      </button>
    </div>
  );
};
