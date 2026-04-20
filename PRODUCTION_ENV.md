# Arkiol — Production Environment Variables

All variables are set in: **Vercel Dashboard → Project → Settings → Environment Variables**

## Critical (app fails fast without these)

| Variable | Example | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://user:pass@host:6543/db?sslmode=require` | Pooled connection (PgBouncer port) |
| `DIRECT_URL` | `postgresql://user:pass@host:5432/db?sslmode=require` | Direct connection for Prisma CLI |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` | Must be ≥32 characters |
| `NEXTAUTH_URL` | `https://app.arkiol.com` | Your app URL |

## AI & Generation

| Variable | Example | Notes |
|----------|---------|-------|
| `OPENAI_API_KEY` | `sk-...` | Required for AI generation |
| `OPENAI_ORG_ID` | `org-...` | Optional |

## Storage (S3)

| Variable | Example | Notes |
|----------|---------|-------|
| `AWS_ACCESS_KEY_ID` | `AKIA...` | IAM user with S3 permissions |
| `AWS_SECRET_ACCESS_KEY` | `...` | |
| `AWS_REGION` | `us-east-1` | Default: us-east-1 |
| `S3_BUCKET_NAME` | `arkiol-assets-prod` | |
| `CLOUDFRONT_DOMAIN` | `https://cdn.arkiol.ai` | Optional CDN |

## Authentication

| Variable | Example | Notes |
|----------|---------|-------|
| `GOOGLE_CLIENT_ID` | `...apps.googleusercontent.com` | Optional OAuth |
| `GOOGLE_CLIENT_SECRET` | `...` | |
| `FOUNDER_EMAIL` | *(your email)* | Auto-promotes to SUPER_ADMIN on sign-in |

## Billing (Paddle or Stripe)

| Variable | Example | Notes |
|----------|---------|-------|
| `BILLING_PROVIDER` | `paddle` or `stripe` | Default: paddle |
| `PADDLE_API_KEY` | `...` | |
| `PADDLE_CLIENT_TOKEN` | `...` | |
| `PADDLE_WEBHOOK_SECRET` | `...` | |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Alternative to Paddle |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | |

## Rate Limiting

| Variable | Example | Notes |
|----------|---------|-------|
| `UPSTASH_REDIS_REST_URL` | `https://...upstash.io` | |
| `UPSTASH_REDIS_REST_TOKEN` | `...` | |

## Queue (BullMQ Workers)

| Variable | Example | Notes |
|----------|---------|-------|
| `REDIS_HOST` | `localhost` | Required for workers |
| `REDIS_PORT` | `6379` | |
| `REDIS_PASSWORD` | `...` | Optional |
| `REDIS_TLS` | `true` | Set for cloud Redis |

## Email

| Variable | Example | Notes |
|----------|---------|-------|
| `SMTP_HOST` | `smtp.resend.com` | |
| `SMTP_PORT` | `587` | |
| `SMTP_USER` | `resend` | |
| `SMTP_PASS` | `re_...` | |
| `EMAIL_FROM` | `Arkiol <noreply@arkiol.ai>` | |

## Monitoring

| Variable | Example | Notes |
|----------|---------|-------|
| `SENTRY_DSN` | `https://...@sentry.io/...` | Server-side |
| `NEXT_PUBLIC_SENTRY_DSN` | `https://...@sentry.io/...` | Client-side |
| `SENTRY_AUTH_TOKEN` | `sntrys_...` | For source maps |

## Security

| Variable | Example | Notes |
|----------|---------|-------|
| `WEBHOOK_SECRET_KEY` | `openssl rand -hex 32` | 64 hex chars |
| `MONITORING_SECRET` | *(internal token)* | For /api/monitoring |

## Application

| Variable | Example | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_APP_URL` | `https://app.arkiol.com` | Client-accessible |
| `WORKER_CONCURRENCY` | `3` | BullMQ worker threads |

## Arkiol-Core (scene engine + memory + 3D manifest)

These are specific to the arkiol-core sub-app under `apps/arkiol-core`.
Everything is optional — sensible defaults apply when unset.

| Variable | Example | Notes |
|----------|---------|-------|
| `ARKIOL_MEMORY_STORE` | `in-memory` (default) or `redis` | Picks the memory store driver at boot. `redis` requires `REDIS_URL`. |
| `REDIS_URL` | `rediss://default:TOKEN@host:6380` | Used when `ARKIOL_MEMORY_STORE=redis`. TLS endpoint recommended for cloud Redis. |
| `ARKIOL_MEMORY_CAPACITY` | `2000` | Max records retained in the InMemoryStore ring buffer. Default 1,000. |
| `ARKIOL_3D_ASSET_BASE` | `https://cdn.arkiol.ai/3d` | Base URL for the 3D asset manifest. Without it, `asset3dUrl()` returns undefined and the pipeline falls back to inline SVG scenes. |
| `ARKIOL_3D_ASSET_EXT` | `png` (default), `webp`, `jpg` | File extension appended to each slug. |
| `ARKIOL_PACK_ANCHOR_STRICT` | `true` / `false` | When `true`, downstream variations must inherit palette + typography from the first gallery render. Default: `true`. |
| `ARKIOL_METRICS_WINDOW` | `200` | Rolling latency sample window used by `/api/health/generation`. Default: 200. |
