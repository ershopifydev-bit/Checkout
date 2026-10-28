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
  createdAt?: string | undefined;
  shopifyOrderName?: string | undefined;
}

export interface OrderAttemptRecord {
  _id: string;
  shop: string;
  checkoutSessionId: string;
  status:
    'CREATED' | 'VALIDATING' | 'READY' | 'CREATING' | 'CONFIRMED' | 'FAILED' | 'MANUAL_REVIEW';
  expectedAmountMinor: number;
  formattedAmount: string;
  shopifyOrderName?: string | undefined;
  shopifyOrderId?: string | undefined;
  createdAt: string;
  updatedAt: string;
  lastErrorCode?: string | undefined;
  lastErrorMessage?: string | undefined;
}

export interface ConnectorItem {
  name: string;
  description: string;
  connected: boolean;
}

export interface MonitorOverviewData {
  database: {
    status: 'HEALTHY' | 'DEGRADED';
    databaseName: string;
    latencyMs: number;
    totalCollections: number;
    collections: string[];
    storageStats: {
      dataSizeMb: number;
      storageSizeMb: number;
      indexSizeMb: number;
      totalObjects: number;
    };
  };
  ordersAndAttempts: {
    totalAttempts: number;
    confirmed: number;
    failed: number;
    manualReview: number;
    confirmedRevenue: {
      minor: number;
      formatted: string;
    };
    failureRatePercent: number;
  };
  funnelsAndCheckouts: {
    totalFunnelSessions: number;
    totalAbandoned: number;
    conversionRatePercent: number;
  };
  eventStream: {
    totalRecordedEvents: number;
    latestEvents: Array<{
      _id: string;
      shop: string;
      sessionId: string;
      event: string;
      step: string;
      timestamp: string;
      cartValueMinor?: number | undefined;
    }>;
  };
  latestAttempts: OrderAttemptRecord[];
  monitoredAt: string;
}

export interface TeamUserItem {
  _id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string | undefined;
}
