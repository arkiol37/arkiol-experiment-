-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260228_hardening
-- Arkiol Platform — Production Hardening Additions
--
-- Changes:
--   (1) Add soft-delete fields to "StudioProject" (deletedAt, deletedBy)
--   (2) Add index on StudioProject(orgId, deletedAt) for efficient filtering
--   (3) Add extended indexes to AuditLog for compliance queries
--   (4) Add idempotency key index to Job for export dedup lookups
--
-- All changes are purely additive — no existing rows or constraints are altered.
-- Safe to run on live production with zero downtime.
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) Soft-delete fields for StudioProject
ALTER TABLE "StudioProject"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;

COMMENT ON COLUMN "StudioProject"."deletedAt"
  IS 'NULL = active project. Set to deletion timestamp when soft-deleted. Hard deletes are prohibited in production.';
COMMENT ON COLUMN "StudioProject"."deletedBy"
  IS 'userId of the actor who soft-deleted the project. NULL means system-initiated.';

-- (2) Composite index for soft-delete filtering (orgId + deletedAt)
-- This makes WHERE orgId = ? AND deletedAt IS NULL fast even on large tables.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "StudioProject_orgId_deletedAt_idx"
  ON "StudioProject"("orgId", "deletedAt");

-- (3) Additional AuditLog indexes for compliance and admin queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_orgId_action_idx"
  ON "AuditLog"("orgId", "action");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_targetId_idx"
  ON "AuditLog"("targetId")
  WHERE "targetId" IS NOT NULL;

-- (4) Job payload index for export idempotency format-based lookups
-- GIN index on the payload JSONB column to support payload->'format' queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Job_payload_gin_idx"
  ON "Job" USING gin("payload");

-- (5) Partial index for active export jobs (fast count for idempotency window check)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Job_active_exports_idx"
  ON "Job"("userId", "orgId", "createdAt")
  WHERE "type" = 'EXPORT_BUNDLE'
    AND "status" NOT IN ('FAILED', 'CANCELED', 'CANCELLED', 'REFUNDED');
