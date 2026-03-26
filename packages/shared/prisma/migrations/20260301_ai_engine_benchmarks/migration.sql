-- packages/shared/prisma/migrations/20260301_ai_engine_benchmarks/migration.sql
-- V16 AI Engine — Benchmark tables, continuous improvement, maxVariationsPerRun
-- All statements use IF NOT EXISTS / IF EXISTS for idempotent replay safety.

-- ── Org: maxVariationsPerRun cap ─────────────────────────────────────────────
ALTER TABLE "Org" ADD COLUMN IF NOT EXISTS "maxVariationsPerRun" INTEGER NOT NULL DEFAULT 1;

-- ── AIBenchmarkRecord — per-asset render quality (append-only) ───────────────
CREATE TABLE IF NOT EXISTS "AIBenchmarkRecord" (
    "id"             TEXT    NOT NULL PRIMARY KEY,
    "assetId"        TEXT    NOT NULL,
    "jobId"          TEXT    NOT NULL,
    "orgId"          TEXT    NOT NULL,
    "format"         TEXT    NOT NULL,
    "variationIdx"   INTEGER NOT NULL DEFAULT 0,
    "stylePreset"    TEXT    NOT NULL,
    "outputFormat"   TEXT    NOT NULL,
    "overallScore"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "brandAlignment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hierarchyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "densityScore"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contrastScore"  DOUBLE PRECISION NOT NULL DEFAULT 0,
    "violationCount" INTEGER NOT NULL DEFAULT 0,
    "pipelineMs"     INTEGER NOT NULL DEFAULT 0,
    "anyFallback"    BOOLEAN NOT NULL DEFAULT FALSE,
    "layoutFamily"   TEXT    NOT NULL DEFAULT '',
    "abVariants"     JSONB   NOT NULL DEFAULT '{}',
    "stagePerfs"     JSONB   NOT NULL DEFAULT '[]',
    "renderedAt"     TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS "AIBenchmarkRecord_orgId_renderedAt_idx" ON "AIBenchmarkRecord" ("orgId", "renderedAt" DESC);
CREATE INDEX IF NOT EXISTS "AIBenchmarkRecord_jobId_idx"            ON "AIBenchmarkRecord" ("jobId");
CREATE INDEX IF NOT EXISTS "AIBenchmarkRecord_format_orgId_idx"     ON "AIBenchmarkRecord" ("format", "orgId");
CREATE INDEX IF NOT EXISTS "AIBenchmarkRecord_stylePreset_orgId_idx" ON "AIBenchmarkRecord" ("stylePreset", "orgId");

-- ── AIJobSummary — per-job aggregated benchmark ──────────────────────────────
CREATE TABLE IF NOT EXISTS "AIJobSummary" (
    "jobId"             TEXT             NOT NULL PRIMARY KEY,
    "orgId"             TEXT             NOT NULL,
    "assetCount"        INTEGER          NOT NULL DEFAULT 0,
    "avgOverallScore"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPipelineMs"     INTEGER          NOT NULL DEFAULT 0,
    "avgBrandScore"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgHierarchyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fallbackRate"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "violationRate"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "worstStage"        TEXT,
    "abVariants"        JSONB            NOT NULL DEFAULT '{}',
    "completedAt"       TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS "AIJobSummary_orgId_completedAt_idx" ON "AIJobSummary" ("orgId", "completedAt" DESC);

-- ── AIStylePerformance — rolling style score per org ─────────────────────────
CREATE TABLE IF NOT EXISTS "AIStylePerformance" (
    "id"              TEXT             NOT NULL PRIMARY KEY,
    "orgId"           TEXT             NOT NULL,
    "stylePreset"     TEXT             NOT NULL,
    "sampleCount"     INTEGER          NOT NULL DEFAULT 0,
    "avgQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPipelineMs"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgViolations"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trend"           TEXT             NOT NULL DEFAULT 'insufficient_data',
    "lastUpdated"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE ("orgId", "stylePreset")
);

CREATE INDEX IF NOT EXISTS "AIStylePerformance_orgId_idx" ON "AIStylePerformance" ("orgId");

-- ── AIFormatPerformance — rolling format score per org ───────────────────────
CREATE TABLE IF NOT EXISTS "AIFormatPerformance" (
    "id"              TEXT             NOT NULL PRIMARY KEY,
    "orgId"           TEXT             NOT NULL,
    "format"          TEXT             NOT NULL,
    "sampleCount"     INTEGER          NOT NULL DEFAULT 0,
    "avgQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fallbackRate"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    "topLayoutFamily" TEXT,
    "lastUpdated"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE ("orgId", "format")
);

CREATE INDEX IF NOT EXISTS "AIFormatPerformance_orgId_idx" ON "AIFormatPerformance" ("orgId");

-- ── AIABResult — A/B experiment results per org × experiment × variant ────────
CREATE TABLE IF NOT EXISTS "AIABResult" (
    "id"              TEXT             NOT NULL PRIMARY KEY,
    "orgId"           TEXT             NOT NULL,
    "experimentName"  TEXT             NOT NULL,
    "variant"         TEXT             NOT NULL,
    "sampleCount"     INTEGER          NOT NULL DEFAULT 0,
    "avgQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPipelineMs"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUpdated"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE ("orgId", "experimentName", "variant")
);

CREATE INDEX IF NOT EXISTS "AIABResult_orgId_experimentName_idx" ON "AIABResult" ("orgId", "experimentName");
