-- packages/shared/prisma/migrations/20260305_v9_platform/migration.sql
-- Shared platform: ExplorationPriors, OrgSpendRecord, CampaignPlan, NoveltyArchive

CREATE TABLE IF NOT EXISTS "ExplorationPriors" (
  "id"                        TEXT NOT NULL PRIMARY KEY,
  "orgId"                     TEXT NOT NULL,
  "brandId"                   TEXT,
  "layoutFamilyWeights"       JSONB NOT NULL DEFAULT '{}',
  "archetypeWeights"          JSONB NOT NULL DEFAULT '{}',
  "presetWeights"             JSONB NOT NULL DEFAULT '{}',
  "hookStrategyWeights"       JSONB NOT NULL DEFAULT '{}',
  "compositionPatternWeights" JSONB NOT NULL DEFAULT '{}',
  "densityProfileWeights"     JSONB NOT NULL DEFAULT '{}',
  "explorationTemperature"    DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  "totalSignals"              INTEGER NOT NULL DEFAULT 0,
  "schemaVersion"             INTEGER NOT NULL DEFAULT 1,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ExplorationPriors_orgId_idx" ON "ExplorationPriors"("orgId");

CREATE TABLE IF NOT EXISTS "OrgSpendRecord" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "orgId"          TEXT NOT NULL,
  "jobId"          TEXT NOT NULL,
  "provider"       TEXT NOT NULL,
  "costUsd"        DOUBLE PRECISION NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "windowHour"     TEXT NOT NULL,
  "windowDay"      TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrgSpendRecord_idempotency_unique" ON "OrgSpendRecord"("idempotencyKey");

CREATE TABLE IF NOT EXISTS "NoveltyArchiveEntry" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "orgId"        TEXT NOT NULL,
  "format"       TEXT NOT NULL,
  "featureVector" JSONB NOT NULL,
  "candidateId"  TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "NoveltyArchiveEntry_orgId_format_idx" ON "NoveltyArchiveEntry"("orgId", "format");
