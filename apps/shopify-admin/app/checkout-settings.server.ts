import type { Collection, Db } from 'mongodb';

export type BrandMode = 'name' | 'logo';
export type GiftVoucherVerifyMode = 'pin' | 'otp';
export type UpiAppId = 'paytm' | 'phonepe' | 'gpay' | 'amazonpay' | 'bhim' | 'cred';

/** Storefront payment rows merchants can toggle from the dashboard. */
export type PaymentMethodsConfig = {
  cod: boolean;
  upi: boolean;
  card: boolean;
  netbanking: boolean;
};

export type UpiSettingsConfig = {
  vpa: string;
  merchantName: string;
  discountBadge: string;
  cashbackBadge: string;
  apps: UpiAppId[];
};

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
  /** Which pay rows show on checkout. Prepaid place is still demo-only. */
  payments: PaymentMethodsConfig;
  /** Configures UPI QR on desktop & app cards on mobile. */
  upiConfig: UpiSettingsConfig;
  updatedAt: string;
};

type SettingsDocument = CheckoutShopSettings & { _id: string };

const DEFAULT_BRAND_NAME = 'RARE';

export const DEFAULT_UPI_APPS: UpiAppId[] = [
  'paytm',
  'phonepe',
  'gpay',
  'amazonpay',
  'bhim',
  'cred',
];

export function defaultUpiConfig(fallbackMerchant = DEFAULT_BRAND_NAME): UpiSettingsConfig {
  return {
    vpa: '',
    merchantName: fallbackMerchant,
    discountBadge: '₹50 Off',
    cashbackBadge: 'Win Cashback',
    apps: [...DEFAULT_UPI_APPS],
  };
}

export function normalizeUpiConfig(
  input?: Partial<UpiSettingsConfig> | null,
  fallbackMerchant = DEFAULT_BRAND_NAME,
): UpiSettingsConfig {
  const allowed = new Set<string>(DEFAULT_UPI_APPS);
  const rawApps = Array.isArray(input?.apps) ? input.apps : [];
  const validApps = rawApps
    .map((a) => String(a).toLowerCase().trim() as UpiAppId)
    .filter((a): a is UpiAppId => allowed.has(a));
  const uniqueApps = Array.from(new Set(validApps));
  const finalApps = uniqueApps.length > 0 ? uniqueApps : [...DEFAULT_UPI_APPS];

  return {
    vpa: typeof input?.vpa === 'string' ? input.vpa.trim().slice(0, 80) : '',
    merchantName:
      typeof input?.merchantName === 'string' && input.merchantName.trim()
        ? input.merchantName.trim().slice(0, 80)
        : fallbackMerchant,
    discountBadge:
      typeof input?.discountBadge === 'string' && input.discountBadge.trim()
        ? input.discountBadge.trim().slice(0, 30)
        : '₹50 Off',
    cashbackBadge:
      typeof input?.cashbackBadge === 'string' && input.cashbackBadge.trim()
        ? input.cashbackBadge.trim().slice(0, 30)
        : 'Win Cashback',
    apps: finalApps,
  };
}

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

export function defaultPaymentMethods(): PaymentMethodsConfig {
  // Prepaid off until a merchant enables them — COD stays the live path.
  return { cod: true, upi: false, card: false, netbanking: false };
}

export function normalizePaymentMethods(
  input?: Partial<PaymentMethodsConfig> | null,
): PaymentMethodsConfig {
  const next: PaymentMethodsConfig = {
    cod: input?.cod !== false,
    upi: input?.upi === true,
    card: input?.card === true,
    netbanking: input?.netbanking === true,
  };
  // At least one method must remain selectable.
  if (!next.cod && !next.upi && !next.card && !next.netbanking) {
    next.cod = true;
  }
  return next;
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
    payments: defaultPaymentMethods(),
    upiConfig: defaultUpiConfig(DEFAULT_BRAND_NAME),
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
    payments: settings.payments,
    upiConfig: settings.upiConfig,
  };
}

