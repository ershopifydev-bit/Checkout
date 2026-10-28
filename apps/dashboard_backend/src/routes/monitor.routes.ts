import { Router } from 'express';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { getDb, pingDatabase, collections } from '../config/database.js';

export const monitorRouter: Router = Router();

monitorRouter.use(authenticate);
monitorRouter.use(requirePermission('monitor:read'));

// GET /api/monitor/overview - Comprehensive database health and operational overview
monitorRouter.get('/overview', async (_req: AuthenticatedRequest, res, next) => {
  try {
    const db = getDb();
    const ping = await pingDatabase();

    // Query stats across core business collections in parallel
    const [
      rawDbStats,
      collectionsList,
      totalAttempts,
      confirmedOrders,
      failedOrders,
      reviewOrders,
      funnelCount,
      abandonedCount,
      totalEvents,
      recentEvents,
      recentAttempts,
    ] = await Promise.all([
      db.stats().catch(() => ({})),
      db
        .listCollections()
        .toArray()
        .catch(() => []),
      collections
        .checkoutOrderAttempts()
        .countDocuments()
        .catch(() => 0),
      collections
        .checkoutOrderAttempts()
        .countDocuments({ status: 'CONFIRMED' })
        .catch(() => 0),
      collections
        .checkoutOrderAttempts()
        .countDocuments({ status: 'FAILED' })
        .catch(() => 0),
      collections
        .checkoutOrderAttempts()
        .countDocuments({ status: 'MANUAL_REVIEW' })
        .catch(() => 0),
      collections
        .checkoutFunnels()
        .countDocuments()
        .catch(() => 0),
      collections
        .checkoutFunnels()
        .countDocuments({ status: 'checkout_abandoned' })
        .catch(() => 0),
      collections
        .checkoutEvents()
        .countDocuments()
        .catch(() => 0),
      collections
        .checkoutEvents()
        .find({})
        .sort({ timestamp: -1 })
        .limit(10)
        .toArray()
        .catch(() => []),
      collections
        .checkoutOrderAttempts()
        .find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray()
        .catch(() => []),
    ]);

    const dbStats = (rawDbStats as Record<string, unknown>) || {};

    // Calculate revenue metrics from confirmed orders
    const revenueAgg = await collections
      .checkoutOrderAttempts()
      .aggregate<{ _id: null; totalMinor: number }>([
        { $match: { status: 'CONFIRMED' } },
        { $group: { _id: null, totalMinor: { $sum: '$expectedAmountMinor' } } },
      ])
      .toArray()
      .catch(() => []);

    const firstRev = revenueAgg[0];
    const totalConfirmedRevenueMinor = firstRev ? firstRev.totalMinor : 0;
    const totalConfirmedRevenueRupees = (totalConfirmedRevenueMinor / 100).toLocaleString('en-IN', {
      maximumFractionDigits: 2,
    });

    const conversionRate =
      funnelCount > 0 ? Number(((confirmedOrders / funnelCount) * 100).toFixed(2)) : 0;

    res.json({
      database: {
        status: ping.ok ? 'HEALTHY' : 'DEGRADED',
        databaseName: db.databaseName,
        latencyMs: ping.latencyMs,
        totalCollections: collectionsList.length,
        collections: collectionsList.map((c) => c.name),
        storageStats: {
          dataSizeMb: Number((Number(dbStats['dataSize'] || 0) / (1024 * 1024)).toFixed(2)),
          storageSizeMb: Number((Number(dbStats['storageSize'] || 0) / (1024 * 1024)).toFixed(2)),
          indexSizeMb: Number((Number(dbStats['indexSize'] || 0) / (1024 * 1024)).toFixed(2)),
          totalObjects: Number(dbStats['objects'] || 0),
        },
      },
      ordersAndAttempts: {
        totalAttempts,
        confirmed: confirmedOrders,
        failed: failedOrders,
        manualReview: reviewOrders,
        confirmedRevenue: {
          minor: totalConfirmedRevenueMinor,
          formatted: `₹${totalConfirmedRevenueRupees}`,
        },
        failureRatePercent:
          totalAttempts > 0 ? Number(((failedOrders / totalAttempts) * 100).toFixed(2)) : 0,
      },
      funnelsAndCheckouts: {
        totalFunnelSessions: funnelCount,
        totalAbandoned: abandonedCount,
        conversionRatePercent: conversionRate,
      },
      eventStream: {
        totalRecordedEvents: totalEvents,
        latestEvents: recentEvents,
      },
      latestAttempts: recentAttempts,
      monitoredAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/monitor/stats - Detailed MongoDB server & database metrics
monitorRouter.get('/stats', async (_req, res, next) => {
  try {
    const db = getDb();
    const [rawDbStats, rawServerStatus] = await Promise.all([
      db.stats().catch(() => ({})),
      db
        .admin()
        .serverStatus()
        .catch(() => ({})),
    ]);

    const serverStatus = (rawServerStatus as Record<string, unknown>) || {};

    res.json({
      database: db.databaseName,
      stats: rawDbStats,
      server: {
        version: serverStatus['version'] || 'unknown',
        uptimeSeconds: serverStatus['uptime'] || 0,
        connections: serverStatus['connections'] || {},
        mem: serverStatus['mem'] || {},
        network: serverStatus['network'] || {},
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/monitor/collections - Real-time inspection of all database collections
monitorRouter.get('/collections', async (_req, res, next) => {
  try {
    const db = getDb();
    const cols = await db.listCollections().toArray();

    const collectionDetails = await Promise.all(
      cols.map(async (colInfo) => {
        const col = db.collection(colInfo.name);
        const [count, indexes] = await Promise.all([
          col.estimatedDocumentCount().catch(() => 0),
          col.indexes().catch(() => []),
        ]);

        return {
          name: colInfo.name,
          type: colInfo.type || 'collection',
          documentCount: count,
          indexes: indexes.map((idx) => ({
            name: idx.name,
            key: idx.key,
            unique: Boolean(idx.unique),
          })),
        };
      }),
    );

    res.json({
      database: db.databaseName,
      collections: collectionDetails,
      total: collectionDetails.length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/monitor/collections/:name - Inspect specific collection documents & schema
monitorRouter.get('/collections/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 20));
    const skip = Math.max(0, Number(req.query['skip']) || 0);

    const db = getDb();
    const col = db.collection(name);

    const [count, indexes, sampleDocs] = await Promise.all([
      col.countDocuments().catch(() => 0),
      col.indexes().catch(() => []),
      col
        .find({})
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray()
        .catch(() => []),
    ]);

    res.json({
      collection: name,
      totalDocuments: count,
      indexes,
      limit,
      skip,
      documents: sampleDocs,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/monitor/live-events - Query real-time checkout events stream
monitorRouter.get('/live-events', async (req, res, next) => {
  try {
    const { event, shop } = req.query;
    const limit = Math.min(200, Math.max(1, Number(req.query['limit']) || 50));
    const skip = Math.max(0, Number(req.query['skip']) || 0);

    const filter: Record<string, unknown> = {};
    if (typeof event === 'string' && event.trim()) {
      filter['event'] = event.trim();
    }
    if (typeof shop === 'string' && shop.trim()) {
      filter['shop'] = shop.trim();
    }

    const [events, total] = await Promise.all([
      collections
        .checkoutEvents()
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      collections.checkoutEvents().countDocuments(filter),
    ]);

    res.json({
      events,
      total,
      limit,
      skip,
    });
  } catch (error) {
    next(error);
  }
});
