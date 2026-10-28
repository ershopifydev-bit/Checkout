import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export async function readCheckoutAsset(relativePath: string): Promise<{
  body: Buffer;
  contentType: string;
} | null> {
  const normalized = relativePath.replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('\0')) return null;
  const absolute = normalize(join(publicRoot, normalized));
  const rootWithSep = publicRoot.endsWith(sep) ? publicRoot : `${publicRoot}${sep}`;
  if (absolute !== publicRoot && !absolute.startsWith(rootWithSep)) return null;
  try {
    const body = await readFile(absolute);
    return { body, contentType: contentTypes[extname(absolute)] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}
