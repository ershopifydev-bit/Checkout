import { createHmac } from 'node:crypto';

export function createDashboardToken(shop: string, secret: string): string {
  const ts = Date.now();
  const payload = `${shop}:${ts}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifyDashboardToken(token: string, shop: string, secret: string): boolean {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const [tokenShop, tsStr, sig] = raw.split(':');
    if (!tokenShop || !tsStr || !sig) return false;
    if (tokenShop !== shop) return false;
    const ts = Number(tsStr);
    // Token valid for 24 hours
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 24 * 60 * 60 * 1000) return false;
    const expectedSig = createHmac('sha256', secret).update(`${tokenShop}:${tsStr}`).digest('hex');
    return sig === expectedSig;
  } catch {
    return false;
  }
}
