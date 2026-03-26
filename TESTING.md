# ARKIOL v3 — Testing & CI Guide

## Overview

The monorepo uses a layered test strategy. Every layer runs in the single
`CI` GitHub Actions workflow and is reproducible locally with `npm run verify`.

```
Layer               Where it runs          What it verifies
─────────────────── ────────────────────── ────────────────────────────────────────────
Unit tests          Jest (no services)     Pure logic: engines, services, plans, credits
Integration tests   Jest (Postgres+Redis)  DB schemas, route handlers, business flows
E2E tests           Jest (full services)   Complete render pipeline
HTTP smoke tests    curl/fetch (live svr)  Real HTTP: status codes, shapes, auth gates
Migration check     prisma CLI             Schema drift, idempotency, forward migration
```

---

## Test Suite Summary

**2,663 tests | 68 files**

| Package | Files | Tests |
|---------|-------|-------|
| `apps/animation-studio/backend` | 19 | 613 |
| `apps/arkiol-core` | 35 | 1,529 |
| `packages/shared` | 14 | 521 |

---

## Quick Start

```bash
# Fast feedback loop (lint + type-check + unit tests only, ~2 min, no DB needed)
npm run verify -- --quick

# Full pipeline (matches CI exactly, needs Postgres + Redis running)
DATABASE_URL=postgresql://... REDIS_URL=redis://... npm run verify
```

---

## Running Individual Test Layers

### Unit tests

```bash
# All workspaces
npm test

# Single workspace
npm test --workspace=apps/arkiol-core
npm run test:unit --workspace=apps/animation-studio/backend
npm test --workspace=packages/shared

# With coverage
npm run test:coverage --workspace=apps/arkiol-core
```

Coverage reports are written to:
- `apps/arkiol-core/coverage/`
- `apps/animation-studio/backend/coverage/`
- `packages/shared/coverage/`

### Integration tests (needs `DATABASE_URL` + `REDIS_URL`)

```bash
# Apply migrations first
npm run db:deploy

# Run integration tests
npm run test:integration --workspace=apps/arkiol-core
npm run test:integration --workspace=apps/animation-studio/backend
```

### E2E tests

```bash
# Requires full services: DB, Redis, and both servers running
TEST_STUDIO_URL=http://localhost:4000 \
  npm run test:e2e --workspace=apps/animation-studio/backend
```

### HTTP smoke tests

```bash
# Start servers first, then:
npx tsx scripts/ci/http-smoke-tests.ts
```

---

## Test File Index

### packages/shared

| File | Tests | Coverage |
|------|-------|---------|
| `aiIntelligence.test.ts` | 121 | AI intelligence engine, brand learning gate |
| `planEnforcer.test.ts` | 85 | Plan enforcement, spend guard, kill switch |
| `archetype-helpers.test.ts` | 74 | Hash, scale, uid, block factories, text normalization |
| `ai-learning.test.ts` | 52 | A/B assignment, benchmark scoring, refinement signals |
| `benchmarking.test.ts` | 46 | Quality scoring, stage traces, benchmark summaries |
| `style-presets.test.ts` | 61 | Style presets, archetype map, selectArchetypeAndPreset |
| `monitoring.test.ts` | 45 | All alert checks, THRESHOLDS, dedup, composite runner |
| `contextual-memory.test.ts` | 31 | buildContextualMemory, FeedbackEventSchema |
| `metadata-schemas.test.ts` | 34 | StylePerformance, FormatPerformance, ABResult, BrandLearning |
| `plans.test.ts` | 23 | Plan configs, topup packs, credit costs |
| `soft-delete-errors.test.ts` | 20 | Filters, ProjectNotFoundError, ProjectAlreadyDeletedError |
| `webhook-ssrf-guard.test.ts` | 21 | SSRF validation: IP ranges, hostnames, ports, assertSafe |
| `credit-errors.test.ts` | 12 | InsufficientCreditsError shape and fields |

### apps/arkiol-core

