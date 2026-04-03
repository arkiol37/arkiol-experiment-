// packages/shared/src/env.ts
// ─────────────────────────────────────────────────────────────────────────────
// RESILIENT ENVIRONMENT ACCESS
//
// All environment variables are optional. The app runs with whatever is
// configured. Use the capabilities module to check what is available.
//
// Usage:
//   import { getEnv } from '@arkiol/shared';
//   const env = getEnv();  // always succeeds — never throws
// ─────────────────────────────────────────────────────────────────────────────

export type SharedEnv = {
  // Database
  DATABASE_URL?: string;
  // Stripe
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_CREATOR?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_STUDIO?: string;
  STRIPE_PRICE_TOPUP_200?: string;
  STRIPE_PRICE_TOPUP_600?: string;
  STRIPE_PRICE_TOPUP_2000?: string;
  // Webhook security
  WEBHOOK_SECRET_KEY?: string;
  // AWS / S3
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION: string;
  S3_BUCKET_NAME?: string;
  CLOUDFRONT_DOMAIN?: string;
  // Redis / Queue
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  REDIS_TLS: boolean;
  REDIS_URL?: string;
  // Node
  NODE_ENV: string;
  // Billing — Paddle
  BILLING_PROVIDER: 'stripe' | 'paddle';
  PADDLE_API_KEY?: string;
  PADDLE_CLIENT_TOKEN?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_PRICE_CREATOR?: string;
  PADDLE_PRICE_PRO?: string;
  PADDLE_PRICE_STUDIO?: string;
  PADDLE_ENVIRONMENT: 'sandbox' | 'live';
  // OpenAI
  OPENAI_API_KEY?: string;
  OPENAI_ORG_ID?: string;
  // Upstash
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  // Email
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  EMAIL_FROM?: string;
  ETHEREAL_USER?: string;
  ETHEREAL_PASS?: string;
  // Auth
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  NEXTAUTH_URL?: string;
  NEXTAUTH_SECRET?: string;
  NEXT_PUBLIC_APP_URL?: string;
  // Mobile
  MOBILE_JWT_SECRET?: string;
  // Observability
  SENTRY_DSN?: string;
  LOG_LEVEL?: string;
  MONITORING_SECRET?: string;
  // Feature flags
  GENERATION_KILL_SWITCH?: string;
  GLOBAL_MONTHLY_SPEND_LIMIT_USD?: string;
  PER_USER_HOURLY_LIMIT?: string;
  PER_USER_DAILY_LIMIT?: string;
  WORKER_CONCURRENCY?: number;
  EXPORT_WORKER_CONCURRENCY?: number;
  FONT_CDN_BASE_URL?: string;
  // Alerts
  COST_SPIKE_THRESHOLD_USD?: string;
  COST_SPIKE_WINDOW_MINUTES?: string;
  VOLUME_ANOMALY_MULTIPLIER?: string;
  STAGE_FAILURE_RATE_THRESHOLD?: string;
  ALERT_WEBHOOK_URL?: string;
  ALERT_EMAIL_TO?: string;
  ALERT_COST_SPIKE_ORG_PER_HOUR?: string;
  ALERT_COST_SPIKE_GLOBAL_USD_PER_HOUR?: string;
  ALERT_VOLUME_JOBS_PER_ORG_HOUR?: string;
  ALERT_STAGE_FAILURE_RATE_WARNING?: string;
  ALERT_STAGE_FAILURE_RATE_CRITICAL?: string;
  ALERT_STAGE_TIMEOUT_MS?: string;
  ALERT_FALLBACK_RATE_WARNING?: string;
  ALERT_FALLBACK_RATE_CRITICAL?: string;
  ALERT_DLQ_DEPTH_CRITICAL?: string;
  ALERT_SAFETY_BLOCK_PER_HOUR?: string;
  ALERT_ZERO_ASSET_JOB_RATE_WARNING?: string;
  ALERT_PROVIDER_ERROR_RATE_CRITICAL?: string;
  ALERT_DEDUP_WINDOW_MS?: string;
};

