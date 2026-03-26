-- Migration: 20260303_archetype_intelligence
-- Purpose: Add archetype + preset intelligence metadata columns to AI job records
--          for benchmarking, learning, and analytics.
-- Safe: all columns are nullable — no existing rows are affected.

-- Add archetype intelligence columns to AIJobMetadata (or GenerationJob)
-- These are stored as JSONB for flexibility as the intelligence engine evolves.

ALTER TABLE "AIJobMetadata"
  ADD COLUMN IF NOT EXISTS "archetypeId"         TEXT,
  ADD COLUMN IF NOT EXISTS "archetypeConfidence"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "archetypeReasoning"   TEXT,
  ADD COLUMN IF NOT EXISTS "archetypeFallback"    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "presetId"             TEXT,
  ADD COLUMN IF NOT EXISTS "presetBrandOverride"  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "presetReasoning"      TEXT,
  ADD COLUMN IF NOT EXISTS "intelligenceMs"       INTEGER;

-- Index for analytics queries grouping by archetype
CREATE INDEX IF NOT EXISTS "AIJobMetadata_archetypeId_idx"
  ON "AIJobMetadata" ("archetypeId");

-- Index for analytics queries grouping by preset
CREATE INDEX IF NOT EXISTS "AIJobMetadata_presetId_idx"
  ON "AIJobMetadata" ("presetId");

-- Also add to shared package schema (mirrored in apps/arkiol-core/prisma)
-- The AIEngineBenchmark table also benefits from archetype tracking
ALTER TABLE "AIEngineBenchmark"
  ADD COLUMN IF NOT EXISTS "archetypeId"         TEXT,
  ADD COLUMN IF NOT EXISTS "archetypeConfidence"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "presetId"             TEXT;

CREATE INDEX IF NOT EXISTS "AIEngineBenchmark_archetypeId_idx"
  ON "AIEngineBenchmark" ("archetypeId");
