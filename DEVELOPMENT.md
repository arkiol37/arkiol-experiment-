# Arkiol — Development Guide

## Setup

```bash
# Prerequisites: Node.js >= 20, npm >= 10
node -v  # v20.x or v22.x
npm -v   # 10.x+

# Install all workspace dependencies
npm install

# Generate Prisma client (required before build/typecheck)
npm run prisma:generate

# Copy environment config
cp apps/arkiol-core/.env.example apps/arkiol-core/.env.local
# Edit .env.local with your DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET, etc.
```

## Daily Development

```bash
npm run dev              # arkiol-core on http://localhost:3000
npm run dev:studio       # Animation Studio backend:4000 + frontend:5173
npm run dev:all          # Both concurrently
```

## Build

```bash
npm run build            # shared + arkiol-core
npm run build:all        # shared + arkiol-core + animation-studio
```

Build enforcement:
- `eslint.ignoreDuringBuilds: false` — lint errors break the build
- `typescript.ignoreBuildErrors: false` — type errors break the build
- `serverExternalPackages` — top-level key in `next.config.js` (not deprecated `experimental.serverComponentsExternalPackages`)

## Database

Single authoritative schema: `packages/shared/prisma/schema.prisma`

```bash
npm run db:generate      # Generate Prisma client
npm run db:migrate       # Create new migration (dev)
npm run db:deploy        # Apply migrations (production)
npm run db:studio        # Open Prisma Studio GUI
npm run db:seed          # Seed dev data (development only)
```

The file at `apps/arkiol-core/prisma/schema.prisma` is intentionally inert — IDE tooling only.

## Testing

```bash
npm test                 # All workspaces
npm run test:unit        # Unit tests only
npm run test:coverage    # With coverage
```

## Linting

```bash
npm run lint             # All workspaces
npm run type-check       # TypeScript check all workspaces
```

ESLint is configured with `@typescript-eslint/no-require-imports: off` because `require()` is used intentionally for capability-gated lazy imports.

## Monorepo Structure

- `apps/arkiol-core` — Next.js 14 (SSR + API routes + workers)
- `apps/animation-studio/backend` — Express + Bull render pipeline
- `apps/animation-studio/frontend` — Vite + React SPA
- `packages/shared` — Plans, credits, billing, schemas, capabilities

All packages use `@arkiol/shared` as a workspace dependency (`file:` link).

## Animation Studio Architecture

v27: ALL 2D/2.5D rendering uses the internal Template Execution Engine.
Provider code (Runway/Pika/Sora) is in `backend/src/_future_3d/` for future 3D work.

Key enforcement files:
- `engines/renderer/engineGate.ts` — blocks providers for 2D/2.5D
- `engines/renderer/hybridRouter.ts` — always routes to internal
- `engines/prompt/promptCompilerEngine.ts` — compiles for `'internal'` target
