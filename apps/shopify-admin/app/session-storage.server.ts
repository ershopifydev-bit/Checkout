import { Session } from '@shopify/shopify-api';
import type { SessionStorage } from '@shopify/shopify-app-session-storage';
import type { Collection, Db } from 'mongodb';
import { z } from 'zod';
import { decryptSession, encryptSession } from './session-crypto.server';
import type { EncryptedPayload } from './session-crypto.server';

interface SessionDocument extends EncryptedPayload {
  _id: string;
  shop: string;
}
const properties = z.array(z.tuple([z.string(), z.union([z.string(), z.number(), z.boolean()])]));

/** Used only by Shopify's verified authentication flow; never expose session IDs as a public API. */
export class EncryptedMongoSessionStorage implements SessionStorage {
  private ready: Promise<string> | undefined;
  constructor(
    private readonly getDatabase: () => Db,
    private readonly key: Buffer,
  ) {}
  private collection(): Collection<SessionDocument> {
    return this.getDatabase().collection<SessionDocument>('shopifySessions');
  }
  private async ensureIndex() {
    const col = this.collection();
    this.ready ??= col.createIndex({ shop: 1 }).catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    await this.ready;
  }
  async storeSession(session: Session): Promise<boolean> {
    await this.ensureIndex();
    const encrypted = encryptSession(
      JSON.stringify(session.toPropertyArray(true)),
      session,
      this.key,
    );
    const result = await this.collection().replaceOne(
      { _id: session.id },
      { shop: session.shop, ...encrypted },
      { upsert: true },
    );
    return result.acknowledged;
  }
  private decode(document: SessionDocument): Session {
    const plaintext = decryptSession(document, { id: document._id, shop: document.shop }, this.key);
    const session = Session.fromPropertyArray(properties.parse(JSON.parse(plaintext)), true);
    if (session.id !== document._id || session.shop !== document.shop)
      throw new Error('Session identity mismatch');
    return session;
  }
  async loadSession(id: string): Promise<Session | undefined> {
    const document = await this.collection().findOne({ _id: id });
    return document ? this.decode(document) : undefined;
  }
  async deleteSession(id: string): Promise<boolean> {
    return (await this.collection().deleteOne({ _id: id })).acknowledged;
  }
  async deleteSessions(ids: string[]): Promise<boolean> {
    return (await this.collection().deleteMany({ _id: { $in: ids } })).acknowledged;
  }
  async findSessionsByShop(shop: string): Promise<Session[]> {
    await this.ensureIndex();
    const documents = await this.collection().find({ shop }).toArray();
    return documents.map((document) => this.decode(document));
  }
  async deleteShopSessions(shop: string): Promise<void> {
    const result = await this.collection().deleteMany({ shop });
    if (!result.acknowledged) throw new Error('Session revocation was not acknowledged');
  }
}