/** Read all environment variables — never throws, always returns an object */
export function getEnv(): SharedEnv {
  const env = process.env;
  return {
    DATABASE_URL:             env.DATABASE_URL,
    STRIPE_SECRET_KEY:        env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET:    env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_CREATOR:     env.STRIPE_PRICE_CREATOR,
    STRIPE_PRICE_PRO:         env.STRIPE_PRICE_PRO,
    STRIPE_PRICE_STUDIO:      env.STRIPE_PRICE_STUDIO,
    STRIPE_PRICE_TOPUP_200:   env.STRIPE_PRICE_TOPUP_200,
    STRIPE_PRICE_TOPUP_600:   env.STRIPE_PRICE_TOPUP_600,
    STRIPE_PRICE_TOPUP_2000:  env.STRIPE_PRICE_TOPUP_2000,
    WEBHOOK_SECRET_KEY:       env.WEBHOOK_SECRET_KEY,
    AWS_ACCESS_KEY_ID:        env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY:    env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION:               env.AWS_REGION ?? 'us-east-1',
    S3_BUCKET_NAME:           env.S3_BUCKET_NAME,
    CLOUDFRONT_DOMAIN:        env.CLOUDFRONT_DOMAIN,
    REDIS_HOST:               env.REDIS_HOST ?? 'localhost',
    REDIS_PORT:               parseInt(env.REDIS_PORT ?? '6379', 10),
    REDIS_PASSWORD:           env.REDIS_PASSWORD,
    REDIS_TLS:                env.REDIS_TLS === 'true',
    REDIS_URL:                env.REDIS_URL,
    NODE_ENV:                 env.NODE_ENV ?? 'production',
    BILLING_PROVIDER:         (env.BILLING_PROVIDER as 'stripe' | 'paddle') ?? 'paddle',
    PADDLE_API_KEY:           env.PADDLE_API_KEY,
    PADDLE_CLIENT_TOKEN:      env.PADDLE_CLIENT_TOKEN,
    PADDLE_WEBHOOK_SECRET:    env.PADDLE_WEBHOOK_SECRET,
    PADDLE_PRICE_CREATOR:     env.PADDLE_PRICE_CREATOR,
    PADDLE_PRICE_PRO:         env.PADDLE_PRICE_PRO,
    PADDLE_PRICE_STUDIO:      env.PADDLE_PRICE_STUDIO,
    PADDLE_ENVIRONMENT:       (env.PADDLE_ENVIRONMENT as 'sandbox' | 'live') ?? 'sandbox',
    OPENAI_API_KEY:           env.OPENAI_API_KEY,
    OPENAI_ORG_ID:            env.OPENAI_ORG_ID,
    UPSTASH_REDIS_REST_URL:   env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
    SMTP_HOST:                env.SMTP_HOST,
    SMTP_PORT:                parseInt(env.SMTP_PORT ?? '587', 10),
    SMTP_SECURE:              env.SMTP_SECURE,
    SMTP_USER:                env.SMTP_USER,
    SMTP_PASS:                env.SMTP_PASS,
    EMAIL_FROM:               env.EMAIL_FROM,
    ETHEREAL_USER:            env.ETHEREAL_USER,
    ETHEREAL_PASS:            env.ETHEREAL_PASS,
    GOOGLE_CLIENT_ID:         env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET:     env.GOOGLE_CLIENT_SECRET,
    APPLE_ID:                 env.APPLE_ID,
    APPLE_TEAM_ID:            env.APPLE_TEAM_ID,
    APPLE_KEY_ID:             env.APPLE_KEY_ID,
    APPLE_PRIVATE_KEY:        env.APPLE_PRIVATE_KEY,
    NEXTAUTH_URL:             env.NEXTAUTH_URL,
    NEXTAUTH_SECRET:          env.NEXTAUTH_SECRET,
    NEXT_PUBLIC_APP_URL:      env.NEXT_PUBLIC_APP_URL,
    MOBILE_JWT_SECRET:        env.MOBILE_JWT_SECRET,
    SENTRY_DSN:               env.SENTRY_DSN,
    LOG_LEVEL:                env.LOG_LEVEL,
    MONITORING_SECRET:        env.MONITORING_SECRET,
    GENERATION_KILL_SWITCH:   env.GENERATION_KILL_SWITCH,
    GLOBAL_MONTHLY_SPEND_LIMIT_USD: env.GLOBAL_MONTHLY_SPEND_LIMIT_USD,
    PER_USER_HOURLY_LIMIT:    env.PER_USER_HOURLY_LIMIT,
    PER_USER_DAILY_LIMIT:     env.PER_USER_DAILY_LIMIT,
    WORKER_CONCURRENCY:       env.WORKER_CONCURRENCY ? parseInt(env.WORKER_CONCURRENCY, 10) : undefined,
    EXPORT_WORKER_CONCURRENCY: env.EXPORT_WORKER_CONCURRENCY ? parseInt(env.EXPORT_WORKER_CONCURRENCY, 10) : undefined,
    FONT_CDN_BASE_URL:        env.FONT_CDN_BASE_URL,
    COST_SPIKE_THRESHOLD_USD: env.COST_SPIKE_THRESHOLD_USD,
    COST_SPIKE_WINDOW_MINUTES: env.COST_SPIKE_WINDOW_MINUTES,
    VOLUME_ANOMALY_MULTIPLIER: env.VOLUME_ANOMALY_MULTIPLIER,
    STAGE_FAILURE_RATE_THRESHOLD: env.STAGE_FAILURE_RATE_THRESHOLD,
    ALERT_WEBHOOK_URL:        env.ALERT_WEBHOOK_URL,
    ALERT_EMAIL_TO:           env.ALERT_EMAIL_TO,
    ALERT_COST_SPIKE_ORG_PER_HOUR: env.ALERT_COST_SPIKE_ORG_PER_HOUR,
    ALERT_COST_SPIKE_GLOBAL_USD_PER_HOUR: env.ALERT_COST_SPIKE_GLOBAL_USD_PER_HOUR,
    ALERT_VOLUME_JOBS_PER_ORG_HOUR: env.ALERT_VOLUME_JOBS_PER_ORG_HOUR,
    ALERT_STAGE_FAILURE_RATE_WARNING: env.ALERT_STAGE_FAILURE_RATE_WARNING,
    ALERT_STAGE_FAILURE_RATE_CRITICAL: env.ALERT_STAGE_FAILURE_RATE_CRITICAL,
    ALERT_STAGE_TIMEOUT_MS:   env.ALERT_STAGE_TIMEOUT_MS,
    ALERT_FALLBACK_RATE_WARNING: env.ALERT_FALLBACK_RATE_WARNING,
    ALERT_FALLBACK_RATE_CRITICAL: env.ALERT_FALLBACK_RATE_CRITICAL,
    ALERT_DLQ_DEPTH_CRITICAL: env.ALERT_DLQ_DEPTH_CRITICAL,
    ALERT_SAFETY_BLOCK_PER_HOUR: env.ALERT_SAFETY_BLOCK_PER_HOUR,
    ALERT_ZERO_ASSET_JOB_RATE_WARNING: env.ALERT_ZERO_ASSET_JOB_RATE_WARNING,
    ALERT_PROVIDER_ERROR_RATE_CRITICAL: env.ALERT_PROVIDER_ERROR_RATE_CRITICAL,
    ALERT_DEDUP_WINDOW_MS:    env.ALERT_DEDUP_WINDOW_MS,
  };
}

/** Validate critical environment variables. Throws in production if DATABASE_URL is missing. */
export function validateSharedEnv(): SharedEnv {
  const result = getEnv();
  if (process.env.NODE_ENV === 'production' && !result.DATABASE_URL) {
    throw new Error('[env] DATABASE_URL is required in production');
  }
  return result;
}

/** Bootstrap env reader for early-init code (logger, middleware) */
export type BootstrapKey =
  | 'NODE_ENV'
  | 'LOG_LEVEL'
  | 'SENTRY_DSN'
  | 'NEXT_PUBLIC_SENTRY_DSN'
  | 'NEXT_PUBLIC_APP_URL'
  | 'NEXTAUTH_URL'
  | 'npm_package_version';

export function bootstrapEnv(key: BootstrapKey): string | undefined {
  return (typeof process !== 'undefined' ? process.env[key] : undefined) as string | undefined;
}

/** Convenience proxy — property access never throws */
export const env: SharedEnv = new Proxy({} as SharedEnv, {
  get(_target, prop: string) {
    return (getEnv() as any)[prop];
  },
});
