# ARKIOL v3 — Development Setup

## Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- PostgreSQL 16
- Redis 7

## Quick Start

```bash
# 1. Install all workspace dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env
# edit .env with your DATABASE_URL, NEXTAUTH_SECRET, etc.

# 3. Generate Prisma client from unified schema
npm run db:generate

# 4. Run database migrations
npm run db:migrate

# 5. Seed the database (development only)
npm run db:seed

# 6. Start development servers
npm run dev              # arkiol-core only
npm run dev:all          # arkiol-core + animation-studio (uses concurrently)
./scripts/dev.sh         # alternative cross-platform runner
```

## Package Manager

This project uses **npm workspaces**. Always use `npm` — not `yarn` or `pnpm`.

A `package-lock.json` is committed to the repository so that `npm ci` works reliably in CI.

## Prisma

See [PRISMA.md](./PRISMA.md) for the full guide. The short version:
- **Single source of truth**: `packages/shared/prisma/schema.prisma`
- Always run `npm run db:generate` after pulling changes
- CI runs `prisma migrate deploy` automatically

## Available Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run dev` | Start arkiol-core in development mode |
| `npm run dev:all` | Start all services (uses concurrently) |
| `npm run build` | Build shared package + arkiol-core |
| `npm run test` | Run all workspace tests |
| `npm run lint` | Lint all workspaces |
| `npm run db:generate` | Generate Prisma client from unified schema |
| `npm run db:migrate` | Run migrations (dev) |
| `npm run db:deploy` | Deploy migrations (production) |
| `npm run db:seed` | Seed database (development only) |
| `npm run smoke-test` | Run production smoke tests |

## Environment Variables

See `.env.example` for the full list.

Key variables for local development:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/arkiol_dev
NEXTAUTH_SECRET=<at-least-32-chars>
NEXTAUTH_URL=http://localhost:3000
REDIS_URL=redis://localhost:6379
```

## Project Structure

```
arkiol-platform/
├── apps/
│   ├── arkiol-core/          # Next.js 14 app — main product
│   └── animation-studio/     # Animation Studio (frontend + backend)
├── packages/
│   └── shared/               # Shared types, engines, Prisma schema
│       └── prisma/
│           └── schema.prisma # ← SINGLE SOURCE OF TRUTH
├── scripts/
│   ├── dev.sh                # Cross-platform dev runner
│   └── deploy-checklist.sh   # Pre-deployment verification
├── PRISMA.md                 # Prisma schema guide
├── DEVELOPMENT.md            # This file
└── package.json              # Workspace root
```
