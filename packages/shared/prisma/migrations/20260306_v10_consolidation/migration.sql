-- packages/shared/prisma/migrations/20260306_v10_consolidation/migration.sql
-- ══════════════════════════════════════════════════════════════════════════════
-- ARKIOL AI v10 — SCHEMA CONSOLIDATION MIGRATION
-- ══════════════════════════════════════════════════════════════════════════════
--
-- This migration is the final consolidation step that unifies the Arkiol Core
-- schema (apps/arkiol-core/prisma/schema.prisma — now archived) and the
-- Shared schema (packages/shared/prisma/schema.prisma — now the sole source).
--
-- It adds every model, field, and index that existed in the Core schema but
-- was absent from the Shared schema. All statements use IF NOT EXISTS / IF NOT
-- EXISTS guards so this migration is safe to apply on:
--   (a) A database that previously ran only Shared migrations
--   (b) A database that previously ran only Core migrations
--   (c) A fresh empty database
--
-- After this migration, all subsequent schema changes must be made exclusively
-- in packages/shared/prisma/schema.prisma.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Org — legacy credit columns + on-demand counters ───────────────────
ALTER TABLE "Org"
  ADD COLUMN IF NOT EXISTS "creditLimit"  INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS "creditsUsed"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "budgetCapCredits" INTEGER,
  ADD COLUMN IF NOT EXISTS "onDemandAssetsGeneratedMonth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastOnDemandResetAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "maxVariationsPerRun" INTEGER NOT NULL DEFAULT 1;

-- ── 2. Asset — orgId denormalisation + s3Path + retention ─────────────────
ALTER TABLE "Asset"
  ADD COLUMN IF NOT EXISTS "s3Path"      TEXT,
  ADD COLUMN IF NOT EXISTS "retainUntil" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Asset_orgId_idx" ON "Asset"("orgId");

-- ── 3. Job — credit tracking + cost-protection + org relation ─────────────
ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "orgId"                     TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey"             TEXT,
  ADD COLUMN IF NOT EXISTS "creditCost"                 INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditDeducted"             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "creditRefunded"             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "estimatedProviderCostUsd"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "actualProviderCostUsd"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "failedAt"                   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "canceledAt"                 TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "studioProjectId"            TEXT;

-- Unique constraint on idempotencyKey (ignore if already exists)
DO $$ BEGIN
  ALTER TABLE "Job" ADD CONSTRAINT "Job_idempotencyKey_key" UNIQUE ("idempotencyKey");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Job_orgId_idx"     ON "Job"("orgId");
CREATE INDEX IF NOT EXISTS "Job_createdAt_idx" ON "Job"("createdAt" DESC);

-- ── 4. ApiKey — dailyLimit quota ──────────────────────────────────────────
ALTER TABLE "ApiKey"
  ADD COLUMN IF NOT EXISTS "dailyLimit" INTEGER;

-- ── 5. BillingEvent — error column ───────────────────────────────────────
ALTER TABLE "BillingEvent"
  ADD COLUMN IF NOT EXISTS "error" TEXT;

CREATE INDEX IF NOT EXISTS "BillingEvent_processed_createdAt_idx"
  ON "BillingEvent"("processed", "createdAt");

-- ── 6. AIGeneratedAsset — v2 cost/reuse tracking fields ──────────────────
ALTER TABLE "AIGeneratedAsset"
  ADD COLUMN IF NOT EXISTS "jobId"               TEXT,
  ADD COLUMN IF NOT EXISTS "signedUrl"            TEXT,
  ADD COLUMN IF NOT EXISTS "signedUrlExpiresAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reuseCount"           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditCost"           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "providerCostUsd"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "durationMs"           INTEGER NOT NULL DEFAULT 0;

-- Add foreign key from AIGeneratedAsset to Org if not present
DO $$ BEGIN
  ALTER TABLE "AIGeneratedAsset"
    ADD CONSTRAINT "AIGeneratedAsset_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_orgId_reuseCount_idx"
  ON "AIGeneratedAsset"("orgId", "reuseCount" DESC);

-- ── 7. AIBenchmarkRecord — cost gate columns ──────────────────────────────
ALTER TABLE "AIBenchmarkRecord"
  ADD COLUMN IF NOT EXISTS "costGateBlocked" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "costEstimateUsd" DOUBLE PRECISION;

-- ── 8. StudioProject — if it doesn't exist yet ────────────────────────────
CREATE TABLE IF NOT EXISTS "StudioProject" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "orgId"       TEXT NOT NULL,
  "brandId"     TEXT,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "status"      TEXT NOT NULL DEFAULT 'draft',
  "settings"    JSONB NOT NULL DEFAULT '{}',
  "deletedAt"   TIMESTAMP(3),
  "deletedBy"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY ("orgId")    REFERENCES "Org"("id"),
  FOREIGN KEY ("brandId")  REFERENCES "Brand"("id")
);
CREATE INDEX IF NOT EXISTS "StudioProject_orgId_idx"
  ON "StudioProject"("orgId");
