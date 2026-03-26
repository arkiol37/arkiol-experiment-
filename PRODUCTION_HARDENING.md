# Production Hardening — What Changed

This document describes the hardening pass applied on top of the base Arkiol platform (v9 + bulk generation + roadmap features).

## New Modules — `packages/shared/src/`

### `parallelOrchestrator.ts`
Group-based concurrent pipeline execution. Stages in the same group run via `Promise.allSettled` — a single failure activates fallback without cancelling sibling stages. Delivers ~2.1× speedup for the analysis layer.

**Groups:**
1. `IntentNormalization` (sequential)
2. `LayoutIntelligence + ContentDensityOptimizer + AudienceStyleEngine` (parallel)
3. `AutoVariation + BrandDNAExtractor` (parallel)
4. `ArchetypeIntelligenceEngine` (sequential)

### `atomicCreditProtection.ts`
Two-phase credit commit: `holdCredits` at job creation → `finalizeCredits` on success OR `refundCredits` on failure/DLQ. Every operation guarded by unique idempotency key. `creditFinalized` and `creditRefunded` boolean flags on the Job row prevent any combination of double-charge or double-refund.

### `idempotencyGuard.ts`
Stage-level, asset-level, and credit-level deduplication. `checkAssetIdempotency` prevents duplicate `prisma.asset.create()` calls on worker retry. `deduplicatePendingTasks` separates already-completed from pending work during batch recovery.

### `observability.ts`
- `createStructuredLogger` — JSON envelopes with correlationId, traceId, spanId
- `createPipelineTracer` — distributed trace spans across stages
- `emitMetric` — counter/gauge/histogram ring buffer (10k max)
- `runHealthChecks` — composite DB/Redis/worker/DLQ health
- `evaluateAlerts` — DLQ depth, stuck jobs, error rate alerts
- `generateDiagnosticDump` — admin on-demand snapshot

## Updated Routes — `apps/arkiol-core/src/app/api/`

### `assets/resize/route.ts`
Three-strategy SVG-native pipeline: `svg_viewbox` → `svg_transform` → `raster` (Sharp fallback). Both PNG and SVG uploaded to S3 for vector preservation. Ownership check extended to `orgId`.

### `monitoring/route.ts`
All metrics from authoritative DB tables only (`AIAssetBenchmark`, `DeadLetterJob`, `WorkerHealthSnapshot`). No estimated values. Returns `dataSource: 'real_runtime_metrics'`. Requires admin role or `MONITORING_SECRET_TOKEN` bearer.

### `automation/generate/route.ts`
`brandId` ownership verification against caller's `orgId`. Per-org rate limit (100 batch-jobs/min). `holdCredits` called immediately after job creation. `apiKeyId` recorded for audit.

### `webhooks/route.ts`
`rotateSecret` endpoint. Delivery tracking (`lastDeliveredAt`, `consecutiveFailures`, etc.). Rate limit on test deliveries (5/min). SSRF guard on both create AND update.

## Updated Worker — `apps/arkiol-core/src/workers/generation.worker.ts`

- Imports `finalizeCredits`, `refundCredits`, `checkAssetIdempotency`, `createStructuredLogger`, `createPipelineTracer`, `computeParallelismMetrics` from `@arkiol/shared`
- 30-second heartbeat writing to `WorkerHealthSnapshot` table
- Credit deduction replaced with `finalizeCredits()` (atomic two-phase commit)
- Asset creation guarded by `checkAssetIdempotency()` (no duplicate assets on retry)
- COMPLETED transition routed through `crashSafety.transitionJob()` (FSM enforcement)

## New Test Suites

- `apps/arkiol-core/src/__tests__/production-hardening.test.ts` — 9 suites, 24 cases
- `apps/arkiol-core/src/__tests__/load-and-concurrency.test.ts` — 6 suites, 12 cases

## New Migration

`packages/shared/prisma/migrations/20260313_production_hardening/migration.sql`
- `Job.creditsHeld`, `Job.creditFinalized`
- `Org.creditsHeld`
- `BatchJob.webhookUrl`, `BatchJob.webhookFailures`, `BatchJob.apiKeyId`, etc.
- `CreditTransaction.idempotencyKey` unique index

## Deployment Order

1. Deploy `packages/shared` (new modules required by worker + API)
2. Run: `prisma migrate deploy`
3. Run new test suites
4. Deploy `apps/arkiol-core` (updated API routes)
5. Deploy generation worker
6. Verify `GET /api/monitoring` returns `dataSource: 'real_runtime_metrics'`
