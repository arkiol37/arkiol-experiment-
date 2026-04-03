-- packages/shared/prisma/migrations/20260228_v16/migration.sql
-- V16 Migration — Paddle Billing + AI Architecture fields

-- ── Paddle billing fields on Org ─────────────────────────────────────────────
ALTER TABLE "Org" ADD COLUMN IF NOT EXISTS "paddleCustomerId"     TEXT UNIQUE;
ALTER TABLE "Org" ADD COLUMN IF NOT EXISTS "paddleSubscriptionId" TEXT UNIQUE;
ALTER TABLE "Org" ADD COLUMN IF NOT EXISTS "paddlePriceId"        TEXT;

-- Index for Paddle webhook lookups (findFirst by customerId / subscriptionId)
CREATE INDEX IF NOT EXISTS "Org_paddleCustomerId_idx"     ON "Org" ("paddleCustomerId");
CREATE INDEX IF NOT EXISTS "Org_paddleSubscriptionId_idx" ON "Org" ("paddleSubscriptionId");

-- ── AI feedback / learning event log ─────────────────────────────────────────
-- Stores aggregated signals for A/B learning, benchmarking, adaptive refinement.
-- No PII — orgId + event type + scores only.
CREATE TABLE IF NOT EXISTS "AIFeedbackEvent" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "orgId"        TEXT NOT NULL,
    "sessionId"    TEXT NOT NULL,
    "jobId"        TEXT,
    "assetId"      TEXT,
    "eventType"    TEXT NOT NULL,
    "format"       TEXT,
    "planKey"      TEXT,
    "variationIdx" INTEGER,
    "durationMs"   INTEGER,
    "qualityScore" DOUBLE PRECISION,
    "metadata"     JSONB NOT NULL DEFAULT '{}',
    "occurredAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "AIFeedbackEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AIFeedbackEvent_orgId_idx"     ON "AIFeedbackEvent" ("orgId");
CREATE INDEX IF NOT EXISTS "AIFeedbackEvent_eventType_idx" ON "AIFeedbackEvent" ("eventType");
CREATE INDEX IF NOT EXISTS "AIFeedbackEvent_occurredAt_idx" ON "AIFeedbackEvent" ("occurredAt" DESC);

-- ── Generated asset metadata cache ───────────────────────────────────────────
-- Tracks generated assets for CDN storage, similarity reuse, and metadata.
CREATE TABLE IF NOT EXISTS "AIGeneratedAsset" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "orgId"           TEXT NOT NULL,
    "jobId"           TEXT,
    "assetType"       TEXT NOT NULL,   -- vector | illustrated | photoreal | 3d
    "quality"         TEXT NOT NULL,   -- fast | high
    "source"          TEXT NOT NULL,   -- cache | library | ai_generated
    "url"             TEXT NOT NULL,
    "cdnUrl"          TEXT,
    "width"           INTEGER NOT NULL,
    "height"          INTEGER NOT NULL,
    "mimeType"        TEXT NOT NULL,
    "maskUrl"         TEXT,
    "palette"         JSONB NOT NULL DEFAULT '[]',
    "perspectiveFit"  BOOLEAN NOT NULL DEFAULT FALSE,
    "safetyValidated" BOOLEAN NOT NULL DEFAULT FALSE,
    "similarityHash"  TEXT,             -- perceptual hash for reuse lookup
    "promptUsed"      TEXT,
    "metadata"        JSONB NOT NULL DEFAULT '{}',
    "createdAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "GeneratedAsset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "GeneratedAsset_orgId_idx"         ON "AIGeneratedAsset" ("orgId");
CREATE INDEX IF NOT EXISTS "GeneratedAsset_similarityHash_idx" ON "AIGeneratedAsset" ("similarityHash") WHERE "similarityHash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "GeneratedAsset_createdAt_idx"     ON "AIGeneratedAsset" ("createdAt" DESC);
