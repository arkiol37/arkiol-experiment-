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
