import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SessionIdentity {
  id: string;
  shop: string;
}
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function readEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('SESSION_ENCRYPTION_KEY must encode 32 bytes in base64');
  }
  return key;
}
function additionalData(identity: SessionIdentity): Buffer {
  return Buffer.from(JSON.stringify([identity.id, identity.shop]));
}
export function encryptSession(
  plaintext: string,
  identity: SessionIdentity,
  key: Buffer,
): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(additionalData(identity));
  return {
    ciphertext: Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString(
      'base64',
    ),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
export function decryptSession(
  payload: EncryptedPayload,
  identity: SessionIdentity,
  key: Buffer,
): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAAD(additionalData(identity));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
