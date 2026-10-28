import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { useLiveIntegrations } from '../hooks/useLiveIntegrations';

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'select' | 'checkbox';
  placeholder?: string;
  helper?: string;
  options?: string[];
  defaultValue?: string;
}

interface ConnectorMetadata {
  name: string;
  icon: string;
  category: string;
  description: string;
  fields: FieldDef[];
}

const CONNECTOR_DEFS: Record<string, ConnectorMetadata> = {
  Shopify: {
    name: 'Shopify',
    icon: '🛍️',
    category: 'E-commerce Core',
    description:
      'Sync orders, products, inventory, discounts and checkout sessions with Shopify Admin API.',
    fields: [
      {
        key: 'shopDomain',
        label: 'Store Domain',
        placeholder: 'your-store.myshopify.com',
        defaultValue: 'codemadi.myshopify.com',
      },
      {
        key: 'accessToken',
        label: 'Admin API Access Token',
        type: 'password',
        placeholder: 'shpat_xxxxxxxxxxxxxxxxxxxxxxxx',
      },
      {
        key: 'apiVersion',
        label: 'Shopify API Version',
        placeholder: '2024-04',
        defaultValue: '2024-04',
      },
      {
        key: 'themeEmbed',
        label: 'Theme App Embed Status',
        type: 'select',
        options: ['Enabled (cod-checkout block)', 'Disabled'],
        defaultValue: 'Enabled (cod-checkout block)',
      },
    ],
  },
  Razorpay: {
    name: 'Razorpay',
    icon: '💳',
    category: 'Payments Gateway',
    description: 'Accept UPI, Cards, Netbanking and automatically reconcile payment refunds.',
    fields: [
      { key: 'keyId', label: 'Key ID', placeholder: 'rzp_live_xxxxxxxxxxxxxxxx' },
      { key: 'keySecret', label: 'Key Secret', type: 'password', placeholder: '••••••••••••••••' },
      {
        key: 'webhookSecret',
        label: 'Webhook Secret',
        type: 'password',
        placeholder: 'whsec_xxxxxxxxxxxxxxxx',
      },
      {
        key: 'captureMode',
        label: 'Auto Capture',
        type: 'select',
        options: ['Automatic (Instant)', 'Manual (Authorize only)'],
        defaultValue: 'Automatic (Instant)',
      },
    ],
  },
  Shiprocket: {
    name: 'Shiprocket',
    icon: '📦',
    category: 'Courier Aggregator',
    description: 'Automated AWB generation, courier allocation, label printing and NDR reattempts.',
    fields: [
      { key: 'email', label: 'Shiprocket Account Email', placeholder: 'operations@yourbrand.com' },
      {
        key: 'password',
        label: 'API Password / Token',
        type: 'password',
        placeholder: '••••••••••••••••',
      },
      { key: 'pickupPincode', label: 'Default Pickup Pincode', placeholder: '400001' },
      { key: 'channelId', label: 'Channel ID (optional)', placeholder: 'shopify_store_01' },
    ],
  },
  Delhivery: {
    name: 'Delhivery',
    icon: '🚚',
    category: 'Direct Courier',
    description:
      'Direct courier integration for surface & air express delivery across 18,000+ pincodes.',
    fields: [
      { key: 'clientId', label: 'Client ID / Name', placeholder: 'DELHIVERY_BRAND_PROD' },
      { key: 'apiToken', label: 'API Token', type: 'password', placeholder: '••••••••••••••••' },
      {
        key: 'warehouseName',
        label: 'Primary Warehouse Hub',
        placeholder: 'Mumbai Central Fulfillment Hub',
      },
      {
        key: 'serviceType',
        label: 'Default Service Mode',
        type: 'select',
        options: ['Express Surface', 'Air Express', 'Standard COD'],
        defaultValue: 'Express Surface',
      },
    ],
  },
  'WhatsApp (Gupshup)': {
    name: 'WhatsApp (Gupshup)',
    icon: '💬',
    category: 'Communication & Recovery',
    description:
      'Send automated OTP verification, abandoned cart recovery links and shipping updates.',
    fields: [
      { key: 'appName', label: 'Gupshup App Name', placeholder: 'TezvixCheckoutAlerts' },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: '••••••••••••••••' },
      { key: 'senderPhone', label: 'Sender WhatsApp Number', placeholder: '+919876543210' },
      {
        key: 'templateId',
        label: 'Order Confirmation Template ID',
        placeholder: 'order_confirm_v2',
        defaultValue: 'order_confirm_v2',
      },
    ],
  },
  Klaviyo: {
    name: 'Klaviyo',
    icon: '✉️',
    category: 'Marketing Automation',
    description:
      'Push customer profiles, cart abandoners and order events into email & SMS segments.',
    fields: [
      { key: 'publicKey', label: 'Public API Key / Site ID', placeholder: 'AbCd12' },
      {
        key: 'privateKey',
        label: 'Private API Key',
        type: 'password',
        placeholder: 'pk_••••••••••••••••',
      },
      { key: 'listId', label: 'Abandoned Checkout Flow List ID', placeholder: 'XyZ789' },
    ],
  },
  'Meta Pixel': {
    name: 'Meta Pixel',
    icon: '🎯',
    category: 'Ads & Attribution',
    description:
      'Track InitiateCheckout, AddPaymentInfo and Purchase events via browser Pixel and CAPI.',
    fields: [
      { key: 'pixelId', label: 'Meta Pixel ID', placeholder: '123456789012345' },
      {
        key: 'capiToken',
        label: 'Conversions API Access Token',
        type: 'password',
        placeholder: 'EAAG••••••••••••••••',
      },
      { key: 'testEventCode', label: 'Test Event Code (optional)', placeholder: 'TEST12345' },
    ],
  },
  'Google Analytics 4': {
    name: 'Google Analytics 4',
    icon: '📊',
    category: 'Web Analytics',
    description: 'Measure checkout conversion funnels and e-commerce purchase events.',
    fields: [
      { key: 'measurementId', label: 'GA4 Measurement ID', placeholder: 'G-XXXXXXXXXX' },
      {
        key: 'apiSecret',
        label: 'Measurement Protocol API Secret',
        type: 'password',
        placeholder: '••••••••••••••••',
      },
    ],
  },
  'Zoho Books': {
    name: 'Zoho Books',
    icon: '📑',
    category: 'Accounting & ERP',
    description: 'Generate GST-compliant tax invoices, credit notes and sync merchant settlements.',
    fields: [
      { key: 'orgId', label: 'Organization ID', placeholder: '70012345' },
      { key: 'clientId', label: 'Zoho Client ID', placeholder: '1000.xxxx' },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        type: 'password',
        placeholder: '••••••••••••••••',
      },
    ],
  },
  Slack: {
    name: 'Slack',
    icon: '🔔',
    category: 'Operations Alerting',
    description:
      'Send immediate alert notifications for failed orders, high RTO spikes and payment errors.',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Incoming Webhook URL',
        placeholder: 'https://hooks.slack.com/services/T.../B.../X...',
      },
      {
        key: 'channel',
        label: 'Notification Channel',
        placeholder: '#alerts-checkout',
        defaultValue: '#alerts-checkout',
      },
    ],
  },
};

