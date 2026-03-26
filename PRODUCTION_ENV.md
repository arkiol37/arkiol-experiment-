# PRODUCTION_ENV.md
# ══════════════════════════════════════════════════════════════════════════════
# ARKIOL v3 — Production Environment Variable Reference
# ══════════════════════════════════════════════════════════════════════════════
#
# This document is the single authoritative reference for every environment
# variable used by the ARKIOL platform.
#
# Three environments exist:
#   production  — live Vercel deployment + Railway/Fly workers
#   staging     — preview Vercel deployments + staging workers
#   ci          — GitHub Actions (safe dummy values, no real credentials)
#
# Where to configure:
#   Arkiol Core (Next.js):   Vercel Dashboard → Project → Settings → Env Vars
#   Animation Studio:        Railway / Fly.io / Docker env — see WORKER_HOSTING.md
#   GitHub Actions secrets:  Repo → Settings → Secrets and variables → Actions
#
# ══════════════════════════════════════════════════════════════════════════════
# LEGEND
# ══════════════════════════════════════════════════════════════════════════════
#
#   REQUIRED   — server refuses to start if missing or malformed
#   REQUIRED*  — required only when a specific feature flag is enabled
#   OPTIONAL   — safe default used if omitted
#   CI-SAFE    — use a dummy/stub value in CI (no real credential needed)
#
# ══════════════════════════════════════════════════════════════════════════════


# ─────────────────────────────────────────────────────────────────────────────
# 1. DATABASE
# ─────────────────────────────────────────────────────────────────────────────
# Used by:  arkiol-core, packages/shared (Prisma), animation-studio (Knex)
# Managed:  Vercel Postgres / Neon / Supabase / Railway Postgres
#
# REQUIRED — both apps validate this at startup via validateSharedEnv() /
#             animation-studio env.ts schema.

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/arkiol?sslmode=require
# Non-pooled URL — required by Prisma migrate deploy on some providers (Neon).
# Used only during migration runs, not in the running application.
DATABASE_URL_UNPOOLED=postgresql://USER:PASSWORD@HOST-direct:5432/arkiol?sslmode=require

# CI safe dummy values:
#   DATABASE_URL=postgresql://arkiol:arkiol@localhost:5432/arkiol_test


# ─────────────────────────────────────────────────────────────────────────────
# 2. REDIS
# ─────────────────────────────────────────────────────────────────────────────
# Used by:  arkiol-core (BullMQ queues), animation-studio (BullMQ / ioredis)
# Managed:  Redis Cloud / Railway Redis / Upstash (see note below)
#
# arkiol-core reads REDIS_HOST + REDIS_PORT (+ optional REDIS_PASSWORD + REDIS_TLS).
# animation-studio reads REDIS_URL as a full connection string.
# Both are REQUIRED — startup fails if Redis is unreachable.

REDIS_HOST=your-redis-host.example.com    # REQUIRED (arkiol-core)
REDIS_PORT=6379                           # OPTIONAL — default 6379
REDIS_PASSWORD=                           # OPTIONAL — set if Redis requires auth
REDIS_TLS=true                            # OPTIONAL — default false; set true for TLS

REDIS_URL=rediss://USER:PASSWORD@host:6380  # REQUIRED (animation-studio)
                                             # Use redis:// (no TLS) or rediss:// (TLS)

# Upstash REST API — used for rate limiting in arkiol-core.
# Separate from BullMQ Redis above.  Free tier available: upstash.com
UPSTASH_REDIS_REST_URL=https://YOUR_ID.upstash.io    # REQUIRED for rate limiting
UPSTASH_REDIS_REST_TOKEN=YOUR_TOKEN                  # REQUIRED for rate limiting

# CI safe dummy values:
#   REDIS_HOST=localhost  REDIS_PORT=6379  REDIS_URL=redis://localhost:6379
#   UPSTASH_REDIS_REST_URL / TOKEN — omit or use stubs (rate limiter degrades gracefully)


# ─────────────────────────────────────────────────────────────────────────────
# 3. NEXTAUTH (arkiol-core only)
# ─────────────────────────────────────────────────────────────────────────────
# REQUIRED — instrumentation.ts throws on startup if either is missing.