| File | Tests | Coverage |
|------|-------|---------|
| `render-queue.test.ts` | 91 | Job lifecycle, credit deduction, retry, DLQ |
| `e2e-pipeline.test.ts` | 87 | Full generation pipeline: 8 stages, fallback, concurrency |
| `v9-engines.test.ts` | 76 | Generation engines, platform intelligence, output shape |
| `archetype-helpers.test.ts` | 74 | (shared via workspace) |
| `stage-validator.test.ts` | 51 | Stage contract validation, repair, constraint schema |
| `gif-renderer.test.ts` | 52 | GIF frame generation, motion, timing |
| `types-registry.test.ts` | 53 | FORMAT_DIMS, categories, credit costs, ApiError |
| `types-and-utils.test.ts` | 58 | Type guards, utilities, schema validation |
| `bug-fixes.test.ts` | 56 | Regression tests for production bug fixes |
| `style-enforcer.test.ts` | 43 | Style enforcement, color contrast, font compliance |
| `svg-decorations.test.ts` | 30 | All 20+ shape kinds, backgrounds, mesh overlay |
| `text-measure.test.ts` | 31 | Line measurement, wrapping, zone fitting, SVG positions |
| `platform-intelligence.test.ts` | 42 | Platform format detection, dimension validation |
| `pipeline-errors.test.ts` | 42 | KillSwitch, HardFailure, SpendGuard, Timeout errors |
| ... | ... | (35 total files) |

### apps/animation-studio/backend

| File | Tests | Coverage |
|------|-------|---------|
| `renders.test.ts` | 60 | Render job routes, scene regeneration, status updates |
| `authService.test.ts` | 60 | JWT validation, session management, RBAC |
| `brandAsset.test.ts` | 50 | Asset upload, processing stages, palette extraction |
| `adScriptEngine.test.ts` | 48 | Script generation, hook psychology, scene building |
| `renderPure.test.ts` | 48 | Pure render computation, dimension mapping, cost estimation |
| `renderPipeline.e2e.ts` | 50 | Full E2E render pipeline with real queue |
| `analyticsAndProviders.test.ts` | 30 | Analytics aggregation, provider management |
| `errorHandler.test.ts` | 30 | Express error middleware, status codes, sanitization |
| `brandAssetRenderIntegration.test.ts` | 29 | Scene injection, FFmpeg filter generation |
| `platformSpecs.test.ts` | 49 | Platform spec validation, dimension constraints |
| `storageAndBilling.test.ts` | 31 | Asset validation, plan limits, credit costs |
| `providerErrors.test.ts` | 13 | ProviderError class, isRetryableStatus |
| ... | ... | (19 total files) |

---

## CI Configuration

The CI pipeline (`.github/workflows/ci.yml`) runs 8 ordered steps on every push and PR:

1. **Install** — `npm ci` using `package-lock.json` (deterministic, fails on mismatch)
2. **Prisma generate** — from `packages/shared/prisma/schema.prisma` only
3. **Lint** — ESLint across all workspaces
4. **Type-check** — `tsc --noEmit` across all workspaces
5. **Unit tests** — Jest unit tests across all workspaces
6. **Integration tests** — Jest with live Postgres 16 + Redis 7
7. **Build** — production bundles for `@arkiol/shared`, `@arkiol/core`, `@arkiol/animation-studio-backend`
8. **Migration check** — `prisma migrate deploy` on ephemeral DB + schema table verification
9. **HTTP smoke tests** — both servers started, endpoints verified with curl

All deploy workflows require the full CI pipeline to pass first.

---

## Adding New Tests

1. **Unit tests** — place in `__tests__/` next to the module being tested, or in `tests/unit/`
2. **Integration tests** — place in `tests/integration/`, use `TEST_DB_URL` for isolated DB
3. **Mock strategy** — mock at the module boundary (Prisma, fetch, fs); never mock the code under test
4. **Pure functions first** — extract pure logic for easy unit testing before wiring to I/O

See existing test files for patterns — the codebase uses Jest with TypeScript throughout.
