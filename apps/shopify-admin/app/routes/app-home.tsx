import { Form, Link, useActionData, useLoaderData, useNavigation } from 'react-router';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import {
  getCheckoutSettings,
  saveCheckoutSettings,
  type UpiAppId,
} from '../checkout-settings.server';
import { authenticate, publicApiKey } from '../shopify.server';

/** Liquid filename under extensions/.../blocks/ (not the extension handle). */
const COD_CHECKOUT_BLOCK_HANDLE = 'cod-checkout';

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const storeHandle = shop.replace(/\.myshopify\.com$/i, '');
  const hostThemeId = process.env['SHOPIFY_THEME_EXTENSION_HOST_THEME_ID']?.trim();
  const hasDevTheme = Boolean(hostThemeId && /^\d+$/.test(hostThemeId));

  // https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration#app-embed-block-deep-linking
  // Do not URL-encode the slash in activateAppId — Shopify expects api_key/handle literally.
  const liveThemeUrl = `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?context=apps&activateAppId=${publicApiKey}/${COD_CHECKOUT_BLOCK_HANDLE}`;
  const devThemeUrl = hasDevTheme
    ? `https://admin.shopify.com/store/${storeHandle}/themes/${hostThemeId}/editor?context=apps&activateAppId=${publicApiKey}/${COD_CHECKOUT_BLOCK_HANDLE}`
    : null;

  let settings;
  try {
    settings = await getCheckoutSettings(shop);
  } catch (error) {
    console.error('[EasyCheckout] checkout settings load failed', error);
    throw new Response(
      'Could not load checkout settings. Is MongoDB running on the URI in apps/shopify-admin/.env?',
      { status: 503 },
    );
  }
  return {
    shop,
    liveThemeUrl,
    devThemeUrl,
    hostThemeId: hasDevTheme ? hostThemeId : null,
    settings,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    const settings = await saveCheckoutSettings(session.shop, {
      brandMode: String(form.get('brandMode') || 'name'),
      brandName: String(form.get('brandName') || ''),
      logoUrl: String(form.get('logoUrl') || ''),
      requireCodConfirmation: form.get('requireCodConfirmation') === 'on',
      showUpsell: form.get('showUpsell') === 'on',
      giftVouchersEnabled: form.get('giftVouchersEnabled') === 'on',
      giftVoucherVerifyMode: String(form.get('giftVoucherVerifyMode') || 'pin'),
      loyaltyPartnerEnabled: form.get('loyaltyPartnerEnabled') === 'on',
      loyaltyPartnerName: String(form.get('loyaltyPartnerName') || ''),
      loyaltyPointsBalance: Number(form.get('loyaltyPointsBalance') || 0),
      payments: {
        cod: form.get('payCod') === 'on',
        upi: form.get('payUpi') === 'on',
        card: form.get('payCard') === 'on',
        netbanking: form.get('payNetbanking') === 'on',
      },
      upiConfig: {
        vpa: String(form.get('upiVpa') || ''),
        merchantName: String(form.get('upiMerchantName') || ''),
        discountBadge: String(form.get('upiDiscountBadge') || '₹50 Off'),
        cashbackBadge: String(form.get('upiCashbackBadge') || 'Win Cashback'),
        ...(form.getAll('upiApps').length > 0
          ? { apps: form.getAll('upiApps').map(String) as UpiAppId[] }
          : {}),
      },
    });
    return { ok: true as const, settings, error: null };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SAVE_FAILED';
    return {
      ok: false as const,
      settings: null,
      error:
        code === 'INVALID_LOGO_URL'
          ? 'Logo URL must start with http:// or https://'
          : 'Could not save settings.',
    };
  }
}