NEXTAUTH_SECRET=<openssl rand -base64 48>   # min 32 chars; marks all JWT sessions
NEXTAUTH_URL=https://app.arkiol.com          # canonical URL; must match Vercel domain

# CI safe dummy values:
#   NEXTAUTH_SECRET=ci-nextauth-secret-minimum-32-chars-xx
#   NEXTAUTH_URL=http://localhost:3000


# ─────────────────────────────────────────────────────────────────────────────
# 4. OAUTH PROVIDERS (arkiol-core only)
# ─────────────────────────────────────────────────────────────────────────────
# OPTIONAL — omitting disables the provider; only credentials login remains.

# Google OAuth
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx

# Apple Sign-In (checklist §2.1)
# Required if NEXT_PUBLIC_APPLE_ENABLED=true.
# APPLE_PRIVATE_KEY = base64-encoded .p8 key: openssl base64 -in AuthKey_*.p8
APPLE_ID=com.yourcompany.app
APPLE_TEAM_ID=ABCDE12345
APPLE_KEY_ID=ABCDE12345
APPLE_PRIVATE_KEY=<base64-encoded .p8 contents>
NEXT_PUBLIC_APPLE_ENABLED=false   # set to "true" only when all APPLE_* vars are configured


# ─────────────────────────────────────────────────────────────────────────────
# 5. STRIPE BILLING (required when BILLING_PROVIDER=stripe)
# ─────────────────────────────────────────────────────────────────────────────
# REQUIRED when BILLING_PROVIDER=stripe.  validateSharedEnv() checks this.
# Use sk_live_ keys in production, sk_test_ in staging/CI.

STRIPE_SECRET_KEY=sk_live_...               # REQUIRED (BILLING_PROVIDER=stripe)
STRIPE_WEBHOOK_SECRET=whsec_...             # REQUIRED (BILLING_PROVIDER=stripe)
STRIPE_PUBLISHABLE_KEY=pk_live_...          # OPTIONAL — client-side Stripe.js
STRIPE_PRICE_CREATOR=price_...             # OPTIONAL — plan price IDs
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_STUDIO=price_...
STRIPE_PRICE_TOPUP_100=price_...           # OPTIONAL — credit top-up packs
STRIPE_PRICE_TOPUP_500=price_...
STRIPE_PRICE_TOPUP_2000=price_...

# CI safe dummy values (only when BILLING_PROVIDER=stripe):
#   STRIPE_SECRET_KEY=sk_test_ci_stub_not_real_xxxxxxxxxxxxxxxx
#   STRIPE_WEBHOOK_SECRET=whsec_ci_stub_not_real


# ─────────────────────────────────────────────────────────────────────────────
# 6. PADDLE BILLING (required when BILLING_PROVIDER=paddle — DEFAULT)
# ─────────────────────────────────────────────────────────────────────────────
# BILLING_PROVIDER defaults to "paddle".  validateSharedEnv() enforces all
# PADDLE_* vars below when BILLING_PROVIDER=paddle.
#
# SECURITY: PADDLE_API_KEY is server-side ONLY.
#   Never use NEXT_PUBLIC_PADDLE_API_KEY — the validator will hard-fail if it
#   detects this key as a NEXT_PUBLIC_ variable.

BILLING_PROVIDER=paddle                    # OPTIONAL — default "paddle"
PADDLE_API_KEY=pdl_live_...               # REQUIRED (BILLING_PROVIDER=paddle) — server-side only
PADDLE_CLIENT_TOKEN=live_...              # REQUIRED (BILLING_PROVIDER=paddle) — Paddle.js checkout
PADDLE_WEBHOOK_SECRET=pdl_ntfset_...      # REQUIRED (BILLING_PROVIDER=paddle) — HMAC signing secret
PADDLE_ENVIRONMENT=live                   # OPTIONAL — "sandbox" or "live"; default "sandbox"
PADDLE_PRICE_CREATOR=pri_01...            # REQUIRED (BILLING_PROVIDER=paddle)
PADDLE_PRICE_PRO=pri_01...               # REQUIRED (BILLING_PROVIDER=paddle)
PADDLE_PRICE_STUDIO=pri_01...            # REQUIRED (BILLING_PROVIDER=paddle)

