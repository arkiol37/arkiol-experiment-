-- packages/shared/prisma/migrations/20260312_control_plane/migration.sql
-- AI ENGINE CONTROL PLANE — FULL MIGRATION v2
--
-- This migration creates all persistence tables required by the production
-- control plane. Each table has a dedicated, distinct purpose:
--
--   EngineRegistration     — boot audit log of registered engine contracts
--   RoutingPlanLog         — immutable audit trail of routing decisions (pre-execution)
--   JobCheckpoint          — stage-level crash recovery (authoritative, not AIJobMetadata)
--   DeadLetterJob          — unrecoverable jobs (append-only)
--   AssetRelationship      — real persisted graph edges (not inferred from metadata)
--   MemorySignalLog        — audit trail of all unified memory writes
--   WorkerHealthSnapshot   — real-time worker health (one row per worker, upserted)
--
-- All additions to existing tables use "IF NOT EXISTS" / "ADD COLUMN IF NOT EXISTS"
-- for full backward compatibility. No existing rows are affected.

-- ─────────────────────────────────────────────────────────────────────────────
-- ENGINE REGISTRATION AUDIT LOG
-- Append-only record of every engine contract ever registered.
-- Enables version history and regression attribution.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EngineRegistration" (
  "id"               TEXT        NOT NULL PRIMARY KEY,
  "name"             TEXT        NOT NULL,
  "version"          TEXT        NOT NULL,
  "purpose"          TEXT        NOT NULL,
  "executionStage"   TEXT        NOT NULL,
  "costClass"        TEXT        NOT NULL,
  "fallbackStrategy" TEXT        NOT NULL,
  "latencyTargetMs"  INTEGER     NOT NULL,
  "idempotent"       BOOLEAN     NOT NULL DEFAULT true,
  "parallelSafe"     BOOLEAN     NOT NULL DEFAULT false,
  "featureGated"     BOOLEAN     NOT NULL DEFAULT false,
  "featureFlagKey"   TEXT,
  "alwaysRun"        BOOLEAN     NOT NULL DEFAULT false,
  "registeredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EngineRegistration_name_version_key" UNIQUE ("name", "version")
);
CREATE INDEX IF NOT EXISTS "EngineRegistration_name_idx"           ON "EngineRegistration" ("name");
CREATE INDEX IF NOT EXISTS "EngineRegistration_executionStage_idx" ON "EngineRegistration" ("executionStage");

-- ─────────────────────────────────────────────────────────────────────────────
-- ROUTING PLAN AUDIT LOG
-- Immutable record of every routing plan computed by the Policy Router.
-- Written BEFORE any stage executes — enables post-hoc "why did this run?"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RoutingPlanLog" (
  "id"                  TEXT           NOT NULL PRIMARY KEY,
  "jobId"               TEXT           NOT NULL,
  "orgId"               TEXT           NOT NULL,
  "mode"                TEXT           NOT NULL,
  "enabledEngines"      TEXT[]         NOT NULL DEFAULT '{}',
  "disabledEngines"     TEXT[]         NOT NULL DEFAULT '{}',
  "explorationParallel" BOOLEAN        NOT NULL DEFAULT false,
  "budgetMs"            INTEGER        NOT NULL,
  "budgetUsd"           DOUBLE PRECISION NOT NULL,
  "rationale"           JSONB          NOT NULL DEFAULT '[]',
  "routedAt"            TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "RoutingPlanLog_jobId_idx"   ON "RoutingPlanLog" ("jobId");
