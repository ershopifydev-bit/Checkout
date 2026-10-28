import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import type { CheckoutSettings, PaymentMethods } from '../types';

interface CheckoutViewProps {
  settings: CheckoutSettings;
  onSavePayments: (payments: PaymentMethods) => Promise<unknown>;
}

export const CheckoutView: React.FC<CheckoutViewProps> = ({ settings, onSavePayments }) => {
  const { showToast } = useDashboard();
  const [payments, setPayments] = useState<PaymentMethods>({
    cod: settings.payments?.cod !== false,
    upi: !!settings.payments?.upi,
    card: !!settings.payments?.card,
    netbanking: !!settings.payments?.netbanking,
  });
  const [saving, setSaving] = useState(false);

  const brandDisplay = settings.brandName || 'Nilgiri Tea Co.';

  const handleToggle = (key: keyof PaymentMethods) => {
    setPayments((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSavePayments(payments);
      showToast('Payment methods saved to Shopify');
    } catch {
      showToast('Saved in draft mode');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="g g3">
        <div className="card">
          <h3>
            Payment methods<em>Drag to reorder</em>
          </h3>
          <div style={{ color: 'var(--mut)', fontSize: '12px', margin: '6px 0 12px' }}>
            Control storefront payment methods shown in overlay. Flags persist across all checkouts.
          </div>

          <div className="row">
            <div>
              UPI<small>Google Pay, PhonePe, Paytm, any UPI app</small>
            </div>
            <button
              className={`tg ${payments.upi ? 'on' : ''}`}
              role="switch"
              aria-checked={payments.upi}
              onClick={() => handleToggle('upi')}
            />
          </div>

          <div className="row">
            <div>
              Cards<small>Visa, Mastercard, RuPay</small>
            </div>
            <button
              className={`tg ${payments.card ? 'on' : ''}`}
              role="switch"
              aria-checked={payments.card}
              onClick={() => handleToggle('card')}
            />
          </div>

          <div className="row">
            <div>
              Netbanking<small>42 banks supported</small>
            </div>
            <button
              className={`tg ${payments.netbanking ? 'on' : ''}`}
              role="switch"
              aria-checked={payments.netbanking}
              onClick={() => handleToggle('netbanking')}
            />
          </div>

          <div className="row">
            <div>
              Cash on delivery<small>Subject to the rules on the right</small>
            </div>
            <button
              className={`tg ${payments.cod ? 'on' : ''}`}
              role="switch"
              aria-checked={payments.cod}
              onClick={() => handleToggle('cod')}
            />
          </div>

          <button
            className="btn"
            style={{ marginTop: '14px' }}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save draft'}
          </button>
        </div>

        <div className="card">
          <h3>
            COD rules<em>Applies to all stores</em>
          </h3>
          {[
            ['Minimum order value', '₹300'],
            ['Maximum order value', '₹5,000'],
            ['COD fee', '₹49'],
            ['Block when RTO score above', '70'],
            ['Ask advance payment above', '₹2,500'],
          ].map(([label, val]) => (
            <div className="fld" key={label}>
              {label}
              <input defaultValue={val} aria-label={label} />
            </div>
          ))}
          <div className="row">
            <div>
              Nudge to prepaid<small>Show ₹50 off on UPI</small>
            </div>
            <button
              className="tg on"
              role="switch"
              aria-checked="true"
              onClick={(e) => {
                e.currentTarget.classList.toggle('on');
                showToast('Nudge rule updated');
              }}
            />
          </div>
        </div>

        <div className="card">
          <h3>
            Live preview<em>Mobile</em>
          </h3>
          <div className="phone">
            <div className="h">{brandDisplay}</div>
            <div>Ship to Aarav, Mumbai 400050</div>
            {payments.upi && (
              <div className="o s">
                <span>UPI</span>
                <span>−₹50</span>
              </div>
            )}
            {payments.card && (
              <div className="o">
                <span>Cards</span>
                <span />
              </div>
            )}
            {payments.cod && (
              <div className="o">
                <span>Cash on delivery</span>
                <span>+₹49</span>
              </div>
            )}
            <div className="cta">Pay ₹2,449</div>
          </div>
          <div style={{ textAlign: 'center', marginTop: '14px' }}>
            <button className="btn l" onClick={() => showToast('Version published to storefront')}>
              Publish changes
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>
          Version history<em>Roll back any time</em>
        </h3>
        <div className="wide">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Changed by</th>
                <th>Change</th>
                <th className="n">When</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['v14', 'Noor H.', 'COD fee raised to ₹49', 'Today'],
                ['v13', 'Erin C.', 'Added UPI nudge', 'Yesterday'],
                ['v12', 'Support team', 'Hid wallets for Kora', '3 days ago'],
              ].map(([ver, who, ch, when]) => (
                <tr key={ver} className="r">
                  <td>{ver}</td>
                  <td>{who}</td>
                  <td>{ch}</td>
                  <td className="n">{when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};
