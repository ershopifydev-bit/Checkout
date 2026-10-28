import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';

interface RecentDelivery {
  ev: string;
  ep: string;
  code: string;
  att: string;
}

const DELIVERIES: RecentDelivery[] = [
  { ev: 'order.paid', ep: 'orders', code: '200', att: '1' },
  { ev: 'payment.settled', ep: 'erp', code: '200', att: '1' },
  { ev: 'checkout.failed', ep: 'slack', code: '500', att: '3' },
];

const API_KEYS = [
  {
    name: 'Storefront',
    scope: 'Read orders, checkout',
    created: '3 Aug',
    last: 'Today',
    action: 'Rotate',
    toastMsg: 'Key rotated',
  },
  {
    name: 'ERP sync',
    scope: 'Orders, settlements',
    created: '12 Sep',
    last: 'Today',
    action: 'Rotate',
    toastMsg: 'Key rotated',
  },
  {
    name: 'Reporting',
    scope: 'Read only',
    created: '20 Oct',
    last: 'Never',
    action: 'Revoke',
    toastMsg: 'Key revoked',
  },
];

export const IntegrationsView: React.FC = () => {
  const { connectors, toggleConnector, showToast } = useDashboard();
  const [subTab, setSubTab] = useState<'Connectors' | 'Webhooks' | 'API keys'>('Connectors');

  return (
    <>
      <div className="chips">
        {(['Connectors', 'Webhooks', 'API keys'] as const).map((t) => (
          <button key={t} className={subTab === t ? 'on' : ''} onClick={() => setSubTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {subTab === 'Connectors' && (
        <div className="g g3">
          {connectors.map((c, i) => (
            <div className="card" key={c.name}>
              <h3>
                {c.name}
                <em>
                  <span className={`pill ${c.connected ? 'g' : 'n'}`}>
                    {c.connected ? 'Connected' : 'Not connected'}
                  </span>
                </em>
              </h3>
              <div style={{ color: 'var(--mut)', margin: '6px 0 14px' }}>{c.description}</div>
              <button
                className={`btn ${c.connected ? 'l' : ''}`}
                onClick={() => toggleConnector(i)}
              >
                {c.connected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          ))}
        </div>
      )}

      {subTab === 'Webhooks' && (
        <>
          <div className="card">
            <h3>
              Endpoints<em>Signed with HMAC SHA-256</em>
            </h3>
            <div className="wide">
              <table>
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Events</th>
                    <th>Status</th>
                    <th>24h success</th>
                    <th>Last delivery</th>
                    <th className="n">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      'api.nilgiri.in/hooks/orders',
                      'order.created, order.paid',
                      'Active',
                      'g',
                      '99.8%',
                      '2 min ago',
                    ],
                    [
                      'erp.sahyadri.in/tezvix',
                      'payment.settled, refund.processed',
                      'Active',
                      'g',
                      '97.1%',
                      '14 min ago',
                    ],
                    [
                      'hooks.slack.com/services/…',
                      'checkout.failed',
                      'Failing',
                      'o',
                      '61%',
                      '1 h ago',
                    ],
                  ].map(([ep, ev, st, stCl, succ, last]) => (
                    <tr key={ep} className="r">
                      <td>{ep}</td>
                      <td>{ev}</td>
                      <td>
                        <span className={`pill ${stCl}`}>{st}</span>
                      </td>
                      <td>{succ}</td>
                      <td>{last}</td>
                      <td className="n">
                        <button
                          className="btn l"
                          onClick={() => showToast('Test event delivered: 200 OK')}
                        >
                          Send test
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="g g2e" style={{ marginTop: '14px' }}>
            <div className="card">
              <h3>Recent deliveries</h3>
              <div className="wide">
                <table>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Endpoint</th>
                      <th>Code</th>
                      <th>Attempt</th>
                      <th className="n">Replay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DELIVERIES.map((d) => (
                      <tr key={d.ev + d.ep} className="r">
                        <td>{d.ev}</td>
                        <td>{d.ep}</td>
                        <td>{d.code}</td>
                        <td>{d.att}</td>
                        <td className="n">
                          <button className="btn l" onClick={() => showToast('Event replayed')}>
                            Replay
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <h3>Add endpoint</h3>
              <div className="fld">
                URL
                <input
                  style={{ width: '210px' }}
                  defaultValue="https://"
                  aria-label="Endpoint URL"
                />
              </div>
              <div className="fld">
                Signing secret
                <span>
                  whsec_••••9d1{' '}
                  <button className="btn l" onClick={() => showToast('Secret copied')}>
                    Copy
                  </button>
                </span>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '12px 0' }}>
                {[
                  'order.created',
                  'order.paid',
                  'order.failed',
                  'order.cancelled',
                  'checkout.abandoned',
                  'checkout.recovered',
                  'payment.settled',
                  'refund.processed',
                  'rto.flagged',
                  'ndr.opened',
                ].map((e) => (
                  <span key={e} className="pill b">
                    {e}
                  </span>
                ))}
              </div>
              <button className="btn" onClick={() => showToast('Endpoint added and verified')}>
                Add endpoint
              </button>
            </div>
          </div>
        </>
      )}

      {subTab === 'API keys' && (
        <div className="card">
          <h3>
            API keys
            <em>
              <button className="btn" onClick={() => showToast('New key created. Copy it now.')}>
                Create key
              </button>
            </em>
          </h3>
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scope</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th className="n">Action</th>
                </tr>
              </thead>
              <tbody>
                {API_KEYS.map((k) => (
                  <tr key={k.name} className="r">
                    <td>{k.name}</td>
                    <td>{k.scope}</td>
                    <td>{k.created}</td>
                    <td>{k.last}</td>
                    <td className="n">
                      <button className="btn l" onClick={() => showToast(k.toastMsg)}>
                        {k.action}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};
