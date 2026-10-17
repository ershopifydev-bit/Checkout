import { Form, useActionData, useLoaderData, useNavigation } from 'react-router';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import {
  getCheckoutSettings,
  saveCheckoutSettings,
} from '../checkout-settings.server';
import { authenticate, publicApiKey } from '../shopify.server';

/** Liquid filename under extensions/.../blocks/ (not the extension handle). */
const COD_CHECKOUT_BLOCK_HANDLE = 'cod-checkout';

function themeEditorThemeId(): string {
  // While `shopify app dev` runs, embeds are only on the CLI host theme — not the published theme.
  // Copy the theme id from the CLI line: "Setup your theme app extension in the host theme".
  const hostThemeId = process.env['SHOPIFY_THEME_EXTENSION_HOST_THEME_ID']?.trim();
  if (hostThemeId && /^\d+$/.test(hostThemeId)) return hostThemeId;
  return 'current';
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const storeHandle = shop.replace(/\.myshopify\.com$/i, '');
  const themeId = themeEditorThemeId();
  // https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration#app-embed-block-deep-linking
  // Do not URL-encode the slash in activateAppId — Shopify expects api_key/handle literally.
  const enableEmbedUrl = `https://admin.shopify.com/store/${storeHandle}/themes/${themeId}/editor?context=apps&activateAppId=${publicApiKey}/${COD_CHECKOUT_BLOCK_HANDLE}`;
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
    enableEmbedUrl,
    usesDevHostTheme: themeId !== 'current',
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
  const { shop, enableEmbedUrl, usesDevHostTheme, settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === 'submitting';
  const current = actionData?.settings || settings;

  return (
    <main className="welcome">
      <p className="eyebrow">Shopify connection</p>
      <h1>Checkout</h1>
      <section>
        <h2>Store connection</h2>
        <p>You’re connected to {shop} through Shopify.</p>
      </section>
      <section>
        <h2>Checkout branding</h2>
        <p>Choose what shoppers see in the center of the checkout header — a brand name or a logo.</p>
        <Form method="post" className="settings-form">
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
            placeholder="RARE"
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
          <p className="hint">Used when “Brand logo” is selected. Paste a direct image URL (https).</p>
          <label className="settings-check">
            <input
              type="checkbox"
              name="requireCodConfirmation"
              defaultChecked={current.requireCodConfirmation}
            />
            Ask for confirmation before placing COD orders
          </label>
          <p className="hint">This flag need to be driven from admin.</p>
          <label className="settings-check">
            <input
              type="checkbox"
              name="showUpsell"
              defaultChecked={current.showUpsell !== false}
            />
            Show “You may also like”
          </label>
          <p className="hint">When off, the upsell rail is hidden on checkout.</p>
          <label className="settings-check">
            <input
              type="checkbox"
              name="giftVouchersEnabled"
              defaultChecked={current.giftVouchersEnabled !== false}
            />
            Enable gift vouchers
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
          <p className="hint">Checkout asks for PIN or OTP after the shopper taps Redeem your GV.</p>
          <label className="settings-check">
            <input
              type="checkbox"
              name="loyaltyPartnerEnabled"
              defaultChecked={current.loyaltyPartnerEnabled !== false}
            />
            Show loyalty partner points
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
          <label htmlFor="loyaltyPointsBalance">Loyalty points balance (demo)</label>
          <input
            id="loyaltyPointsBalance"
            name="loyaltyPointsBalance"
            type="number"
            min={0}
            step={1}
            defaultValue={current.loyaltyPointsBalance || 0}
          />
          <p className="hint">This flag need to be driven from admin / loyalty partner API.</p>
          <p className="actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </p>
          {actionData?.ok ? <p className="settings-ok">Saved.</p> : null}
          {actionData?.error ? <p id="shop-error">{actionData.error}</p> : null}
        </Form>
      </section>
      <section>
        <h2>COD checkout on the storefront</h2>
        <p>
          Enable the <strong>COD Checkout</strong> app embed so shoppers who click Checkout / Buy
          now open the one-page COD overlay on your store (same page), not a separate checkout site.
        </p>
        <p className="actions">
          <a className="button" href={enableEmbedUrl} target="_top" rel="noopener noreferrer">
            Enable COD Checkout on theme
          </a>
        </p>
        <p className="hint">
          {usesDevHostTheme
            ? 'Opens the Shopify CLI development host theme (required while pnpm dev is running). Turn COD Checkout on under App embeds, then Save.'
            : 'Opens the theme editor with the app embed ready to turn on. Click Save in the editor after enabling it.'}
        </p>
        <p>
          Demo orders stay local until Shopify Admin order sync is enabled. Prepaid methods remain
          disabled.
        </p>
      </section>
    </main>
  );
}