# CI: set BILLING_PROVIDER=stripe in CI to avoid requiring all Paddle secrets.
# The CI workflow already does this (see .github/workflows/ci.yml env block).


# ─────────────────────────────────────────────────────────────────────────────
# 7. WEBHOOK SIGNING KEY (arkiol-core)
# ─────────────────────────────────────────────────────────────────────────────
# AES-256-GCM encryption key for outbound webhook signing secrets stored in DB.
# REQUIRED — exactly 64 hex characters (32 bytes).
# Generate: openssl rand -hex 32
# Rotate by: re-generating and re-creating all existing webhook registrations.

WEBHOOK_SECRET_KEY=<openssl rand -hex 32>

# CI safe dummy value:
#   WEBHOOK_SECRET_KEY=0000000000000000000000000000000000000000000000000000000000000000


# ─────────────────────────────────────────────────────────────────────────────
# 8. AWS S3 STORAGE
# ─────────────────────────────────────────────────────────────────────────────
# Used by:  arkiol-core (asset upload/download), animation-studio
# REQUIRED — all four vars below are validated at startup.
#
# IAM permissions required: s3:PutObject, s3:GetObject, s3:DeleteObject, s3:HeadObject
# Bucket policy: block all public access; serve assets via CloudFront.

AWS_ACCESS_KEY_ID=AKIA...                  # REQUIRED
AWS_SECRET_ACCESS_KEY=...                  # REQUIRED
AWS_REGION=us-east-1                       # REQUIRED (default "us-east-1")
S3_BUCKET_NAME=arkiol-assets-prod          # REQUIRED (arkiol-core)
S3_BUCKET_ASSETS=animation-studio-assets   # REQUIRED (animation-studio)
S3_BUCKET_RENDERS=animation-studio-renders # REQUIRED (animation-studio)

CLOUDFRONT_DOMAIN=https://cdn.arkiol.ai   # OPTIONAL — CDN prefix for presigned URLs

# CI safe dummy values:
#   AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
#   AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
#   AWS_REGION=us-east-1
#   S3_BUCKET_NAME=arkiol-ci-bucket  S3_BUCKET_ASSETS=ci-assets  S3_BUCKET_RENDERS=ci-renders


# ─────────────────────────────────────────────────────────────────────────────
# 9. OPENAI
# ─────────────────────────────────────────────────────────────────────────────
# Used by:  arkiol-core (AI generation, embeddings, brand analysis)
# OPTIONAL — health check reports "warn" if missing; generation features degrade.
# Strongly recommended in production.

OPENAI_API_KEY=sk-...                      # OPTIONAL (warn if missing)
OPENAI_ORG_ID=org-...                      # OPTIONAL

# CI safe dummy value:
#   OPENAI_API_KEY=sk-ci-stub-not-real


# ─────────────────────────────────────────────────────────────────────────────
# 10. EMAIL / SMTP (arkiol-core)
# ─────────────────────────────────────────────────────────────────────────────
# Used for transactional email: invites, password resets, job notifications.
# OPTIONAL — if not configured, emails are logged to console in development.
# Recommended providers: Resend (smtp.resend.com), SendGrid, AWS SES.

SMTP_HOST=smtp.resend.com                  # OPTIONAL
SMTP_PORT=587                              # OPTIONAL — default 587
SMTP_SECURE=false                          # OPTIONAL — true for port 465
SMTP_USER=resend                           # OPTIONAL
SMTP_PASS=re_...                           # OPTIONAL
EMAIL_FROM="Arkiol <noreply@arkiol.ai>"    # OPTIONAL


# ─────────────────────────────────────────────────────────────────────────────
# 11. ANIMATION STUDIO — SERVER IDENTITY & JWT
# ─────────────────────────────────────────────────────────────────────────────
# These are specific to the animation-studio Express backend.
# Validated by apps/animation-studio/backend/src/config/env.ts on startup.

