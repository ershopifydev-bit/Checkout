import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Shopify theme app extensions only accept these in assets/.
const ALLOWED = new Set(['.jpg', '.jpeg', '.js', '.css', '.png', '.svg', '.json', '.wasm']);
const assetsDir = fileURLToPath(
  new URL('../../apps/shopify-admin/extensions/cod-checkout-embed/assets', import.meta.url),
);

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

describe('cod-checkout-embed theme assets', () => {
  it('does not include extensions Shopify rejects (e.g. .html)', () => {
    const rejected = listFiles(assetsDir).filter(
      (file) => !ALLOWED.has(extname(file).toLowerCase()),
    );
    expect(rejected).toEqual([]);
  });
});
