// apps/animation-studio/backend/src/config/env.ts
// V15: Synchronous fail-fast validation — shared env is validated BEFORE export.
// Previously, validateSharedEnv() was called via async import().then(), which allowed
// env vars to be consumed before validation could complete. This version blocks on
// synchronous require() so the process exits immediately on misconfiguration.

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(20),

  REDIS_URL: z.string().min(1),
  REDIS_TLS: z.string().transform(v => v === 'true').default('false'),
  REDIS_PASSWORD: z.string().optional(),

  JWT_SECRET: z.string().min(32),
  NEXTAUTH_SECRET: z.string().min(32).optional(), // Required when Arkiol session bridge is used
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
  STRIPE_PRICE_SCALE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_SCALE_YEARLY: z.string().optional(),
  STRIPE_CREDIT_PACK_25: z.string().optional(),
  STRIPE_CREDIT_PACK_100: z.string().optional(),
  STRIPE_CREDIT_PACK_500: z.string().optional(),

  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().default('us-east-1'),
  S3_BUCKET_ASSETS: z.string().min(1),
  S3_BUCKET_RENDERS: z.string().min(1),
  CDN_URL: z.string().url(),

  RUNWAY_API_KEY: z.string().optional(),
  RUNWAY_API_URL: z.string().url().default('https://api.runwayml.com/v1'),
  PIKA_API_KEY: z.string().optional(),
  PIKA_API_URL: z.string().url().default('https://api.pika.art/v1'),
  SORA_API_KEY: z.string().optional(),
  SORA_API_URL: z.string().url().default('https://api.openai.com/v1'),

  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_API_URL: z.string().url().default('https://api.elevenlabs.io/v1'),
  MUSICGEN_API_KEY: z.string().optional(),

  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default('noreply@animation-studio.ai'),
  EMAIL_REPLY_TO: z.string().email().optional(),

  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes)'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  RENDER_RATE_LIMIT_MAX: z.coerce.number().default(10),
  RENDER_CONCURRENCY: z.coerce.number().default(3),

  FFMPEG_TIMEOUT_MS: z.coerce.number().default(600000),
  SCENE_POLL_TIMEOUT_MS: z.coerce.number().default(300000),
  SCENE_POLL_INTERVAL_MS: z.coerce.number().default(5000),

  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  FEATURE_4K_EXPORT: z.string().transform(v => v === 'true').default('true'),
  FEATURE_API_ACCESS: z.string().transform(v => v === 'true').default('false'),
});

// ── Step 1: Validate app-specific env (synchronous, fail-fast) ──────────────
const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error('❌ [animation-studio] Invalid environment configuration:');
  console.error(JSON.stringify(_parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

// ── Step 2: Validate shared env contract (synchronous via require) ───────────
// Using require() instead of dynamic import() ensures this runs synchronously
// and blocks the process before any env vars are exported or consumed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { validateSharedEnv } = require('@arkiol/shared') as { validateSharedEnv: () => void };
  validateSharedEnv();
  console.log('✅ [animation-studio] Shared environment validation passed.');
} catch (err: any) {
  console.error('❌ [animation-studio] Shared env validation failed:');
  console.error(err.message);
  process.exit(1);
}

// ── Exports (available only after both validations pass) ─────────────────────
export const config = _parsed.data;

export const isProduction  = config.NODE_ENV === 'production';
export const isDevelopment = config.NODE_ENV === 'development';
export const isTest        = config.NODE_ENV === 'test';
