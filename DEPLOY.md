# Deployment Guide

## Architecture Overview

Arkiol is a monorepo with two deployable units:

| Component | Deploys To | Why |
|-----------|-----------|-----|
| `apps/arkiol-core` (Next.js) | **Vercel** | Serverless SSR, API routes, auth, billing |
| `apps/arkiol-core` worker (BullMQ) | **Railway / Fly.io / Docker** | Persistent process for generation queue, export, webhooks |
| `apps/animation-studio/backend` (Express) | **Railway / Fly.io / Docker** | Persistent Express + Bull render queue |
| `apps/animation-studio/frontend` (Vite/React) | **Vercel / Netlify / CDN** | Static SPA, proxies API to backend |

Vercel **cannot** host the worker or animation-studio backend — they require persistent processes for Redis/BullMQ queues.

## Prerequisites

- Node.js >= 20, npm >= 10
- PostgreSQL (Supabase / Neon / Vercel Postgres)
- Redis (Upstash / Railway Redis)
- AWS S3 or Cloudflare R2
- Stripe account
- OpenAI API key

## Step 1: Generate and commit the lockfile

The repository requires a committed `package-lock.json` for deterministic installs across local, CI, and Vercel environments. This must be done once in a networked environment:

```bash
git clone https://github.com/YOUR_USERNAME/arkiol.git
cd arkiol
npm install --package-lock-only --legacy-peer-deps
git add package-lock.json
git commit -m "chore: add package-lock.json"
git push -u origin main
```

After this, all environments use `npm ci` — no lockfile generation at install time.

## Step 2: Validate locally

```bash
bash scripts/bootstrap.sh
```

This installs dependencies from the committed lockfile, generates the Prisma client, builds all workspaces, runs type-checks and tests, and performs a production build. If every step passes, the repo is ready to deploy.

## Step 3: Configure environment

```bash
cp apps/arkiol-core/.env.example apps/arkiol-core/.env.local
# Edit .env.local — minimum: DATABASE_URL, NEXTAUTH_SECRET, FOUNDER_EMAIL
```

## Step 4: Deploy Next.js to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import your GitHub repo
2. Vercel auto-detects `vercel.json`:
   - **Framework**: Next.js
   - **Root Directory**: `.` (monorepo root)
   - **Install Command**: `npm ci --legacy-peer-deps`
   - **Build Command**: `npm run vercel-build`
   - **Output Directory**: `apps/arkiol-core/.next`
3. Add environment variables (see `apps/arkiol-core/.env.example` for full list):

**Required:**
```
DATABASE_URL=postgresql://...?sslmode=require
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://your-app.vercel.app
OPENAI_API_KEY=sk-...
FOUNDER_EMAIL=your-email@example.com
SKIP_DB_MIGRATE=true
```

**Recommended:**
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET_NAME=arkiol-assets
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

4. Click Deploy

## Step 5: Run database migration

After first deploy, run migrations against your production database:

```bash
DATABASE_URL='postgresql://...' npx prisma migrate deploy --schema=packages/shared/prisma/schema.prisma
```

Or apply `supabase-schema.sql` directly in Supabase SQL Editor (idempotent).

## Step 6: Deploy worker (Railway / Fly.io)

The BullMQ worker runs as a persistent Node.js process alongside Vercel.

See `apps/arkiol-core/WORKER_HOSTING.md` for:
- Docker: `docker build -t arkiol-worker -f apps/arkiol-core/Dockerfile .`
- Fly.io: `fly deploy --config apps/arkiol-core/fly.toml`
- Railway: set root directory to `apps/arkiol-core`

Required worker env vars: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `OPENAI_API_KEY`.

## Step 7: Deploy Animation Studio backend (optional)

Only needed if Animation Studio features are enabled.

```bash
cd apps/animation-studio/backend
npm run build
npm start     # Express on port 4000
npm run worker  # Render worker (separate process)
```

See `apps/animation-studio/backend/.env.example` for required env vars.

## Step 8: Verify

```bash
# Health check (returns capability status)
curl https://your-app.vercel.app/api/health

# Expected: {"status":"partial"|"ok", "checks":{...}}
```

The health endpoint reports which services are configured vs unconfigured. A `partial` status with `database: ok` and `auth: ok` is sufficient for launch.

## Post-deploy

1. Visit your app URL and register with the `FOUNDER_EMAIL` address
2. The founder account auto-promotes to SUPER_ADMIN with unlimited credits
3. Set up Stripe webhooks pointing to `https://your-app.vercel.app/api/billing/webhook`
4. Configure DNS and custom domain in Vercel dashboard

## Keeping the lockfile up to date

When you add, remove, or update dependencies, `npm install` updates `package-lock.json` automatically. Always commit the updated lockfile alongside `package.json` changes:

```bash
npm install some-new-package --legacy-peer-deps
git add package.json package-lock.json
git commit -m "deps: add some-new-package"
```
