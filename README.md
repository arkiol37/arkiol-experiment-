[README.md](https://github.com/user-attachments/files/26391711/README.md)
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
│   │   └── Dockerfile            ← Worker container image
│   └── animation-studio/
│       ├── backend/              ← Express + Bull render pipeline
│       └── frontend/             ← Vite + React SPA
├── packages/
│   └── shared/                   ← @arkiol/shared — plans, credits, billing, schemas
│       └── prisma/schema.prisma  ← Single authoritative database schema
├── .github/workflows/ci.yml     ← CI: install, lint, typecheck, build, test
├── vercel.json                   ← Vercel deployment config
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
# 1. Clone and bootstrap
git clone https://github.com/YOUR_USERNAME/arkiol.git && cd arkiol
bash scripts/bootstrap.sh

# 2. Configure environment
cp apps/arkiol-core/.env.example apps/arkiol-core/.env.local
# Edit .env.local with your DATABASE_URL, NEXTAUTH_SECRET, OPENAI_API_KEY, etc.

# 3. Set up database (choose one)
# Option A: Prisma migrations
npm run db:deploy

# Option B: Supabase SQL Editor
# Paste supabase-schema.sql and run

# 4. Start development
npm run dev              # Next.js on :3000
npm run dev:studio       # Animation Studio on :4000 + :5173
```

## Scripts

```bash
npm run dev              # Start arkiol-core dev server
npm run build            # Build shared + arkiol-core
npm run build:all        # Build shared + arkiol-core + animation-studio
npm run test             # Run all workspace tests
npm run lint             # Lint all workspaces
npm run type-check       # TypeScript check all workspaces
npm run db:deploy        # Run Prisma migrations (production)
npm run db:migrate       # Run Prisma migrations (development)
npm run db:generate      # Generate Prisma client
npm run db:studio        # Open Prisma Studio
npm run db:seed          # Seed dev data (development only)
npm run worker:core      # Start BullMQ workers
npm run verify           # Run deployment verification
```

## CI

GitHub Actions runs on every push to `main`/`develop` and on PRs:

1. **Install** — `npm ci` with lockfile
2. **Lint** — ESLint across workspaces
3. **TypeScript** — `tsc --noEmit` for shared, core, and backend
4. **Build** — Full production build (shared → core → backend)
5. **Test** — Jest across all workspaces
6. **Prisma** — Schema validation + client generation

## Deployment

See [DEPLOY.md](./DEPLOY.md) for step-by-step deployment instructions.

## Key design decisions

- **Graceful degradation**: Every service is optional. The app starts with whatever is configured and reports capability status via `/api/health` and `/api/capabilities`.
- **Single schema**: All apps share one Prisma schema at `packages/shared/prisma/schema.prisma`. Never create a second schema.
- **Founder bootstrap**: Set `FOUNDER_EMAIL` env var. First sign-in with that email auto-promotes to SUPER_ADMIN with unlimited credits.
- **Credit economy**: Append-only ledger with atomic two-phase commit (hold → finalize/refund).
- **Edge-safe middleware**: `src/middleware.ts` runs in Edge Runtime and cannot import `@arkiol/shared`. Auth logic is duplicated inline with a cross-reference comment.

## Environment variables

See `apps/arkiol-core/.env.example` for the full list. The minimum to start:

```
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=<32+ chars>
NEXTAUTH_URL=http://localhost:3000
OPENAI_API_KEY=sk-...
FOUNDER_EMAIL=you@example.com
```

## License

Proprietary. All rights reserved.
