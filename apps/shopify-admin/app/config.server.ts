import { z } from 'zod';
import { readEncryptionKey } from './session-crypto.server';

const schema = z.object({
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_APP_URL: z.url().refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    );
  }),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  MONGODB_DATABASE: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  SESSION_ENCRYPTION_KEY: z.string(),
});
export function readAdminConfig(environment: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse({
    ...environment,
    SHOPIFY_APP_URL: environment['SHOPIFY_APP_URL'] || environment['HOST'],
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid Shopify app configuration: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`,
    );
  }
  return { ...parsed.data, encryptionKey: readEncryptionKey(parsed.data.SESSION_ENCRYPTION_KEY) };
}
