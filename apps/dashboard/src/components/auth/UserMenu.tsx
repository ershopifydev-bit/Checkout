import React, { useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDashboard } from '../../context/DashboardContext';

interface UserMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ isOpen, onClose }) => {
  const { user, logout, openLoginModal } = useAuth();
  const { showToast } = useDashboard();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleLogout = () => {
    logout();
    onClose();
    showToast('Signed out successfully');
  };

  const handleSwitch = () => {
    onClose();
    openLoginModal();
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        top: '52px',
        right: '0',
        width: '280px',
        backgroundColor: 'var(--card)',
        borderRadius: '10px',
        border: '1px solid var(--line)',
        boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
        zIndex: 1000,
        padding: '16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'var(--gs, #e0f2fe)',
            color: 'var(--gr, #0369a1)',
            fontWeight: 'bold',
            display: 'grid',
            placeItems: 'center',
            fontSize: '15px',
          }}
        >
          {user ? user.name.slice(0, 2).toUpperCase() : 'TX'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: '14px',
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {user ? user.name : 'Guest User'}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--mut)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {user ? user.email : 'admin@tezvix.internal'}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 10px',
          background: 'var(--bg)',
          borderRadius: '6px',
          marginBottom: '14px',
          fontSize: '12px',
        }}
      >
        <span style={{ color: 'var(--mut)' }}>Access Role</span>
        <span className="pill b" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
          {user?.role || 'SUPER_ADMIN'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          className="btn l"
          onClick={handleSwitch}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '8px 12px',
            fontSize: '13px',
            justifyContent: 'flex-start',
          }}
        >
          🔑 {user ? 'Switch account' : 'Sign in'}
        </button>

        {user && (
          <button
            className="btn l"
            onClick={handleLogout}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 12px',
              fontSize: '13px',
              color: 'var(--red, #ef4444)',
              justifyContent: 'flex-start',
            }}
          >
            🚪 Sign out
          </button>
        )}
      </div>
    </div>
  );
};

