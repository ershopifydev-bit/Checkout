import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSession, encryptSession, readEncryptionKey } from '../app/session-crypto.server.js';

const key = randomBytes(32);
const identity = { id: 'offline_alpha.myshopify.com', shop: 'alpha.myshopify.com' };

describe('encrypted session payloads', () => {
  it('round-trips credentials without storing plaintext and uses a fresh nonce', () => {
    const payload = JSON.stringify([
      ['accessToken', 'private-access-token'],
      ['refreshToken', 'private-refresh-token'],
    ]);
    const encrypted = encryptSession(payload, identity, key);
    expect(JSON.stringify(encrypted)).not.toContain('private-');
    expect(decryptSession(encrypted, identity, key)).toBe(payload);
    expect(encryptSession(payload, identity, key)).not.toEqual(encrypted);
  });
  it('rejects ciphertext copied to another session or tenant', () => {
    const encrypted = encryptSession('secret', identity, key);
    expect(() =>
      decryptSession(encrypted, { ...identity, shop: 'beta.myshopify.com' }, key),
    ).toThrow();
    expect(() => decryptSession(encrypted, { ...identity, id: 'other' }, key)).toThrow();
  });
  it('rejects tampering and a different encryption key', () => {
    const encrypted = encryptSession('secret', identity, key);
    expect(() =>
      decryptSession(
        { ...encrypted, ciphertext: Buffer.from('tampered').toString('base64') },
        identity,
        key,
      ),
    ).toThrow();
    expect(() => decryptSession(encrypted, identity, randomBytes(32))).toThrow();
  });
  it('requires a canonical base64 encoded 256-bit key', () => {
    expect(readEncryptionKey(key.toString('base64'))).toEqual(key);
    for (const value of [
      '',
      'private-value',
      randomBytes(16).toString('base64'),
      key.toString('base64') + '!',
    ]) {
      expect(() => readEncryptionKey(value)).toThrow(
        'SESSION_ENCRYPTION_KEY must encode 32 bytes in base64',
      );
    }
  });
});
