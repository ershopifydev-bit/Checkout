import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { useLiveUsers } from '../hooks/useLiveUsers';
import { useLiveMonitor } from '../hooks/useLiveMonitor';

export const TeamView: React.FC = () => {
  const { showToast } = useDashboard();
  const { users, total, loading, error, refresh } = useLiveUsers();
  const { data: monitor } = useLiveMonitor();

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'ADMIN' | 'OPERATOR' | 'VIEWER'>('ADMIN');
  const [newPassword, setNewPassword] = useState('');

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          name: newName,
          role: newRole,
          password: newPassword || 'Tezvix@2026!',
        }),
      });

      if (res.ok) {
        showToast(`User ${newName} invited successfully`);
        setShowInviteModal(false);
        setNewEmail('');
        setNewName('');
        setNewPassword('');
        void refresh();
      } else {
        const j = await res.json().catch(() => null);
        showToast(j?.error?.message || 'Could not create user');
      }
    } catch {
      showToast('Request failed');
    }
  };

  return (
    <>
      <div className="g g2">
        <div className="card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            }}
          >
            <div>
              <h3 style={{ margin: 0 }}>
                Team & Operators<em>{total} registered accounts</em>
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
                Authenticated roles from <code>dashboard_users</code> in MongoDB
              </span>
            </div>
            <button className="btn" onClick={() => setShowInviteModal(!showInviteModal)}>
              {showInviteModal ? 'Cancel' : '+ Invite user'}
            </button>
          </div>

          {showInviteModal && (
            <form
              onSubmit={(e) => void handleCreateUser(e)}
              style={{
                marginBottom: '16px',
                padding: '12px',
                border: '1px solid var(--line)',
                borderRadius: '8px',
                background: 'var(--bg)',
              }}
            >
              <h4 style={{ margin: '0 0 10px' }}>Add Team Member</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Full Name"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--line)',
                  }}
                />
                <input
                  type="email"
                  placeholder="Email Address"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--line)',
                  }}
                />
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'ADMIN' | 'OPERATOR' | 'VIEWER')}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--line)',
                  }}
                >
                  <option value="ADMIN">ADMIN (Full management)</option>
                  <option value="OPERATOR">OPERATOR (Orders & monitoring)</option>
                  <option value="VIEWER">VIEWER (Read-only)</option>
                </select>
                <input
                  type="password"
                  placeholder="Temporary Password (min 8 chars)"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--line)',
                  }}
                />
                <button type="submit" className="btn" style={{ marginTop: '4px' }}>
                  Create Account
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--mut)' }}>
              Loading team users...
            </div>
          ) : error ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--or)' }}>
              {error}
            </div>
          ) : (
            <div className="wide">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th className="n">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    let rolePill = 'n';
                    if (u.role === 'SUPER_ADMIN') rolePill = 'o';
                    else if (u.role === 'ADMIN') rolePill = 'b';
                    else if (u.role === 'OPERATOR') rolePill = 'g';

                    return (
                      <tr key={u._id} className="r">
                        <td>
                          <strong>{u.name}</strong>
                        </td>
                        <td>{u.email}</td>
                        <td>
                          <span className={`pill ${rolePill}`}>{u.role}</span>
                        </td>
                        <td className="n">
                          <span className={`pill ${u.isActive ? 'g' : 'o'}`}>
                            {u.isActive ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3>
            Database telemetry & metrics<em>Live MongoDB status</em>
          </h3>
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Component</th>
                  <th className="n">Status / Count</th>
                </tr>
              </thead>
              <tbody>
                <tr className="r">
                  <td>Database Engine</td>
                  <td className="n">{monitor?.database.databaseName || 'checkout_development'}</td>
                </tr>
                <tr className="r">
                  <td>Server Health</td>
                  <td className="n">
                    <span className={`pill ${monitor?.database.status === 'HEALTHY' ? 'g' : 'o'}`}>
                      {monitor?.database.status || 'ONLINE'}
                    </span>
                  </td>
                </tr>
                <tr className="r">
                  <td>Active Collections</td>
                  <td className="n">{monitor?.database.totalCollections ?? 0}</td>
                </tr>
                <tr className="r">
                  <td>Total Records Stored</td>
                  <td className="n">{monitor?.database.storageStats.totalObjects ?? 0}</td>
                </tr>
                <tr className="r">
                  <td>Recorded Events</td>
                  <td className="n">{monitor?.eventStream.totalRecordedEvents ?? 0}</td>
                </tr>
                <tr className="r">
                  <td>Confirmed Order Volume</td>
                  <td className="n">
                    {monitor?.ordersAndAttempts.confirmedRevenue.formatted || '₹0'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
};
