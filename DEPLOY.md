# Arkiol — Deployment Guide

## Service Split (Step 1)

Arkiol runs as **two** independent services that share a Postgres DB:

| Service               | Host   | Owns                                                    |
|-----------------------|--------|---------------------------------------------------------|
| `apps/arkiol-core`    | Vercel | UI (dashboard / editor / gallery), auth, plan + credit enforcement, lightweight `/api/generate` proxy, status polling (`/api/jobs`). |
| `apps/render-backend` | Render | Heavy generation — OpenAI calls, template composition, asset selection + injection, layout, rendering, final output. |

Frontend → Render wiring lives in
`apps/arkiol-core/src/lib/renderDispatch.ts`. Setting
`RENDER_GENERATION_URL` + `RENDER_GENERATION_KEY` on Vercel activates
the split; if either is missing the legacy inline path is used
(preview deploys, local dev).

See `render.yaml` and `apps/render-backend/README.md` for the Render
side.

## Prerequisites

- Node.js >= 20, npm >= 10
- PostgreSQL (Supabase / Neon / Vercel Postgres)
- Redis (Upstash / Railway — optional, queue features degrade gracefully)

## Fresh Setup

```bash
# 1. Install dependencies (generates package-lock.json on first run)
npm install

# 2. Generate Prisma client
npm run prisma:generate

# 3. Configure environment
cp apps/arkiol-core/.env.example apps/arkiol-core/.env.local
# Edit .env.local — minimum: DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET, NEXTAUTH_URL

# 4. Run database migrations
npm run db:deploy

# 5. Build and start
npm run build
cd apps/arkiol-core && npm start
```

## Vercel Deployment

### Dashboard Configuration

1. **Root Directory**: `apps/arkiol-core`
2. **Framework**: Next.js (auto-detected)
3. **Build & Install**: Auto — controlled by `apps/arkiol-core/vercel.json`
4. **Node.js Version**: 20.x

The app-level `apps/arkiol-core/vercel.json` is the **single source of truth** for build config:
```json
{
  "framework": "nextjs",
  "installCommand": "cd ../.. && npm install",
  "buildCommand": "node scripts/vercel-prisma-generate.cjs && next build"
}
```

The root `vercel.json` contains only headers and rewrites — **no build config**.

### Required Environment Variables

**Critical (app fails fast without these in production):**
- `DATABASE_URL` — Pooled PostgreSQL (port 6543 for Supabase)
- `DIRECT_URL` — Direct PostgreSQL (port 5432, for Prisma CLI)
- `NEXTAUTH_SECRET` — ≥32 chars (`openssl rand -base64 32`)
- `NEXTAUTH_URL` — App URL (e.g. `https://app.arkiol.com`)

**Recommended:**
- `OPENAI_API_KEY` — AI generation
- `FOUNDER_EMAIL` — Your email for auto-promotion to SUPER_ADMIN
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` — Asset storage
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — Rate limiting
- `NEXT_PUBLIC_APP_URL` — Same as NEXTAUTH_URL

See `apps/arkiol-core/.env.example` for the complete list.

### Post-Deploy

```bash
# Verify
curl https://your-app.vercel.app/api/health

# Run migrations (first deploy only)
DATABASE_URL='postgresql://...' npx prisma migrate deploy --schema=packages/shared/prisma/schema.prisma
```

## Render Backend Deployment (heavy generation)

The dedicated generation service lives in `apps/render-backend`.
Point Render at this repo and Render will pick up `render.yaml`.
Required env vars in the Render dashboard:

- `DATABASE_URL` — same Postgres as the Vercel deploy
- `OPENAI_API_KEY`
- `RENDER_GENERATION_KEY` — shared secret (must match Vercel)
- `ALLOWED_ORIGINS` — comma-separated Vercel origins
- `S3_*` — optional; falls back to inline SVG data URLs

Once deployed, set on Vercel:

- `RENDER_GENERATION_URL` — the Render service URL (no trailing slash)
- `RENDER_GENERATION_KEY` — same shared secret as on Render

After that, `/api/generate` on Vercel forwards heavy work to Render,
responds 202 immediately with the `jobId`, and the existing frontend
polling flow (`/api/jobs`) is unchanged.

## Worker Deployment (Railway / Fly.io)

BullMQ workers require persistent processes — cannot run on Vercel.
The Render backend above is the preferred way to host heavy
generation; the BullMQ worker path remains for environments already
running Redis + a dedicated worker container.

```bash
# Docker
docker build -t arkiol-worker -f apps/arkiol-core/Dockerfile .

# Or direct
cd apps/arkiol-core && npm run worker:prod
```

Required worker env vars: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `OPENAI_API_KEY`, `AWS_*`, `S3_BUCKET_NAME`

## Animation Studio Backend (optional)

Only needed if Animation Studio features are enabled. Deploys to Railway/Fly.io as a separate Express service.

```bash
cd apps/animation-studio/backend
npm run build && npm start     # Express on port 4000
npm run worker                 # Render worker (separate process)
```

## Build Enforcement

| Setting | Value |
|---------|-------|
| `eslint.ignoreDuringBuilds` | `false` — build fails on lint errors |
| `typescript.ignoreBuildErrors` | `false` — build fails on type errors |
| `serverExternalPackages` | Top-level key (not deprecated `experimental` location) |
| `--legacy-peer-deps` | **Not used** — all peer deps resolved |
