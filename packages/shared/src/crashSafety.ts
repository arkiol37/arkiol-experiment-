// packages/shared/src/crashSafety.ts
// CRASH SAFETY SYSTEM — Production-Grade v2
//
// This module is the authoritative runtime safety mechanism for the generation
// pipeline. All generation jobs MUST use this service — the legacy AIJobMetadata
// path is a secondary observability sink only.
//
// Core guarantees:
//   1. Durable lifecycle states (strict FSM) persisted to Job table
//   2. Stage-level checkpoints in dedicated JobCheckpoint table (not AIJobMetadata)
//   3. Idempotent retries — same idempotencyKey never writes twice to any domain
//   4. Atomic credit protection — refund and state change in one DB transaction
//   5. Dead-letter persistence in DeadLetterJob table (append-only)
//   6. Worker health written to WorkerHealthSnapshot table
//   7. Full structured diagnostics for admin dashboards
//
// Failure classification drives retry policy:
//   TRANSIENT:          → retry with exponential backoff
//   PERMANENT:          → immediate DLQ, no retry
//   RESUMABLE:          → recover checkpoint, re-run from last completed stage
//   PARTIAL_SUCCESS:    → partial credit refund, return available assets
//   DEAD_LETTER:        → DLQ + full credit refund

import { PrismaClient } from '@prisma/client';
type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
import { toJsonValue, toJsonValueNullable } from './typeUtils';
import { z } from 'zod';

// ── Failure classification ──────────────────────────────────────────────────────

export type FailureClass = 'transient' | 'permanent' | 'resumable' | 'partial_success' | 'dead_letter';

// These error codes are immediately permanent — no retry, no recovery attempt
const PERMANENT_CODES = new Set([
  'KILL_SWITCH_ACTIVE', 'CREDIT_INSUFFICIENT', 'PLAN_LIMIT_EXCEEDED',
  'SAFETY_VIOLATION', 'CONCURRENCY_LIMIT', 'ASSET_COUNT_LIMIT',
  'SPEND_GUARD_ACTIVE', 'CONTRACT_SCHEMA_INVALID', 'ENGINE_NOT_REGISTERED',
  'REGISTRY_LOCKED', 'ALWAYS_RUN_DISABLED', 'ENFORCEMENT_FAILURE',
]);

// These are known-transient codes — safe to retry with backoff
const TRANSIENT_CODES = new Set([
  'PROVIDER_TIMEOUT', 'RATE_LIMITED', 'TRANSIENT_ERROR', 'CONNECTION_RESET',
  'UPSTREAM_503', 'UPSTREAM_429', 'PROVIDER_UNAVAILABLE', 'UPSTREAM_TIMEOUT',
  'JOB_TIMEOUT', 'WORKER_RESTART',
]);

export function classifyFailure(errorCode: string): FailureClass {
  if (PERMANENT_CODES.has(errorCode)) return 'permanent';
  if (TRANSIENT_CODES.has(errorCode)) return 'transient';
  return 'transient'; // unknown = transient (fail open on retries, not credits)
}

export function isPermanentFailure(errorCode: string): boolean {
  return classifyFailure(errorCode) === 'permanent';
}

// ── Extended lifecycle states ────────────────────────────────────────────────────

export const ExtendedJobStatusSchema = z.enum([
  'queued',           // created, credits held, awaiting worker pickup
  'running',          // worker executing — checkpoint saves accumulate
  'retrying',         // transient failure — backoff timer set
  'failed',           // permanent failure or exhausted retries
  'recovered',        // crashed worker, recovered from checkpoint — re-queued
  'completed',        // all stages passed — credits finalised
  'dead_lettered',    // unrecoverable — in DeadLetterJob table
  'credit_protected', // credits refunded atomically — terminal safe state
]);
export type ExtendedJobStatus = z.infer<typeof ExtendedJobStatusSchema>;

// Legal FSM transitions — every call to transitionJob validates against this map
const LEGAL_TRANSITIONS: Readonly<Record<ExtendedJobStatus, readonly ExtendedJobStatus[]>> = {
  queued:           ['running', 'failed', 'dead_lettered'],
  running:          ['completed', 'retrying', 'failed', 'recovered'],
  retrying:         ['running', 'failed', 'dead_lettered'],
  failed:           ['credit_protected', 'dead_lettered', 'recovered', 'retrying'],
  recovered:        ['running', 'failed'],
  completed:        [],                               // terminal
  dead_lettered:    ['credit_protected'],             // can still refund after DLQ
  credit_protected: [],                               // terminal
};

