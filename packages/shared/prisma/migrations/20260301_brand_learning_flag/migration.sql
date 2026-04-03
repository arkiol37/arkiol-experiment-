-- packages/shared/prisma/migrations/20260301_brand_learning_flag/migration.sql
-- V17: Brand Learning feature flag + AI observability cost columns
-- Idempotent — all statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

-- ── 1. Org: brand learning explicit opt-in ───────────────────────────────────
-- Default FALSE — never auto-enabled. Passive, no cross-tenant data.
ALTER TABLE "Org" ADD COLUMN IF NOT EXISTS "brandLearningEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. AIJobMetadata: cost impact and fallback trigger tracking ───────────────
ALTER TABLE "AIJobMetadata" ADD COLUMN IF NOT EXISTS "estimatedProviderCostUsd" DOUBLE PRECISION;
ALTER TABLE "AIJobMetadata" ADD COLUMN IF NOT EXISTS "actualProviderCostUsd"    DOUBLE PRECISION;
ALTER TABLE "AIJobMetadata" ADD COLUMN IF NOT EXISTS "fallbackTriggers"         JSONB NOT NULL DEFAULT '[]';

-- ── 3. AIStageTrace: per-stage cost columns ───────────────────────────────────
ALTER TABLE "AIStageTrace" ADD COLUMN IF NOT EXISTS "estimatedCostUsd" DOUBLE PRECISION;
ALTER TABLE "AIStageTrace" ADD COLUMN IF NOT EXISTS "actualCostUsd"    DOUBLE PRECISION;

-- ── 4. Time-range indexes for observability queries ───────────────────────────
CREATE INDEX IF NOT EXISTS "AIJobMetadata_orgId_createdAt_v17"    ON "AIJobMetadata" ("orgId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AIStageTrace_orgId_createdAt_v17"     ON "AIStageTrace"  ("orgId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AIFeedbackEvent_orgId_occurredAt_v17" ON "AIFeedbackEvent" ("orgId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "AIABResult_orgId_lastUpdated_v17"     ON "AIABResult" ("orgId", "lastUpdated" DESC);

-- ── 5. AIGeneratedAsset: provider cost ────────────────────────────────────────
ALTER TABLE "AIGeneratedAsset" ADD COLUMN IF NOT EXISTS "providerCostUsd" DOUBLE PRECISION;
