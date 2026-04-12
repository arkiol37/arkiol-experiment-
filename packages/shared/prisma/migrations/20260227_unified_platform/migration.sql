-- packages/shared/prisma/migrations/20260227_unified_platform/migration.sql
-- UNIFIED ARKIOL PLATFORM MIGRATION
-- Adds: Credit ledger, plan feature flags, Studio tables, job lifecycle columns.
-- Safe to run on existing V12 Arkiol DB — all changes are additive.

-- ── Plan enum: add new tiers ─────────────────────────────────────────────────
-- PostgreSQL: add new values to existing enum (safe, no rewrite)
DO $$ BEGIN
  ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'FREE';
  ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'CREATOR';
  ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'STUDIO';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── JobStatus enum: add explicit states ──────────────────────────────────────
DO $$ BEGIN
  ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
  ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'SUCCEEDED';
  ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'CANCELED';
  ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── JobType enum: add video and studio types ──────────────────────────────────
DO $$ BEGIN
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'RENDER_VIDEO_STD';
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'RENDER_VIDEO_HQ';
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'RENDER_VIDEO_LONG';
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'STUDIO_RENDER_2D';
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'STUDIO_RENDER_3D';
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'STUDIO_EXPORT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── CreditTxType enum (new) ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "CreditTxType" AS ENUM (
    'grant_cycle','daily_grant','consume','refund',
    'topup','rollover_grant','rollover_expire','adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── CreditReason enum (new) ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "CreditReason" AS ENUM (
    'static','gif','video_std','video_hq','video_long','export_zip','admin_adjust'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ProductMode enum (new) ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ProductMode" AS ENUM ('CREATOR','STUDIO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── CreditTransaction table (new) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CreditTransaction" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"          TEXT        NOT NULL,
  "type"           "CreditTxType" NOT NULL,
  "amount"         INTEGER     NOT NULL,
  "unit"           TEXT        NOT NULL DEFAULT 'credits',
  "reason"         "CreditReason" NOT NULL,
  "refId"          TEXT,
  "idempotencyKey" TEXT        NOT NULL,
  "expiresAt"      TIMESTAMPTZ,
  "metadata"       JSONB       NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditTransaction_idempotencyKey_key" UNIQUE ("idempotencyKey")
);
CREATE INDEX IF NOT EXISTS "CreditTransaction_orgId_createdAt_idx" ON "CreditTransaction"("orgId","createdAt");
CREATE INDEX IF NOT EXISTS "CreditTransaction_orgId_type_idx"      ON "CreditTransaction"("orgId","type");
CREATE INDEX IF NOT EXISTS "CreditTransaction_refId_idx"            ON "CreditTransaction"("refId");

-- ── CreditPack table (new) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CreditPack" (
  "id"            TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "name"          TEXT    NOT NULL,
  "credits"       INTEGER NOT NULL,
  "priceUsd"      INTEGER NOT NULL,
  "stripePriceId" TEXT,
  "expiryDays"    INTEGER,
  "active"        BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "CreditPack_pkey" PRIMARY KEY ("id")
);

-- ── StudioProject table (new) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StudioProject" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"       TEXT        NOT NULL,
  "brandId"     TEXT,
  "name"        TEXT        NOT NULL,
  "description" TEXT,
  "status"      TEXT        NOT NULL DEFAULT 'draft',
  "settings"    JSONB       NOT NULL DEFAULT '{}',
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "StudioProject_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StudioProject_orgId_idx" ON "StudioProject"("orgId");

-- ── ContentPack table (new) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ContentPack" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"      TEXT        NOT NULL,
  "name"       TEXT        NOT NULL,
  "theme"      TEXT        NOT NULL,
  "daysCount"  INTEGER     NOT NULL DEFAULT 30,
  "items"      JSONB       NOT NULL DEFAULT '[]',
  "status"     TEXT        NOT NULL DEFAULT 'generating',
  "zipS3Key"   TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ContentPack_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ContentPack_orgId_idx" ON "ContentPack"("orgId");

