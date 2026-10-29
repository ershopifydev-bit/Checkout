import { storeFilter } from '../middleware/store-access.js';
import { Router } from 'express';
import { collections } from '../config/database.js';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';

export const storesRouter: Router = Router();

storesRouter.use(authenticate);

// GET /api/stores - List all connected Shopify stores from shopifySessions & checkoutSettings
storesRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const [sessions, settingsList] = await Promise.all([
      collections.shopifySessions().find(storeFilter(req.user!)).toArray(),
      collections.checkoutSettings().find(storeFilter(req.user!)).toArray(),
    ]);

    const shopSet = new Set<string>();
    for (const s of sessions) {
      if (s['shop']) shopSet.add(String(s['shop']));
    }
    for (const s of settingsList) {
      if (s['shop']) shopSet.add(String(s['shop']));
    }

    const stores = await Promise.all(
      Array.from(shopSet).map(async (shop) => {
        const rawSetting = settingsList.find((s) => s['shop'] === shop);
        const setting: Record<string, unknown> = (rawSetting as Record<string, unknown>) || {};
        const session = sessions.find((s) => s['shop'] === shop);
        const [eventCount, attemptCount, confirmedCount] = await Promise.all([
          collections.checkoutEvents().countDocuments({ shop }),
          collections.checkoutOrderAttempts().countDocuments({ shop }),
          collections.checkoutOrderAttempts().countDocuments({ shop, status: 'CONFIRMED' }),
        ]);

        const brandName =
          (setting['brandName'] as string) || shop.replace('.myshopify.com', '').toUpperCase();

        return {
          shop,
          brandName,
          brandMode: (setting['brandMode'] as string) || 'name',
          logoUrl: (setting['logoUrl'] as string) || '',
          status: session ? 'Connected' : 'Configured',
          hasSession: Boolean(session),
          eventCount,
          attemptCount,
          confirmedCount,
          themeEmbedHandle: 'cod-checkout',
          updatedAt: setting['updatedAt'] || session?.['updatedAt'] || new Date(),
        };
      }),
    );

    res.json({
      stores,
      total: stores.length,
    });
  } catch (error) {
    next(error);
  }
});
