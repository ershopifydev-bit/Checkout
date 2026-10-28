import React, { useState, useEffect } from 'react';
import { useDashboard } from '../context/DashboardContext';
import type { CheckoutSettings, PaymentMethods } from '../types';

interface SettingsViewProps {
  settings: CheckoutSettings;
  error?: string | undefined;
  onSave: (body: Partial<CheckoutSettings>) => Promise<unknown>;
  onReload: () => Promise<unknown>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  error,
  onSave,
  onReload,
}) => {
  const { showToast } = useDashboard();
  const [form, setForm] = useState<CheckoutSettings>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleFieldChange = <K extends keyof CheckoutSettings>(
    key: K,
    value: CheckoutSettings[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePayToggle = (key: keyof PaymentMethods) => {
    setForm((prev) => {
      const currentPays: PaymentMethods = prev.payments || {
        cod: true,
        upi: false,
        card: false,
        netbanking: false,
      };
      return {
        ...prev,
        payments: {
          ...currentPays,
          [key]: !currentPays[key],
        },
      };
    });
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      await onSave(form);
      showToast('Settings saved successfully');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      showToast(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePaysOnly = async () => {
    if (!form.payments) return;
    setSaving(true);
    try {
      await onSave({ payments: form.payments });
      showToast('Payment methods saved');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      showToast(msg);
    } finally {
      setSaving(false);
    }
  };

  const p = form.payments || { cod: true, upi: false, card: false, netbanking: false };

  return (
    <>
      {error ? (
        <div className="banner err">
          {error}
          <button
            className="btn l"
            style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: '11px' }}
            onClick={onReload}
          >
            Retry live connection
          </button>
        </div>
      ) : settings.shop ? (
        <div className="banner">
          Connected to Shopify store: <b>{settings.shop}</b> · Settings save to database
        </div>
      ) : null}

      <div className="g g2">
        <div className="card">
          <h3>Storefront branding & features</h3>
          <div style={{ color: 'var(--mut)', fontSize: '12px', margin: '4px 0 12px' }}>
            Control what shoppers see on the checkout overlay.
          </div>

          <div className="fld">
            <span>Center display mode</span>
            <div style={{ display: 'flex', gap: '12px' }}>
              <label>
                <input
                  type="radio"
                  name="brandMode"
                  value="name"
                  checked={form.brandMode !== 'logo'}
                  onChange={() => handleFieldChange('brandMode', 'name')}
                />{' '}
                Name
              </label>
              <label>
                <input
                  type="radio"
                  name="brandMode"
                  value="logo"
                  checked={form.brandMode === 'logo'}
                  onChange={() => handleFieldChange('brandMode', 'logo')}
                />{' '}
                Logo
              </label>
            </div>
          </div>

          <div className="fld">
            <label>Brand name</label>
            <input
              value={form.brandName || ''}
              maxLength={80}
              onChange={(e) => handleFieldChange('brandName', e.target.value)}
            />
          </div>

          <div className="fld">
            <label>Logo URL</label>
            <input
              value={form.logoUrl || ''}
              placeholder="https://cdn..."
              onChange={(e) => handleFieldChange('logoUrl', e.target.value)}
            />
          </div>

          <div className="row">
            <div>
              Confirm COD orders
              <small>Ask shopper confirmation before placing COD</small>
            </div>
            <input
              type="checkbox"
              checked={form.requireCodConfirmation !== false}
              onChange={(e) => handleFieldChange('requireCodConfirmation', e.target.checked)}
            />
          </div>

          <div className="row">
            <div>
              Upsell recommendations
              <small>Show “You may also like” section</small>
            </div>
            <input
              type="checkbox"
              checked={form.showUpsell !== false}
              onChange={(e) => handleFieldChange('showUpsell', e.target.checked)}
            />
          </div>

          <div className="row">
            <div>
              Gift vouchers
              <small>Allow shoppers to redeem voucher codes</small>
            </div>
            <input
              type="checkbox"
              checked={form.giftVouchersEnabled !== false}
              onChange={(e) => handleFieldChange('giftVouchersEnabled', e.target.checked)}
            />
          </div>

          <div className="fld">
            <label>Voucher verification</label>
            <select
              value={form.giftVoucherVerifyMode || 'pin'}
              onChange={(e) =>
                handleFieldChange('giftVoucherVerifyMode', e.target.value as 'pin' | 'otp')
              }
            >
              <option value="pin">PIN code</option>
              <option value="otp">SMS OTP</option>
            </select>
          </div>

          <div className="row">
            <div>
              Loyalty partner points
              <small>Show customer reward balance</small>
            </div>
            <input
              type="checkbox"
              checked={form.loyaltyPartnerEnabled !== false}
              onChange={(e) => handleFieldChange('loyaltyPartnerEnabled', e.target.checked)}
            />
          </div>

          <div className="fld">
            <label>Loyalty partner name</label>
            <input
              value={form.loyaltyPartnerName || ''}
              onChange={(e) => handleFieldChange('loyaltyPartnerName', e.target.value)}
            />
          </div>

          <div className="fld">
            <label>Loyalty points demo balance</label>
            <input
              type="number"
              min={0}
              step={1}
              value={form.loyaltyPointsBalance ?? 0}
              onChange={(e) => handleFieldChange('loyaltyPointsBalance', Number(e.target.value))}
            />
          </div>

          <div style={{ marginTop: '16px' }}>
            <button className="btn" disabled={saving} onClick={handleSaveAll}>
              {saving ? 'Saving...' : 'Save all settings'}
            </button>
          </div>
        </div>

        <div className="card">
          <h3>Live storefront payment methods</h3>
          <div style={{ color: 'var(--mut)', fontSize: '12px', margin: '4px 0 12px' }}>
            Enabled methods appear on checkout. COD places a real Shopify order; prepaid UI is
            preview.
          </div>

          <div className="row">
            <div>
              Cash on Delivery<small>Places real Shopify order directly</small>
            </div>
            <button
              className={`tg ${p.cod !== false ? 'on' : ''}`}
              role="switch"
              aria-checked={p.cod !== false}
              onClick={() => handlePayToggle('cod')}
            />
          </div>

          <div className="row">
            <div>
              UPI<small>Google Pay, PhonePe, Paytm, BHIM</small>
            </div>
            <button
              className={`tg ${p.upi === true ? 'on' : ''}`}
              role="switch"
              aria-checked={p.upi === true}
              onClick={() => handlePayToggle('upi')}
            />
          </div>

          <div className="row">
            <div>
              Debit / Credit Cards<small>Visa, Mastercard, RuPay</small>
            </div>
            <button
              className={`tg ${p.card === true ? 'on' : ''}`}
              role="switch"
              aria-checked={p.card === true}
              onClick={() => handlePayToggle('card')}
            />
          </div>

          <div className="row">
            <div>
              Net banking<small>42 top Indian banks</small>
            </div>
            <button
              className={`tg ${p.netbanking === true ? 'on' : ''}`}
              role="switch"
              aria-checked={p.netbanking === true}
              onClick={() => handlePayToggle('netbanking')}
            />
          </div>

          <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
            <button className="btn" disabled={saving} onClick={handleSavePaysOnly}>
              {saving ? 'Saving...' : 'Save payment methods'}
            </button>
            <button
              className="btn l"
              onClick={() => {
                showToast('Reloading settings from Shopify...');
                onReload();
              }}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
