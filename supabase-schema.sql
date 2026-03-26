-- ============================================================================
-- ARKIOL AI — COMPLETE DATABASE SCHEMA FOR SUPABASE
-- ============================================================================
-- HOW TO USE
-- ──────────────────────────────────────────────────────────────────────────
-- FRESH DATABASE  : Paste this entire file in Supabase SQL Editor → Run
-- EXISTING DATABASE: Same — every statement uses IF NOT EXISTS / ADD COLUMN
--                   IF NOT EXISTS so it is fully idempotent and safe
--
-- After running this file once you NEVER need manual column patching again.
-- All signup, login, Google OAuth, sessions, and founder recognition will work.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: ENUMS (idempotent — DO blocks catch duplicate_object)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE "Role" AS ENUM (
  'SUPER_ADMIN','ADMIN','MANAGER','DESIGNER','REVIEWER','VIEWER'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "Plan" AS ENUM (
  'FREE','CREATOR','PRO','STUDIO','STARTER','ENTERPRISE'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'FREE';
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'CREATOR';
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'PRO';
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'STUDIO';
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'STARTER';
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'ENTERPRISE';

DO $$ BEGIN CREATE TYPE "SubStatus" AS ENUM (
  'TRIALING','ACTIVE','PAST_DUE','CANCELED','UNPAID','INCOMPLETE'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "ProductMode" AS ENUM ('CREATOR','STUDIO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "CreditTxType" AS ENUM (
  'grant_cycle','daily_grant','consume','refund','topup',
  'rollover_grant','rollover_expire','adjustment'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "CreditReason" AS ENUM (
  'static','static_hq','gif','asset_on_demand','asset_on_demand_hq',
  'asset_on_demand_refund','normal_ad','cinematic_ad','video_std','video_hq',
  'export_zip','admin_adjust','brand_asset_process'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'static_hq';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'asset_on_demand';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'asset_on_demand_hq';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'asset_on_demand_refund';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'normal_ad';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'cinematic_ad';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'brand_asset_process';

DO $$ BEGIN CREATE TYPE "JobStatus" AS ENUM (
  'QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELED','REFUNDED',
  'PENDING','COMPLETED','CANCELLED'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'SUCCEEDED';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'CANCELED';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

DO $$ BEGIN CREATE TYPE "JobType" AS ENUM (
  'GENERATE_ASSETS','RENDER_GIF','RENDER_VIDEO_STD','RENDER_VIDEO_HQ',
  'RENDER_NORMAL_AD','RENDER_CINEMATIC_AD','COMPILE_CAMPAIGN','EXPORT_BUNDLE',
  'BATCH_GENERATE','BRAND_RETRAIN','WEBHOOK_DELIVERY',
  'STUDIO_RENDER_2D','STUDIO_RENDER_CINEMATIC','STUDIO_EXPORT'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'RENDER_NORMAL_AD';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'RENDER_CINEMATIC_AD';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'STUDIO_RENDER_CINEMATIC';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'BATCH_GENERATE';

DO $$ BEGIN CREATE TYPE "BrandAssetType" AS ENUM (
  'logo','product','screenshot','packaging','pattern','icon','other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "BrandAssetUsageRole" AS ENUM (
  'logo_slot','product_slot','screenshot_slot',
  'brand_reveal_slot','background_slot','accent_slot'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "BrandAssetProcessingStatus" AS ENUM (
  'pending','processing','ready','failed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: CORE TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- Org must be created BEFORE User (User has FK to Org)
CREATE TABLE IF NOT EXISTS "Org" (
  "id"                            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "name"                          TEXT        NOT NULL,
  "slug"                          TEXT        NOT NULL,
  "plan"                          "Plan"      NOT NULL DEFAULT 'FREE',
  "subscriptionStatus"            "SubStatus" NOT NULL DEFAULT 'ACTIVE',
  "trialEndsAt"                   TIMESTAMPTZ,
  "billingCycleAnchor"            TIMESTAMPTZ,
  "currentCycleStart"             TIMESTAMPTZ,
  "currentCycleEnd"               TIMESTAMPTZ,
  "creditLimit"                   INTEGER     NOT NULL DEFAULT 500,
  "creditsUsed"                   INTEGER     NOT NULL DEFAULT 0,
  "creditsHeld"                   INTEGER     NOT NULL DEFAULT 0,
  "budgetCapCredits"              INTEGER,
  "onDemandAssetsGeneratedMonth"  INTEGER     NOT NULL DEFAULT 0,
  "lastOnDemandResetAt"           TIMESTAMPTZ,
  "stripeCustomerId"              TEXT,
  "stripeSubscriptionId"          TEXT,
  "stripePriceId"                 TEXT,
  "paddleCustomerId"              TEXT,
  "paddleSubscriptionId"          TEXT,
  "paddlePriceId"                 TEXT,
  "monthlyPriceUsd"               INTEGER,
  "canUseStudioVideo"             BOOLEAN     NOT NULL DEFAULT false,
  "canUseGifMotion"               BOOLEAN     NOT NULL DEFAULT false,
  "canBatchGenerate"              BOOLEAN     NOT NULL DEFAULT false,
  "canUseZipExport"               BOOLEAN     NOT NULL DEFAULT false,
  "canUseAutomation"              BOOLEAN     NOT NULL DEFAULT false,
  "maxConcurrency"                INTEGER     NOT NULL DEFAULT 1,
  "brandLearningEnabled"          BOOLEAN     NOT NULL DEFAULT false,
  "queuePriority"                 INTEGER     NOT NULL DEFAULT 0,
  "maxDailyVideoJobs"             INTEGER     NOT NULL DEFAULT 0,
  "maxFormatsPerRun"              INTEGER     NOT NULL DEFAULT 1,
  "maxVariationsPerRun"           INTEGER     NOT NULL DEFAULT 1,
  "maxExportResolution"           TEXT        NOT NULL DEFAULT '1080p',
  "freeWatermarkEnabled"          BOOLEAN     NOT NULL DEFAULT true,
  "freeDailyCreditsPerDay"        INTEGER     NOT NULL DEFAULT 3,
  "freeMonthlyCapCredits"         INTEGER     NOT NULL DEFAULT 60,
  "creditBalance"                 INTEGER     NOT NULL DEFAULT 0,
  "dailyCreditBalance"            INTEGER     NOT NULL DEFAULT 0,
  "dailyCreditLastReset"          TIMESTAMPTZ,
  "autoRefillEnabled"             BOOLEAN     NOT NULL DEFAULT false,
  "refillThreshold"               INTEGER,
  "refillPackId"                  TEXT,
  "dailySpendCapUsd"              DOUBLE PRECISION,
  "dailySpendUsd"                 DOUBLE PRECISION NOT NULL DEFAULT 0,
  "dailySpendDate"                TIMESTAMPTZ,
  "costProtectionBlocked"         BOOLEAN     NOT NULL DEFAULT false,
  "ssoEnabled"                    BOOLEAN     NOT NULL DEFAULT false,
  "mfaRequired"                   BOOLEAN     NOT NULL DEFAULT false,
  "gracePeriodEndsAt"             TIMESTAMPTZ,
  "createdAt"                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Org_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Org_slug_key" UNIQUE ("slug")
);

-- Unique constraints (safe to add individually)
DO $$ BEGIN ALTER TABLE "Org" ADD CONSTRAINT "Org_stripeCustomerId_key" UNIQUE ("stripeCustomerId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Org" ADD CONSTRAINT "Org_stripeSubscriptionId_key" UNIQUE ("stripeSubscriptionId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Org" ADD CONSTRAINT "Org_paddleCustomerId_key" UNIQUE ("paddleCustomerId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Org" ADD CONSTRAINT "Org_paddleSubscriptionId_key" UNIQUE ("paddleSubscriptionId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- User table (NextAuth + Arkiol auth)
CREATE TABLE IF NOT EXISTS "User" (
  "id"               TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "email"            TEXT        NOT NULL,
  "name"             TEXT,
  "image"            TEXT,
  "passwordHash"     TEXT,
  "resetToken"       TEXT,
  "resetTokenExpiry" TIMESTAMPTZ,
  "role"             "Role"      NOT NULL DEFAULT 'DESIGNER',
  "orgId"            TEXT,
  "productMode"      "ProductMode" NOT NULL DEFAULT 'CREATOR',
  "onboardingDone"   BOOLEAN     NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "User_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "User_email_key" UNIQUE ("email"),
  CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id")
);

DO $$ BEGIN ALTER TABLE "User" ADD CONSTRAINT "User_resetToken_key" UNIQUE ("resetToken");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NextAuth: Account (OAuth tokens)
CREATE TABLE IF NOT EXISTS "Account" (
  "id"                TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"            TEXT    NOT NULL,
  "type"              TEXT    NOT NULL,
  "provider"          TEXT    NOT NULL,
  "providerAccountId" TEXT    NOT NULL,
  "refresh_token"     TEXT,
  "access_token"      TEXT,
  "expires_at"        INTEGER,
  "token_type"        TEXT,
  "scope"             TEXT,
  "id_token"          TEXT,
  "session_state"     TEXT,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Account_provider_providerAccountId_key" UNIQUE ("provider","providerAccountId"),
  CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- NextAuth: Session (database sessions — used with PrismaAdapter)
CREATE TABLE IF NOT EXISTS "Session" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "sessionToken" TEXT        NOT NULL,
  "userId"       TEXT        NOT NULL,
  "expires"      TIMESTAMPTZ NOT NULL,
  CONSTRAINT "Session_pkey"            PRIMARY KEY ("id"),
  CONSTRAINT "Session_sessionToken_key" UNIQUE ("sessionToken"),
  CONSTRAINT "Session_userId_fkey"     FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- NextAuth: VerificationToken (magic link emails)
CREATE TABLE IF NOT EXISTS "VerificationToken" (
  "identifier" TEXT        NOT NULL,
  "token"      TEXT        NOT NULL,
  "expires"    TIMESTAMPTZ NOT NULL,
  CONSTRAINT "VerificationToken_token_key"            UNIQUE ("token"),
  CONSTRAINT "VerificationToken_identifier_token_key" UNIQUE ("identifier","token")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: SAFE ALTER TABLE FOR EXISTING DATABASES
-- Every column uses ADD COLUMN IF NOT EXISTS so this is fully idempotent.
-- Run this whether your DB is fresh or has been patched manually.
-- ─────────────────────────────────────────────────────────────────────────────

-- Org: ensure all columns exist (handles DBs created before certain migrations)
ALTER TABLE "Org"
  ADD COLUMN IF NOT EXISTS "currentCycleStart"             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "currentCycleEnd"               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "creditsHeld"                   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "budgetCapCredits"              INTEGER,
  ADD COLUMN IF NOT EXISTS "onDemandAssetsGeneratedMonth"  INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastOnDemandResetAt"           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "paddleCustomerId"              TEXT,
  ADD COLUMN IF NOT EXISTS "paddleSubscriptionId"          TEXT,
  ADD COLUMN IF NOT EXISTS "paddlePriceId"                 TEXT,
  ADD COLUMN IF NOT EXISTS "monthlyPriceUsd"               INTEGER,
  ADD COLUMN IF NOT EXISTS "canUseStudioVideo"             BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canUseGifMotion"               BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canBatchGenerate"              BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canUseZipExport"               BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canUseAutomation"              BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "maxConcurrency"                INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "brandLearningEnabled"          BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "queuePriority"                 INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxDailyVideoJobs"             INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxFormatsPerRun"              INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "maxVariationsPerRun"           INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "maxExportResolution"           TEXT        NOT NULL DEFAULT '1080p',
  ADD COLUMN IF NOT EXISTS "freeWatermarkEnabled"          BOOLEAN     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "freeDailyCreditsPerDay"        INTEGER     NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "freeMonthlyCapCredits"         INTEGER     NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "creditBalance"                 INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dailyCreditBalance"            INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dailyCreditLastReset"          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "autoRefillEnabled"             BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "refillThreshold"               INTEGER,
  ADD COLUMN IF NOT EXISTS "refillPackId"                  TEXT,
  ADD COLUMN IF NOT EXISTS "dailySpendCapUsd"              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "dailySpendUsd"                 DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dailySpendDate"                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "costProtectionBlocked"         BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "gracePeriodEndsAt"             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "ssoEnabled"                    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "mfaRequired"                   BOOLEAN     NOT NULL DEFAULT false;

-- User: ensure all columns exist
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "image"            TEXT,
  ADD COLUMN IF NOT EXISTS "passwordHash"     TEXT,
  ADD COLUMN IF NOT EXISTS "resetToken"       TEXT,
  ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "orgId"            TEXT,
  ADD COLUMN IF NOT EXISTS "onboardingDone"   BOOLEAN NOT NULL DEFAULT false;

-- Safely add/convert productMode column
-- If it exists as TEXT, this will be a no-op (TEXT accepts enum strings)
-- If it doesn't exist, add it as the ProductMode enum type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'productMode'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "productMode" "ProductMode" NOT NULL DEFAULT 'CREATOR';
  END IF;
END $$;

-- Add FK from User.orgId to Org.id (safe — catches error if already exists)
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Org"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: CREDIT LEDGER
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CreditTransaction" (
  "id"             TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"          TEXT           NOT NULL,
  "type"           "CreditTxType" NOT NULL,
  "amount"         INTEGER        NOT NULL,
  "unit"           TEXT           NOT NULL DEFAULT 'credits',
  "reason"         "CreditReason" NOT NULL,
  "refId"          TEXT,
  "idempotencyKey" TEXT           NOT NULL,
  "expiresAt"      TIMESTAMPTZ,
  "metadata"       JSONB          NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT "CreditTransaction_pkey"               PRIMARY KEY ("id"),
  CONSTRAINT "CreditTransaction_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "CreditTransaction_orgId_fkey"         FOREIGN KEY ("orgId") REFERENCES "Org"("id")
);

CREATE INDEX IF NOT EXISTS "CreditTransaction_orgId_createdAt_idx" ON "CreditTransaction"("orgId","createdAt");
CREATE INDEX IF NOT EXISTS "CreditTransaction_orgId_type_idx"      ON "CreditTransaction"("orgId","type");
CREATE INDEX IF NOT EXISTS "CreditTransaction_refId_idx"           ON "CreditTransaction"("refId");

CREATE TABLE IF NOT EXISTS "CreditPack" (
  "id"            TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "name"          TEXT    NOT NULL,
  "credits"       INTEGER NOT NULL,
  "priceUsd"      INTEGER NOT NULL,
  "stripePriceId" TEXT,
  "expiryDays"    INTEGER,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "CreditPack_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: BRAND / CAMPAIGN / ASSETS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Brand" (
  "id"               TEXT     NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"            TEXT     NOT NULL,
  "name"             TEXT     NOT NULL,
  "primaryColor"     TEXT     NOT NULL DEFAULT '#4f6ef7',
  "secondaryColor"   TEXT     NOT NULL DEFAULT '#a855f7',
  "accentColors"     TEXT[]   NOT NULL DEFAULT '{}',
  "fontDisplay"      TEXT     NOT NULL DEFAULT 'Georgia',
  "fontBody"         TEXT     NOT NULL DEFAULT 'Arial',
  "fontMono"         TEXT     NOT NULL DEFAULT 'Courier New',
  "voiceAttribs"     JSONB    NOT NULL DEFAULT '{}',
  "logoUrl"          TEXT,
  "assetSamples"     TEXT[]   NOT NULL DEFAULT '{}',
  "modelVersion"     INTEGER  NOT NULL DEFAULT 0,
  "consistencyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Brand_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "Brand_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id")
);
CREATE INDEX IF NOT EXISTS "Brand_orgId_idx" ON "Brand"("orgId");

CREATE TABLE IF NOT EXISTS "StudioProject" (
  "id"            TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"         TEXT    NOT NULL,
  "brandId"       TEXT,
  "name"          TEXT    NOT NULL,
  "description"   TEXT,
  "status"        TEXT    NOT NULL DEFAULT 'draft',
  "settings"      JSONB   NOT NULL DEFAULT '{}',
  "brandAssetIds" TEXT[]  NOT NULL DEFAULT '{}',
  "brandPalette"  JSONB   NOT NULL DEFAULT '[]',
  "deletedAt"     TIMESTAMPTZ,
  "deletedBy"     TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "StudioProject_pkey"        PRIMARY KEY ("id"),
  CONSTRAINT "StudioProject_orgId_fkey"  FOREIGN KEY ("orgId")   REFERENCES "Org"("id"),
  CONSTRAINT "StudioProject_brand_fkey"  FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
);
CREATE INDEX IF NOT EXISTS "StudioProject_orgId_idx"           ON "StudioProject"("orgId");
CREATE INDEX IF NOT EXISTS "StudioProject_orgId_deletedAt_idx" ON "StudioProject"("orgId","deletedAt");

-- StudioProject: add brandAssetIds/brandPalette for existing tables
ALTER TABLE "StudioProject"
  ADD COLUMN IF NOT EXISTS "brandAssetIds" TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "brandPalette"  JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "deletedAt"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "deletedBy"     TEXT;

CREATE TABLE IF NOT EXISTS "Campaign" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"       TEXT        NOT NULL,
  "brandId"     TEXT,
  "name"        TEXT        NOT NULL,
  "prompt"      TEXT        NOT NULL,
  "stylePreset" TEXT        NOT NULL DEFAULT 'modern_minimal',
  "formats"     TEXT[]      NOT NULL DEFAULT '{}',
  "status"      "JobStatus" NOT NULL DEFAULT 'PENDING',
  "channels"    TEXT[]      NOT NULL DEFAULT '{}',
  "scheduledAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "creditCost"  INTEGER     NOT NULL DEFAULT 0,
  "metadata"    JSONB       NOT NULL DEFAULT '{}',
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Campaign_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "Campaign_orgId_fkey"  FOREIGN KEY ("orgId")   REFERENCES "Org"("id"),
  CONSTRAINT "Campaign_brand_fkey"  FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
);
CREATE INDEX IF NOT EXISTS "Campaign_orgId_idx"  ON "Campaign"("orgId");
CREATE INDEX IF NOT EXISTS "Campaign_status_idx" ON "Campaign"("status");

CREATE TABLE IF NOT EXISTS "Asset" (
  "id"             TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"         TEXT    NOT NULL,
  "orgId"          TEXT,
  "campaignId"     TEXT,
  "name"           TEXT    NOT NULL,
  "format"         TEXT    NOT NULL,
  "category"       TEXT    NOT NULL,
  "mimeType"       TEXT    NOT NULL,
  "s3Key"          TEXT    NOT NULL,
  "s3Bucket"       TEXT    NOT NULL,
  "s3Path"         TEXT,
  "width"          INTEGER NOT NULL,
  "height"         INTEGER NOT NULL,
  "fileSize"       INTEGER NOT NULL,
  "tags"           TEXT[]  NOT NULL DEFAULT '{}',
  "layoutFamily"   TEXT,
  "svgSource"      TEXT,
  "metadata"       JSONB   NOT NULL DEFAULT '{}',
  "brandScore"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "hierarchyValid" BOOLEAN NOT NULL DEFAULT true,
  "retainUntil"    TIMESTAMPTZ,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Asset_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "Asset_userId_fkey"   FOREIGN KEY ("userId")     REFERENCES "User"("id"),
  CONSTRAINT "Asset_campaign_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
);
CREATE INDEX IF NOT EXISTS "Asset_userId_idx"     ON "Asset"("userId");
CREATE INDEX IF NOT EXISTS "Asset_orgId_idx"      ON "Asset"("orgId");
CREATE INDEX IF NOT EXISTS "Asset_campaignId_idx" ON "Asset"("campaignId");
CREATE INDEX IF NOT EXISTS "Asset_format_idx"     ON "Asset"("format");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: JOBS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Job" (
  "id"                      TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "type"                    TEXT        NOT NULL DEFAULT 'GENERATE_ASSETS',
  "status"                  "JobStatus" NOT NULL DEFAULT 'QUEUED',
  "userId"                  TEXT        NOT NULL,
  "orgId"                   TEXT        NOT NULL,
  "campaignId"              TEXT,
  "studioProjectId"         TEXT,
  "payload"                 JSONB       NOT NULL DEFAULT '{}',
  "result"                  JSONB,
  "progress"                INTEGER     NOT NULL DEFAULT 0,
  "attempts"                INTEGER     NOT NULL DEFAULT 0,
  "maxAttempts"             INTEGER     NOT NULL DEFAULT 3,
  "idempotencyKey"          TEXT,
  "creditCost"              INTEGER     NOT NULL DEFAULT 0,
  "creditDeducted"          BOOLEAN     NOT NULL DEFAULT false,
  "creditRefunded"          BOOLEAN     NOT NULL DEFAULT false,
  "creditsHeld"             INTEGER     NOT NULL DEFAULT 0,
  "creditFinalized"         BOOLEAN     NOT NULL DEFAULT false,
  "estimatedProviderCostUsd" DOUBLE PRECISION,
  "actualProviderCostUsd"   DOUBLE PRECISION,
  "startedAt"               TIMESTAMPTZ,
  "completedAt"             TIMESTAMPTZ,
  "failedAt"                TIMESTAMPTZ,
  "canceledAt"              TIMESTAMPTZ,
  "createdAt"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Job_pkey"              PRIMARY KEY ("id"),
  CONSTRAINT "Job_userId_fkey"       FOREIGN KEY ("userId")          REFERENCES "User"("id"),
  CONSTRAINT "Job_orgId_fkey"        FOREIGN KEY ("orgId")           REFERENCES "Org"("id"),
  CONSTRAINT "Job_campaignId_fkey"   FOREIGN KEY ("campaignId")      REFERENCES "Campaign"("id"),
  CONSTRAINT "Job_studioProj_fkey"   FOREIGN KEY ("studioProjectId") REFERENCES "StudioProject"("id")
);

DO $$ BEGIN ALTER TABLE "Job" ADD CONSTRAINT "Job_idempotencyKey_key" UNIQUE ("idempotencyKey");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Job_userId_idx"          ON "Job"("userId");
CREATE INDEX IF NOT EXISTS "Job_orgId_idx"           ON "Job"("orgId");
CREATE INDEX IF NOT EXISTS "Job_status_idx"          ON "Job"("status");
CREATE INDEX IF NOT EXISTS "Job_type_idx"            ON "Job"("type");
CREATE INDEX IF NOT EXISTS "Job_createdAt_idx"       ON "Job"("createdAt");
CREATE INDEX IF NOT EXISTS "Job_creditFinalized_idx" ON "Job"("creditFinalized");
CREATE INDEX IF NOT EXISTS "Job_creditsHeld_idx"     ON "Job"("creditsHeld");
CREATE INDEX IF NOT EXISTS "Job_creditRefunded_idx"  ON "Job"("creditRefunded");

ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "creditsHeld"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditFinalized"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "creditDeducted"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "creditRefunded"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "studioProjectId"   TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey"    TEXT,
  ADD COLUMN IF NOT EXISTS "failedAt"          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "canceledAt"        TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: API KEYS / USAGE / CONTENT / WEBHOOKS / BILLING / AUDIT
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ApiKey" (
  "id"          TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"      TEXT    NOT NULL,
  "name"        TEXT    NOT NULL,
  "keyHash"     TEXT    NOT NULL,
  "keyPrefix"   TEXT    NOT NULL,
  "permissions" TEXT[]  NOT NULL DEFAULT '{"generate","read"}',
  "lastUsedAt"  TIMESTAMPTZ,
  "expiresAt"   TIMESTAMPTZ,
  "isRevoked"   BOOLEAN NOT NULL DEFAULT false,
  "dailyLimit"  INTEGER,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ApiKey_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "ApiKey_keyHash_key" UNIQUE ("keyHash"),
  CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
);
CREATE INDEX IF NOT EXISTS "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");
CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx"  ON "ApiKey"("userId");

CREATE TABLE IF NOT EXISTS "Usage" (
  "id"        TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"    TEXT    NOT NULL,
  "action"    TEXT    NOT NULL,
  "credits"   INTEGER NOT NULL,
  "metadata"  JSONB   NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Usage_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "Usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
);
CREATE INDEX IF NOT EXISTS "Usage_userId_idx"    ON "Usage"("userId");
CREATE INDEX IF NOT EXISTS "Usage_createdAt_idx" ON "Usage"("createdAt");

CREATE TABLE IF NOT EXISTS "EditorDraft" (
  "id"        TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"    TEXT    NOT NULL,
  "orgId"     TEXT,
  "projectId" TEXT    NOT NULL,
  "type"      TEXT    NOT NULL,
  "label"     TEXT,
  "elements"  JSONB   NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "EditorDraft_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "EditorDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "EditorDraft_orgId_fkey"  FOREIGN KEY ("orgId")  REFERENCES "Org"("id")
);
CREATE INDEX IF NOT EXISTS "EditorDraft_userId_projectId_idx" ON "EditorDraft"("userId","projectId");
CREATE INDEX IF NOT EXISTS "EditorDraft_projectId_orgId_idx"  ON "EditorDraft"("projectId","orgId");

CREATE TABLE IF NOT EXISTS "ContentPack" (
  "id"        TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"     TEXT    NOT NULL,
  "name"      TEXT    NOT NULL,
  "theme"     TEXT    NOT NULL,
  "daysCount" INTEGER NOT NULL DEFAULT 30,
  "items"     JSONB   NOT NULL DEFAULT '[]',
  "status"    TEXT    NOT NULL DEFAULT 'generating',
  "zipS3Key"  TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ContentPack_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "ContentPack_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id")
);
CREATE INDEX IF NOT EXISTS "ContentPack_orgId_idx" ON "ContentPack"("orgId");

CREATE TABLE IF NOT EXISTS "Webhook" (
  "id"          TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"       TEXT    NOT NULL,
  "url"         TEXT    NOT NULL,
  "secret"      TEXT    NOT NULL,
  "events"      TEXT[]  NOT NULL DEFAULT '{}',
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "failCount"   INTEGER NOT NULL DEFAULT 0,
  "lastSuccess" TIMESTAMPTZ,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Webhook_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "Webhook_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id")
);
CREATE INDEX IF NOT EXISTS "Webhook_orgId_idx" ON "Webhook"("orgId");

CREATE TABLE IF NOT EXISTS "BillingEvent" (
  "id"          TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"       TEXT    NOT NULL,
  "stripeEvent" TEXT    NOT NULL,
  "type"        TEXT    NOT NULL,
  "payload"     JSONB   NOT NULL,
  "processed"   BOOLEAN NOT NULL DEFAULT false,
  "processedAt" TIMESTAMPTZ,
  "error"       TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "BillingEvent_pkey"            PRIMARY KEY ("id"),
  CONSTRAINT "BillingEvent_stripeEvent_key" UNIQUE ("stripeEvent"),
  CONSTRAINT "BillingEvent_orgId_fkey"      FOREIGN KEY ("orgId") REFERENCES "Org"("id")
);
CREATE INDEX IF NOT EXISTS "BillingEvent_orgId_idx"               ON "BillingEvent"("orgId");
CREATE INDEX IF NOT EXISTS "BillingEvent_type_idx"                ON "BillingEvent"("type");
CREATE INDEX IF NOT EXISTS "BillingEvent_processed_createdAt_idx" ON "BillingEvent"("processed","createdAt");

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id"         TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"      TEXT    NOT NULL,
  "actorId"    TEXT    NOT NULL,
  "action"     TEXT    NOT NULL,
  "targetId"   TEXT,
  "targetType" TEXT,
  "metadata"   JSONB   NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AuditLog_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id")
);
CREATE INDEX IF NOT EXISTS "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId","createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_idx"         ON "AuditLog"("actorId");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx"          ON "AuditLog"("action");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8: AI TABLES (feedback, generated assets, benchmarks, traces)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AIFeedbackEvent" (
  "id"           TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"        TEXT    NOT NULL,
  "sessionId"    TEXT    NOT NULL,
  "jobId"        TEXT,
  "assetId"      TEXT,
  "eventType"    TEXT    NOT NULL,
  "format"       TEXT,
  "planKey"      TEXT,
  "variationIdx" INTEGER,
  "durationMs"   INTEGER,
  "qualityScore" DOUBLE PRECISION,
  "metadata"     JSONB   NOT NULL DEFAULT '{}',
  "occurredAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AIFeedbackEvent_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "AIFeedbackEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AIFeedbackEvent_orgId_idx"      ON "AIFeedbackEvent"("orgId");
CREATE INDEX IF NOT EXISTS "AIFeedbackEvent_eventType_idx"  ON "AIFeedbackEvent"("eventType");
CREATE INDEX IF NOT EXISTS "AIFeedbackEvent_occurredAt_idx" ON "AIFeedbackEvent"("occurredAt" DESC);

CREATE TABLE IF NOT EXISTS "AIGeneratedAsset" (
  "id"                 TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"              TEXT    NOT NULL,
  "jobId"              TEXT,
  "assetType"          TEXT    NOT NULL,
  "quality"            TEXT    NOT NULL,
  "source"             TEXT    NOT NULL,
  "url"                TEXT    NOT NULL,
  "cdnUrl"             TEXT,
  "signedUrl"          TEXT,
  "signedUrlExpiresAt" TIMESTAMPTZ,
  "width"              INTEGER NOT NULL,
  "height"             INTEGER NOT NULL,
  "mimeType"           TEXT    NOT NULL,
  "maskUrl"            TEXT,
  "palette"            JSONB   NOT NULL DEFAULT '[]',
  "perspectiveFit"     BOOLEAN NOT NULL DEFAULT false,
  "safetyValidated"    BOOLEAN NOT NULL DEFAULT false,
  "similarityHash"     TEXT,
  "promptUsed"         TEXT,
  "reuseCount"         INTEGER NOT NULL DEFAULT 0,
  "creditCost"         INTEGER NOT NULL DEFAULT 0,
  "providerCostUsd"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "durationMs"         INTEGER NOT NULL DEFAULT 0,
  "metadata"           JSONB   NOT NULL DEFAULT '{}',
  "brandId"            TEXT,
  "campaignId"         TEXT,
  "layoutFamily"       TEXT,
  "stylePreset"        TEXT,
  "generatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AIGeneratedAsset_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "AIGeneratedAsset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_orgId_idx"         ON "AIGeneratedAsset"("orgId");
CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_orgId_hash_idx"    ON "AIGeneratedAsset"("orgId","similarityHash");
CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_createdAt_idx"     ON "AIGeneratedAsset"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_orgId_reuse_idx"   ON "AIGeneratedAsset"("orgId","reuseCount" DESC);
CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_layoutFamily_idx"  ON "AIGeneratedAsset"("layoutFamily");
CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_stylePreset_idx"   ON "AIGeneratedAsset"("stylePreset");

CREATE TABLE IF NOT EXISTS "AlertLog" (
  "id"         TEXT    NOT NULL,
  "alertType"  TEXT    NOT NULL,
  "severity"   TEXT    NOT NULL,
  "title"      TEXT    NOT NULL,
  "message"    TEXT    NOT NULL,
  "orgId"      TEXT,
  "jobId"      TEXT,
  "value"      DOUBLE PRECISION,
  "threshold"  DOUBLE PRECISION,
  "metadata"   JSONB   NOT NULL DEFAULT '{}',
  "resolvedAt" TIMESTAMPTZ,
  "firedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AlertLog_severity_firedAt_idx"  ON "AlertLog"("severity","firedAt" DESC);
CREATE INDEX IF NOT EXISTS "AlertLog_orgId_firedAt_idx"     ON "AlertLog"("orgId","firedAt" DESC);
CREATE INDEX IF NOT EXISTS "AlertLog_alertType_firedAt_idx" ON "AlertLog"("alertType","firedAt" DESC);

CREATE TABLE IF NOT EXISTS "AIBenchmarkRecord" (
  "id"               TEXT    NOT NULL,
  "assetId"          TEXT    NOT NULL,
  "jobId"            TEXT    NOT NULL,
  "orgId"            TEXT    NOT NULL,
  "format"           TEXT    NOT NULL,
  "variationIdx"     INTEGER NOT NULL DEFAULT 0,
  "stylePreset"      TEXT    NOT NULL,
  "outputFormat"     TEXT    NOT NULL,
  "overallScore"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "brandAlignment"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "hierarchyScore"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "densityScore"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "contrastScore"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "violationCount"   INTEGER NOT NULL DEFAULT 0,
  "pipelineMs"       INTEGER NOT NULL DEFAULT 0,
  "anyFallback"      BOOLEAN NOT NULL DEFAULT false,
  "layoutFamily"     TEXT    NOT NULL DEFAULT '',
  "abVariants"       JSONB   NOT NULL DEFAULT '{}',
  "stagePerfs"       JSONB   NOT NULL DEFAULT '[]',
  "costGateBlocked"  BOOLEAN NOT NULL DEFAULT false,
  "costEstimateUsd"  DOUBLE PRECISION,
  "renderedAt"       TIMESTAMPTZ NOT NULL,
  "routingMode"      TEXT,
  "stageBreakdown"   JSONB   NOT NULL DEFAULT '[]',
  "routingDecisions" JSONB   NOT NULL DEFAULT '{}',
  "fallbackCount"    INTEGER NOT NULL DEFAULT 0,
  "totalCostUsd"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "userSelected"     BOOLEAN NOT NULL DEFAULT false,
  "userExported"     BOOLEAN NOT NULL DEFAULT false,
  "userSelectedAt"   TIMESTAMPTZ,
  "archetypeId"      TEXT,
  "archetypeConfidence" DOUBLE PRECISION,
  "presetId"         TEXT,
  CONSTRAINT "AIBenchmarkRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AIBenchmarkRecord_orgId_renderedAt_idx" ON "AIBenchmarkRecord"("orgId","renderedAt");
CREATE INDEX IF NOT EXISTS "AIBenchmarkRecord_jobId_idx"            ON "AIBenchmarkRecord"("jobId");
CREATE INDEX IF NOT EXISTS "AIBenchmarkRecord_overallScore_idx"     ON "AIBenchmarkRecord"("overallScore");

CREATE TABLE IF NOT EXISTS "AIJobSummary" (
  "jobId"             TEXT    NOT NULL,
  "orgId"             TEXT    NOT NULL,
  "assetCount"        INTEGER NOT NULL DEFAULT 0,
  "avgOverallScore"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgPipelineMs"     INTEGER NOT NULL DEFAULT 0,
  "avgBrandScore"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgHierarchyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fallbackRate"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "violationRate"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "worstStage"        TEXT,
  "abVariants"        JSONB   NOT NULL DEFAULT '{}',
  "completedAt"       TIMESTAMPTZ NOT NULL,
  CONSTRAINT "AIJobSummary_pkey" PRIMARY KEY ("jobId")
);

CREATE TABLE IF NOT EXISTS "AIStylePerformance" (
  "id"              TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"           TEXT    NOT NULL,
  "stylePreset"     TEXT    NOT NULL,
  "sampleCount"     INTEGER NOT NULL DEFAULT 0,
  "avgQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgPipelineMs"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgViolations"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "trend"           TEXT    NOT NULL DEFAULT 'insufficient_data',
  "lastUpdated"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AIStylePerformance_pkey"             PRIMARY KEY ("id"),
  CONSTRAINT "AIStylePerformance_orgId_preset_key" UNIQUE ("orgId","stylePreset")
);

CREATE TABLE IF NOT EXISTS "AIFormatPerformance" (
  "id"              TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"           TEXT    NOT NULL,
  "format"          TEXT    NOT NULL,
  "sampleCount"     INTEGER NOT NULL DEFAULT 0,
  "avgQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fallbackRate"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "topLayoutFamily" TEXT,
  "lastUpdated"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AIFormatPerformance_pkey"            PRIMARY KEY ("id"),
  CONSTRAINT "AIFormatPerformance_orgId_format_key" UNIQUE ("orgId","format")
);

CREATE TABLE IF NOT EXISTS "AIABResult" (
  "id"              TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"           TEXT    NOT NULL,
  "experimentName"  TEXT    NOT NULL,
  "variant"         TEXT    NOT NULL,
  "sampleCount"     INTEGER NOT NULL DEFAULT 0,
  "avgQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgPipelineMs"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastUpdated"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AIABResult_pkey"                         PRIMARY KEY ("id"),
  CONSTRAINT "AIABResult_orgId_experiment_variant_key" UNIQUE ("orgId","experimentName","variant")
);

CREATE TABLE IF NOT EXISTS "AIJobMetadata" (
  "id"                  TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "jobId"               TEXT    NOT NULL,
  "orgId"               TEXT    NOT NULL,
  "stageTimings"        JSONB   NOT NULL DEFAULT '{}',
  "stageDecisions"      JSONB   NOT NULL DEFAULT '{}',
  "fallbackReasons"     JSONB   NOT NULL DEFAULT '[]',
  "abAssignments"       JSONB   NOT NULL DEFAULT '{}',
  "stageOutputs"        JSONB   NOT NULL DEFAULT '{}',
  "costGateResults"     JSONB   NOT NULL DEFAULT '[]',
  "observabilityEvents" JSONB   NOT NULL DEFAULT '[]',
  "overallScore"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalAssets"         INTEGER NOT NULL DEFAULT 0,
  "totalFallbacks"      INTEGER NOT NULL DEFAULT 0,
  "totalViolations"     INTEGER NOT NULL DEFAULT 0,
  "totalPipelineMs"     INTEGER NOT NULL DEFAULT 0,
  "killSwitchActive"    BOOLEAN NOT NULL DEFAULT false,
  "globalSpendBlocked"  BOOLEAN NOT NULL DEFAULT false,
  "archetypeId"         TEXT,
  "archetypeConfidence" DOUBLE PRECISION,
  "archetypeReasoning"  TEXT,
  "archetypeFallback"   BOOLEAN NOT NULL DEFAULT false,
  "presetId"            TEXT,
  "presetBrandOverride" BOOLEAN NOT NULL DEFAULT false,
  "presetReasoning"     TEXT,
  "intelligenceMs"      INTEGER,
  "fallbackTriggers"    JSONB   NOT NULL DEFAULT '[]',
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AIJobMetadata_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "AIJobMetadata_jobId_key" UNIQUE ("jobId")
);

CREATE TABLE IF NOT EXISTS "AIStageTrace" (
  "id"             TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "jobId"          TEXT    NOT NULL,
  "assetId"        TEXT    NOT NULL,
  "orgId"          TEXT    NOT NULL,
  "stageId"        TEXT    NOT NULL,
  "stageIdx"       INTEGER NOT NULL DEFAULT 0,
  "durationMs"     INTEGER NOT NULL DEFAULT 0,
  "ok"             BOOLEAN NOT NULL DEFAULT true,
  "fallback"       BOOLEAN NOT NULL DEFAULT false,
  "fallbackReason" TEXT,
  "decision"       TEXT,
  "inputHash"      TEXT,
  "outputSummary"  JSONB   NOT NULL DEFAULT '{}',
  "errorMessage"   TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AIStageTrace_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AIStageTrace_jobId_idx"         ON "AIStageTrace"("jobId");
CREATE INDEX IF NOT EXISTS "AIStageTrace_orgId_stageId_idx" ON "AIStageTrace"("orgId","stageId");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9: CREATIVE EXPLORATION ENGINE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "exploration_runs" (
  "id"                     TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"                  TEXT    NOT NULL,
  "jobId"                  TEXT,
  "brandId"                TEXT,
  "campaignId"             TEXT,
  "seed"                   TEXT    NOT NULL,
  "format"                 TEXT    NOT NULL,
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
  "createdAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "exploration_runs_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "exploration_runs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "exploration_runs_orgId_idx"     ON "exploration_runs"("orgId");
CREATE INDEX IF NOT EXISTS "exploration_runs_createdAt_idx" ON "exploration_runs"("createdAt" DESC);

CREATE TABLE IF NOT EXISTS "exploration_candidates" (
  "id"               TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "runId"            TEXT    NOT NULL,
  "orgId"            TEXT    NOT NULL,
  "generationIndex"  INTEGER NOT NULL,
  "format"           TEXT    NOT NULL,
  "genome"           JSONB   NOT NULL,
  "scores"           JSONB,
  "noveltyScore"     DOUBLE PRECISION,
  "explorationScore" DOUBLE PRECISION,
  "confidenceTier"   TEXT,
  "rank"             INTEGER,
  "constraintPassed" BOOLEAN NOT NULL DEFAULT false,
  "repairLog"        JSONB,
  "featureVector"    JSONB,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "exploration_candidates_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "exploration_candidates_runId_fkey" FOREIGN KEY ("runId") REFERENCES "exploration_runs"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "exploration_candidates_runId_idx" ON "exploration_candidates"("runId");
CREATE INDEX IF NOT EXISTS "exploration_candidates_orgId_idx" ON "exploration_candidates"("orgId");

CREATE TABLE IF NOT EXISTS "exploration_feedback" (
  "id"          TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"      TEXT    NOT NULL,
  "orgId"       TEXT    NOT NULL,
  "brandId"     TEXT,
  "campaignId"  TEXT,
  "candidateId" TEXT    NOT NULL,
  "runId"       TEXT,
  "genome"      JSONB   NOT NULL,
  "scores"      JSONB   NOT NULL,
  "signalType"  TEXT    NOT NULL,
  "weight"      DOUBLE PRECISION NOT NULL,
  "format"      TEXT    NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "exploration_feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "exploration_feedback_orgId_idx"      ON "exploration_feedback"("orgId");
CREATE INDEX IF NOT EXISTS "exploration_feedback_signalType_idx" ON "exploration_feedback"("signalType");

CREATE TABLE IF NOT EXISTS "exploration_priors" (
  "id"           TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"        TEXT    NOT NULL,
  "brandId"      TEXT,
  "priors"       JSONB   NOT NULL,
  "totalSignals" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "exploration_priors_pkey"            PRIMARY KEY ("id"),
  CONSTRAINT "exploration_priors_orgId_brand_key" UNIQUE ("orgId","brandId")
);
CREATE INDEX IF NOT EXISTS "exploration_priors_orgId_idx" ON "exploration_priors"("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "exploration_priors_org_null_brand_idx"
  ON "exploration_priors"("orgId") WHERE "brandId" IS NULL;

CREATE TABLE IF NOT EXISTS "exploration_novelty_archive" (
  "id"          TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"       TEXT    NOT NULL,
  "brandId"     TEXT,
  "vectors"     JSONB   NOT NULL DEFAULT '[]',
  "vectorCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "exploration_novelty_archive_pkey"            PRIMARY KEY ("id"),
  CONSTRAINT "exploration_novelty_archive_orgId_brand_key" UNIQUE ("orgId","brandId")
);
CREATE INDEX IF NOT EXISTS "exploration_novelty_archive_orgId_idx" ON "exploration_novelty_archive"("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "exploration_novelty_archive_org_null_brand_idx"
  ON "exploration_novelty_archive"("orgId") WHERE "brandId" IS NULL;

CREATE OR REPLACE FUNCTION prune_novelty_archive() RETURNS TRIGGER AS $$
DECLARE max_size INTEGER := 500; current_size INTEGER;
BEGIN
  current_size := jsonb_array_length(NEW.vectors);
  IF current_size > max_size THEN
    NEW.vectors := (SELECT jsonb_agg(v) FROM (
      SELECT v FROM jsonb_array_elements(NEW.vectors) AS v
      OFFSET current_size - max_size
    ) sub);
    NEW."vectorCount" := max_size;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prune_novelty_archive ON "exploration_novelty_archive";
CREATE TRIGGER trigger_prune_novelty_archive
  BEFORE INSERT OR UPDATE ON "exploration_novelty_archive"
  FOR EACH ROW EXECUTE FUNCTION prune_novelty_archive();

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 10: BRAND ASSET LIBRARY
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "BrandUploadedAsset" (
  "id"                       TEXT                        NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"                    TEXT                        NOT NULL,
  "brandId"                  TEXT,
  "userId"                   TEXT                        NOT NULL,
  "name"                     TEXT                        NOT NULL,
  "originalName"             TEXT                        NOT NULL,
  "mimeType"                 TEXT                        NOT NULL,
  "sizeBytes"                INTEGER                     NOT NULL,
  "width"                    INTEGER,
  "height"                   INTEGER,
  "s3Key"                    TEXT                        NOT NULL,
  "s3Bucket"                 TEXT                        NOT NULL,
  "cdnUrl"                   TEXT,
  "thumbnailUrl"             TEXT,
  "assetType"                "BrandAssetType"            NOT NULL DEFAULT 'other',
  "usageRole"                "BrandAssetUsageRole",
  "userRoleOverride"         "BrandAssetUsageRole",
  "classificationConfidence" DOUBLE PRECISION            NOT NULL DEFAULT 0,
  "aiAnalysis"               JSONB                       NOT NULL DEFAULT '{}',
  "processingStatus"         "BrandAssetProcessingStatus" NOT NULL DEFAULT 'pending',
  "processingStartedAt"      TIMESTAMPTZ,
  "processingCompletedAt"    TIMESTAMPTZ,
  "processingAttempts"       INTEGER                     NOT NULL DEFAULT 0,
  "processingError"          TEXT,
  "pipelineStages"           JSONB                       NOT NULL DEFAULT '{}',
  "cutoutS3Key"              TEXT,
  "cutoutCdnUrl"             TEXT,
  "vectorS3Key"              TEXT,
  "vectorCdnUrl"             TEXT,
  "enhancedS3Key"            TEXT,
  "enhancedCdnUrl"           TEXT,
  "extractedPalette"         JSONB                       NOT NULL DEFAULT '[]',
  "primaryColor"             TEXT,
  "hasAlpha"                 BOOLEAN                     NOT NULL DEFAULT false,
  "subjectBbox"              JSONB,
  "recommendedMotion"        TEXT,
  "recommendedTransition"    TEXT,
  "scenePlacementHints"      JSONB                       NOT NULL DEFAULT '{}',
  "deletedAt"                TIMESTAMPTZ,
  "deletedBy"                TEXT,
  "createdAt"                TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  CONSTRAINT "BrandUploadedAsset_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "BrandUploadedAsset_orgId_fkey" FOREIGN KEY ("orgId")   REFERENCES "Org"("id") ON DELETE CASCADE,
  CONSTRAINT "BrandUploadedAsset_brand_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL,
  CONSTRAINT "BrandUploadedAsset_user_fkey"  FOREIGN KEY ("userId")  REFERENCES "User"("id")
);
CREATE INDEX IF NOT EXISTS "BrandUploadedAsset_orgId_idx"            ON "BrandUploadedAsset"("orgId");
CREATE INDEX IF NOT EXISTS "BrandUploadedAsset_processingStatus_idx" ON "BrandUploadedAsset"("processingStatus");
CREATE INDEX IF NOT EXISTS "BrandUploadedAsset_createdAt_idx"        ON "BrandUploadedAsset"("createdAt" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 11: MOBILE + CONTROL PLANE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "MobilePushToken" (
  "id"        TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "token"     TEXT    NOT NULL,
  "platform"  TEXT    NOT NULL,
  "userId"    TEXT    NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "MobilePushToken_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "MobilePushToken_token_key" UNIQUE ("token"),
  CONSTRAINT "MobilePushToken_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "MobilePushToken_userId_idx" ON "MobilePushToken"("userId");

CREATE TABLE IF NOT EXISTS "EngineRegistration" (
  "id"               TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "name"             TEXT    NOT NULL,
  "version"          TEXT    NOT NULL,
  "purpose"          TEXT    NOT NULL,
  "executionStage"   TEXT    NOT NULL,
  "costClass"        TEXT    NOT NULL,
  "fallbackStrategy" TEXT    NOT NULL,
  "latencyTargetMs"  INTEGER NOT NULL,
  "idempotent"       BOOLEAN NOT NULL DEFAULT true,
  "parallelSafe"     BOOLEAN NOT NULL DEFAULT false,
  "featureGated"     BOOLEAN NOT NULL DEFAULT false,
  "featureFlagKey"   TEXT,
  "alwaysRun"        BOOLEAN NOT NULL DEFAULT false,
  "registeredAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "EngineRegistration_pkey"             PRIMARY KEY ("id"),
  CONSTRAINT "EngineRegistration_name_version_key" UNIQUE ("name","version")
);

CREATE TABLE IF NOT EXISTS "RoutingPlanLog" (
  "id"                  TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "jobId"               TEXT    NOT NULL,
  "orgId"               TEXT    NOT NULL,
  "mode"                TEXT    NOT NULL,
  "enabledEngines"      TEXT[]  NOT NULL DEFAULT '{}',
  "disabledEngines"     TEXT[]  NOT NULL DEFAULT '{}',
  "explorationParallel" BOOLEAN NOT NULL DEFAULT false,
  "budgetMs"            INTEGER NOT NULL,
  "budgetUsd"           DOUBLE PRECISION NOT NULL,
  "rationale"           JSONB   NOT NULL DEFAULT '[]',
  "routedAt"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "RoutingPlanLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobCheckpoint" (
  "id"              TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "jobId"           TEXT    NOT NULL,
  "orgId"           TEXT    NOT NULL,
  "stage"           TEXT    NOT NULL,
  "stageIdx"        INTEGER NOT NULL,
  "stageOutputs"    JSONB   NOT NULL DEFAULT '{}',
  "completedStages" TEXT[]  NOT NULL DEFAULT '{}',
  "checkpointKey"   TEXT    NOT NULL,
  "attemptNumber"   INTEGER NOT NULL DEFAULT 1,
  "savedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "JobCheckpoint_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "JobCheckpoint_jobId_key" UNIQUE ("jobId")
);

CREATE TABLE IF NOT EXISTS "DeadLetterJob" (
  "id"             TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "jobId"          TEXT    NOT NULL,
  "orgId"          TEXT    NOT NULL,
  "userId"         TEXT    NOT NULL,
  "jobType"        TEXT    NOT NULL DEFAULT 'generation',
  "errorCode"      TEXT    NOT NULL,
  "errorMessage"   TEXT    NOT NULL,
  "failureClass"   TEXT    NOT NULL,
  "attemptCount"   INTEGER NOT NULL DEFAULT 0,
  "creditCost"     INTEGER NOT NULL DEFAULT 0,
  "creditRefunded" BOOLEAN NOT NULL DEFAULT false,
  "payload"        JSONB   NOT NULL DEFAULT '{}',
  "diagnostics"    JSONB   NOT NULL DEFAULT '{}',
  "replayedAt"     TIMESTAMPTZ,
  "replayedBy"     TEXT,
  "deadLetteredAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "DeadLetterJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssetRelationship" (
  "id"           TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"        TEXT    NOT NULL,
  "fromId"       TEXT    NOT NULL,
  "fromType"     TEXT    NOT NULL,
  "toId"         TEXT    NOT NULL,
  "toType"       TEXT    NOT NULL,
  "relationship" TEXT    NOT NULL,
  "weight"       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "metadata"     JSONB   NOT NULL DEFAULT '{}',
  "recordedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AssetRelationship_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "AssetRelationship_from_to_key"   UNIQUE ("fromId","toId","relationship")
);
CREATE INDEX IF NOT EXISTS "AssetRelationship_orgId_idx"       ON "AssetRelationship"("orgId");
CREATE INDEX IF NOT EXISTS "AssetRelationship_fromId_idx"      ON "AssetRelationship"("fromId");
CREATE INDEX IF NOT EXISTS "AssetRelationship_toId_idx"        ON "AssetRelationship"("toId");

CREATE TABLE IF NOT EXISTS "MemorySignalLog" (
  "id"              TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "domain"          TEXT    NOT NULL,
  "orgId"           TEXT    NOT NULL,
  "writePermission" TEXT    NOT NULL,
  "recordCount"     INTEGER NOT NULL DEFAULT 1,
  "writtenAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "MemorySignalLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MemorySignalLog_orgId_idx" ON "MemorySignalLog"("orgId");

CREATE TABLE IF NOT EXISTS "WorkerHealthSnapshot" (
  "workerId"          TEXT             NOT NULL,
  "queueName"         TEXT             NOT NULL,
  "status"            TEXT             NOT NULL,
  "activeJobs"        INTEGER          NOT NULL DEFAULT 0,
  "completedLast5Min" INTEGER          NOT NULL DEFAULT 0,
  "failedLast5Min"    INTEGER          NOT NULL DEFAULT 0,
  "avgJobDurationMs"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastHeartbeatAt"   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  CONSTRAINT "WorkerHealthSnapshot_pkey" PRIMARY KEY ("workerId")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 12: BATCH GENERATION
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "batch_jobs" (
  "id"                 TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"              TEXT    NOT NULL,
  "userId"             TEXT    NOT NULL,
  "status"             TEXT    NOT NULL DEFAULT 'PENDING',
  "totalJobs"          INTEGER NOT NULL,
  "completedJobs"      INTEGER NOT NULL DEFAULT 0,
  "failedJobs"         INTEGER NOT NULL DEFAULT 0,
  "cancelledJobs"      INTEGER NOT NULL DEFAULT 0,
  "totalCreditCost"    INTEGER NOT NULL DEFAULT 0,
  "webhookUrl"         TEXT,
  "webhookFailures"    INTEGER NOT NULL DEFAULT 0,
  "lastDeliveredAt"    TIMESTAMPTZ,
  "lastStatusCode"     INTEGER,
  "deliveryCount"      INTEGER NOT NULL DEFAULT 0,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "apiKeyId"           TEXT,
  "startedAt"          TIMESTAMPTZ,
  "completedAt"        TIMESTAMPTZ,
  "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "batch_jobs_pkey"        PRIMARY KEY ("id"),
  CONSTRAINT "batch_jobs_orgId_fkey"  FOREIGN KEY ("orgId")  REFERENCES "Org"("id"),
  CONSTRAINT "batch_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
);
CREATE INDEX IF NOT EXISTS "batch_jobs_orgId_idx"    ON "batch_jobs"("orgId");
CREATE INDEX IF NOT EXISTS "batch_jobs_userId_idx"   ON "batch_jobs"("userId");
CREATE INDEX IF NOT EXISTS "batch_jobs_status_idx"   ON "batch_jobs"("status");
CREATE INDEX IF NOT EXISTS "batch_jobs_createdAt_idx" ON "batch_jobs"("createdAt");

ALTER TABLE "batch_jobs"
  ADD COLUMN IF NOT EXISTS "webhookUrl"          TEXT,
  ADD COLUMN IF NOT EXISTS "webhookFailures"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastDeliveredAt"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "lastStatusCode"       INTEGER,
  ADD COLUMN IF NOT EXISTS "deliveryCount"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "consecutiveFailures"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "apiKeyId"             TEXT;

CREATE TABLE IF NOT EXISTS "batch_job_items" (
  "id"        TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "batchId"   TEXT    NOT NULL,
  "jobId"     TEXT    NOT NULL,
  "promptIdx" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "batch_job_items_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "batch_job_items_jobId_key"  UNIQUE ("jobId"),
  CONSTRAINT "batch_job_items_batch_fkey" FOREIGN KEY ("batchId") REFERENCES "batch_jobs"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "batch_job_items_batchId_idx" ON "batch_job_items"("batchId");
CREATE INDEX IF NOT EXISTS "batch_job_items_jobId_idx"   ON "batch_job_items"("jobId");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 13: SEED DATA
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "CreditPack" ("id","name","credits","priceUsd","expiryDays","active")
VALUES
  ('pack_100',  '100 Credits',  100,  9,   NULL, true),
  ('pack_500',  '500 Credits',  500,  39,  NULL, true),
  ('pack_2000', '2000 Credits', 2000, 129, NULL, true)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- ✓ DONE. All tables, enums, indexes, and safe ALTER statements applied.
-- Your Arkiol database is fully initialized and ready for production.
-- ─────────────────────────────────────────────────────────────────────────────
