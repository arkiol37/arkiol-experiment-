// packages/shared/src/capabilities.ts
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH — Capability detection for all services.
//
// Server usage (Node.js):
//   import { detectCapabilities } from '@arkiol/shared';
//   const caps = detectCapabilities();
//   if (caps.database) { ... }
//
// API endpoint (serialize for client):
//   import { serializeCapabilities } from '@arkiol/shared';
//   return NextResponse.json(serializeCapabilities());
//
// Client hook: useCapabilities() in src/hooks/useCapabilities.ts
//
// ── EDGE RUNTIME NOTE ───────────────────────────────────────────────────────
// src/middleware.ts runs in Edge Runtime and cannot import this module (the
// shared barrel includes Node.js-only code). middleware.ts contains an inline
// auth check that mirrors detectCapabilities().auth exactly. If you change the
// auth detection logic below, update middleware.ts AUTH_CONFIGURED to match.
// ─────────────────────────────────────────────────────────────────────────────

export interface ArkiolCapabilities {
  /** PostgreSQL database via DATABASE_URL */
  database:      boolean;
  /** OpenAI API via OPENAI_API_KEY */
  ai:            boolean;
  /** AWS S3 storage via AWS_* + S3_BUCKET_NAME */
  storage:       boolean;
  /** Redis/BullMQ queue via REDIS_HOST */
  queue:         boolean;
  /** Upstash Redis rate limiting via UPSTASH_REDIS_REST_* */
  rateLimit:     boolean;
  /** NextAuth authentication via NEXTAUTH_SECRET (≥32 chars) */
  auth:          boolean;
  /** Paddle billing via PADDLE_API_KEY + PADDLE_WEBHOOK_SECRET + PADDLE_CLIENT_TOKEN */
  paddleBilling: boolean;
  /** Stripe billing via STRIPE_SECRET_KEY */
  stripeBilling: boolean;
  /** Any billing provider configured */
  billing:       boolean;
  /** Email via SMTP_HOST */
  email:         boolean;
  /** Webhook AES-256 encryption via WEBHOOK_SECRET_KEY (64 hex chars) */
  webhooks:      boolean;
  /** Mobile JWT signing via MOBILE_JWT_SECRET (≥32 chars) */
  mobileAuth:    boolean;
  /** Sentry error tracking via SENTRY_DSN */
  sentry:        boolean;
}

/** Serialized form for the client — prefixed with 'has' for clarity */
export interface SerializedCapabilities {
  hasDatabase:   boolean;
  hasAI:         boolean;
  hasStorage:    boolean;
  hasQueue:      boolean;
  hasRateLimit:  boolean;
  hasAuth:       boolean;
  hasPaddleBilling: boolean;
  hasStripeBilling: boolean;
  hasBilling:    boolean;
  hasEmail:      boolean;
  hasWebhooks:   boolean;
  hasMobileAuth: boolean;
  hasSentry:     boolean;
}

let _capabilities: ArkiolCapabilities | null = null;

/** Detect which services are configured. Result is cached for the process lifetime. */
export function detectCapabilities(): ArkiolCapabilities {
  if (_capabilities) return _capabilities;

  const env = process.env;

  _capabilities = {
    database: !!(
      env.DATABASE_URL &&
      (env.DATABASE_URL.startsWith('postgresql://') || env.DATABASE_URL.startsWith('postgres://'))
    ),
    ai: !!(env.OPENAI_API_KEY?.startsWith('sk-')),
    storage: !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.S3_BUCKET_NAME),
    queue: !!(env.REDIS_HOST && env.REDIS_HOST.trim() !== ''),
    rateLimit: !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
    auth: !!(env.NEXTAUTH_SECRET && env.NEXTAUTH_SECRET.length >= 32),
    paddleBilling: !!(env.PADDLE_API_KEY && env.PADDLE_WEBHOOK_SECRET && env.PADDLE_CLIENT_TOKEN),
    stripeBilling: !!(
      env.STRIPE_SECRET_KEY &&
      (env.STRIPE_SECRET_KEY.startsWith('sk_live_') || env.STRIPE_SECRET_KEY.startsWith('sk_test_'))
    ),
    get billing() { return this.paddleBilling || this.stripeBilling; },
    email: !!(env.SMTP_HOST),
    webhooks: !!(env.WEBHOOK_SECRET_KEY && /^[0-9a-fA-F]{64}$/.test(env.WEBHOOK_SECRET_KEY)),
    mobileAuth: !!(env.MOBILE_JWT_SECRET && env.MOBILE_JWT_SECRET.length >= 32),
    sentry: !!(env.SENTRY_DSN),
  };

  return _capabilities;
}

/** Reset the capabilities cache (used in tests and for hot-reload scenarios). */
export function resetCapabilities(): void {
  _capabilities = null;
}

/**
 * Serialize capabilities for the /api/capabilities HTTP response.
 * Uses 'has' prefix convention for the client-facing API.
 * Always derived from detectCapabilities() — never duplicates detection logic.
 */
export function serializeCapabilities(): SerializedCapabilities {
  const c = detectCapabilities();
  return {
    hasDatabase:      c.database,
    hasAI:            c.ai,
    hasStorage:       c.storage,
    hasQueue:         c.queue,
    hasRateLimit:     c.rateLimit,
    hasAuth:          c.auth,
    hasPaddleBilling: c.paddleBilling,
    hasStripeBilling: c.stripeBilling,
    hasBilling:       c.billing,
    hasEmail:         c.email,
    hasWebhooks:      c.webhooks,
    hasMobileAuth:    c.mobileAuth,
    hasSentry:        c.sentry,
  };
}

/** Proxy for convenient property access: capabilities.database, capabilities.ai, etc. */
export const capabilities = new Proxy({} as ArkiolCapabilities, {
  get(_target, prop: string) {
    return (detectCapabilities() as unknown as Record<string, unknown>)[prop];
  },
});