export async function getCheckoutSettings(shop: string): Promise<CheckoutShopSettings> {
  const key = normalizeShop(shop);
  if (!key) return defaultCheckoutSettings('');
  const doc = await (await collection()).findOne({ _id: key });
  if (!doc) return defaultCheckoutSettings(key);
  const brandName = (doc.brandName || DEFAULT_BRAND_NAME).trim() || DEFAULT_BRAND_NAME;
  return {
    shop: key,
    brandMode: doc.brandMode === 'logo' ? 'logo' : 'name',
    brandName,
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
    payments: normalizePaymentMethods(
      doc.payments && typeof doc.payments === 'object' ? doc.payments : null,
    ),
    upiConfig: normalizeUpiConfig(
      doc.upiConfig && typeof doc.upiConfig === 'object' ? doc.upiConfig : null,
      brandName,
    ),
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
    payments?: Partial<PaymentMethodsConfig>;
    upiConfig?: Partial<UpiSettingsConfig>;
  },
): Promise<CheckoutShopSettings> {
  const key = normalizeShop(shop);
  if (!key) throw new Error('MISSING_SHOP');

  const current = await getCheckoutSettings(key);

  const brandMode: BrandMode =
    input.brandMode === 'logo' || input.brandMode === 'name' ? input.brandMode : current.brandMode;
  const brandName =
    input.brandName !== undefined
      ? (input.brandName || DEFAULT_BRAND_NAME).trim().slice(0, 80) || DEFAULT_BRAND_NAME
      : current.brandName;
  const logoUrlRaw =
    input.logoUrl !== undefined ? (input.logoUrl || '').trim().slice(0, 500) : current.logoUrl;
  if (brandMode === 'logo' && logoUrlRaw && !isHttpUrl(logoUrlRaw)) {
    throw new Error('INVALID_LOGO_URL');
  }

  const next: SettingsDocument = {
    _id: key,
    shop: key,
    brandMode,
    brandName,
    logoUrl: brandMode === 'logo' ? logoUrlRaw : '',
    requireCodConfirmation:
      typeof input.requireCodConfirmation === 'boolean'
        ? input.requireCodConfirmation
        : current.requireCodConfirmation,
    showUpsell: typeof input.showUpsell === 'boolean' ? input.showUpsell : current.showUpsell,
    giftVouchersEnabled:
      typeof input.giftVouchersEnabled === 'boolean'
        ? input.giftVouchersEnabled
        : current.giftVouchersEnabled,
    giftVoucherVerifyMode:
      input.giftVoucherVerifyMode === 'otp' || input.giftVoucherVerifyMode === 'pin'
        ? input.giftVoucherVerifyMode
        : current.giftVoucherVerifyMode,
    loyaltyPartnerEnabled:
      typeof input.loyaltyPartnerEnabled === 'boolean'
        ? input.loyaltyPartnerEnabled
        : current.loyaltyPartnerEnabled,
    loyaltyPartnerName:
      input.loyaltyPartnerName !== undefined
        ? String(input.loyaltyPartnerName || 'EasyRewardz')
            .trim()
            .slice(0, 80) || 'EasyRewardz'
        : current.loyaltyPartnerName,
    loyaltyPointsBalance:
      typeof input.loyaltyPointsBalance === 'number' && Number.isFinite(input.loyaltyPointsBalance)
        ? Math.max(0, Math.round(input.loyaltyPointsBalance))
        : current.loyaltyPointsBalance,
    payments: normalizePaymentMethods(
      input.payments ? { ...current.payments, ...input.payments } : current.payments,
    ),
    upiConfig: normalizeUpiConfig(
      input.upiConfig ? { ...current.upiConfig, ...input.upiConfig } : current.upiConfig,
      brandName,
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
    payments: next.payments,
    upiConfig: next.upiConfig,
    updatedAt: next.updatedAt,
  };
}