# REQUIRED — animation-studio will exit 1 on startup without these.
API_URL=https://api.animation.arkiol.ai    # Full URL of the animation-studio backend
FRONTEND_URL=https://studio.arkiol.ai     # Frontend origin (used for CORS)
CDN_URL=https://cdn.arkiol.ai             # CloudFront / CDN prefix for rendered assets

JWT_SECRET=<openssl rand -base64 64>       # REQUIRED — min 32 chars
JWT_REFRESH_SECRET=<openssl rand -base64 64>  # REQUIRED — must differ from JWT_SECRET
JWT_EXPIRES_IN=15m                         # OPTIONAL — default 15m
JWT_REFRESH_EXPIRES_IN=30d                 # OPTIONAL — default 30d

# AES-256-GCM encryption key for webhook secrets stored in animation-studio DB.
# Exactly 64 hex chars (32 bytes). Generate: openssl rand -hex 32
ENCRYPTION_KEY=<openssl rand -hex 32>      # REQUIRED

# CI safe dummy values:
#   API_URL=http://localhost:4000
#   FRONTEND_URL=http://localhost:5173
#   CDN_URL=http://localhost:4000
#   JWT_SECRET=ci-jwt-secret-minimum-32-chars-xxxxxx
#   JWT_REFRESH_SECRET=ci-jwt-refresh-secret-32-chars-xxxx
#   ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000


# ─────────────────────────────────────────────────────────────────────────────
# 12. ANIMATION STUDIO — AI VIDEO PROVIDERS
# ─────────────────────────────────────────────────────────────────────────────
# At least one provider must be configured for render jobs to complete.
# All are OPTIONAL — the studio degrades gracefully (jobs queued but unprocessable).

RUNWAY_API_KEY=key_...                     # OPTIONAL — Runway ML video generation
RUNWAY_API_URL=https://api.runwayml.com/v1  # OPTIONAL — default as shown
PIKA_API_KEY=...                           # OPTIONAL — Pika video generation
SORA_API_KEY=sk-proj-...                   # OPTIONAL — OpenAI Sora

ELEVENLABS_API_KEY=...                     # OPTIONAL — voiceover generation
MUSICGEN_API_KEY=...                       # OPTIONAL — background music generation

FAL_AI_API_KEY=...                         # OPTIONAL — fal.ai (fast inference)
REPLICATE_API_TOKEN=...                    # OPTIONAL — Replicate (model hosting)


# ─────────────────────────────────────────────────────────────────────────────
# 13. SENTRY (observability)
# ─────────────────────────────────────────────────────────────────────────────
# OPTIONAL — errors are logged to console if not configured.
# Strongly recommended in production.
# Create a Next.js project at sentry.io to get the DSN.

SENTRY_DSN=https://xxxxx@sentry.io/...       # OPTIONAL (arkiol-core server)
SENTRY_AUTH_TOKEN=sntrys_...                  # OPTIONAL — source map upload
NEXT_PUBLIC_SENTRY_DSN=https://xxxxx@sentry.io/...  # OPTIONAL — client-side error capture


# ─────────────────────────────────────────────────────────────────────────────
# 14. MONITORING & ALERTING (arkiol-core)
# ─────────────────────────────────────────────────────────────────────────────
# The /api/monitoring endpoint is protected by MONITORING_SECRET OR SUPER_ADMIN session.
# Without MONITORING_SECRET it still works via SUPER_ADMIN browser session.

MONITORING_SECRET=<openssl rand -hex 32>   # OPTIONAL — internal monitoring token

# Slack / webhook alert sink
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...  # OPTIONAL — Slack incoming webhook
ALERT_EMAIL_TO=ops@arkiol.ai              # OPTIONAL — email for critical alerts

