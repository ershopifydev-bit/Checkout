import { Router } from 'express';
import { collections } from '../config/database.js';

export const settingsRouter: Router = Router();

const DEFAULT_SETTINGS = {
  shop: 'codemadi.myshopify.com',
  brandMode: 'name',
  brandName: 'RARE',
  logoUrl: '',
  requireCodConfirmation: true,
  showUpsell: true,
  giftVouchersEnabled: true,
  giftVoucherVerifyMode: 'pin',
  loyaltyPartnerEnabled: true,
  loyaltyPartnerName: 'Tezvix',
  loyaltyPointsBalance: 1250,
  payments: { cod: true, upi: true, card: true, netbanking: true },
};

async function resolveShop(requestedShop?: string | null): Promise<string> {
  if (requestedShop && requestedShop !== 'demo.myshopify.com') {
    return requestedShop;
  }
  // Try finding in checkoutSettings
  const setting = await collections.checkoutSettings().findOne({});
  if (setting && setting['shop']) {
    return String(setting['shop']);
  }
  // Try finding in shopifySessions
  const session = await collections.shopifySessions().findOne({});
  if (session && session['shop']) {
    return String(session['shop']);
  }
  return 'codemadi.myshopify.com';
}

// GET /api/settings - Fetch store checkout settings
settingsRouter.get('/', async (req, res, next) => {
  try {
    const rawShop = req.query['shop'] ? String(req.query['shop']) : undefined;
    const shop = await resolveShop(rawShop);
    const doc = await collections.checkoutSettings().findOne({ shop });

    if (!doc) {
      // Check if any setting doc exists
      const anyDoc = await collections.checkoutSettings().findOne({});
      if (anyDoc) {
        const { _id: _omitted, ...safeDoc } = anyDoc;
        res.json({
          ...DEFAULT_SETTINGS,
          ...safeDoc,
          shop: String(anyDoc['shop'] || shop),
        });
        return;
      }

      res.json({ ...DEFAULT_SETTINGS, shop });
      return;
    }

    const { _id: _omitted, ...safeDoc } = doc;
    res.json({
      ...DEFAULT_SETTINGS,
      ...safeDoc,
      shop,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings - Save store checkout settings
settingsRouter.put('/', async (req, res, next) => {
  try {
    const rawShop = req.query['shop']
      ? String(req.query['shop'])
      : req.body['shop']
        ? String(req.body['shop'])
        : undefined;
    const shop = await resolveShop(rawShop);
    const patch = req.body;

    const updateFields: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (typeof patch.brandMode === 'string') updateFields['brandMode'] = patch.brandMode;
    if (typeof patch.brandName === 'string') updateFields['brandName'] = patch.brandName;
    if (typeof patch.logoUrl === 'string') updateFields['logoUrl'] = patch.logoUrl;
    if (typeof patch.requireCodConfirmation === 'boolean') {
      updateFields['requireCodConfirmation'] = patch.requireCodConfirmation;
    }
    if (typeof patch.showUpsell === 'boolean') updateFields['showUpsell'] = patch.showUpsell;
    if (typeof patch.giftVouchersEnabled === 'boolean') {
      updateFields['giftVouchersEnabled'] = patch.giftVouchersEnabled;
    }
    if (typeof patch.giftVoucherVerifyMode === 'string') {
      updateFields['giftVoucherVerifyMode'] = patch.giftVoucherVerifyMode;
    }
    if (typeof patch.loyaltyPartnerEnabled === 'boolean') {
      updateFields['loyaltyPartnerEnabled'] = patch.loyaltyPartnerEnabled;
    }
    if (typeof patch.loyaltyPartnerName === 'string') {
      updateFields['loyaltyPartnerName'] = patch.loyaltyPartnerName;
    }
    if (typeof patch.loyaltyPointsBalance === 'number') {
      updateFields['loyaltyPointsBalance'] = patch.loyaltyPointsBalance;
    }
    if (patch.payments && typeof patch.payments === 'object') {
      updateFields['payments'] = {
        cod: patch.payments.cod !== false,
        upi: Boolean(patch.payments.upi),
        card: Boolean(patch.payments.card),
        netbanking: Boolean(patch.payments.netbanking),
      };
    }

    const updated = await collections.checkoutSettings().findOneAndUpdate(
      { shop },
      {
        $set: updateFields,
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, returnDocument: 'after' },
    );

    const resultDoc = updated || { ...DEFAULT_SETTINGS, ...updateFields, shop };
    const { _id: _omitted, ...safeDoc } = resultDoc as Record<string, unknown>;

    res.json({
      ...DEFAULT_SETTINGS,
      ...safeDoc,
      shop,
    });
  } catch (error) {
    next(error);
  }
});