-- ── Org: add new columns (additive) ──────────────────────────────────────────
ALTER TABLE "Org"
  ADD COLUMN IF NOT EXISTS "currentCycleStart"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "currentCycleEnd"         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "canUseStudioVideo"       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "canUseGifMotion"         BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "canBatchGenerate"        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "canUseZipExport"         BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "canUseAutomation"        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "maxConcurrency"          INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "queuePriority"           INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxDailyVideoJobs"       INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxFormatsPerRun"        INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "maxVariationsPerRun"     INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "maxExportResolution"     TEXT        NOT NULL DEFAULT '1080p',
  ADD COLUMN IF NOT EXISTS "freeWatermarkEnabled"    BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "freeDailyCreditsPerDay"  INTEGER     NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "freeMonthlyCapCredits"   INTEGER     NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "creditBalance"           INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dailyCreditBalance"      INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dailyCreditLastReset"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "autoRefillEnabled"       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "refillThreshold"         INTEGER,
  ADD COLUMN IF NOT EXISTS "refillPackId"            TEXT,
  ADD COLUMN IF NOT EXISTS "dailySpendCapUsd"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "dailySpendUsd"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dailySpendDate"          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "costProtectionBlocked"   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "gracePeriodEndsAt"       TIMESTAMPTZ;

-- Migrate existing creditsUsed/creditLimit to new creditBalance
UPDATE "Org" SET "creditBalance" = GREATEST(0, "creditLimit" - COALESCE("creditsUsed", 0))
WHERE "creditBalance" = 0 AND "creditLimit" > 0;

-- ── Job: add new columns ──────────────────────────────────────────────────────
ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "orgId"                      TEXT,
  ADD COLUMN IF NOT EXISTS "studioProjectId"            TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey"             TEXT,
  ADD COLUMN IF NOT EXISTS "creditCost"                 INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditDeducted"             BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "creditRefunded"             BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "estimatedProviderCostUsd"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "actualProviderCostUsd"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "failedAt"                   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "canceledAt"                 TIMESTAMPTZ;

-- Backfill orgId from user.orgId where missing
UPDATE "Job" j SET "orgId" = u."orgId"
FROM "User" u WHERE j."userId" = u.id AND j."orgId" IS NULL AND u."orgId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Job_idempotencyKey_key" ON "Job"("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Job_orgId_idx"     ON "Job"("orgId");
CREATE INDEX IF NOT EXISTS "Job_createdAt_idx" ON "Job"("createdAt");

-- ── User: add productMode column ──────────────────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "productMode"    "ProductMode" NOT NULL DEFAULT 'CREATOR',
  ADD COLUMN IF NOT EXISTS "onboardingDone" BOOLEAN       NOT NULL DEFAULT FALSE;

-- ── Asset: add orgId and s3Path ───────────────────────────────────────────────
ALTER TABLE "Asset"
  ADD COLUMN IF NOT EXISTS "orgId"     TEXT,
  ADD COLUMN IF NOT EXISTS "s3Path"    TEXT,
  ADD COLUMN IF NOT EXISTS "retainUntil" TIMESTAMPTZ;

UPDATE "Asset" a SET "orgId" = u."orgId"
FROM "User" u WHERE a."userId" = u.id AND a."orgId" IS NULL AND u."orgId" IS NOT NULL;

-- ── BillingEvent: add error column ────────────────────────────────────────────
ALTER TABLE "BillingEvent" ADD COLUMN IF NOT EXISTS "error" TEXT;

-- ── Seed credit packs ─────────────────────────────────────────────────────────
INSERT INTO "CreditPack" ("id","name","credits","priceUsd","expiryDays","active")
VALUES
  ('pack_100',  '100 Credits',  100,  9,   NULL, TRUE),
  ('pack_500',  '500 Credits',  500,  39,  NULL, TRUE),
  ('pack_2000', '2000 Credits', 2000, 129, NULL, TRUE)
ON CONFLICT DO NOTHING;