# Alert threshold overrides (all OPTIONAL — safe defaults apply if omitted)
ALERT_COST_SPIKE_ORG_PER_HOUR=100         # credits/hr per-org before spike alert
ALERT_COST_SPIKE_GLOBAL_USD_PER_HOUR=50   # global USD/hr before critical alert
ALERT_VOLUME_JOBS_PER_ORG_HOUR=30         # jobs/hr per-org before volume alert
ALERT_STAGE_FAILURE_RATE_WARNING=5        # stage failure % for WARNING
ALERT_STAGE_FAILURE_RATE_CRITICAL=20      # stage failure % for CRITICAL
ALERT_STAGE_TIMEOUT_MS=30000              # per-stage timeout (ms)
ALERT_DLQ_DEPTH_CRITICAL=10               # DLQ depth before CRITICAL alert
ALERT_ZERO_ASSET_JOB_RATE_WARNING=15      # % zero-asset completed jobs before WARNING
ALERT_DEDUP_WINDOW_MS=900000              # alert deduplication window (ms) — default 15 min


# ─────────────────────────────────────────────────────────────────────────────
# 15. COST PROTECTION & KILL SWITCHES
# ─────────────────────────────────────────────────────────────────────────────
# These can be set at any time without a redeploy (Vercel env var hot-reload).

GENERATION_KILL_SWITCH=false              # OPTIONAL — set "true" to halt all job submissions
GLOBAL_MONTHLY_SPEND_LIMIT_USD=10000      # OPTIONAL — hard ceiling on monthly AI spend
PER_USER_HOURLY_LIMIT=30                  # OPTIONAL — max jobs/hr per user (default 30)
PER_USER_DAILY_LIMIT=200                  # OPTIONAL — max jobs/day per user (default 200)
DEFAULT_DAILY_SPEND_CAP_USD=100           # OPTIONAL — per-org daily spend cap ($)


# ─────────────────────────────────────────────────────────────────────────────
# 16. FEATURE FLAGS
# ─────────────────────────────────────────────────────────────────────────────

ASSET_CACHE_TTL_HOURS=720                 # OPTIONAL — AI asset similarity cache TTL (default 720 = 30 days)
NEXT_PUBLIC_APPLE_ENABLED=false           # OPTIONAL — "true" enables Apple Sign-In button

# Animation Studio feature flags
FEATURE_4K_EXPORT=true                    # OPTIONAL — 4K export support
FEATURE_API_ACCESS=false                  # OPTIONAL — API access for studio users


# ─────────────────────────────────────────────────────────────────────────────
# 17. WORKER TUNING
# ─────────────────────────────────────────────────────────────────────────────
# These control concurrency for background workers.
# OPTIONAL — safe defaults apply for all.

WORKER_CONCURRENCY=3                      # arkiol-core generation worker concurrency (default 3)
EXPORT_WORKER_CONCURRENCY=2               # arkiol-core export worker concurrency (default 2)
RENDER_CONCURRENCY=3                      # animation-studio render worker concurrency


# ─────────────────────────────────────────────────────────────────────────────
# 18. VERCEL DEPLOYMENT (GitHub Secrets for deploy.yml)
# ─────────────────────────────────────────────────────────────────────────────
# These are GitHub Actions secrets — not Vercel env vars.
# Set them in: GitHub → Repo → Settings → Secrets and variables → Actions

# VERCEL_TOKEN          = your Vercel access token (vercel.com/account/tokens)
# VERCEL_ORG_ID         = your Vercel team/org ID (from vercel.json or project settings)
# VERCEL_PROJECT_ID     = your Vercel project ID

# ── CI-specific secrets (GitHub Actions) ──────────────────────────────────────
# These are used only in CI — they must be safe dummy values that do not
# conflict with production configuration.  Real production secrets are
# never used in CI.  See .github/workflows/ci.yml env block for safe defaults.

# NEXTAUTH_SECRET_TEST     = ci-nextauth-secret-minimum-32-chars-xx (min 32 chars)
# WEBHOOK_SECRET_KEY_TEST  = 0000000000000000000000000000000000000000000000000000000000000000
# OPENAI_API_KEY_TEST      = sk-ci-stub-not-real  (or a real low-quota key for integration tests)
# UPSTASH_REDIS_REST_URL   = (leave blank — rate limiter degrades gracefully in CI)
# UPSTASH_REDIS_REST_TOKEN = (leave blank)

