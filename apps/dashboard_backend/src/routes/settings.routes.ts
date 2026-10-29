import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { requireStoreAccess } from '../middleware/store-access.js';
import { Router } from 'express';
import { collections } from '../config/database.js';

export const settingsRouter: Router = Router();
settingsRouter.use(authenticate, requireStoreAccess);

const DEFAULT_SETTINGS = {
  shop: 'demo.myshopify.com',
  brandMode: 'name',
  brandName: 'Tezvix Store',
  logoUrl: '',
  requireCodConfirmation: true,
  showUpsell: true,
  giftVouchersEnabled: true,
  giftVoucherVerifyMode: 'pin',
  loyaltyPartnerEnabled: true,
  loyaltyPartnerName: 'Tezvix Rewards',
  loyaltyPointsBalance: 1250,
  payments: { cod: true, upi: false, card: false, netbanking: false },
};

// GET /api/settings - Fetch store checkout settings
settingsRouter.get(
  '/',
  requirePermission('settings:read'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const shop = String(req.query['shop'] || req.user?.shops?.[0] || '');
      if (!shop) {
        res.status(400).json({ error: { message: 'Select a store first.' } });
        return;
      }
      const doc = await collections.checkoutSettings().findOne({ shop });

      if (!doc) {
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
  },
);

// PUT /api/settings - Save store checkout settings
settingsRouter.put(
  '/',
  requirePermission('settings:write'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const shop = String(req.query['shop'] || req.body['shop'] || req.user?.shops?.[0] || '');
      if (!shop) {
        res.status(400).json({ error: { message: 'Select a store first.' } });
        return;
      }
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
  },
);
