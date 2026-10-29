import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDashboard } from '../../context/DashboardContext';

interface DemoAccount {
  role: 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
  name: string;
  email: string;
  pass: string;
  icon: string;
  badgeClass: string;
  desc: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: 'SUPER_ADMIN',
    name: 'Super Admin',
    email: 'admin@tezvix.internal',
    pass: 'Admin@123456',
    icon: '👑',
    badgeClass: 'p',
    desc: 'All scopes & user mgmt',
  },
  {
    role: 'ADMIN',
    name: 'Store Manager',
    email: 'manager@tezvix.internal',
    pass: 'Manager@123456',
    icon: '🛡️',
    badgeClass: 'b',
    desc: 'Settings & store ops',
  },
  {
    role: 'OPERATOR',
    name: 'Ops Lead',
    email: 'operator@tezvix.internal',
    pass: 'Operator@123456',
    icon: '⚙️',
    badgeClass: 'g',
    desc: 'Order review & routing',
  },
  {
    role: 'VIEWER',
    name: 'Data Analyst',
    email: 'viewer@tezvix.internal',
    pass: 'Viewer@123456',
    icon: '👁️',
    badgeClass: 'n',
    desc: 'Read-only analytics',
  },
];

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

  const handleSelectDemo = (acc: DemoAccount) => {
    setEmail(acc.email);
    setPassword(acc.pass);
    setErrorMessage('');
  };

  const handleQuickSignIn = async (acc: DemoAccount) => {
    setEmail(acc.email);
    setPassword(acc.pass);
    setErrorMessage('');
    setSubmitting(true);
    try {
      const result = await login(acc.email, acc.pass);
      if (result.success) {
        showToast(`Signed in as ${acc.name} (${acc.role})`);
      } else {
        setErrorMessage(result.error || 'Authentication failed');
      }
    } finally {
      setSubmitting(false);
    }
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
        if (e.target === e.currentTarget) {
          closeLoginModal();
        }
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '520px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          borderRadius: '12px',
          border: '1px solid var(--line)',
          backgroundColor: 'var(--card)',
          padding: '24px',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <img src="./branding/tezvix-symbol.svg" alt="" width="28" height="28" />
              <h2 style={{ margin: 0, fontSize: '18px' }}>Tezvix OS Sign In</h2>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--mut)' }}>
              Manage checkout overlay, stores, settings and real database audit.
            </p>
          </div>
          <button
            onClick={closeLoginModal}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '18px',
              color: 'var(--mut)',
              padding: '4px',
            }}
            title="Close modal"
          >
            ✕
          </button>
        </div>

        <div style={{ margin: '14px 0 16px' }}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--ink)',
              marginBottom: '4px',
            }}
          >
            ⚡ One-Click Sign In:
          </div>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--mut)',
              marginBottom: '10px',
            }}
          >
            Click any account below to sign in instantly with one click:
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '8px',
            }}
          >
            {DEMO_ACCOUNTS.map((acc) => {
              const isSelected = email === acc.email;
              const isCurrentSubmitting = submitting && isSelected;
              return (
                <div
                  key={acc.role}
                  style={{
                    padding: '10px',
                    borderRadius: '8px',
                    border: isSelected ? '1px solid var(--blue)' : '1px solid var(--line)',
                    background: isSelected ? 'rgba(59, 130, 246, 0.06)' : 'var(--bg)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        justifyContent: 'space-between',
                        marginBottom: '4px',
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                        {acc.icon} {acc.name}
                      </span>
                      <span
                        className={`pill ${acc.badgeClass}`}
                        style={{ fontSize: '9px', padding: '1px 5px' }}
                      >
                        {acc.role}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--mut)', lineHeight: 1.3 }}>
                      {acc.desc}
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        color: 'var(--mut)',
                        marginTop: '3px',
                      }}
                    >
                      {acc.email}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn"
                    disabled={submitting}
                    onClick={() => void handleQuickSignIn(acc)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {isCurrentSubmitting ? 'Signing in...' : '⚡ 1-Click Login'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            textAlign: 'center',
            margin: '16px 0 12px',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: '1px',
              background: 'var(--line)',
            }}
          />
          <span
            style={{
              position: 'relative',
              background: 'var(--card)',
              padding: '0 8px',
              fontSize: '11px',
              color: 'var(--mut)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Or sign in with custom credentials
          </span>
        </div>

        {errorMessage && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '6px',
              background: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--red, #ef4444)',
              fontSize: '13px',
              marginBottom: '14px',
              border: '1px solid rgba(239, 68, 68, 0.2)',
            }}
          >
            {errorMessage}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div>
            <label
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
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
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid var(--line)',
                background: 'var(--bg)',
                color: 'var(--ink)',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
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
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid var(--line)',
                background: 'var(--bg)',
                color: 'var(--ink)',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginTop: '6px', display: 'flex', gap: '8px' }}>
            <button
              type="submit"
              className="btn"
              disabled={submitting}
              style={{
                flex: 1,
                padding: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontWeight: 600,
                fontSize: '13px',
              }}
            >
              {submitting ? 'Authenticating...' : 'Sign In'}
            </button>
            <button
              type="button"
              className="btn l"
              onClick={closeLoginModal}
              style={{ padding: '8px 14px', fontSize: '13px' }}
            >
              {user ? 'Cancel' : 'Continue as Guest'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
