import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAbandonedCheckouts,
  getCheckoutFunnelStats,
  getRecentCheckoutEvents,
  recordCheckoutEvent,
  resetMemoryAnalytics,
} from '../../apps/shopify-admin/app/checkout-events.server';

describe('checkout event tracking and funnel analytics', () => {
  beforeEach(() => {
    resetMemoryAnalytics();
  });

  it('tracks the full conversion funnel from started to completed', async () => {
    const shop = 'test-store.myshopify.com';
    const sessionId = 'sess-1001';

    // 1. Checkout started
    const startEvent = await recordCheckoutEvent({
      shop,
      sessionId,
      event: 'started',
      source: 'cart',
      cartValueMinor: 349900,
      itemCount: 2,
      items: [{ title: 'Classic Sneaker', quantity: 2, amountMinor: 174950 }],
    });
    expect(startEvent.event).toBe('started');
    expect(startEvent.step).toBe('started');
    expect(startEvent.cartValueMinor).toBe(349900);

    // 2. Shopper logged in
    const loginEvent = await recordCheckoutEvent({
      shop,
      sessionId,
      event: 'logged_in',
      shopperPhone: '9876543210',
      customerId: 'cust-123',
    });
    expect(loginEvent.event).toBe('logged_in');
    expect(loginEvent.step).toBe('login');
    expect(loginEvent.shopperPhone).toBe('9876543210');

    // 3. Address added
    const addressEvent = await recordCheckoutEvent({
      shop,
      sessionId,
      event: 'address_added',
      address: {
        locality: 'Bandra West',
        region: 'Maharashtra',
        postalCode: '400050',
      },
    });
    expect(addressEvent.event).toBe('address_added');
    expect(addressEvent.step).toBe('address');

    // 4. Discount applied
    const discountEvent = await recordCheckoutEvent({
      shop,
      sessionId,
      event: 'discount_applied',
      couponCode: 'SAVE50',
      discountMinor: 5000,
    });
    expect(discountEvent.event).toBe('discount_applied');
    expect(discountEvent.step).toBe('discounts');
    expect(discountEvent.couponCode).toBe('SAVE50');

    // 5. Payment method selected
    const payEvent = await recordCheckoutEvent({
      shop,
      sessionId,
      event: 'payment_selected',
      paymentMethod: 'cod',
    });
    expect(payEvent.event).toBe('payment_selected');
    expect(payEvent.paymentMethod).toBe('cod');

    // 6. Checkout completed
    const completeEvent = await recordCheckoutEvent({
      shop,
      sessionId,
      event: 'checkout_completed',
      orderId: 'gid://shopify/Order/99901',
      orderName: '#1001',
      orderGid: 'gid://shopify/Order/99901',
      paymentMethod: 'cod',
      cartValueMinor: 344900,
      discountMinor: 5000,
    });
    expect(completeEvent.event).toBe('checkout_completed');
    expect(completeEvent.step).toBe('complete');
    expect(completeEvent.orderName).toBe('#1001');

    // Verify stats
    const stats = await getCheckoutFunnelStats(shop);
    expect(stats.totalStarted).toBe(1);
    expect(stats.totalLoggedIn).toBe(1);
    expect(stats.totalAddressAdded).toBe(1);
    expect(stats.totalDiscountApplied).toBe(1);
    expect(stats.totalCompleted).toBe(1);
    expect(stats.totalAbandoned).toBe(0);
    expect(stats.conversionRatePercent).toBe(100);

    // Abandoned list should be empty since order is placed
    const abandoned = await getAbandonedCheckouts(shop);
    expect(abandoned.length).toBe(0);

    // Verify recent events log
    const events = await getRecentCheckoutEvents(shop, sessionId);
    expect(events.length).toBe(6);
  });

  it('tracks abandoned checkouts with drop-off stage classification', async () => {
    const shop = 'test-store.myshopify.com';

    // Session 1: Drops off at login
    await recordCheckoutEvent({
      shop,
      sessionId: 'sess-drop-login',
      event: 'started',
      cartValueMinor: 120000,
      itemCount: 1,
    });
    await recordCheckoutEvent({
      shop,
      sessionId: 'sess-drop-login',
      event: 'checkout_abandoned',
      step: 'login',
    });

    // Session 2: Logs in, but drops off at address
    await recordCheckoutEvent({
      shop,
      sessionId: 'sess-drop-address',
      event: 'started',
      cartValueMinor: 250000,
      itemCount: 2,
    });
    await recordCheckoutEvent({
      shop,
      sessionId: 'sess-drop-address',
      event: 'logged_in',
      shopperPhone: '9123456780',
    });
    await recordCheckoutEvent({
      shop,
      sessionId: 'sess-drop-address',
      event: 'checkout_abandoned',
      step: 'address',
    });

    // Session 3: Adds address and discount, but drops off at payment
    await recordCheckoutEvent({
      shop,
      sessionId: 'sess-drop-payment',
      event: 'started',
      cartValueMinor: 450000,
      itemCount: 3,
    });
    await recordCheckoutEvent({
      shop,
      sessionId: 'sess-drop-payment',
      event: 'logged_in',
      shopperPhone: '9988776655',
    });
    await recordCheckoutEvent({
      shop,
      sessionId: 'sess-drop-payment',
      event: 'address_added',
      address: { postalCode: '110001', locality: 'Connaught Place', region: 'Delhi' },
    });
    await recordCheckoutEvent({
      shop,
      sessionId: 'sess-drop-payment',
      event: 'payment_selected',
      paymentMethod: 'upi',
    });

    // Query funnel stats
    const stats = await getCheckoutFunnelStats(shop);
    expect(stats.totalStarted).toBe(3);
    expect(stats.totalLoggedIn).toBe(2);
    expect(stats.totalAddressAdded).toBe(1);
    expect(stats.totalCompleted).toBe(0);
    expect(stats.totalAbandoned).toBe(3);
    expect(stats.conversionRatePercent).toBe(0);

    // Drop-off breakdown
    expect(stats.dropOffByStep.login).toBe(1);
    expect(stats.dropOffByStep.address).toBe(1);
    expect(stats.dropOffByStep.payment).toBe(1);

    // Query abandoned checkouts
    const abandonedList = await getAbandonedCheckouts(shop);
    expect(abandonedList.length).toBe(3);

    const paymentDrop = abandonedList.find((a) => a.sessionId === 'sess-drop-payment');
    expect(paymentDrop).toBeDefined();
    expect(paymentDrop?.droppedAt).toBe('Payment');
    expect(paymentDrop?.shopperPhone).toBe('9988776655');
    expect(paymentDrop?.cartValueMinor).toBe(450000);

    const addressDrop = abandonedList.find((a) => a.sessionId === 'sess-drop-address');
    expect(addressDrop).toBeDefined();
    expect(addressDrop?.droppedAt).toBe('Address');
    expect(addressDrop?.shopperPhone).toBe('9123456780');

    const loginDrop = abandonedList.find((a) => a.sessionId === 'sess-drop-login');
    expect(loginDrop).toBeDefined();
    expect(loginDrop?.droppedAt).toBe('Login');
  });

  it('calculates mixed conversion rate when some checkouts complete and others abandon', async () => {
    const shop = 'fashion-store.myshopify.com';

    // 2 Completed checkouts
    for (let i = 1; i <= 2; i++) {
      const sess = `sess-complete-${i}`;
      await recordCheckoutEvent({
        shop,
        sessionId: sess,
        event: 'started',
        cartValueMinor: 100000,
      });
      await recordCheckoutEvent({
        shop,
        sessionId: sess,
        event: 'logged_in',
        shopperPhone: `900000000${i}`,
      });
      await recordCheckoutEvent({
        shop,
        sessionId: sess,
        event: 'address_added',
        address: { postalCode: '560001', locality: 'MG Road', region: 'Karnataka' },
      });
      await recordCheckoutEvent({
        shop,
        sessionId: sess,
        event: 'checkout_completed',
        orderId: `order-${i}`,
        orderName: `#${1000 + i}`,
      });
    }

    // 2 Abandoned checkouts
    for (let i = 1; i <= 2; i++) {
      const sess = `sess-abandon-${i}`;
      await recordCheckoutEvent({ shop, sessionId: sess, event: 'started', cartValueMinor: 80000 });
      await recordCheckoutEvent({
        shop,
        sessionId: sess,
        event: 'checkout_abandoned',
        step: 'login',
      });
    }

    const stats = await getCheckoutFunnelStats(shop);
    expect(stats.totalStarted).toBe(4);
    expect(stats.totalCompleted).toBe(2);
    expect(stats.totalAbandoned).toBe(2);
    expect(stats.conversionRatePercent).toBe(50); // 2 out of 4 = 50%
  });
});
