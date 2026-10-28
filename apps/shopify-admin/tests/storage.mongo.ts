import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { Session } from '@shopify/shopify-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EncryptedMongoSessionStorage } from '../app/session-storage.server';

const uri = process.env['MONGODB_TEST_URI'];
if (!uri) throw new Error('Set MONGODB_TEST_URI to an isolated test MongoDB server.');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
const database = `checkout_test_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);
const store = new EncryptedMongoSessionStorage(() => client.db(database), key);
function session(shop: string) {
  return new Session({
    id: `offline_${shop}`,
    shop,
    state: '',
    isOnline: false,
    accessToken: 'private-access-token',
    refreshToken: 'private-refresh-token',
    refreshTokenExpires: new Date(Date.now() + 86400000),
    expires: new Date(Date.now() + 3600000),
    scope: '',
  });
}
beforeAll(async () => {
  await client.connect();
});
afterAll(async () => {
  await client.db(database).dropDatabase();
  await client.close();
});
describe('real MongoDB session persistence', () => {
  it('persists encrypted tokens and survives storage reconstruction', async () => {
    const original = session('alpha.myshopify.com');
    await store.storeSession(original);
    const document = await client
      .db(database)
      .collection<{ _id: string; shop: string }>('shopifySessions')
      .findOne({ _id: original.id });
    expect(JSON.stringify(document)).not.toContain('private-');
    const reopened = new EncryptedMongoSessionStorage(() => client.db(database), key);
    expect((await reopened.loadSession(original.id))?.toPropertyArray(true)).toEqual(
      original.toPropertyArray(true),
    );
  });
  it('updates without duplicates and deletes only the requested shop', async () => {
    const alpha = session('alpha.myshopify.com');
    const beta = session('beta.myshopify.com');
    await store.storeSession(alpha);
    await store.storeSession(beta);
    alpha.accessToken = 'replacement-token';
    await store.storeSession(alpha);
    expect(await store.findSessionsByShop(alpha.shop)).toHaveLength(1);
    expect((await store.loadSession(alpha.id))?.accessToken).toBe('replacement-token');
    await store.deleteShopSessions(alpha.shop);
    await store.deleteShopSessions(alpha.shop);
    expect(await store.loadSession(alpha.id)).toBeUndefined();
    expect((await store.loadSession(beta.id))?.shop).toBe(beta.shop);
  });
  it('rejects tampered payloads and tenant reassignment', async () => {
    const original = session('tamper.myshopify.com');
    await store.storeSession(original);
    await client
      .db(database)
      .collection<{ _id: string; shop: string }>('shopifySessions')
      .updateOne({ _id: original.id }, { $set: { shop: 'other.myshopify.com' } });
    await expect(store.loadSession(original.id)).rejects.toThrow();
  });
  it('supports idempotent SDK deletion methods', async () => {
    const first = session('first.myshopify.com');
    const second = session('second.myshopify.com');
    await store.storeSession(first);
    await store.storeSession(second);
    expect(await store.deleteSessions([first.id, second.id])).toBe(true);
    expect(await store.deleteSession(first.id)).toBe(true);
    expect(await store.findSessionsByShop(first.shop)).toEqual([]);
  });
  it('retains expired access tokens so Shopify can refresh using the encrypted refresh token', async () => {
    const original = session('refresh.myshopify.com');
    original.expires = new Date(0);
    await store.storeSession(original);
    expect((await store.loadSession(original.id))?.refreshToken).toBe(original.refreshToken);
  });
  it('propagates database failure rather than acknowledging revocation', async () => {
    const unavailable = new MongoClient('mongodb://127.0.0.1:1', {
      serverSelectionTimeoutMS: 100,
      connectTimeoutMS: 100,
    });
    try {
      const failedStore = new EncryptedMongoSessionStorage(() => unavailable.db(database), key);
      await expect(failedStore.deleteShopSessions('alpha.myshopify.com')).rejects.toThrow();
    } finally {
      await unavailable.close();
    }
  });
});
