-- packages/shared/prisma/migrations/20260308_brand_asset_library/migration.sql
-- ══════════════════════════════════════════════════════════════════════════════
-- Brand Asset Library Migration
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Adds the BrandUploadedAsset model to the shared Prisma schema so that
-- arkiol-core (Next.js) can also create, read, and reference brand assets
-- via the unified Prisma client.
--
-- The animation-studio (Express + Knex) uses its own brand_assets table
-- (created by migration 007_brand_asset_library.ts). Both tables track the
-- same data — brand assets uploaded by users for use in 2D ad generation.
--
-- This migration adds:
--   1. BrandUploadedAsset model table
--   2. BrandAssetProcessingStage enum
--   3. Updated JobType enum with PROCESS_BRAND_ASSET
--   4. Updated CreditReason enum with brand_asset_process
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. BrandAssetType enum ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "BrandAssetType" AS ENUM (
    'logo',
    'product',
    'screenshot',
    'packaging',
    'pattern',
    'icon',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ── 2. BrandAssetUsageRole enum ───────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "BrandAssetUsageRole" AS ENUM (
    'logo_slot',
    'product_slot',
    'screenshot_slot',
    'brand_reveal_slot',
    'background_slot',
    'accent_slot'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ── 3. BrandAssetProcessingStatus enum ───────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "BrandAssetProcessingStatus" AS ENUM (
    'pending',
    'processing',
    'ready',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ── 4. BrandUploadedAsset table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BrandUploadedAsset" (
    "id"                         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "orgId"                      TEXT NOT NULL,
    "brandId"                    TEXT,
    "userId"                     TEXT NOT NULL,

    -- Upload metadata
    "name"                       TEXT NOT NULL,
    "originalName"               TEXT NOT NULL,
    "mimeType"                   TEXT NOT NULL,
    "sizeBytes"                  INTEGER NOT NULL,
    "width"                      INTEGER,
    "height"                     INTEGER,
    "s3Key"                      TEXT NOT NULL,
    "s3Bucket"                   TEXT NOT NULL,
    "cdnUrl"                     TEXT,
    "thumbnailUrl"               TEXT,

    -- AI Classification
    "assetType"                  "BrandAssetType" NOT NULL DEFAULT 'other',
    "usageRole"                  "BrandAssetUsageRole",
    "userRoleOverride"           "BrandAssetUsageRole",
    "classificationConfidence"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aiAnalysis"                 JSONB NOT NULL DEFAULT '{}',

    -- Processing Pipeline
    "processingStatus"           "BrandAssetProcessingStatus" NOT NULL DEFAULT 'pending',
    "processingStartedAt"        TIMESTAMP(3),
    "processingCompletedAt"      TIMESTAMP(3),
    "processingAttempts"         INTEGER NOT NULL DEFAULT 0,
    "processingError"            TEXT,
    "pipelineStages"             JSONB NOT NULL DEFAULT '{}',

    -- Processed Variants
    "cutoutS3Key"                TEXT,
    "cutoutCdnUrl"               TEXT,
    "vectorS3Key"                TEXT,
    "vectorCdnUrl"               TEXT,
    "enhancedS3Key"              TEXT,
    "enhancedCdnUrl"             TEXT,

    -- Brand Colors
    "extractedPalette"           JSONB NOT NULL DEFAULT '[]',
    "primaryColor"               TEXT,
    "hasAlpha"                   BOOLEAN NOT NULL DEFAULT false,
    "subjectBbox"                JSONB,

    -- Motion Intelligence
    "recommendedMotion"          TEXT,
    "recommendedTransition"      TEXT,
    "scenePlacementHints"        JSONB NOT NULL DEFAULT '{}',

    -- Soft delete
    "deletedAt"                  TIMESTAMP(3),
    "deletedBy"                  TEXT,

    "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandUploadedAsset_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "BrandUploadedAsset"
    ADD CONSTRAINT "BrandUploadedAsset_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BrandUploadedAsset"
    ADD CONSTRAINT "BrandUploadedAsset_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BrandUploadedAsset"
    ADD CONSTRAINT "BrandUploadedAsset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "BrandUploadedAsset_orgId_idx"
    ON "BrandUploadedAsset"("orgId");

CREATE INDEX IF NOT EXISTS "BrandUploadedAsset_brandId_idx"
    ON "BrandUploadedAsset"("brandId");

CREATE INDEX IF NOT EXISTS "BrandUploadedAsset_assetType_idx"
    ON "BrandUploadedAsset"("assetType");

CREATE INDEX IF NOT EXISTS "BrandUploadedAsset_processingStatus_idx"
    ON "BrandUploadedAsset"("processingStatus");

CREATE INDEX IF NOT EXISTS "BrandUploadedAsset_orgId_processingStatus_idx"
    ON "BrandUploadedAsset"("orgId", "processingStatus");

CREATE INDEX IF NOT EXISTS "BrandUploadedAsset_createdAt_idx"
    ON "BrandUploadedAsset"("createdAt" DESC);

-- ── 5. Add PROCESS_BRAND_ASSET to JobType enum ────────────────────────────────
DO $$ BEGIN
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'PROCESS_BRAND_ASSET';
EXCEPTION
  WHEN invalid_parameter_value THEN null;
END $$;

-- ── 6. Add brand_asset_process to CreditReason enum ──────────────────────────
DO $$ BEGIN
  ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'brand_asset_process';
EXCEPTION
  WHEN invalid_parameter_value THEN null;
END $$;

-- ── 7. Link BrandUploadedAsset to existing StudioProject ─────────────────────
-- Add brandAssetIds column to StudioProject for tracking which assets are used
DO $$ BEGIN
  ALTER TABLE "StudioProject"
    ADD COLUMN IF NOT EXISTS "brandAssetIds" TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "brandPalette"  JSONB DEFAULT '[]';
EXCEPTION
  WHEN others THEN null;
END $$;
