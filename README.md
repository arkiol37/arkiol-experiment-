# ARKIOL v27

AI-powered design and animation platform. One subscription, one credit economy, two studios.

**v27**: Internal Template Execution Engine is the sole rendering path for all 2D/2.5D outputs. No external provider dependencies.

## Architecture

```
arkiol/
├── apps/
│   ├── arkiol-core/              ← Next.js 14 — design studio, auth, billing, API
│   │   ├── src/app/api/          ← 30+ API routes
│   │   ├── src/engines/          ← AI generation, layout, render engines
│   │   ├── src/workers/          ← BullMQ workers (deploy separately)
│   │   └── vercel.json           ← Vercel build config (single source of truth)
│   └── animation-studio/
│       ├── backend/              ← Express + Bull render pipeline (internal-only)
│       │   └── src/_future_3d/   ← Provider code preserved for future 3D
│       └── frontend/             ← Vite + React SPA
├── packages/
│   └── shared/                   ← @arkiol/shared — plans, credits, billing, schemas
│       └── prisma/schema.prisma  ← Single authoritative database schema
├── .github/workflows/ci.yml     ← CI: install, lint, typecheck, build, test
├── vercel.json                   ← Headers/rewrites only (no build config)
└── supabase-schema.sql           ← Full schema SQL (alternative to migrations)
```

## Deployment targets

| What | Where | Reason |
|------|-------|--------|
| `apps/arkiol-core` (web) | **Vercel** | Next.js SSR + API routes |
| `apps/arkiol-core` (workers) | **Railway / Fly.io** | Persistent BullMQ queue processing |
| `apps/animation-studio/backend` | **Railway / Fly.io** | Express + persistent render workers |
| `apps/animation-studio/frontend` | **Vercel / Netlify** | Static SPA |
| PostgreSQL | **Supabase / Neon** | Primary database |
| Redis | **Upstash / Railway** | Queue + rate limiting |

## Quick start

```bash
# 1. Install (generates package-lock.json on first run)
npm install

# 2. Generate Prisma client
npm run prisma:generate

# 3. Configure environment
cp apps/arkiol-core/.env.example apps/arkiol-core/.env.local
# Edit .env.local with your DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET, etc.

# 4. Set up database
npm run db:deploy          # Prisma migrations
# OR paste supabase-schema.sql in Supabase SQL Editor

# 5. Start development
npm run dev                # Next.js on :3000
npm run dev:studio         # Animation Studio on :4000 + :5173
```

## Build flags

| Flag | Value | Effect |
|------|-------|--------|
| `eslint.ignoreDuringBuilds` | `false` | Build fails on lint errors |
| `typescript.ignoreBuildErrors` | `false` | Build fails on type errors |

## Scripts

```bash
npm run dev              # Start arkiol-core dev server
npm run build            # Build shared + arkiol-core
npm run build:all        # Build all workspaces
npm test                 # Run all workspace tests
npm run lint             # Lint all workspaces
npm run type-check       # TypeScript check all workspaces
npm run db:deploy        # Run Prisma migrations (production)
npm run db:generate      # Generate Prisma client
npm run db:studio        # Open Prisma Studio
npm run verify           # Run deployment verification
```

## CI

GitHub Actions runs on push to `main`/`develop` and PRs to `main`:
install → lint → typecheck → build → test → prisma validate

All steps use `npm ci` with no `--legacy-peer-deps`.
