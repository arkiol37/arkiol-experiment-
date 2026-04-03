# ARKIOL v27 — Launch Report

**Date**: 2026-04-04
**Verdict**: **GO** — all structural issues resolved

---

## Architecture Summary

Arkiol is a monorepo with two studios sharing a single Prisma schema, credit economy, and auth layer.

| Component | Runtime | Deploy Target |
|-----------|---------|---------------|
| `apps/arkiol-core` (Next.js 14) | Serverless + SSR | **Vercel** |
| `apps/arkiol-core` workers | Persistent Node.js | Railway / Fly.io |
| `apps/animation-studio/backend` | Express + Bull | Railway / Fly.io |
| `apps/animation-studio/frontend` | Vite SPA | Vercel / Netlify |
| PostgreSQL | Managed | Supabase / Neon |
| Redis | Managed | Upstash / Railway |

## Rendering Architecture

**v27 policy**: ALL 2D and 2.5D rendering uses the internal Template Execution Engine exclusively. No external video provider (Runway/Pika/Sora) is called in any active code path.

Enforcement layers:
- `engineGate.ts` — blocks provider engine requests for all 2D/2.5D modes
- `hybridRouter.ts` — always returns `path: 'internal'`
- `renderQueue.ts` — imports only internal render pipeline, never `providerAdapter`
- `promptCompilerEngine.ts` — compiles prompts for `'internal'` target only

Provider code is preserved in `_future_3d/` for future 3D video capabilities.

## Build Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| `eslint.ignoreDuringBuilds` | `false` | Zero suppressed lint errors |
| `typescript.ignoreBuildErrors` | `false` | Zero suppressed type errors |
| `serverExternalPackages` | Top-level (not `experimental`) | Next.js 14.2+ standard key |
| `--legacy-peer-deps` | **Removed** | All peer deps resolved at source |
| CSP `unsafe-eval` | **Dev only** | Stripped in production builds |
| CSP `unsafe-inline` (styles) | Required | Next.js injects `<style>` tags |

## Vercel Deployment

**Root Directory**: `apps/arkiol-core` (set in Vercel dashboard)

Build config lives in `apps/arkiol-core/vercel.json`:
```json
{
  "framework": "nextjs",
  "installCommand": "cd ../.. && npm install",
  "buildCommand": "node scripts/vercel-prisma-generate.cjs && next build"
}
```

Root `vercel.json` contains only headers and rewrites — **no build config**.

**Required env vars**: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET` (≥32 chars), `NEXTAUTH_URL`

Production builds fail fast if any required var is missing (enforced in `instrumentation.ts`).

## Prisma

Single authoritative schema: `packages/shared/prisma/schema.prisma`

The stub at `apps/arkiol-core/prisma/schema.prisma` is intentionally inert (no datasource, no generator, no models) — exists only for IDE tooling.

Prisma client generation: `npx prisma generate --schema=packages/shared/prisma/schema.prisma`
Build hook: `apps/arkiol-core/scripts/vercel-prisma-generate.cjs` (runs before `next build`)

## CI

All CI jobs use `npm ci` (no `--legacy-peer-deps`). Prisma generate runs before every lint/typecheck/build/test step.

## Validated Commands

```bash
npm install                    # Clean install (generates package-lock.json)
npm run prisma:generate        # Generate Prisma client
npm run build                  # Build shared + arkiol-core
npm run lint                   # Lint all workspaces
npm run type-check             # TypeScript check all workspaces
npm test                       # Run all tests
```
