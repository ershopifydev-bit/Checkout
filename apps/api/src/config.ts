import { z } from 'zod';

const ConfigSchema = z.object({
  HOST: z.union([z.ipv4(), z.ipv6()]).default('127.0.0.1'),
  PORT: z.string().regex(/^\d+$/).default('3000').transform(Number).pipe(z.int().min(1).max(65535)),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export function readConfig(environment: NodeJS.ProcessEnv) {
  const parsed = ConfigSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid API configuration: ${fields.join(', ')}`);
  }
  return parsed.data;
}
