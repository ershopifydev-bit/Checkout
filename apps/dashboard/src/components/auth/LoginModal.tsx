import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDashboard } from '../../context/DashboardContext';

export const LoginModal: React.FC = () => {
  const { isLoginModalOpen, closeLoginModal, login, user } = useAuth();
  const { showToast } = useDashboard();
  const [email, setEmail] = useState('admin@tezvix.internal');
  const [password, setPassword] = useState('Admin@123456');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (!isLoginModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.success) {
        showToast('Signed in successfully');
      } else {
        setErrorMessage(result.error || 'Authentication failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleFillAdmin = () => {
    setEmail('admin@tezvix.internal');
    setPassword('Admin@123456');
    setErrorMessage('');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && user) {
          closeLoginModal();
        }
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '440px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          borderRadius: '12px',
          border: '1px solid var(--line)',
          backgroundColor: 'var(--card)',
          padding: '28px',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <img src="./branding/tezvix-symbol.svg" alt="" width="32" height="32" />
              <h2 style={{ margin: 0, fontSize: '20px' }}>Tezvix OS Sign In</h2>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--mut)' }}>
              Manage checkout overlay, stores, settings and real database audit.
            </p>
          </div>
          {user && (
            <button
              onClick={closeLoginModal}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                color: 'var(--mut)',
              }}
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ margin: '16px 0 20px' }}>
          <button
            type="button"
            className="btn l"
            onClick={handleFillAdmin}
            style={{
              width: '100%',
              fontSize: '12px',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              background: 'rgba(59, 130, 246, 0.08)',
              color: 'var(--blue)',
              borderColor: 'rgba(59, 130, 246, 0.3)',
            }}
          >
            🔑 Fill Default Super Admin (<code>admin@tezvix.internal</code>)
          </button>
        </div>

        {errorMessage && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '6px',
              background: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--red, #ef4444)',
              fontSize: '13px',
              marginBottom: '16px',
              border: '1px solid rgba(239, 68, 68, 0.2)',
            }}
          >
            {errorMessage}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <div>
            <label
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}
            >
              Work Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid var(--line)',
                background: 'var(--bg)',
                color: 'var(--ink)',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}
            >
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid var(--line)',
                background: 'var(--bg)',
                color: 'var(--ink)',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginTop: '8px', display: 'flex', gap: '10px' }}>
            <button
              type="submit"
              className="btn"
              disabled={submitting}
              style={{
                flex: 1,
                padding: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontWeight: 600,
              }}
            >
              {submitting ? 'Authenticating...' : 'Sign In'}
            </button>
            {user && (
              <button
                type="button"
                className="btn l"
                onClick={closeLoginModal}
                style={{ padding: '10px 16px' }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