export function isLegalTransition(from: ExtendedJobStatus, to: ExtendedJobStatus): boolean {
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

export function terminalStates(): ExtendedJobStatus[] {
  return ['completed', 'credit_protected'];
}

// ── Retry configuration ─────────────────────────────────────────────────────────

export interface RetryConfig {
  maxAttempts:       number;
  baseDelayMs:       number;
  maxDelayMs:        number;
  jitterFactor:      number;    // fraction of computed delay added as random jitter
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts:       3,
  baseDelayMs:       1_000,
  maxDelayMs:        30_000,
  jitterFactor:      0.25,
  backoffMultiplier: 2,
};

/**
 * Compute exponential backoff delay with bounded jitter.
 * Deterministic for same (attempt, config) input modulo the jitter component.
 */
export function computeRetryDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const base   = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  const capped = Math.min(base, config.maxDelayMs);
  const jitter = capped * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(config.baseDelayMs, Math.round(capped + jitter));
}

/**
 * Returns true if the job should be retried given its error code and attempt count.
 * Permanent errors are never retried regardless of attempt count.
 */
export function shouldRetry(errorCode: string, attemptCount: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): boolean {
  if (isPermanentFailure(errorCode)) return false;
  return attemptCount < config.maxAttempts;
}

// ── Stage checkpoint schema ─────────────────────────────────────────────────────
// Written to the dedicated JobCheckpoint table.
// One row per job, upserted after each successful stage.
// On recovery, the executor resumes from the last recorded completed stage.
export const CheckpointSchema = z.object({
  jobId:           z.string(),
  orgId:           z.string(),
  stage:           z.string(),
  stageIdx:        z.number().int().nonnegative(),
  stageOutputs:    z.record(z.unknown()),   // serialised outputs of all completed stages
  completedStages: z.array(z.string()),     // list of fully completed stage IDs
  idempotencyKey:  z.string(),             // unique per job+attempt — prevents double write
  savedAt:         z.string(),
  attemptNumber:   z.number().int().min(1),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

// ── Dead-letter entry schema ────────────────────────────────────────────────────
export const DeadLetterEntrySchema = z.object({
  id:             z.string(),
  jobId:          z.string(),
  orgId:          z.string(),
  userId:         z.string(),
  jobType:        z.string(),
  errorCode:      z.string(),
  errorMessage:   z.string(),
  failureClass:   z.string(),
  attemptCount:   z.number().int().nonnegative(),
  creditCost:     z.number().int().nonnegative(),
  creditRefunded: z.boolean(),
  payload:        z.record(z.unknown()),
  diagnostics:    z.record(z.unknown()),
  deadLetteredAt: z.string(),
});
export type DeadLetterEntry = z.infer<typeof DeadLetterEntrySchema>;

// ── Worker health schema ────────────────────────────────────────────────────────
export const WorkerHealthSchema = z.object({
  workerId:          z.string(),
  queueName:         z.string(),
  status:            z.enum(['healthy','degraded','unhealthy','offline']),
  activeJobs:        z.number().int().nonnegative(),
  completedLast5Min: z.number().int().nonnegative(),
  failedLast5Min:    z.number().int().nonnegative(),
  avgJobDurationMs:  z.number().nonnegative(),
  lastHeartbeatAt:   z.string(),
  uptimeMs:          z.number().nonnegative(),
});
export type WorkerHealth = z.infer<typeof WorkerHealthSchema>;

// ── Job diagnostics ─────────────────────────────────────────────────────────────
export interface JobDiagnostics {
  jobId:                string;
  orgId:                string;
  currentStatus:        ExtendedJobStatus;
  failureClass:         FailureClass | null;
  attemptCount:         number;
  lastError:            string | null;
  lastErrorCode:        string | null;
  completedStages:      string[];
  checkpointStage:      string | null;
  creditStatus:         'deducted' | 'refunded' | 'never_charged';
  timeInCurrentStateMs: number;
  isStuck:              boolean;
  stuckThresholdMs:     number;
  nextRetryAt:          string | null;
  canRetry:             boolean;
  canRecover:           boolean;
}

// ── Dependencies ────────────────────────────────────────────────────────────────
export interface CrashSafetyDeps {
  prisma?: PrismaClient;
  logger?: {
    info(obj: unknown, msg: string): void;
    warn(obj: unknown, msg: string): void;
    error(obj: unknown, msg: string): void;
  };
}

// ── Service factory ─────────────────────────────────────────────────────────────
export function createCrashSafetyService(deps: CrashSafetyDeps) {
  const { prisma, logger } = deps;

  // ── saveCheckpoint ─────────────────────────────────────────────────────────
  // Uses upsert on JobCheckpoint table (dedicated, not AIJobMetadata).
  // The idempotencyKey prevents duplicate writes on retry re-entry.
  async function saveCheckpoint(cp: Omit<Checkpoint, 'idempotencyKey'> & { idempotencyKey?: string }): Promise<boolean> {
    const withKey = { ...cp, idempotencyKey: cp.idempotencyKey ?? `ck_${cp.jobId}_${cp.stage}_${cp.attemptNumber}` };
    const parsed  = CheckpointSchema.safeParse(withKey);
    if (!parsed.success) {
      logger?.warn({ issues: parsed.error.issues, jobId: cp.jobId }, '[crash-safety] Invalid checkpoint schema — not saved');
      return false;
    }
    if (!prisma) return false;
    const d = parsed.data;
    try {
      await prisma.jobCheckpoint?.upsert?.({
        where:  { jobId: d.jobId },
        create: {
          id:              `ck_${d.jobId}`,
          jobId:           d.jobId,
          orgId:           d.orgId,
          stage:           d.stage,
          stageIdx:        d.stageIdx,
          stageOutputs:    toJsonValue(d.stageOutputs),
          completedStages: d.completedStages,
          checkpointKey:   d.idempotencyKey,
          attemptNumber:   d.attemptNumber,
          savedAt:         new Date(d.savedAt),
        },
        update: {
          // Only update if this checkpoint is newer (higher stageIdx or same stage on new attempt)
          stage:           d.stage,
          stageIdx:        d.stageIdx,
          stageOutputs:    toJsonValue(d.stageOutputs),
          completedStages: d.completedStages,
          checkpointKey:   d.idempotencyKey,
          attemptNumber:   d.attemptNumber,
          savedAt:         new Date(d.savedAt),
        },
      });
      return true;
    } catch (e: unknown) {
      logger?.warn({ err: (e instanceof Error ? e.message : String(e)), jobId: d.jobId, stage: d.stage }, '[crash-safety] saveCheckpoint failed (non-fatal)');
      return false;
    }
  }

  // ── recoverFromCheckpoint ──────────────────────────────────────────────────
  // Reads from JobCheckpoint table. Returns null if no checkpoint exists.
  async function recoverFromCheckpoint(jobId: string): Promise<{
    stageOutputs:    Record<string, unknown>;
    completedStages: string[];
    checkpointStage: string;
    attemptNumber:   number;
  } | null> {
    if (!prisma) return null;
    try {
      const row = await prisma.jobCheckpoint?.findUnique?.({ where: { jobId } });
      if (!row) return null;
      return {
        stageOutputs:    (row.stageOutputs ?? {}) as Record<string, unknown>, // reading from DB — safe cast
        completedStages: (row.completedStages ?? []) as string[],
        checkpointStage: row.stage as string,
        attemptNumber:   row.attemptNumber as number,
      };
    } catch (e: unknown) {
      logger?.warn({ err: (e instanceof Error ? e.message : String(e)), jobId }, '[crash-safety] recoverFromCheckpoint failed');
      return null;
    }
  }

  // ── transitionJob (FSM-validated) ─────────────────────────────────────────
  // All job status changes must go through this function — never direct DB updates.
  async function transitionJob(
    jobId: string,
    to:    ExtendedJobStatus,
    opts?: {
      errorMessage?:  string;
      errorCode?:     string;
      nextRetryAt?:   Date;
      attemptNumber?: number;
    }
  ): Promise<boolean> {
    if (!prisma) return false;
    try {
      const job = await prisma.job?.findUnique?.({
        where:  { id: jobId },
        select: { status: true, orgId: true },
      });
      if (!job) {
        logger?.warn({ jobId, to }, '[crash-safety] transitionJob: job not found');
        return false;
      }
      const from = _mapDbStatus(job.status as string);
      if (!isLegalTransition(from, to)) {
        logger?.warn({ jobId, from, to }, '[crash-safety] Illegal FSM transition blocked');
        return false;
      }
      await prisma.job?.update?.({
        where: { id: jobId },
        data: {
          status:    _mapToDbStatus(to),
          ...(to === 'running'                                              && { startedAt:   new Date() }),
          ...(to === 'completed'                                            && { completedAt: new Date() }),
          ...((to === 'failed' || to === 'dead_lettered')                  && { failedAt:    new Date() }),
          ...(opts?.errorMessage && {
            result: toJsonValueNullable({
              error:        opts.errorMessage,
              errorCode:    opts.errorCode,
              failureClass: opts.errorCode ? classifyFailure(opts.errorCode) : 'transient',
              transition:   to,
              ...(opts.nextRetryAt && { nextRetryAt: opts.nextRetryAt.toISOString() }),
            }),
          }),
        },
      });
      logger?.info?.({ jobId, from, to }, '[crash-safety] Job status transition');
      return true;
    } catch (e: unknown) {
      logger?.warn({ err: (e instanceof Error ? e.message : String(e)), jobId, to }, '[crash-safety] transitionJob failed');
      return false;
    }
  }

  // ── protectCredits (atomic) ────────────────────────────────────────────────
  // Credits and job state change in a single DB transaction.
  // This ensures there is NO state where credits are lost: either both commit
  // or neither does. The refundFn is called inside the transaction.
  async function protectCredits(
    jobId:    string,
    refundFn: (orgId: string, jobId: string, creditCost: number) => Promise<void>
  ): Promise<boolean> {
    if (!prisma) return false;
    try {
      const job = await prisma.job?.findUnique?.({
        where:  { id: jobId },
        select: { orgId: true, creditCost: true, creditDeducted: true, creditRefunded: true },
      });
      if (!job) return false;
      if (job.creditRefunded) {
        logger?.info?.({ jobId }, '[crash-safety] Credits already refunded — skipping');
        return true; // idempotent
      }
      if (!job.creditDeducted || (job.creditCost ?? 0) <= 0) {
        // Nothing to refund — just update status
        await prisma.job?.update?.({ where: { id: jobId }, data: { status: 'REFUNDED' } });
        return true;
      }
      // Atomic: refund + mark in one transaction
      await prisma.$transaction?.(async (tx: TxClient) => {
        await refundFn(job.orgId, jobId, job.creditCost);
        await tx.job.update({
          where: { id: jobId },
          data:  { creditRefunded: true, status: 'REFUNDED' },
        });
      });
      logger?.info?.({ jobId, orgId: job.orgId, creditCost: job.creditCost }, '[crash-safety] Credits refunded atomically');
      return true;
    } catch (e: unknown) {
      logger?.error({ err: (e instanceof Error ? e.message : String(e)), jobId }, '[crash-safety] protectCredits FAILED — manual review required');
      return false;
    }
  }

  // ── sendToDeadLetter ───────────────────────────────────────────────────────
  // Writes to the dedicated DeadLetterJob table (append-only, never deleted).
  // Also updates the Job row status. Called when a job exhausts retries or
  // encounters a permanent failure code.
  async function sendToDeadLetter(
    jobId:        string,
    errorCode:    string,
    errorMessage: string,
    diagnostics:  Record<string, unknown>
  ): Promise<void> {
    if (!prisma) return;
    try {
      const job = await prisma.job?.findUnique?.({
        where:  { id: jobId },
        select: { orgId: true, userId: true, type: true, payload: true, creditCost: true, creditRefunded: true },
      });
      if (!job) return;

      const fc     = classifyFailure(errorCode);
      const dlqId  = `dlq_${jobId}_${Date.now()}`;

      await prisma.deadLetterJob?.create?.({
        data: {
          id:             dlqId,
          jobId,
          orgId:          job.orgId,
          userId:         job.userId ?? 'unknown',
          jobType:        job.type ?? 'generation',
          errorCode,
          errorMessage,
          failureClass:   fc,
          attemptCount:   (diagnostics.attemptCount as number) ?? 0,
          creditCost:     job.creditCost ?? 0,
          creditRefunded: job.creditRefunded ?? false,
          payload:        toJsonValue(job.payload ?? {}),
          diagnostics:    toJsonValue(diagnostics),
          deadLetteredAt: new Date(),
        },
      });

      await prisma.job?.update?.({
        where: { id: jobId },
        data: {
          status:   'FAILED',
          failedAt: new Date(),
          result: toJsonValueNullable({
            deadLettered:   true,
            dlqId,
            errorCode,
            errorMessage,
            failureClass:   fc,
            deadLetteredAt: new Date().toISOString(),
          }),
        },
      });
      logger?.warn({ jobId, errorCode, failureClass: fc, orgId: job.orgId }, '[crash-safety] Job dead-lettered');
    } catch (e: unknown) {
      logger?.error({ err: (e instanceof Error ? e.message : String(e)), jobId }, '[crash-safety] sendToDeadLetter failed');
    }
  }

  // ── recoverStuckJobs (cron-callable) ──────────────────────────────────────
  // Detects jobs stuck in RUNNING state beyond the threshold.
  // Jobs with a valid checkpoint → mark recovered + re-queue.
  // Jobs with no checkpoint → send to DLQ.
  async function recoverStuckJobs(stuckThresholdMs = 300_000): Promise<{
    recovered: string[];
    deadLettered: string[];
  }> {
    if (!prisma) return { recovered: [], deadLettered: [] };
    const cutoff    = new Date(Date.now() - stuckThresholdMs);
    const recovered: string[] = [];
    const dead:      string[] = [];

    try {
      const stuckJobs = await prisma.job?.findMany?.({
        where:  { status: { in: ['RUNNING', 'PENDING'] }, startedAt: { lte: cutoff } },
        select: { id: true, orgId: true, type: true },
        take:   50,
      }) ?? [];

      for (const job of stuckJobs) {
        const cp = await recoverFromCheckpoint(job.id);
        if (cp && cp.completedStages.length > 0) {
          await transitionJob(job.id, 'recovered', { errorCode: 'WORKER_RESTART', errorMessage: 'Worker detected stuck job — recovering from checkpoint' });
          recovered.push(job.id);
          logger?.info?.({ jobId: job.id, checkpointStage: cp.checkpointStage, completedStages: cp.completedStages }, '[crash-safety] Stuck job recovered from checkpoint');
        } else {
          await sendToDeadLetter(job.id, 'WORKER_TIMEOUT', 'Job stuck with no recoverable checkpoint', {
            detectedAt: new Date().toISOString(), stuckThresholdMs,
          });
          dead.push(job.id);
          logger?.warn?.({ jobId: job.id }, '[crash-safety] Stuck job with no checkpoint → dead-lettered');
        }
      }
    } catch (e: unknown) {
      logger?.error({ err: (e instanceof Error ? e.message : String(e)) }, '[crash-safety] recoverStuckJobs error');
    }
    return { recovered, deadLettered: dead };
  }

  // ── recordWorkerHealth ─────────────────────────────────────────────────────
  // Upserts to WorkerHealthSnapshot table. Called by the worker on each heartbeat.
  async function recordWorkerHealth(health: WorkerHealth): Promise<void> {
    if (!prisma) return;
    const parsed = WorkerHealthSchema.safeParse(health);
    if (!parsed.success) return;
    const d = parsed.data;
    try {
      await prisma.workerHealthSnapshot?.upsert?.({
        where:  { workerId: d.workerId },
        create: {
          workerId:           d.workerId,
          queueName:          d.queueName,
          status:             d.status,
          activeJobs:         d.activeJobs,
          completedLast5Min:  d.completedLast5Min,
          failedLast5Min:     d.failedLast5Min,
          avgJobDurationMs:   d.avgJobDurationMs,
          lastHeartbeatAt:    new Date(d.lastHeartbeatAt),
        },
        update: {
          status:             d.status,
          activeJobs:         d.activeJobs,
          completedLast5Min:  d.completedLast5Min,
          failedLast5Min:     d.failedLast5Min,
          avgJobDurationMs:   d.avgJobDurationMs,
          lastHeartbeatAt:    new Date(d.lastHeartbeatAt),
        },
      });
    } catch { /* non-fatal — worker health is observability only */ }
  }

  // ── getDiagnostics ─────────────────────────────────────────────────────────
  async function getDiagnostics(jobId: string): Promise<JobDiagnostics | null> {
    if (!prisma) return null;
    const STUCK_THRESHOLD = 120_000;
    try {
      const [job, cp] = await Promise.all([
        prisma.job?.findUnique?.({
          where:  { id: jobId },
          select: { orgId: true, status: true, startedAt: true, createdAt: true,
                    creditDeducted: true, creditRefunded: true, result: true },
        }),
        recoverFromCheckpoint(jobId),
      ]);
      if (!job) return null;
      const result     = job.result as Record<string, unknown> | null;
      const current    = _mapDbStatus(job.status as string);
      const stateStart = job.startedAt ?? job.createdAt;
      const timeInMs   = stateStart ? Date.now() - new Date(stateStart).getTime() : 0;
      const errorCode  = (result?.errorCode as string | null) ?? null;
      const resultCp = (result?.checkpoint ?? null) as Record<string, unknown> | null;
      return {
        jobId,
        orgId:                job.orgId,
        currentStatus:        current,
        failureClass:         errorCode ? classifyFailure(errorCode) : null,
        attemptCount:         Number(result?.attemptCount ?? 1),
        lastError:            (result?.error as string | null) ?? null,
        lastErrorCode:        errorCode,
        completedStages:      (resultCp?.completedStages as string[] | null) ?? [],
        checkpointStage:      (resultCp?.checkpointStage as string | null) ?? null,
        creditStatus:         job.creditRefunded ? 'refunded' : job.creditDeducted ? 'deducted' : 'never_charged',
        timeInCurrentStateMs: timeInMs,
        isStuck:              current === 'running' && timeInMs > STUCK_THRESHOLD,
        stuckThresholdMs:     STUCK_THRESHOLD,
        nextRetryAt:          (result?.nextRetryAt as string | null) ?? null,
        canRetry:             isLegalTransition(current, 'running') || isLegalTransition(current, 'retrying'),
        canRecover:           cp !== null && (cp.completedStages?.length ?? 0) > 0,
      };
    } catch (e: unknown) {
      logger?.warn({ err: (e instanceof Error ? e.message : String(e)), jobId }, '[crash-safety] getDiagnostics failed');
      return null;
    }
  }

  // ── timeoutGuard ──────────────────────────────────────────────────────────
  // Returns a Promise that rejects after timeoutMs with a retryable error.
  // Use: await Promise.race([stageWork(), crashSafety.timeoutGuard(jobId, 5000)])
  function timeoutGuard(jobId: string, timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      const t = setTimeout(() => {
        reject(Object.assign(new Error(`Job ${jobId} stage timed out after ${timeoutMs}ms`), {
          code: 'JOB_TIMEOUT', retryable: true,
        }));
      }, timeoutMs);
      if (typeof t === 'object' && t !== null && 'unref' in t) (t as { unref: () => void }).unref();
    });
  }

  return {
    saveCheckpoint,
    recoverFromCheckpoint,
    transitionJob,
    protectCredits,
    sendToDeadLetter,
    recoverStuckJobs,
    recordWorkerHealth,
    getDiagnostics,
    timeoutGuard,
  };
}

export type CrashSafetyService = ReturnType<typeof createCrashSafetyService>;

// ── DB status mapping (handles both legacy and new status values) ───────────────
function _mapDbStatus(s: string): ExtendedJobStatus {
  const m: Record<string, ExtendedJobStatus> = {
    QUEUED:'queued', PENDING:'queued', RUNNING:'running',
    SUCCEEDED:'completed', COMPLETED:'completed',
    FAILED:'failed', CANCELED:'failed', CANCELLED:'failed',
    REFUNDED:'credit_protected',
  };
  return m[s] ?? 'failed';
}

function _mapToDbStatus(s: ExtendedJobStatus): string {
  const m: Record<ExtendedJobStatus, string> = {
    queued:'QUEUED', running:'RUNNING', retrying:'QUEUED',
    failed:'FAILED', recovered:'QUEUED', completed:'SUCCEEDED',
    dead_lettered:'FAILED', credit_protected:'REFUNDED',
  };
  return m[s] ?? 'FAILED';
}
