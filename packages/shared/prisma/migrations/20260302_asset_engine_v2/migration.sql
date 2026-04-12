-- Migration: 20260302_asset_engine_v2 (shared)
-- Adds V2 asset engine fields and monitoring support.

-- AIGeneratedAsset V2 fields
ALTER TABLE "AIGeneratedAsset"
  ADD COLUMN IF NOT EXISTS "signedUrl"          TEXT,
  ADD COLUMN IF NOT EXISTS "signedUrlExpiresAt"  TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "reuseCount"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditCost"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "providerCostUsd"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "durationMs"          INTEGER NOT NULL DEFAULT 0;

-- Backfill: normalize legacy quality values
UPDATE "AIGeneratedAsset" SET "quality" = 'standard' WHERE "quality" IN ('fast', '');

-- New indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AIGeneratedAsset_org_hash_quality_idx"
  ON "AIGeneratedAsset"("orgId", "similarityHash", "quality");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AIGeneratedAsset_org_reuse_idx"
  ON "AIGeneratedAsset"("orgId", "reuseCount" DESC);

-- AlertLog table
CREATE TABLE IF NOT EXISTS "AlertLog" (
  "id"          TEXT                     NOT NULL,
  "alertType"   TEXT                     NOT NULL,
  "severity"    TEXT                     NOT NULL,
  "title"       TEXT                     NOT NULL,
  "message"     TEXT                     NOT NULL,
  "orgId"       TEXT,
  "jobId"       TEXT,
  "value"       DOUBLE PRECISION,
  "threshold"   DOUBLE PRECISION,
  "metadata"    JSONB                    NOT NULL DEFAULT '{}',
  "resolvedAt"  TIMESTAMP WITH TIME ZONE,
  "firedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AlertLog_severity_firedAt_idx" ON "AlertLog"("severity", "firedAt" DESC);
CREATE INDEX IF NOT EXISTS "AlertLog_orgId_firedAt_idx"    ON "AlertLog"("orgId", "firedAt" DESC);
CREATE INDEX IF NOT EXISTS "AlertLog_alertType_firedAt_idx" ON "AlertLog"("alertType", "firedAt" DESC);

-- Org V2 fields (if not already added by arkiol-core migration)
ALTER TABLE "Org"
  ADD COLUMN IF NOT EXISTS "onDemandAssetsGeneratedMonth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastOnDemandResetAt"          TIMESTAMP WITH TIME ZONE;
