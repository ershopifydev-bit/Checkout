import React from 'react';
import { KpiCard } from '../components/common/KpiCard';
import { useLiveMonitor } from '../hooks/useLiveMonitor';
import { useLiveAnalytics } from '../hooks/useLiveAnalytics';

export const DashboardView: React.FC = () => {
  const { data: monitor, loading: monitorLoading } = useLiveMonitor();
  const { data: analytics } = useLiveAnalytics();

  const todayStr = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();

  const ordersStats = monitor?.ordersAndAttempts;
  const funnelStats = monitor?.funnelsAndCheckouts;
  const dbInfo = monitor?.database;
  const latestAttempts = monitor?.latestAttempts || [];

  const funnel = analytics?.funnel;
  const started = funnel?.totalStarted || 0;
  const address = funnel?.totalAddressAdded || 0;
  const discounts = funnel?.totalDiscountApplied || 0;
  const completed = funnel?.totalCompleted || 0;

  const funnelStages: Array<[string, number, number]> = [
    ['Checkout started', started > 0 ? 100 : 0, started],
    ['Address added', started > 0 ? Math.round((address / started) * 100) : 0, address],
    ['Discounts applied', started > 0 ? Math.round((discounts / started) * 100) : 0, discounts],
    ['Order placed', started > 0 ? Math.round((completed / started) * 100) : 0, completed],
  ];

  return (
    <>
      <div className="g g2">
        <div className="card hero">
          <small>{todayStr}</small>
          <h2>Good day, Partner.</h2>
          <div style={{ color: 'var(--mut)', maxWidth: '480px' }}>
            {monitorLoading ? (
              'Connecting to database telemetry...'
            ) : (
              <>
                {ordersStats?.totalAttempts ?? 0} order attempts ({ordersStats?.confirmed ?? 0}{' '}
                confirmed, {ordersStats?.failed ?? 0} failed) and {funnelStats?.totalAbandoned ?? 0}{' '}
                abandoned checkouts in <strong>{dbInfo?.databaseName || 'database'}</strong>.
              </>
            )}
          </div>
          <div style={{ marginTop: '14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className={`pill ${dbInfo?.status === 'HEALTHY' ? 'g' : 'o'}`}>
              DB: {dbInfo?.databaseName || 'MongoDB'} ({dbInfo?.status || 'ONLINE'} ·{' '}
              {dbInfo?.latencyMs ?? 0}ms)
            </span>
            <span className="pill n">
              {dbInfo?.totalCollections ?? 0} collections · {dbInfo?.storageStats.totalObjects ?? 0}{' '}
              records
            </span>
          </div>
        </div>

        <div className="card">
          <h3>
            Confirmed order revenue<em>Real-time DB aggregate</em>
          </h3>
          <div className="kv" style={{ fontSize: '32px' }}>
            {ordersStats?.confirmedRevenue.formatted || '₹0'}
          </div>
          <span className="pill g">
            {ordersStats?.confirmed ?? 0} confirmed order{ordersStats?.confirmed === 1 ? '' : 's'}
          </span>
          <div style={{ color: 'var(--mut)', fontSize: '12px', marginTop: '12px' }}>
            Aggregated directly from confirmed <code>checkoutOrderAttempts</code> in MongoDB.
          </div>
        </div>
      </div>

      <div className="g g4">
        <KpiCard
          icon="₹"
          label="Confirmed revenue"
          value={ordersStats?.confirmedRevenue.formatted || '₹0'}
          sub={`${ordersStats?.confirmed ?? 0} orders successful`}
          variant="dk"
        />
        <KpiCard
          icon="◔"
          label="Checkout conversion"
          value={`${funnelStats?.conversionRatePercent ?? 0}%`}
          sub={`${ordersStats?.confirmed ?? 0} of ${funnelStats?.totalFunnelSessions ?? 0} sessions`}
          variant="bl"
        />
        <KpiCard
          icon="▤"
          label="Total attempts"
          value={String(ordersStats?.totalAttempts ?? 0)}
          sub={`${ordersStats?.manualReview ?? 0} flagged for review`}
        />
        <KpiCard
          icon="↺"
          label="Attempt failure rate"
          value={`${ordersStats?.failureRatePercent ?? 0}%`}
          sub={`${ordersStats?.failed ?? 0} total failed`}
          variant={ordersStats && ordersStats.failureRatePercent > 10 ? 'or' : undefined}
        />
      </div>

      <div className="g g2">
        <div className="card">
          <h3>
            Database storage & collections<em>Real-time MongoDB telemetry</em>
          </h3>
          <div style={{ marginTop: '8px' }}>
            <div className="wide">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th className="n">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="r">
                    <td>Database Name</td>
                    <td className="n">
                      <code>{dbInfo?.databaseName || 'checkout_development'}</code>
                    </td>
                  </tr>
                  <tr className="r">
                    <td>Total Collections</td>
                    <td className="n">{dbInfo?.totalCollections ?? 0}</td>
                  </tr>
                  <tr className="r">
                    <td>Total Documents</td>
                    <td className="n">{dbInfo?.storageStats.totalObjects ?? 0}</td>
                  </tr>
                  <tr className="r">
                    <td>Storage Size</td>
                    <td className="n">{dbInfo?.storageStats.storageSizeMb ?? 0} MB</td>
                  </tr>
                  <tr className="r">
                    <td>Index Footprint</td>
                    <td className="n">{dbInfo?.storageStats.indexSizeMb ?? 0} MB</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>
            Checkout funnel<em>Live event counts</em>
          </h3>
          {funnelStages.map(([stage, pct, count]) => (
            <div className="bar" key={stage}>
              <span>{stage}</span>
              <div>
                <i style={{ width: `${pct}%` }} />
              </div>
              <b>{count}</b>
            </div>
          ))}
          <div style={{ color: 'var(--mut)', fontSize: '12px', marginTop: '12px' }}>
            {started === 0
              ? 'No shopper checkout sessions recorded yet. Funnel will update as shoppers interact with storefront checkout.'
              : `Conversion rate is ${funnel?.conversionRatePercent ?? 0}% based on ${started} total session${started === 1 ? '' : 's'}.`}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>
          Recent order attempts<em>Live DB records</em>
        </h3>
        {latestAttempts.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--mut)' }}>
            No checkout order attempts recorded in database yet.
          </div>
        ) : (
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Attempt ID</th>
                  <th>Shop</th>
                  <th>Status</th>
                  <th>Shopify Order</th>
                  <th className="n">Amount</th>
                </tr>
              </thead>
              <tbody>
                {latestAttempts.map((attempt) => {
                  let pillClass = 'n';
                  if (attempt.status === 'CONFIRMED') pillClass = 'g';
                  else if (attempt.status === 'FAILED') pillClass = 'o';
                  else if (attempt.status === 'MANUAL_REVIEW') pillClass = 'b';

                  return (
                    <tr key={attempt._id} className="r">
                      <td>
                        <code>{attempt._id.slice(0, 14)}...</code>
                      </td>
                      <td>{attempt.shop}</td>
                      <td>
                        <span className={`pill ${pillClass}`}>{attempt.status}</span>
                      </td>
                      <td>{attempt.shopifyOrderName || '—'}</td>
                      <td className="n">{attempt.formattedAmount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