# ── Production-only GitHub Secrets (used by deploy.yml migrate-production job) ──
# DATABASE_URL             = production PostgreSQL connection string
# NEXTAUTH_SECRET          = production NextAuth secret (min 32 chars)
# WEBHOOK_SECRET_KEY       = production 64-hex AES-256 key
# STRIPE_SECRET_KEY        = sk_live_... (production Stripe key)
# STRIPE_WEBHOOK_SECRET    = whsec_... (production Stripe webhook secret)
# OPENAI_API_KEY           = production OpenAI key
# AWS_ACCESS_KEY_ID        = production IAM access key
# AWS_SECRET_ACCESS_KEY    = production IAM secret
# S3_BUCKET_NAME           = arkiol-assets-prod


# ─────────────────────────────────────────────────────────────────────────────
# 19. APPLICATION URLs
# ─────────────────────────────────────────────────────────────────────────────

NEXT_PUBLIC_APP_URL=https://app.arkiol.com   # arkiol-core: canonical public URL
NODE_ENV=production                         # "development" | "staging" | "production" | "test"
LOG_LEVEL=warn                              # OPTIONAL — "error"|"warn"|"info"|"debug"|"trace"


# ─────────────────────────────────────────────────────────────────────────────
# 20. DEVELOPMENT-ONLY VARS (never set in production)
# ─────────────────────────────────────────────────────────────────────────────
# These vars are refused or ignored by the application in NODE_ENV=production.

ALLOW_SEED=development     # Required by db:seed — ONLY works with NODE_ENV=development
SEED_ADMIN_PASSWORD=       # Local dev seed admin password
SEED_DESIGNER_PASSWORD=    # Local dev seed designer password
ETHEREAL_USER=             # Ethereal test email inbox (development only)
ETHEREAL_PASS=


