import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readAdminConfig } from '../app/config.server';
const valid = {
  SHOPIFY_API_KEY: 'test-key',
  SHOPIFY_API_SECRET: 'test-secret',
  SHOPIFY_APP_URL: 'https://example.com',
  MONGODB_URI: 'mongodb://127.0.0.1:27027',
  MONGODB_DATABASE: 'checkout_dev',
  SESSION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};
describe('Shopify configuration', () => {
  it('accepts configured development and HTTPS app URLs', () => {
    expect(readAdminConfig(valid).encryptionKey.length).toBe(32);
    expect(
      readAdminConfig({ ...valid, SHOPIFY_APP_URL: 'http://localhost:3001' }).SHOPIFY_APP_URL,
    ).toBe('http://localhost:3001');
  });
  it('accepts the tunnel URL supplied as HOST by Shopify CLI', () => {
    const cliEnvironment: NodeJS.ProcessEnv = { ...valid };
    delete cliEnvironment['SHOPIFY_APP_URL'];
    expect(
      readAdminConfig({ ...cliEnvironment, HOST: 'https://test-tunnel.example.com' })
        .SHOPIFY_APP_URL,
    ).toBe('https://test-tunnel.example.com');
    expect(readAdminConfig({ ...valid, HOST: 'https://other.example.com' }).SHOPIFY_APP_URL).toBe(
      valid.SHOPIFY_APP_URL,
    );
  });
  it('rejects insecure public URLs and embedded credentials', () => {
    for (const SHOPIFY_APP_URL of [
      'http://example.com',
      'https://user:private@example.com',
      'javascript:alert(1)',
    ]) {
      expect(() => readAdminConfig({ ...valid, SHOPIFY_APP_URL })).toThrow(
        'Invalid Shopify app configuration: SHOPIFY_APP_URL',
      );
    }
  });
  it('reports missing fields without echoing secrets or connection strings', () => {
    expect(() => readAdminConfig({ ...valid, MONGODB_URI: 'private-db-value' })).toThrow(
      'Invalid Shopify app configuration: MONGODB_URI',
    );
    expect(() => readAdminConfig({})).toThrow('Invalid Shopify app configuration:');
  });
});