CREATE INDEX IF NOT EXISTS "StudioProject_orgId_deletedAt_idx"
  ON "StudioProject"("orgId", "deletedAt");

-- ── 9. CreditTransaction — if not yet created ────────────────────────────
CREATE TABLE IF NOT EXISTS "CreditTransaction" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "orgId"          TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "amount"         INTEGER NOT NULL,
  "unit"           TEXT NOT NULL DEFAULT 'credits',
  "reason"         TEXT NOT NULL,
  "refId"          TEXT,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "expiresAt"      TIMESTAMP(3),
  "metadata"       JSONB NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY ("orgId") REFERENCES "Org"("id")
);
CREATE INDEX IF NOT EXISTS "CreditTransaction_orgId_createdAt_idx"
  ON "CreditTransaction"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "CreditTransaction_orgId_type_idx"
  ON "CreditTransaction"("orgId", "type");
CREATE INDEX IF NOT EXISTS "CreditTransaction_refId_idx"
  ON "CreditTransaction"("refId");

-- ── 10. CreditPack ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CreditPack" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "credits"       INTEGER NOT NULL,
  "priceUsd"      INTEGER NOT NULL,
  "stripePriceId" TEXT,
  "expiryDays"    INTEGER,
  "active"        BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── 11. ContentPack ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ContentPack" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "orgId"     TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "theme"     TEXT NOT NULL,
  "daysCount" INTEGER NOT NULL DEFAULT 30,
  "items"     JSONB NOT NULL DEFAULT '[]',
  "status"    TEXT NOT NULL DEFAULT 'generating',
  "zipS3Key"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY ("orgId") REFERENCES "Org"("id")
);
CREATE INDEX IF NOT EXISTS "ContentPack_orgId_idx" ON "ContentPack"("orgId");

-- ── 12. AIJobMetadata ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AIJobMetadata" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "jobId"               TEXT NOT NULL UNIQUE,
  "orgId"               TEXT NOT NULL,
  "stageTimings"        JSONB NOT NULL DEFAULT '{}',
  "stageDecisions"      JSONB NOT NULL DEFAULT '{}',
  "fallbackReasons"     JSONB NOT NULL DEFAULT '[]',
  "abAssignments"       JSONB NOT NULL DEFAULT '{}',
  "stageOutputs"        JSONB NOT NULL DEFAULT '{}',
  "costGateResults"     JSONB NOT NULL DEFAULT '[]',
  "observabilityEvents" JSONB NOT NULL DEFAULT '[]',
  "overallScore"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalAssets"         INTEGER NOT NULL DEFAULT 0,
  "totalFallbacks"      INTEGER NOT NULL DEFAULT 0,
  "totalViolations"     INTEGER NOT NULL DEFAULT 0,
  "totalPipelineMs"     INTEGER NOT NULL DEFAULT 0,
  "killSwitchActive"    BOOLEAN NOT NULL DEFAULT FALSE,
  "globalSpendBlocked"  BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AIJobMetadata_orgId_createdAt_idx"
  ON "AIJobMetadata"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "AIJobMetadata_overallScore_idx"
  ON "AIJobMetadata"("overallScore");

-- ── 13. AIStageTrace ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AIStageTrace" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "jobId"          TEXT NOT NULL,
  "assetId"        TEXT NOT NULL,
  "orgId"          TEXT NOT NULL,
  "stageId"        TEXT NOT NULL,
  "stageIdx"       INTEGER NOT NULL DEFAULT 0,
  "durationMs"     INTEGER NOT NULL DEFAULT 0,
  "ok"             BOOLEAN NOT NULL DEFAULT TRUE,
  "fallback"       BOOLEAN NOT NULL DEFAULT FALSE,
  "fallbackReason" TEXT,
  "decision"       TEXT,
  "inputHash"      TEXT,
  "outputSummary"  JSONB NOT NULL DEFAULT '{}',
  "errorMessage"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AIStageTrace_jobId_idx"     ON "AIStageTrace"("jobId");
CREATE INDEX IF NOT EXISTS "AIStageTrace_assetId_idx"   ON "AIStageTrace"("assetId");
CREATE INDEX IF NOT EXISTS "AIStageTrace_orgId_stageId_idx"
  ON "AIStageTrace"("orgId", "stageId");
CREATE INDEX IF NOT EXISTS "AIStageTrace_fallback_idx"  ON "AIStageTrace"("fallback");

-- ── 14. ExplorationRun ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exploration_runs" (
  "id"                     TEXT NOT NULL PRIMARY KEY,
  "orgId"                  TEXT NOT NULL,
  "jobId"                  TEXT,
  "seed"                   TEXT NOT NULL,
  "format"                 TEXT NOT NULL,
  "poolSize"               INTEGER NOT NULL,
  "targetResultCount"      INTEGER NOT NULL,
  "highConfidenceCount"    INTEGER NOT NULL DEFAULT 0,
  "experimentalCount"      INTEGER NOT NULL DEFAULT 0,
  "totalExploreMs"         INTEGER NOT NULL DEFAULT 0,
  "avgCompositeScore"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgNoveltyScore"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "explorationTemperature" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  "stats"                  JSONB,
  "pipelineContext"        JSONB,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "exploration_runs_orgId_idx"
  ON "exploration_runs"("orgId");