# ══════════════════════════════════════════════════════════════════════════════
# STARTUP VALIDATION SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
#
# arkiol-core (Next.js) — instrumentation.ts runs validateSharedEnv() before
# the first request is served.  Hard-fails with a clear error listing all
# missing/malformed vars if any of the following are absent:
#
#   DATABASE_URL, STRIPE_SECRET_KEY, WEBHOOK_SECRET_KEY,
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET_NAME,
#   REDIS_HOST, NEXTAUTH_SECRET, NEXTAUTH_URL
#
#   When BILLING_PROVIDER=paddle (default):
#     PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_CLIENT_TOKEN,
#     PADDLE_PRICE_CREATOR, PADDLE_PRICE_PRO, PADDLE_PRICE_STUDIO
#
#   When BILLING_PROVIDER=stripe:
#     STRIPE_WEBHOOK_SECRET
#
# animation-studio — src/config/env.ts validates its own schema synchronously
# before any module exports are consumed.  Hard-fails with a clear error listing
# missing fields.  Required vars (subset):
#
#   DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET,
#   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ENCRYPTION_KEY,
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_ASSETS,
#   S3_BUCKET_RENDERS, API_URL, FRONTEND_URL, CDN_URL
#
# ══════════════════════════════════════════════════════════════════════════════
# PRODUCTION LAUNCH CHECKLIST
# ══════════════════════════════════════════════════════════════════════════════
#
# Before going live, confirm all of the following in Vercel + GitHub:
#
# Vercel Environment Variables (arkiol-core):
#   [ ] DATABASE_URL               — PostgreSQL connection string with ?sslmode=require
#   [ ] REDIS_HOST / REDIS_PORT    — Production Redis host + port
#   [ ] REDIS_PASSWORD             — If Redis requires auth
#   [ ] REDIS_TLS=true             — If Redis requires TLS (recommended)
#   [ ] NEXTAUTH_SECRET            — 48+ char random secret
#   [ ] NEXTAUTH_URL               — https://app.arkiol.com
#   [ ] WEBHOOK_SECRET_KEY         — 64-char hex (openssl rand -hex 32)
#   [ ] STRIPE_SECRET_KEY          — sk_live_...
#   [ ] STRIPE_WEBHOOK_SECRET      — whsec_...
#   [ ] BILLING_PROVIDER           — "paddle" or "stripe"
#   [ ] PADDLE_API_KEY             — (if BILLING_PROVIDER=paddle)
#   [ ] PADDLE_WEBHOOK_SECRET      — (if BILLING_PROVIDER=paddle)
#   [ ] PADDLE_CLIENT_TOKEN        — (if BILLING_PROVIDER=paddle)
#   [ ] PADDLE_PRICE_*             — 3 price IDs (if BILLING_PROVIDER=paddle)
#   [ ] PADDLE_ENVIRONMENT=live    — (if BILLING_PROVIDER=paddle)
#   [ ] AWS_ACCESS_KEY_ID          — IAM access key
#   [ ] AWS_SECRET_ACCESS_KEY      — IAM secret
#   [ ] AWS_REGION                 — e.g. us-east-1
#   [ ] S3_BUCKET_NAME             — arkiol-assets-prod
#   [ ] UPSTASH_REDIS_REST_URL     — Rate limiting (Upstash)
#   [ ] UPSTASH_REDIS_REST_TOKEN   — Rate limiting (Upstash)
#   [ ] OPENAI_API_KEY             — sk-... (AI features)
#   [ ] NEXT_PUBLIC_APP_URL        — https://app.arkiol.com
#   [ ] NODE_ENV=production
#   [ ] SENTRY_DSN                 — Recommended for production error tracking
#   [ ] MONITORING_SECRET          — Internal monitoring endpoint token
#
# GitHub Actions Secrets:
#   [ ] VERCEL_TOKEN
#   [ ] VERCEL_ORG_ID
#   [ ] VERCEL_PROJECT_ID
#   [ ] DATABASE_URL               — Production DB (used by migrate-production job)
#   [ ] NEXTAUTH_SECRET            — Production NextAuth secret
#   [ ] WEBHOOK_SECRET_KEY         — Production key
#   [ ] STRIPE_SECRET_KEY          — Production Stripe key
#   [ ] STRIPE_WEBHOOK_SECRET      — Production Stripe webhook secret
#   [ ] OPENAI_API_KEY             — Production OpenAI key
#   [ ] AWS_ACCESS_KEY_ID          — Production IAM key
#   [ ] AWS_SECRET_ACCESS_KEY      — Production IAM secret
#   [ ] S3_BUCKET_NAME             — arkiol-assets-prod
#   [ ] UPSTASH_REDIS_REST_URL     — Production Upstash URL
#   [ ] UPSTASH_REDIS_REST_TOKEN   — Production Upstash token
#
# Branch Protection:
#   [ ] Run:  bash scripts/setup-branch-protection.sh
#             (requires GITHUB_TOKEN + GITHUB_REPO env vars)
#
# Database:
#   [ ] Run production migration:
#         DATABASE_URL=<prod> npx prisma migrate deploy --schema=packages/shared/prisma/schema.prisma
#   [ ] Verify: npx prisma migrate status --schema=packages/shared/prisma/schema.prisma
#
# Smoke test against production:
#   [ ] ARKIOL_CORE_URL=https://app.arkiol.com npx tsx scripts/ci/http-smoke-tests.ts

# ─────────────────────────────────────────────────────────────────────────────
# AUTOMATION API (STUDIO plan — /api/automation/generate)
# ─────────────────────────────────────────────────────────────────────────────
# HMAC-SHA256 signing secret for direct webhook delivery (deliverDirectWebhook).
# Used when /api/automation/generate delivers automation.job.completed to
# the caller's webhookUrl without going through the registered webhook queue.
# OPTIONAL — falls back to WEBHOOK_DEFAULT_SECRET if absent.
# Generate: openssl rand -base64 32

AUTOMATION_WEBHOOK_SECRET=<openssl rand -base64 32>

# Default HMAC signing key for direct webhooks (fallback for all direct delivery).
# OPTIONAL — embedded safe default exists; always set in production.

WEBHOOK_DEFAULT_SECRET=<openssl rand -base64 32>

# CI safe dummy values:
#   AUTOMATION_WEBHOOK_SECRET=ci-automation-webhook-secret-stub-for-testing-only
#   WEBHOOK_DEFAULT_SECRET=ci-webhook-default-secret-stub-for-testing-only
