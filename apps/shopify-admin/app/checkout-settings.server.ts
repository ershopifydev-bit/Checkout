import type { Collection, Db } from 'mongodb';

export type BrandMode = 'name' | 'logo';
export type GiftVoucherVerifyMode = 'pin' | 'otp';

export type CheckoutShopSettings = {
  shop: string;
  brandMode: BrandMode;
  brandName: string;
  logoUrl: string;
  /** This flag need to be driven from admin. */
  requireCodConfirmation: boolean;
  showUpsell: boolean;
  giftVouchersEnabled: boolean;
  /** Gift voucher second factor: static PIN or OTP. */
  giftVoucherVerifyMode: GiftVoucherVerifyMode;
  loyaltyPartnerEnabled: boolean;
  loyaltyPartnerName: string;
  /** ponytail: placeholder balance until loyalty partner API drives this. */
  loyaltyPointsBalance: number;
  updatedAt: string;
};

type SettingsDocument = CheckoutShopSettings & { _id: string };

const DEFAULT_BRAND_NAME = 'RARE';

async function mongoDb(): Promise<Db> {
  const { connectMongo } = await import('./shopify.server');
  return connectMongo();
}

async function collection(): Promise<Collection<SettingsDocument>> {
  return (await mongoDb()).collection<SettingsDocument>('checkoutSettings');
}

function normalizeShop(shop: string): string {
  return shop.trim().toLowerCase();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function defaultCheckoutSettings(shop: string): CheckoutShopSettings {
  return {
    shop: normalizeShop(shop),
    brandMode: 'name',
    brandName: DEFAULT_BRAND_NAME,
    logoUrl: '',
    requireCodConfirmation: true,
    showUpsell: true,
    giftVouchersEnabled: true,
    giftVoucherVerifyMode: 'pin',
    loyaltyPartnerEnabled: true,
    loyaltyPartnerName: 'EasyRewardz',
    loyaltyPointsBalance: 1250,
    updatedAt: new Date(0).toISOString(),
  };
}

export function publicCheckoutSettings(settings: CheckoutShopSettings) {
  return {
    brandMode: settings.brandMode,
    brandName: settings.brandName,
    logoUrl: settings.logoUrl,
    requireCodConfirmation: settings.requireCodConfirmation,
    showUpsell: settings.showUpsell,
    giftVouchersEnabled: settings.giftVouchersEnabled,
    giftVoucherVerifyMode: settings.giftVoucherVerifyMode,
    loyaltyPartnerEnabled: settings.loyaltyPartnerEnabled,
    loyaltyPartnerName: settings.loyaltyPartnerName,
    loyaltyPointsBalance: settings.loyaltyPointsBalance,
  };
}

export async function getCheckoutSettings(shop: string): Promise<CheckoutShopSettings> {
  const key = normalizeShop(shop);
  if (!key) return defaultCheckoutSettings('');
  const doc = await (await collection()).findOne({ _id: key });
  if (!doc) return defaultCheckoutSettings(key);
  return {
    shop: key,
    brandMode: doc.brandMode === 'logo' ? 'logo' : 'name',
    brandName: (doc.brandName || DEFAULT_BRAND_NAME).trim() || DEFAULT_BRAND_NAME,
    logoUrl: typeof doc.logoUrl === 'string' ? doc.logoUrl.trim() : '',
    requireCodConfirmation: doc.requireCodConfirmation !== false,
    showUpsell: doc.showUpsell !== false,
    giftVouchersEnabled: doc.giftVouchersEnabled !== false,
    giftVoucherVerifyMode: doc.giftVoucherVerifyMode === 'otp' ? 'otp' : 'pin',
    loyaltyPartnerEnabled: doc.loyaltyPartnerEnabled !== false,
    loyaltyPartnerName:
      typeof doc.loyaltyPartnerName === 'string' && doc.loyaltyPartnerName.trim()
        ? doc.loyaltyPartnerName.trim()
        : 'EasyRewardz',
    loyaltyPointsBalance:
      typeof doc.loyaltyPointsBalance === 'number' && Number.isFinite(doc.loyaltyPointsBalance)
        ? Math.max(0, Math.round(doc.loyaltyPointsBalance))
        : 1250,
    updatedAt: doc.updatedAt || new Date(0).toISOString(),
  };
}

export async function saveCheckoutSettings(
  shop: string,
  input: {
    brandMode?: string;
    brandName?: string;
    logoUrl?: string;
    requireCodConfirmation?: boolean;
    showUpsell?: boolean;
    giftVouchersEnabled?: boolean;
    giftVoucherVerifyMode?: string;
    loyaltyPartnerEnabled?: boolean;
    loyaltyPartnerName?: string;
    loyaltyPointsBalance?: number;
  },
): Promise<CheckoutShopSettings> {
  const key = normalizeShop(shop);
  if (!key) throw new Error('MISSING_SHOP');

  const brandMode: BrandMode = input.brandMode === 'logo' ? 'logo' : 'name';
  const brandName = (input.brandName || DEFAULT_BRAND_NAME).trim().slice(0, 80) || DEFAULT_BRAND_NAME;
  const logoUrl = (input.logoUrl || '').trim().slice(0, 500);
  if (brandMode === 'logo' && logoUrl && !isHttpUrl(logoUrl)) {
    throw new Error('INVALID_LOGO_URL');
  }

  const next: SettingsDocument = {
    _id: key,
    shop: key,
    brandMode,
    brandName,
    logoUrl: brandMode === 'logo' ? logoUrl : '',
    requireCodConfirmation: input.requireCodConfirmation !== false,
    showUpsell: input.showUpsell !== false,
    giftVouchersEnabled: input.giftVouchersEnabled !== false,
    giftVoucherVerifyMode: input.giftVoucherVerifyMode === 'otp' ? 'otp' : 'pin',
    loyaltyPartnerEnabled: input.loyaltyPartnerEnabled !== false,
    loyaltyPartnerName: String(input.loyaltyPartnerName || 'EasyRewardz')
      .trim()
      .slice(0, 80) || 'EasyRewardz',
    loyaltyPointsBalance: Math.max(
      0,
      Math.round(
        typeof input.loyaltyPointsBalance === 'number' && Number.isFinite(input.loyaltyPointsBalance)
          ? input.loyaltyPointsBalance
          : 1250,
      ),
    ),
    updatedAt: new Date().toISOString(),
  };

  await (await collection()).replaceOne({ _id: key }, next, { upsert: true });
  return {
    shop: next.shop,
    brandMode: next.brandMode,
    brandName: next.brandName,
    logoUrl: next.logoUrl,
    requireCodConfirmation: next.requireCodConfirmation,
    showUpsell: next.showUpsell,
    giftVouchersEnabled: next.giftVouchersEnabled,
    giftVoucherVerifyMode: next.giftVoucherVerifyMode,
    loyaltyPartnerEnabled: next.loyaltyPartnerEnabled,
    loyaltyPartnerName: next.loyaltyPartnerName,
    loyaltyPointsBalance: next.loyaltyPointsBalance,
    updatedAt: next.updatedAt,
  };
}
