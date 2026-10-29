import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useDashboard } from '../context/DashboardContext';

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
    desc: 'Full platform privileges (*) & user provisioning',
  },
  {
    role: 'ADMIN',
    name: 'Store Manager',
    email: 'manager@tezvix.internal',
    pass: 'Manager@123456',
    icon: '🛡️',
    badgeClass: 'b',
    desc: 'Store configuration, settings & order management',
  },
  {
    role: 'OPERATOR',
    name: 'Operations Lead',
    email: 'operator@tezvix.internal',
    pass: 'Operator@123456',
    icon: '⚙️',
    badgeClass: 'g',
    desc: 'Live order routing & logistics review',
  },
  {
    role: 'VIEWER',
    name: 'Data Analyst',
    email: 'viewer@tezvix.internal',
    pass: 'Viewer@123456',
    icon: '👁️',
    badgeClass: 'n',
    desc: 'Read-only analytics & database audit telemetry',
  },
];

interface LoginViewProps {
  onExploreGuest?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onExploreGuest }) => {
  const { login } = useAuth();
  const { showToast } = useDashboard();

  const [email, setEmail] = useState('admin@tezvix.internal');
  const [password, setPassword] = useState('Admin@123456');
  const [submittingRole, setSubmittingRole] = useState<string | null>(null);
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleQuickSignIn = async (acc: DemoAccount) => {
    setErrorMessage('');
    setSubmittingRole(acc.role);
    try {
      const result = await login(acc.email, acc.pass);
      if (result.success) {
        showToast(`Signed in as ${acc.name} (${acc.role})`);
      } else {
        setErrorMessage(result.error || 'Authentication failed');
      }
    } finally {
      setSubmittingRole(null);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setIsFormSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.success) {
        showToast('Signed in successfully');
      } else {
        setErrorMessage(result.error || 'Authentication failed');
      }
    } finally {
      setIsFormSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '560px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.15)',
          borderRadius: '16px',
          border: '1px solid var(--line)',
          backgroundColor: 'var(--card)',
          padding: '32px',
          position: 'relative',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '8px',
            }}
          >
            <img src="./branding/tezvix-symbol.svg" alt="" width="36" height="36" />
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: 'var(--ink)' }}>
              Tezvix OS
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--mut)' }}>
            Checkout Operating System & Merchant Control Center
          </p>
        </div>

        {/* 1-Click Role Logins */}
        <div style={{ marginBottom: '24px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
            }}
          >
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--ink)',
              }}
            >
              ⚡ One-Click Role Sign In
            </span>
            <span style={{ fontSize: '11px', color: 'var(--mut)' }}>No password required</span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '10px',
            }}
          >
            {DEMO_ACCOUNTS.map((acc) => {
              const isSubmitting = submittingRole === acc.role;
              return (
                <div
                  key={acc.role}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '10px',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '4px',
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                        {acc.icon} {acc.name}
                      </span>
                      <span
                        className={`pill ${acc.badgeClass}`}
                        style={{ fontSize: '9px', padding: '1px 6px' }}
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
                        marginTop: '4px',
                      }}
                    >
                      {acc.email}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn"
                    disabled={submittingRole !== null || isFormSubmitting}
                    onClick={() => void handleQuickSignIn(acc)}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      fontSize: '12px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                      cursor: 'pointer',
                    }}
                  >
                    {isSubmitting ? 'Signing in...' : '⚡ 1-Click Login'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {errorMessage && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--red, #ef4444)',
              fontSize: '13px',
              marginBottom: '16px',
              border: '1px solid rgba(239, 68, 68, 0.25)',
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Divider */}
        <div
          style={{
            position: 'relative',
            textAlign: 'center',
            margin: '20px 0 16px',
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
              padding: '0 10px',
              fontSize: '11px',
              color: 'var(--mut)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Or custom credentials
          </span>
        </div>

        {/* Custom Credentials Form */}
        <form
          onSubmit={handleFormSubmit}
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
                padding: '9px 12px',
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
                padding: '9px 12px',
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
              disabled={submittingRole !== null || isFormSubmitting}
              style={{
                flex: 1,
                padding: '9px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {isFormSubmitting ? 'Authenticating...' : 'Sign In'}
            </button>
            {onExploreGuest && (
              <button
                type="button"
                className="btn l"
                onClick={onExploreGuest}
                style={{ padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
              >
                Explore as Guest →
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