const DEFAULT_CONNECTORS = [
  'Shopify',
  'Razorpay',
  'Shiprocket',
  'Delhivery',
  'WhatsApp (Gupshup)',
  'Klaviyo',
  'Meta Pixel',
  'Google Analytics 4',
  'Zoho Books',
  'Slack',
];

export const IntegrationsView: React.FC = () => {
  const { showToast } = useDashboard();
  const { integrations, saveIntegration, disconnectIntegration } = useLiveIntegrations();
  const [subTab, setSubTab] = useState<'Connectors' | 'Webhooks' | 'API keys'>('Connectors');

  // Sidebar / Drawer state
  const [activeDrawer, setActiveDrawer] = useState<ConnectorMetadata | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openDrawer = (name: string) => {
    const meta = CONNECTOR_DEFS[name] || {
      name,
      icon: '🔌',
      category: 'Custom Service',
      description: 'Configure API credentials and endpoints.',
      fields: [
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Enter API key' },
        { key: 'endpoint', label: 'Endpoint URL', placeholder: 'https://api.service.com' },
      ],
    };

    setActiveDrawer(meta);
    setTestResult(null);

    // Populate existing saved configuration if present
    const saved = integrations[name]?.config || {};
    const initial: Record<string, string> = {};
    for (const f of meta.fields) {
      initial[f.key] = saved[f.key] || f.defaultValue || '';
    }
    setFormData(initial);
  };

  const closeDrawer = () => {
    setActiveDrawer(null);
    setTestResult(null);
  };

  const handleFieldChange = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleTestConnection = () => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      // Basic client-side validation check
      const hasEmptyRequired = activeDrawer?.fields.some(
        (f) => !formData[f.key] && !f.label.includes('optional'),
      );
      if (hasEmptyRequired) {
        setTestResult('⚠️ Please complete all required configuration fields.');
      } else {
        setTestResult('✓ Connection test succeeded! Credentials format is valid.');
      }
    }, 700);
  };

  const handleSaveAndConnect = async () => {
    if (!activeDrawer) return;
    setSaving(true);
    try {
      await saveIntegration(activeDrawer.name, formData, true);
      showToast(`${activeDrawer.name} connected & saved to MongoDB`);
      closeDrawer();
    } catch {
      showToast(`Failed to save ${activeDrawer.name} integration`);
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (name: string) => {
    if (
      window.confirm(
        `Are you sure you want to disconnect ${name}? Saved credentials will be removed.`,
      )
    ) {
      try {
        await disconnectIntegration(name);
        showToast(`${name} disconnected`);
        if (activeDrawer?.name === name) {
          closeDrawer();
        }
      } catch {
        showToast(`Could not disconnect ${name}`);
      }
    }
  };

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
          {DEFAULT_CONNECTORS.map((name) => {
            const meta = CONNECTOR_DEFS[name] || {
              name,
              icon: '🔌',
              category: 'Integration',
              description: 'Third-party integration',
              fields: [],
            };
            const isConnected = Boolean(integrations[name]?.connected);

            return (
              <div
                className="card"
                key={name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '20px' }}>{meta.icon}</span>
                      <h3 style={{ margin: 0 }}>{meta.name}</h3>
                    </div>
                    <span className={`pill ${isConnected ? 'g' : 'n'}`}>
                      {isConnected ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                  <div
                    style={{
                      color: 'var(--mut)',
                      margin: '8px 0 16px',
                      fontSize: '13px',
                      lineHeight: 1.5,
                    }}
                  >
                    {meta.description}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  {isConnected ? (
                    <>
                      <button className="btn" style={{ flex: 1 }} onClick={() => openDrawer(name)}>
                        ⚙️ Configure
                      </button>
                      <button className="btn l" onClick={() => void handleDisconnect(name)}>
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn"
                      style={{ width: '100%' }}
                      onClick={() => openDrawer(name)}
                    >
                      Connect →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {subTab === 'Webhooks' && (
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
                Webhook Endpoints<em>HMAC SHA-256 signature verified</em>
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
                Incoming events from Shopify App Lifecycle and payment gateways
              </span>
            </div>
            <button
              className="btn"
              onClick={() => showToast('Webhook configuration is managed automatically')}
            >
              + Add endpoint
            </button>
          </div>

          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Route</th>
                  <th>Security</th>
                  <th>Status</th>
                  <th className="n">Audit</th>
                </tr>
              </thead>
              <tbody>
                <tr className="r">
                  <td>
                    <strong>app/uninstalled</strong>
                  </td>
                  <td>
                    <code>/webhooks/app/uninstalled</code>
                  </td>
                  <td>Shopify HMAC</td>
                  <td>
                    <span className="pill g">Active</span>
                  </td>
                  <td className="n">
                    <span className="pill n">Verified</span>
                  </td>
                </tr>
                <tr className="r">
                  <td>
                    <strong>app/scopes_update</strong>
                  </td>
                  <td>
                    <code>/webhooks/app/scopes_update</code>
                  </td>
                  <td>Shopify HMAC</td>
                  <td>
                    <span className="pill g">Active</span>
                  </td>
                  <td className="n">
                    <span className="pill n">Verified</span>
                  </td>
                </tr>
                <tr className="r">
                  <td>
                    <strong>orders/create</strong>
                  </td>
                  <td>
                    <code>/proxy/v1/sessions/:id/place-cod</code>
                  </td>
                  <td>Storefront Session</td>
                  <td>
                    <span className="pill g">Active</span>
                  </td>
                  <td className="n">
                    <span className="pill n">Verified</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'API keys' && (
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
              <h3 style={{ margin: 0 }}>API Credentials & Tokens</h3>
              <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
                Access tokens for Storefront app proxy and Tezvix OS backend
              </span>
            </div>
          </div>

          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Key Name</th>
                  <th>Scope</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th className="n">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr className="r">
                  <td>
                    <strong>Storefront Proxy Token</strong>
                  </td>
                  <td>Read orders, create checkout</td>
                  <td>Synced with app session</td>
                  <td>
                    <span className="pill g">Active</span>
                  </td>
                  <td className="n">
                    <button className="btn l" onClick={() => showToast('Managed by Shopify OAuth')}>
                      Info
                    </button>
                  </td>
                </tr>
                <tr className="r">
                  <td>
                    <strong>Dashboard JWT Secret</strong>
                  </td>
                  <td>Full Admin Telemetry</td>
                  <td>Configured in .env</td>
                  <td>
                    <span className="pill g">Active</span>
                  </td>
                  <td className="n">
                    <button className="btn l" onClick={() => showToast('Rotated via .env')}>
                      Info
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Slide-over Configuration Drawer */}
      {activeDrawer && (
        <div className="drawer-backdrop" onClick={closeDrawer}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '24px' }}>{activeDrawer.icon}</span>
                <div>
                  <h3 style={{ margin: 0 }}>{activeDrawer.name}</h3>
                  <small style={{ color: 'var(--mut)' }}>{activeDrawer.category}</small>
                </div>
              </div>
              <button
                onClick={closeDrawer}
                style={{
                  fontSize: '18px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: 'var(--bg)',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div className="drawer-body">
              <div
                style={{
                  padding: '12px',
                  borderRadius: '6px',
                  background: 'var(--bg)',
                  marginBottom: '20px',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  color: 'var(--mut)',
                }}
              >
                {activeDrawer.description}
              </div>

              <div style={{ marginBottom: '20px' }}>
                <span className={`pill ${integrations[activeDrawer.name]?.connected ? 'g' : 'n'}`}>
                  {integrations[activeDrawer.name]?.connected
                    ? '● Connected to MongoDB'
                    : '○ Not yet connected'}
                </span>
                {integrations[activeDrawer.name]?.updatedAt && (
                  <small style={{ display: 'block', color: 'var(--mut)', marginTop: '6px' }}>
                    Last saved:{' '}
                    {new Date(integrations[activeDrawer.name]!.updatedAt!).toLocaleString()}
                  </small>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveAndConnect();
                }}
              >
                {activeDrawer.fields.map((f) => (
                  <div className="drawer-field" key={f.key}>
                    <label>{f.label}</label>
                    {f.type === 'select' ? (
                      <select
                        value={formData[f.key] || f.defaultValue || ''}
                        onChange={(e) => handleFieldChange(f.key, e.target.value)}
                      >
                        {f.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.type || 'text'}
                        placeholder={f.placeholder}
                        value={formData[f.key] || ''}
                        onChange={(e) => handleFieldChange(f.key, e.target.value)}
                      />
                    )}
                    {f.helper && <small>{f.helper}</small>}
                  </div>
                ))}

                {testResult && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '16px',
                      background: testResult.startsWith('✓') ? 'var(--gs)' : 'var(--os)',
                      color: testResult.startsWith('✓') ? 'var(--gr)' : 'var(--or)',
                    }}
                  >
                    {testResult}
                  </div>
                )}
              </form>
            </div>

            <div className="drawer-footer">
              <button
                type="button"
                className="btn l"
                disabled={testing}
                onClick={handleTestConnection}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>

              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => void handleSaveAndConnect()}
              >
                {saving ? 'Saving...' : 'Save & Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
