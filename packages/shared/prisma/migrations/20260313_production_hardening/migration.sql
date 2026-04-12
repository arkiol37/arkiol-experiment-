-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260313_production_hardening
-- Adds columns required for atomic credit two-phase commit,
-- idempotency tracking, and worker health monitoring.
-- ─────────────────────────────────────────────────────────────────────────────

-- Job: two-phase credit commit flags
ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "creditsHeld"       INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditFinalized"   BOOLEAN  NOT NULL DEFAULT false;

-- Org: total held credits across pending jobs
ALTER TABLE "Org"
  ADD COLUMN IF NOT EXISTS "creditsHeld"       INTEGER  NOT NULL DEFAULT 0;

-- BatchJob: webhook delivery tracking + audit fields
ALTER TABLE "BatchJob"
  ADD COLUMN IF NOT EXISTS "webhookUrl"            TEXT,
  ADD COLUMN IF NOT EXISTS "webhookFailures"       INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastDeliveredAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastStatusCode"        INTEGER,
  ADD COLUMN IF NOT EXISTS "deliveryCount"         INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "consecutiveFailures"   INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "apiKeyId"              TEXT;

CREATE INDEX IF NOT EXISTS "Job_creditFinalized_idx"  ON "Job" ("creditFinalized");
CREATE INDEX IF NOT EXISTS "Job_creditsHeld_idx"      ON "Job" ("creditsHeld");

-- CreditTransaction: idempotency key unique constraint
-- (table already exists from earlier migration — add constraint if missing)
ALTER TABLE "CreditTransaction"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CreditTransaction_idempotencyKey_key"
  ON "CreditTransaction" ("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