CREATE INDEX IF NOT EXISTS "RoutingPlanLog_orgId_idx"   ON "RoutingPlanLog" ("orgId");
CREATE INDEX IF NOT EXISTS "RoutingPlanLog_mode_idx"    ON "RoutingPlanLog" ("mode");
CREATE INDEX IF NOT EXISTS "RoutingPlanLog_routedAt_idx" ON "RoutingPlanLog" ("routedAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- JOB CHECKPOINT TABLE (AUTHORITATIVE CRASH RECOVERY SOURCE)
-- One row per job. Upserted after each successful pipeline stage.
-- On recovery, the executor reads this and skips completed stages.
-- This is DISTINCT from AIJobMetadata (observability only).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "JobCheckpoint" (
  "id"              TEXT         NOT NULL PRIMARY KEY,
  "jobId"           TEXT         NOT NULL UNIQUE,
  "orgId"           TEXT         NOT NULL,
  "stage"           TEXT         NOT NULL,
  "stageIdx"        INTEGER      NOT NULL,
  "stageOutputs"    JSONB        NOT NULL DEFAULT '{}',
  "completedStages" TEXT[]       NOT NULL DEFAULT '{}',
  "checkpointKey"   TEXT         NOT NULL,
  "attemptNumber"   INTEGER      NOT NULL DEFAULT 1,
  "savedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "JobCheckpoint_orgId_idx"   ON "JobCheckpoint" ("orgId");
CREATE INDEX IF NOT EXISTS "JobCheckpoint_savedAt_idx" ON "JobCheckpoint" ("savedAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- DEAD-LETTER JOB TABLE
-- Append-only. Never deleted (audit trail).
-- Written by crashSafety.sendToDeadLetter() when a job exhausts retries
-- or encounters a permanent error code.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DeadLetterJob" (
  "id"             TEXT         NOT NULL PRIMARY KEY,
  "jobId"          TEXT         NOT NULL,
  "orgId"          TEXT         NOT NULL,
  "userId"         TEXT         NOT NULL,
  "jobType"        TEXT         NOT NULL DEFAULT 'generation',
  "errorCode"      TEXT         NOT NULL,
  "errorMessage"   TEXT         NOT NULL,
  "failureClass"   TEXT         NOT NULL,
  "attemptCount"   INTEGER      NOT NULL DEFAULT 0,
  "creditCost"     INTEGER      NOT NULL DEFAULT 0,
  "creditRefunded" BOOLEAN      NOT NULL DEFAULT false,
  "payload"        JSONB        NOT NULL DEFAULT '{}',
  "diagnostics"    JSONB        NOT NULL DEFAULT '{}',
  "replayedAt"     TIMESTAMP(3),
  "replayedBy"     TEXT,
  "deadLetteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "DeadLetterJob_jobId_idx"          ON "DeadLetterJob" ("jobId");
CREATE INDEX IF NOT EXISTS "DeadLetterJob_orgId_idx"          ON "DeadLetterJob" ("orgId");
CREATE INDEX IF NOT EXISTS "DeadLetterJob_errorCode_idx"      ON "DeadLetterJob" ("errorCode");
CREATE INDEX IF NOT EXISTS "DeadLetterJob_failureClass_idx"   ON "DeadLetterJob" ("failureClass");
CREATE INDEX IF NOT EXISTS "DeadLetterJob_deadLetteredAt_idx" ON "DeadLetterJob" ("deadLetteredAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSET RELATIONSHIP TABLE (REAL PERSISTED GRAPH)
-- Explicit edges between all first-class platform entities.
-- Written by assetGraph.recordAssetRelationships() after every asset is produced.
-- NOT inferred at query time — relationships are authoritative at write time.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AssetRelationship" (
  "id"           TEXT             NOT NULL PRIMARY KEY,
  "orgId"        TEXT             NOT NULL,
  "fromId"       TEXT             NOT NULL,
  "fromType"     TEXT             NOT NULL,
  "toId"         TEXT             NOT NULL,
  "toType"       TEXT             NOT NULL,
  "relationship" TEXT             NOT NULL,
  "weight"       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "metadata"     JSONB            NOT NULL DEFAULT '{}',
  "recordedAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetRelationship_fromId_toId_relationship_key"
    UNIQUE ("fromId", "toId", "relationship")
);
CREATE INDEX IF NOT EXISTS "AssetRelationship_orgId_idx"         ON "AssetRelationship" ("orgId");
CREATE INDEX IF NOT EXISTS "AssetRelationship_fromId_idx"        ON "AssetRelationship" ("fromId");
CREATE INDEX IF NOT EXISTS "AssetRelationship_toId_idx"          ON "AssetRelationship" ("toId");
CREATE INDEX IF NOT EXISTS "AssetRelationship_relationship_idx"  ON "AssetRelationship" ("relationship");
CREATE INDEX IF NOT EXISTS "AssetRelationship_fromType_idx"      ON "AssetRelationship" ("fromType");
CREATE INDEX IF NOT EXISTS "AssetRelationship_toType_idx"        ON "AssetRelationship" ("toType");
CREATE INDEX IF NOT EXISTS "AssetRelationship_recordedAt_idx"    ON "AssetRelationship" ("recordedAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- MEMORY SIGNAL LOG
-- Audit trail of every write to the Unified Memory layer.
-- Enables: "who wrote to brand_dna for org X at time Y?"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MemorySignalLog" (
  "id"              TEXT         NOT NULL PRIMARY KEY,
  "domain"          TEXT         NOT NULL,
  "orgId"           TEXT         NOT NULL,
  "writePermission" TEXT         NOT NULL,
  "recordCount"     INTEGER      NOT NULL DEFAULT 1,
  "writtenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MemorySignalLog_orgId_idx"    ON "MemorySignalLog" ("orgId");
CREATE INDEX IF NOT EXISTS "MemorySignalLog_domain_idx"   ON "MemorySignalLog" ("domain");
CREATE INDEX IF NOT EXISTS "MemorySignalLog_writtenAt_idx" ON "MemorySignalLog" ("writtenAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- WORKER HEALTH SNAPSHOT
-- One row per worker, upserted on each heartbeat.
-- Written by crashSafety.recordWorkerHealth().
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WorkerHealthSnapshot" (
  "workerId"           TEXT             NOT NULL PRIMARY KEY,
  "queueName"          TEXT             NOT NULL,
  "status"             TEXT             NOT NULL,
  "activeJobs"         INTEGER          NOT NULL DEFAULT 0,
  "completedLast5Min"  INTEGER          NOT NULL DEFAULT 0,
  "failedLast5Min"     INTEGER          NOT NULL DEFAULT 0,
  "avgJobDurationMs"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastHeartbeatAt"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WorkerHealthSnapshot_queueName_idx"       ON "WorkerHealthSnapshot" ("queueName");
CREATE INDEX IF NOT EXISTS "WorkerHealthSnapshot_status_idx"          ON "WorkerHealthSnapshot" ("status");
CREATE INDEX IF NOT EXISTS "WorkerHealthSnapshot_lastHeartbeatAt_idx" ON "WorkerHealthSnapshot" ("lastHeartbeatAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- EXTEND EXISTING TABLES (safe: nullable columns only)
-- ─────────────────────────────────────────────────────────────────────────────

-- AIBenchmarkRecord: add control plane fields
ALTER TABLE "AIBenchmarkRecord"
  ADD COLUMN IF NOT EXISTS "routingMode"      TEXT,
  ADD COLUMN IF NOT EXISTS "stageBreakdown"   JSONB            NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "routingDecisions" JSONB            NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "fallbackCount"    INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalCostUsd"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "userExported"     BOOLEAN          NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "userSelectedAt"   TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "AIBenchmarkRecord_routingMode_idx"  ON "AIBenchmarkRecord" ("routingMode");
CREATE INDEX IF NOT EXISTS "AIBenchmarkRecord_userSelected_idx" ON "AIBenchmarkRecord" ("userSelected");
CREATE INDEX IF NOT EXISTS "AIBenchmarkRecord_overallScore_idx" ON "AIBenchmarkRecord" ("overallScore");

-- AIGeneratedAsset: add layout/style/brand fields used by asset graph
ALTER TABLE "AIGeneratedAsset"
  ADD COLUMN IF NOT EXISTS "layoutFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "stylePreset"  TEXT,
  ADD COLUMN IF NOT EXISTS "brandId"      TEXT,
  ADD COLUMN IF NOT EXISTS "campaignId"   TEXT,
  ADD COLUMN IF NOT EXISTS "generatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_layoutFamily_idx"  ON "AIGeneratedAsset" ("layoutFamily");
CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_stylePreset_idx"   ON "AIGeneratedAsset" ("stylePreset");
CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_orgId_brandId_idx" ON "AIGeneratedAsset" ("orgId", "brandId");
CREATE INDEX IF NOT EXISTS "AIGeneratedAsset_orgId_campaignId_idx" ON "AIGeneratedAsset" ("orgId", "campaignId");

-- ExplorationRun: add brandId + campaignId for graph traversal
ALTER TABLE "ExplorationRun"
  ADD COLUMN IF NOT EXISTS "campaignId" TEXT,
  ADD COLUMN IF NOT EXISTS "brandId"    TEXT;

CREATE INDEX IF NOT EXISTS "ExplorationRun_campaignId_idx" ON "ExplorationRun" ("campaignId");
CREATE INDEX IF NOT EXISTS "ExplorationRun_brandId_idx"    ON "ExplorationRun" ("brandId");

-- Job: add credit tracking columns for atomic credit protection
ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "creditDeducted"  BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "creditRefunded"  BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "creditCost"      INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failedAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "type"            TEXT     NOT NULL DEFAULT 'generation',
  ADD COLUMN IF NOT EXISTS "payload"         JSONB    NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "Job_creditRefunded_idx" ON "Job" ("creditRefunded");
CREATE INDEX IF NOT EXISTS "Job_type_idx"           ON "Job" ("type");
