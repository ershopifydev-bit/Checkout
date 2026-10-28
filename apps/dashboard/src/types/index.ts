export type PortalType = 'm' | 'i';

export type NavItem = [string, number];

export interface PaymentMethods {
  cod: boolean;
  upi: boolean;
  card: boolean;
  netbanking: boolean;
}

export interface CheckoutSettings {
  shop?: string | undefined;
  brandMode?: 'name' | 'logo' | undefined;
  brandName?: string | undefined;
  logoUrl?: string | undefined;
  requireCodConfirmation?: boolean | undefined;
  showUpsell?: boolean | undefined;
  giftVouchersEnabled?: boolean | undefined;
  giftVoucherVerifyMode?: 'pin' | 'otp' | undefined;
  loyaltyPartnerEnabled?: boolean | undefined;
  loyaltyPartnerName?: string | undefined;
  loyaltyPointsBalance?: number | undefined;
  payments?: PaymentMethods | undefined;
}

export interface OrderItem {
  id: string;
  customer: string;
  city: string;
  mode: string;
  status: 'Paid' | 'Pending' | 'Failed';
  riskCheck: string;
  riskCheckType: 'g' | 'o' | 'b' | 'n';
  amount: string;
}

export interface ConnectorItem {
  name: string;
  description: string;
  connected: boolean;
}
