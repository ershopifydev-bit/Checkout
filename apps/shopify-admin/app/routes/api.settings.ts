import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import {
  getCheckoutSettings,
  publicCheckoutSettings,
  saveCheckoutSettings,
  type PaymentMethodsConfig,
  type UpiAppId,
  type UpiSettingsConfig,
} from '../checkout-settings.server';
import { authenticate } from '../shopify.server';
import { verifyDashboardToken } from '../dashboard-token.server';

type SettingsPatch = Parameters<typeof saveCheckoutSettings>[1];

function shopFromToken(token?: string | null): string | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const [shop] = raw.split(':');
    return shop || null;
  } catch {
    return null;
  }
}

async function authenticateSettingsRequest(request: Request): Promise<{ shop: string }> {
  try {
    const { session } = await authenticate.admin(request);
    return { shop: session.shop };
  } catch (err) {
    const url = new URL(request.url);
    const token = request.headers.get('x-dashboard-token') || url.searchParams.get('token');
    const shop = url.searchParams.get('shop') || shopFromToken(token);
    const secret = process.env['SESSION_ENCRYPTION_KEY'] || 'checkout-dashboard-secret';
    if (token && shop && verifyDashboardToken(token, shop, secret)) {
      return { shop };
    }
    throw err;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPayments(raw: unknown): Partial<PaymentMethodsConfig> | undefined {
  const obj = asRecord(raw);
  if (!obj) return undefined;
  const out: Partial<PaymentMethodsConfig> = {};
  if (typeof obj['cod'] === 'boolean') out.cod = obj['cod'];
  if (typeof obj['upi'] === 'boolean') out.upi = obj['upi'];
  if (typeof obj['card'] === 'boolean') out.card = obj['card'];
  if (typeof obj['netbanking'] === 'boolean') out.netbanking = obj['netbanking'];
  return out;
}

function readUpiConfig(raw: unknown): Partial<UpiSettingsConfig> | undefined {
  const obj = asRecord(raw);
  if (!obj) return undefined;
  const out: Partial<UpiSettingsConfig> = {};
  if (typeof obj['vpa'] === 'string') out.vpa = obj['vpa'];
  if (typeof obj['merchantName'] === 'string') out.merchantName = obj['merchantName'];
  if (typeof obj['discountBadge'] === 'string') out.discountBadge = obj['discountBadge'];
  if (typeof obj['cashbackBadge'] === 'string') out.cashbackBadge = obj['cashbackBadge'];
  if (Array.isArray(obj['apps'])) {
    out.apps = obj['apps'].map((a) => String(a).toLowerCase().trim() as UpiAppId);
  }
  return out;
}

function patchFromBody(body: Record<string, unknown>): SettingsPatch {
  const patch: SettingsPatch = {};
  if (typeof body['brandMode'] === 'string') patch.brandMode = body['brandMode'];
  if (typeof body['brandName'] === 'string') patch.brandName = body['brandName'];
  if (typeof body['logoUrl'] === 'string') patch.logoUrl = body['logoUrl'];
  if (typeof body['requireCodConfirmation'] === 'boolean') {
    patch.requireCodConfirmation = body['requireCodConfirmation'];
  }
  if (typeof body['showUpsell'] === 'boolean') patch.showUpsell = body['showUpsell'];
  if (typeof body['giftVouchersEnabled'] === 'boolean') {
    patch.giftVouchersEnabled = body['giftVouchersEnabled'];
  }
  if (typeof body['giftVoucherVerifyMode'] === 'string') {
    patch.giftVoucherVerifyMode = body['giftVoucherVerifyMode'];
  }
  if (typeof body['loyaltyPartnerEnabled'] === 'boolean') {
    patch.loyaltyPartnerEnabled = body['loyaltyPartnerEnabled'];
  }
  if (typeof body['loyaltyPartnerName'] === 'string') {
    patch.loyaltyPartnerName = body['loyaltyPartnerName'];
  }
  if (typeof body['loyaltyPointsBalance'] === 'number') {
    patch.loyaltyPointsBalance = body['loyaltyPointsBalance'];
  }
  const payments = readPayments(body['payments']);
  if (payments) patch.payments = payments;
  const upiConfig = readUpiConfig(body['upiConfig']);
  if (upiConfig) patch.upiConfig = upiConfig;
  return patch;
}

/** Admin-session JSON API for the Tezvix OS dashboard (not on the shopper hot path). */
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await authenticateSettingsRequest(request);
  const settings = await getCheckoutSettings(shop);
  return Response.json({
    shop,
    ...publicCheckoutSettings(settings),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await authenticateSettingsRequest(request);
  if (request.method !== 'PUT' && request.method !== 'POST' && request.method !== 'PATCH') {
    return Response.json({ error: { message: 'Method not allowed' } }, { status: 405 });
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    const record = asRecord(parsed);
    if (!record) {
      return Response.json({ error: { message: 'Invalid JSON body' } }, { status: 400 });
    }
    body = record;
  } catch {
    return Response.json({ error: { message: 'Invalid JSON body' } }, { status: 400 });
  }

  try {
    const settings = await saveCheckoutSettings(shop, patchFromBody(body));
    return Response.json({
      shop,
      ...publicCheckoutSettings(settings),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SAVE_FAILED';
    return Response.json(
      {
        error: {
          message:
            code === 'INVALID_LOGO_URL'
              ? 'Logo URL must start with http:// or https://'
              : 'Could not save settings.',
        },
      },
      { status: 400 },
    );
  }
}
