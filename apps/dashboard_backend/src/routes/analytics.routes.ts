import { authenticate } from '../middleware/auth.js';
import { requireStoreAccess, requestStoreFilter } from '../middleware/store-access.js';
import { Router } from 'express';
import { collections } from '../config/database.js';

export const analyticsRouter: Router = Router();
analyticsRouter.use(authenticate, requireStoreAccess);

// GET /api/analytics - Compatibility endpoint for apps/dashboard useLiveAnalytics() hook
analyticsRouter.get('/', async (req, res, next) => {
  try {
    const shop = String(req.query['shop'] || 'demo.myshopify.com');
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50));

    // Aggregate funnel events for shop (or all if demo)
    const matchShop = requestStoreFilter(req);

    const [
      startedCount,
      loggedInCount,
      addressCount,
      discountCount,
      completedCount,
      abandonedCount,
      abandonedRecords,
    ] = await Promise.all([
      collections
        .checkoutEvents()
        .countDocuments({ ...matchShop, event: 'started' })
        .catch(() => 0),
      collections
        .checkoutEvents()
        .countDocuments({ ...matchShop, event: 'logged_in' })
        .catch(() => 0),
      collections
        .checkoutEvents()
        .countDocuments({ ...matchShop, event: 'address_added' })
        .catch(() => 0),
      collections
        .checkoutEvents()
        .countDocuments({ ...matchShop, event: 'discount_applied' })
        .catch(() => 0),
      collections
        .checkoutEvents()
        .countDocuments({ ...matchShop, event: 'checkout_completed' })
        .catch(() => 0),
      collections
        .checkoutFunnels()
        .countDocuments({ ...matchShop, status: 'checkout_abandoned' })
        .catch(() => 0),
      collections
        .checkoutFunnels()
        .find({ ...matchShop, status: 'checkout_abandoned' })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .toArray()
        .catch(() => []),
    ]);

    const totalStarted = Math.max(startedCount, completedCount + abandonedCount, 1);
    const conversionRatePercent = Number(((completedCount / totalStarted) * 100).toFixed(1));

    const funnel = {
      shop,
      totalStarted,
      totalLoggedIn: loggedInCount,
      totalAddressAdded: addressCount,
      totalDiscountApplied: discountCount,
      totalCompleted: completedCount,
      totalAbandoned: abandonedCount,
      conversionRatePercent,
      dropOffByStep: {
        login: Math.max(0, totalStarted - loggedInCount),
        address: Math.max(0, loggedInCount - addressCount),
        discounts: Math.max(0, addressCount - discountCount),
        payment: Math.max(0, (discountCount || addressCount) - completedCount),
      },
    };

    const abandoned = abandonedRecords.map((doc) => ({
      sessionId: String(doc['_id'] || doc['sessionId']),
      shopperPhone: (doc['shopperPhone'] as string) || undefined,
      shopperName: (doc['shopperName'] as string) || undefined,
      cartValueMinor: Number(doc['cartValueMinor'] || 0),
      itemCount: Number(doc['itemCount'] || 1),
      items: Array.isArray(doc['items']) ? doc['items'] : [],
      droppedAt: String(doc['currentStep'] || 'payment'),
      updatedAt: doc['updatedAt']
        ? new Date(doc['updatedAt'] as string).toISOString()
        : new Date().toISOString(),
      createdAt: doc['createdAt']
        ? new Date(doc['createdAt'] as string).toISOString()
        : new Date().toISOString(),
    }));

    res.json({
      shop,
      funnel,
      abandoned,
    });
  } catch (error) {
    next(error);
  }
});