export default function Overview() {
  const { shop, liveThemeUrl, devThemeUrl, hostThemeId, settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === 'submitting';
  const current = actionData?.settings || settings;
  const storeLabel = shop.replace(/\.myshopify\.com$/i, '');

  return (
    <main className="onboard">
      <header className="onboard-hero">
        <div className="onboard-hero-text">
          <p className="onboard-kicker">EasyCheckout</p>
          <h1>Launch your one-page checkout</h1>
          <p className="onboard-lead">
            Three steps: put the embed on your theme, choose what shoppers see, then go live. Every
            customize toggle below is what the storefront reads — no separate checkout config.
          </p>
        </div>
        <div className="onboard-store" aria-label="Connected store">
          <span className="onboard-store-dot" aria-hidden="true" />
          <div>
            <p className="onboard-store-label">Connected store</p>
            <p className="onboard-store-name">{storeLabel}</p>
          </div>
        </div>
      </header>

      <ol className="onboard-steps">
        <li className="onboard-card">
          <div className="onboard-card-head">
            <span className="onboard-step-num" aria-hidden="true">
              1
            </span>
            <div>
              <h2>Enable on your storefront</h2>
              <p>
                Turn on the <strong>COD Checkout</strong> app embed so Checkout / Buy now opens your
                one-page overlay on the same page — not Shopify’s hosted checkout.
              </p>
            </div>
          </div>
          <div className="onboard-card-actions">
            <a className="button" href={liveThemeUrl} target="_top" rel="noopener noreferrer">
              Open theme editor (Live theme)
            </a>
            {devThemeUrl ? (
              <a
                className="button button-secondary"
                href={devThemeUrl}
                target="_top"
                rel="noopener noreferrer"
              >
                Open dev theme ({hostThemeId})
              </a>
            ) : null}
            <p className="hint">
              Opens the theme editor with the embed ready under App embeds. Enable it, then click
              Save.
              {devThemeUrl ? ' If the CLI dev theme expired, use the Live theme button.' : ''}
            </p>
          </div>
        </li>

        <li className="onboard-card onboard-card-customize" id="customize-checkout">
          <div className="onboard-card-head">
            <span className="onboard-step-num" aria-hidden="true">
              2
            </span>
            <div>
              <h2>Customize checkout</h2>
              <p>
                Control branding, payment methods, and shopper-facing modules. Saved values ship in
                the existing settings response the checkout already loads — visibility updates on
                the next open, with no extra storefront requests.
              </p>
            </div>
          </div>

          <Form method="post" className="customize-form" key={current.updatedAt || 'settings'}>
            <div className="customize-grid">
              <section className="customize-panel" aria-labelledby="customize-look">
                <h3 id="customize-look">Look & brand</h3>
                <p className="hint">Header center of the checkout overlay.</p>
                <fieldset className="settings-fieldset">
                  <legend>Center display</legend>
                  <label className="settings-radio">
                    <input
                      type="radio"
                      name="brandMode"
                      value="name"
                      defaultChecked={current.brandMode !== 'logo'}
                    />
                    Brand name
                  </label>
                  <label className="settings-radio">
                    <input
                      type="radio"
                      name="brandMode"
                      value="logo"
                      defaultChecked={current.brandMode === 'logo'}
                    />
                    Brand logo
                  </label>
                </fieldset>
                <label htmlFor="brandName">Brand name</label>
                <input
                  id="brandName"
                  name="brandName"
                  type="text"
                  maxLength={80}
                  defaultValue={current.brandName}
                  placeholder="Your brand"
                />
                <label htmlFor="logoUrl">Logo image URL</label>
                <input
                  id="logoUrl"
                  name="logoUrl"
                  type="url"
                  maxLength={500}
                  defaultValue={current.logoUrl}
                  placeholder="https://cdn.example.com/logo.png"
                />
                <p className="hint">Direct https image URL when logo mode is selected.</p>
              </section>

              <section className="customize-panel" aria-labelledby="customize-pay">
                <h3 id="customize-pay">Payment methods</h3>
                <p className="hint">
                  Off = hidden for shoppers. Only COD places a real order today; prepaid is UI-ready
                  for later gateway work.
                </p>

                {/* Changes are here. */}
                <fieldset className="settings-fieldset">
                  <legend>Show on checkout</legend>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      name="payCod"
                      defaultChecked={current.payments?.cod !== false}
                    />
                    Cash on Delivery
                  </label>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      name="payUpi"
                      defaultChecked={current.payments?.upi === true}
                    />
                    UPI (Desktop QR &amp; Mobile App Cards)
                  </label>
                  <div
                    className="settings-subpanel"
                    style={{ marginLeft: '1.25rem', marginBottom: '0.75rem' }}
                  >
                    <label htmlFor="upiVpa" style={{ fontSize: '0.85rem' }}>
                      Merchant UPI ID (VPA)
                    </label>
                    <input
                      id="upiVpa"
                      name="upiVpa"
                      type="text"
                      defaultValue={current.upiConfig?.vpa || ''}
                      placeholder="e.g. yourstore@okhdfcbank"
                    />
                    <label htmlFor="upiDiscountBadge" style={{ fontSize: '0.85rem' }}>
                      UPI Discount Badge
                    </label>
                    <input
                      id="upiDiscountBadge"
                      name="upiDiscountBadge"
                      type="text"
                      defaultValue={current.upiConfig?.discountBadge || '₹50 Off'}
                    />
                    <label htmlFor="upiCashbackBadge" style={{ fontSize: '0.85rem' }}>
                      Mobile Cashback Badge
                    </label>
                    <input
                      id="upiCashbackBadge"
                      name="upiCashbackBadge"
                      type="text"
                      defaultValue={current.upiConfig?.cashbackBadge || 'Win Cashback'}
                    />
                  </div>
                  <div
                    className="settings-subpanel"
                    style={{ marginLeft: '1.25rem', marginBottom: '0.75rem' }}
                  >
                    <label htmlFor="upiVpa" style={{ fontSize: '0.85rem' }}>
                      Merchant UPI ID (VPA)
                    </label>
                    <input
                      id="upiVpa"
                      name="upiVpa"
                      type="text"
                      defaultValue={current.upiConfig?.vpa || ''}
                      placeholder="e.g. yourstore@okhdfcbank"
                    />
                    <label htmlFor="upiDiscountBadge" style={{ fontSize: '0.85rem' }}>
                      UPI Discount Badge
                    </label>
                    <input
                      id="upiDiscountBadge"
                      name="upiDiscountBadge"
                      type="text"
                      defaultValue={current.upiConfig?.discountBadge || '₹50 Off'}
                    />
                    <label htmlFor="upiCashbackBadge" style={{ fontSize: '0.85rem' }}>
                      Mobile Cashback Badge
                    </label>
                    <input
                      id="upiCashbackBadge"
                      name="upiCashbackBadge"
                      type="text"
                      defaultValue={current.upiConfig?.cashbackBadge || 'Win Cashback'}
                    />
                  </div>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      name="payCard"
                      defaultChecked={current.payments?.card === true}
                    />
                    Cards
                  </label>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      name="payNetbanking"
                      defaultChecked={current.payments?.netbanking === true}
                    />
                    Net banking
                  </label>
                </fieldset>

                <label className="settings-check">
                  <input
                    type="checkbox"
                    name="requireCodConfirmation"
                    defaultChecked={current.requireCodConfirmation}
                  />
                  Confirm before placing COD orders
                </label>
              </section>

              <section className="customize-panel" aria-labelledby="customize-modules">
                <h3 id="customize-modules">Shopper modules</h3>
                <p className="hint">Turn sections on or off in the checkout experience.</p>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    name="showUpsell"
                    defaultChecked={current.showUpsell !== false}
                  />
                  “You may also like” upsells
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    name="giftVouchersEnabled"
                    defaultChecked={current.giftVouchersEnabled !== false}
                  />
                  Gift vouchers
                </label>
                <label htmlFor="giftVoucherVerifyMode">Gift voucher verification</label>
                <select
                  id="giftVoucherVerifyMode"
                  name="giftVoucherVerifyMode"
                  defaultValue={current.giftVoucherVerifyMode === 'otp' ? 'otp' : 'pin'}
                >
                  <option value="pin">PIN</option>
                  <option value="otp">OTP</option>
                </select>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    name="loyaltyPartnerEnabled"
                    defaultChecked={current.loyaltyPartnerEnabled !== false}
                  />
                  Loyalty partner points
                </label>
                <label htmlFor="loyaltyPartnerName">Loyalty partner name</label>
                <input
                  id="loyaltyPartnerName"
                  name="loyaltyPartnerName"
                  type="text"
                  maxLength={80}
                  defaultValue={current.loyaltyPartnerName || ''}
                  placeholder="EasyRewardz"
                />
                <label htmlFor="loyaltyPointsBalance">Demo points balance</label>
                <input
                  id="loyaltyPointsBalance"
                  name="loyaltyPointsBalance"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={current.loyaltyPointsBalance || 0}
                />
              </section>
            </div>

            <div className="customize-footer">
              <button type="submit" className="button" disabled={saving}>
                {saving ? 'Saving…' : 'Save checkout customization'}
              </button>
              {actionData?.ok ? (
                <p className="settings-ok" role="status">
                  Saved — shoppers will see this on the next checkout open.
                </p>
              ) : null}
              {actionData?.error ? (
                <p id="shop-error" role="alert">
                  {actionData.error}
                </p>
              ) : null}
            </div>
          </Form>
        </li>

        {/* <li className="onboard-card onboard-card-muted">
          <div className="onboard-card-head">
            <span className="onboard-step-num onboard-step-num-muted" aria-hidden="true">
              3
            </span>
            <div>
              <h2>Ops dashboard</h2>
              <p>
                Optional deeper view for payments and monitoring. Same live settings API — use it
                when you need the full Checkout OS console.
              </p>
            </div>
          </div>
          <div className="onboard-card-actions">
            <Link className="button button-secondary" to="/app/dashboard">
              Open Checkout OS
            </Link>
          </div>
        </li> */}
      </ol>
    </main>
  );
}
