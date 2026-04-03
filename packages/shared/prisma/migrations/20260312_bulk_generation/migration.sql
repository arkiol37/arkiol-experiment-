-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: Bulk Generation — BatchJob + BatchJobItem tables
-- ══════════════════════════════════════════════════════════════════════════════

-- Add BATCH_GENERATE to JobType enum
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'BATCH_GENERATE';

-- BatchJob — one row per bulk generation request
CREATE TABLE IF NOT EXISTS "batch_jobs" (
  "id"              TEXT         NOT NULL,
  "orgId"           TEXT         NOT NULL,
  "userId"          TEXT         NOT NULL,
  "status"          TEXT         NOT NULL DEFAULT 'PENDING',
  "totalJobs"       INTEGER      NOT NULL,
  "completedJobs"   INTEGER      NOT NULL DEFAULT 0,
  "failedJobs"      INTEGER      NOT NULL DEFAULT 0,
  "cancelledJobs"   INTEGER      NOT NULL DEFAULT 0,
  "totalCreditCost" INTEGER      NOT NULL DEFAULT 0,
  "startedAt"       TIMESTAMP(3),
  "completedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "batch_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_jobs_orgId_fkey"  FOREIGN KEY ("orgId")  REFERENCES "Org"("id")  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "batch_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "batch_jobs_orgId_idx"    ON "batch_jobs"("orgId");
CREATE INDEX IF NOT EXISTS "batch_jobs_userId_idx"   ON "batch_jobs"("userId");
CREATE INDEX IF NOT EXISTS "batch_jobs_status_idx"   ON "batch_jobs"("status");
CREATE INDEX IF NOT EXISTS "batch_jobs_createdAt_idx" ON "batch_jobs"("createdAt");

-- BatchJobItem — junction: BatchJob ↔ Job
CREATE TABLE IF NOT EXISTS "batch_job_items" (
  "id"        TEXT         NOT NULL,
  "batchId"   TEXT         NOT NULL,
  "jobId"     TEXT         NOT NULL,
  "promptIdx" INTEGER      NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "batch_job_items_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "batch_job_items_jobId_key" UNIQUE ("jobId"),
  CONSTRAINT "batch_job_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batch_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "batch_job_items_batchId_idx" ON "batch_job_items"("batchId");
CREATE INDEX IF NOT EXISTS "batch_job_items_jobId_idx"   ON "batch_job_items"("jobId");
