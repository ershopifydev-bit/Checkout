import React from 'react';
import { useDashboard } from '../context/DashboardContext';
import { useAuth } from '../context/AuthContext';

export const Rail: React.FC = () => {
  const { toggleTheme, setTab, setPortal, showToast } = useDashboard();
  const { user, logout, openLoginModal } = useAuth();

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

      <button
        title={user ? `Logout (${user.name} – ${user.role})` : 'Sign in to Tezvix OS'}
        id="rl"
        onClick={() => {
          if (user) {
            logout();
            showToast('Signed out successfully');
          } else {
            openLoginModal();
          }
        }}
        style={{
          marginTop: 'auto',
          color: user ? 'var(--red, #ef4444)' : 'var(--blue, #3b82f6)',
        }}
      >
        {user ? '🚪' : '🔑'}
      </button>
    </div>
  );
};
