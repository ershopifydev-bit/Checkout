import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z
    .string()
    .transform((val) => Number.parseInt(val, 10))
    .pipe(z.number().int().min(1024).max(65535))
    .default('3001'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/checkout_development'),
  MONGODB_DATABASE: z.string().default('checkout_development'),
  JWT_SECRET: z.string().min(16).default('tezvix-dashboard-backend-jwt-secret-key-2026!'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000'),
  INITIAL_ADMIN_EMAIL: z.string().email().default('admin@tezvix.internal'),
  INITIAL_ADMIN_PASSWORD: z.string().min(8).default('Admin@123456'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables in dashboard_backend:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
