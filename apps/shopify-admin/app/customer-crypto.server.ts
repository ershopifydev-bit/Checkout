import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Derives or retrieves the HMAC key for phone fingerprints.
 */
function getHmacKey(): Buffer {
  const secret =
    process.env['CUSTOMER_HMAC_SECRET'] ||
    process.env['SESSION_SECRET'] ||
    'tezvix-dev-customer-hmac-secret-key-32b';
  return Buffer.from(secret.padEnd(32, '0').slice(0, 32));
}

/**
 * Derives or retrieves the AES-256-GCM encryption key.
 */
function getEncryptionKey(): Buffer {
  const secret =
    process.env['CUSTOMER_ENCRYPTION_KEY'] ||
    process.env['SESSION_SECRET'] ||
    'tezvix-dev-aes-gcm-encryption-key32b';
  return Buffer.from(secret.padEnd(32, '0').slice(0, 32));
}

/**
 * Generates a deterministic keyed HMAC-SHA256 fingerprint for phone lookup.
 * Enables O(1) indexed lookup without storing plaintext phone numbers in unindexed fields.
 */
export function computePhoneKey(e164Phone: string): string {
  const clean = e164Phone.trim();
  return createHmac('sha256', getHmacKey()).update(clean).digest('hex');
}

/**
 * Returns a masked phone string for secure display (e.g. "+91 ****** 43210").
 */
export function maskPhone(e164Phone: string): string {
  const clean = e164Phone.trim();
  if (clean.length < 6) return clean;
  const prefix = clean.slice(0, 3);
  const suffix = clean.slice(-4);
  return `${prefix} ****** ${suffix}`;
}

/**
 * Encrypts sensitive PII using AES-256-GCM.
 * Format: ivHex:authTagHex:encryptedHex
 */
export function encryptPii(plainText: string): string {
  if (!plainText) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts sensitive PII using AES-256-GCM.
 */
export function decryptPii(cipherText: string): string {
  if (!cipherText || !cipherText.includes(':')) return '';
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 3) return '';
    const [ivHex, tagHex, dataHex] = parts as [string, string, string];
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(dataHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch {
    return '';
  }
}

/**
 * Normalizes email address to lower case and trims.
 */
export function normalizeEmail(rawEmail: string): string {
  const clean = String(rawEmail || '')
    .trim()
    .toLowerCase();
  if (!clean) return '';
  const match = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
  if (!match) throw new Error('INVALID_EMAIL');
  return clean;
}