CREATE INDEX IF NOT EXISTS "exploration_runs_jobId_idx"
  ON "exploration_runs"("jobId") WHERE "jobId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "exploration_runs_createdAt_idx"
  ON "exploration_runs"("createdAt" DESC);

-- ── 15. ExplorationCandidate ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exploration_candidates" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "runId"            TEXT NOT NULL,
  "orgId"            TEXT NOT NULL,
  "generationIndex"  INTEGER NOT NULL,
  "format"           TEXT NOT NULL,
  "genome"           JSONB NOT NULL,
  "scores"           JSONB,
  "noveltyScore"     DOUBLE PRECISION,
  "explorationScore" DOUBLE PRECISION,
  "confidenceTier"   TEXT,
  "rank"             INTEGER,
  "constraintPassed" BOOLEAN NOT NULL DEFAULT FALSE,
  "repairLog"        JSONB,
  "featureVector"    JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY ("runId") REFERENCES "exploration_runs"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "exploration_candidates_runId_idx"
  ON "exploration_candidates"("runId");
CREATE INDEX IF NOT EXISTS "exploration_candidates_orgId_idx"
  ON "exploration_candidates"("orgId");
CREATE INDEX IF NOT EXISTS "exploration_candidates_tier_idx"
  ON "exploration_candidates"("confidenceTier");

-- ── 16. ExplorationFeedback ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exploration_feedback" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "orgId"       TEXT NOT NULL,
  "brandId"     TEXT,
  "campaignId"  TEXT,
  "candidateId" TEXT NOT NULL,
  "runId"       TEXT,
  "genome"      JSONB NOT NULL,
  "scores"      JSONB NOT NULL,
  "signalType"  TEXT NOT NULL,
  "weight"      DOUBLE PRECISION NOT NULL,
  "format"      TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "exploration_feedback_orgId_idx"
  ON "exploration_feedback"("orgId");
CREATE INDEX IF NOT EXISTS "exploration_feedback_userId_idx"
  ON "exploration_feedback"("userId");
CREATE INDEX IF NOT EXISTS "exploration_feedback_brandId_idx"
  ON "exploration_feedback"("brandId") WHERE "brandId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "exploration_feedback_createdAt_idx"
  ON "exploration_feedback"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "exploration_feedback_signalType_idx"
  ON "exploration_feedback"("signalType");

-- ── 17. ExplorationPrior ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exploration_priors" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "orgId"        TEXT NOT NULL,
  "brandId"      TEXT,
  "priors"       JSONB NOT NULL,
  "totalSignals" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE ("orgId", "brandId")
);
CREATE INDEX IF NOT EXISTS "exploration_priors_orgId_idx"
  ON "exploration_priors"("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "exploration_priors_org_null_brand_idx"
  ON "exploration_priors"("orgId") WHERE "brandId" IS NULL;

-- ── 18. ExplorationNoveltyArchive ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exploration_novelty_archive" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "orgId"       TEXT NOT NULL,
  "brandId"     TEXT,
  "vectors"     JSONB NOT NULL DEFAULT '[]',
  "vectorCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE ("orgId", "brandId")
);
CREATE INDEX IF NOT EXISTS "exploration_novelty_archive_orgId_idx"
  ON "exploration_novelty_archive"("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "exploration_novelty_archive_org_null_brand_idx"
  ON "exploration_novelty_archive"("orgId") WHERE "brandId" IS NULL;

-- Novelty archive pruning trigger (keeps max 500 vectors per org/brand)
CREATE OR REPLACE FUNCTION prune_novelty_archive()
RETURNS TRIGGER AS $$
DECLARE
  max_size INTEGER := 500;
  current_size INTEGER;
BEGIN
  current_size := jsonb_array_length(NEW.vectors);
  IF current_size > max_size THEN
    NEW.vectors := (
      SELECT jsonb_agg(v)
      FROM (
        SELECT v
        FROM jsonb_array_elements(NEW.vectors) AS v
        OFFSET current_size - max_size
      ) sub
    );
    NEW."vectorCount" := max_size;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prune_novelty_archive
  ON "exploration_novelty_archive";

CREATE TRIGGER trigger_prune_novelty_archive
BEFORE INSERT OR UPDATE ON "exploration_novelty_archive"
FOR EACH ROW EXECUTE FUNCTION prune_novelty_archive();

-- ── 19. User — onboarding fields ─────────────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "productMode"    TEXT NOT NULL DEFAULT 'CREATOR',
  ADD COLUMN IF NOT EXISTS "onboardingDone" BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 20. Brand — studioProjects back-relation (no schema change needed) ────
-- The relation is handled by the StudioProject.brandId FK above.

-- ── Done ─────────────────────────────────────────────────────────────────
-- All tables from the former arkiol-core schema are now present in the
-- unified shared schema. This is the final consolidation migration.
-- Future schema changes: edit packages/shared/prisma/schema.prisma only.
