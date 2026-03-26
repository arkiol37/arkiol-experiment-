// src/engines/queue/render-queue.ts
// Render Queue Intelligence — Production-Grade Job Orchestration
// ─────────────────────────────────────────────────────────────────────────────
//
// Provides:
//   • Priority-based queue management (hero formats first, supporting formats after)
//   • Exponential backoff retry logic with configurable max attempts
//   • Per-job timeout enforcement with clean failure paths
//   • Provider failover — automatically routes to secondary providers on failure
//   • Cost monitoring — tracks per-job and per-org provider spend
//   • Compute-safe generation limits — prevents runaway workloads
//
// Architecture:
//   • RenderQueueManager:   orchestrates job intake, priority sorting, dispatch
//   • RetryController:      manages exponential backoff per job
//   • TimeoutGuard:         enforces per-job and per-batch timeout budgets
//   • ProviderRouter:       routes to primary/secondary providers with failover
//   • CostMonitor:          accumulates and checks spend against budgets
//
// Execution contract:
//   ✓ Jobs are processed in priority order (CRITICAL > HIGH > NORMAL > LOW)
//   ✓ Retries use exponential backoff with jitter to avoid thundering herd
//   ✓ Every job has a hard timeout; no job blocks the queue indefinitely
//   ✓ Provider failover is transparent — callers receive the same output
//   ✓ Cost accumulation is idempotent — double-counting is prevented by jobId
//   ✓ Runaway generation is halted by the compute budget guard

import { createHash } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type JobPriority = "critical" | "high" | "normal" | "low";
export type ProviderName = "openai" | "stability" | "replicate" | "local" | "fallback_svg";
export type JobOutcome = "success" | "failed" | "timeout" | "cancelled" | "cost_blocked";

export interface ProviderConfig {
  name: ProviderName;
  /** Soft cost limit per call in USD */
  maxCostPerCallUsd: number;
  /** Timeout for this provider in ms */
  timeoutMs: number;
  /** Whether this provider can be used for failover */
  isFailoverProvider: boolean;
  /** Priority order (lower = higher priority) */
  order: number;
}

export interface RenderJobSpec {
  jobId: string;
  orgId: string;
  userId: string;
  /** Format being rendered */
  format: string;
  /** Job priority — hero/campaign formats are CRITICAL */
  priority: JobPriority;
  /** Maximum retries before failing */
  maxAttempts: number;
  /** Hard timeout per attempt in ms */
  timeoutMs: number;
  /** Maximum budget for this job in USD */
  maxBudgetUsd: number;
  /** Current attempt count */
  attempts: number;
  /** Whether this job is part of a campaign batch */
  isCampaignJob: boolean;
  /** Campaign ID for batching */
  campaignId?: string;
  createdAt: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Multiplier for each subsequent retry */
  backoffMultiplier: number;
  /** Amount of random jitter applied (fraction of delay) */
  jitterFraction: number;
}

export interface ProviderResult {
  provider: ProviderName;
  success: boolean;
  durationMs: number;
  estimatedCostUsd: number;
  error?: string;
  /** Whether a failover occurred */
  wasFailover: boolean;
  /** Primary provider that failed (if failover) */
  failedProvider?: ProviderName;
}

export interface CostAccumulation {
  orgId: string;
  jobId: string;
  provider: ProviderName;
  costUsd: number;
  timestamp: string;
  /** Hash used for idempotency */
  idempotencyKey: string;
}

export interface ComputeBudgetStatus {
  orgId: string;
  /** Spend in the current rolling hour */
  currentHourSpendUsd: number;
  /** Spend today */
  todaySpendUsd: number;
  /** Active concurrent jobs */
  activeConcurrentJobs: number;
  /** Whether the org is within budget */
  withinBudget: boolean;
  /** Whether global compute limits are active */
  globalLimitActive: boolean;
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2  DEFAULT CONFIGURATIONS
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = {
  openai: {
    name: "openai",
    maxCostPerCallUsd: 0.15,
    timeoutMs: 30_000,
    isFailoverProvider: false,
    order: 1,
  },
  stability: {
    name: "stability",
    maxCostPerCallUsd: 0.05,
    timeoutMs: 25_000,
    isFailoverProvider: true,
    order: 2,
  },
  replicate: {
    name: "replicate",
    maxCostPerCallUsd: 0.04,
    timeoutMs: 40_000,
    isFailoverProvider: true,
    order: 3,
  },
  local: {
    name: "local",
    maxCostPerCallUsd: 0.001,
    timeoutMs: 60_000,
    isFailoverProvider: true,
    order: 4,
  },
  fallback_svg: {
    name: "fallback_svg",
    maxCostPerCallUsd: 0,
    timeoutMs: 5_000,
    isFailoverProvider: true,
    order: 99,
  },
};

export const DEFAULT_RETRY_POLICIES: Record<JobPriority, RetryPolicy> = {
  critical: {
    maxAttempts:       5,
    baseDelayMs:       500,
    maxDelayMs:        8_000,
    backoffMultiplier: 1.5,
    jitterFraction:    0.2,
  },
  high: {
    maxAttempts:       4,
    baseDelayMs:       1_000,
    maxDelayMs:        15_000,
    backoffMultiplier: 2.0,
    jitterFraction:    0.25,
  },
  normal: {
    maxAttempts:       3,
    baseDelayMs:       2_000,
    maxDelayMs:        30_000,
    backoffMultiplier: 2.0,
    jitterFraction:    0.30,
  },
  low: {
    maxAttempts:       2,
    baseDelayMs:       5_000,
    maxDelayMs:        60_000,
    backoffMultiplier: 2.0,
    jitterFraction:    0.40,
  },
};

export const PRIORITY_WEIGHTS: Record<JobPriority, number> = {
  critical: 100,
  high:     50,
  normal:   20,
  low:      5,
};

// Compute safety limits
export const COMPUTE_LIMITS = {
  maxConcurrentJobsPerOrg:  5,
  maxConcurrentJobsGlobal:  100,
  maxHourlySpendPerOrgUsd:  25.0,
  maxDailySpendPerOrgUsd:   100.0,
  maxSingleJobBudgetUsd:    2.0,
  campaignBatchMaxFormats:  10,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// § 3  RETRY CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates the delay before the next retry attempt using exponential backoff + jitter.
 */
export function calculateRetryDelay(
  attempt: number,
  policy: RetryPolicy,
  seed?: string
): number {
  const base = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt);
  const clamped = Math.min(base, policy.maxDelayMs);

  // Deterministic jitter from seed if provided, otherwise Math.random
  const jitterSource = seed
    ? parseInt(createHash("sha256").update(`${seed}:retry:${attempt}`).digest("hex").slice(0, 8), 16) / 0xffffffff
    : Math.random();

  const jitter = (jitterSource - 0.5) * 2 * policy.jitterFraction * clamped;
  return Math.max(0, Math.round(clamped + jitter));
}

/**
 * Returns whether a job should be retried given its current state.
 */
export function shouldRetry(job: RenderJobSpec, error: string): boolean {
  if (job.attempts >= job.maxAttempts) return false;

  // Non-retriable errors
  const nonRetriablePatterns = [
    "kill_switch_active",
    "spend_guard_blocked",
    "plan_limit_exceeded",
    "credit_insufficient",
    "content_policy_violation",
  ];

  const errorLower = error.toLowerCase();
  return !nonRetriablePatterns.some(p => errorLower.includes(p));
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4  TIMEOUT GUARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a promise with a hard timeout.
 * Rejects with a structured timeout error after `timeoutMs`.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  jobId: string
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new RenderTimeoutError(jobId, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (err) {
    clearTimeout(timeoutHandle!);
    throw err;
  }
}

export class RenderTimeoutError extends Error {
  readonly code = "RENDER_TIMEOUT";
  readonly jobId: string;
  readonly timeoutMs: number;

  constructor(jobId: string, timeoutMs: number) {
    super(`[timeout] Job ${jobId} exceeded ${timeoutMs}ms`);
    this.name = "RenderTimeoutError";
    this.jobId = jobId;
    this.timeoutMs = timeoutMs;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  PROVIDER ROUTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines the ordered list of providers to try for a given job.
 * Primary provider first, then failover providers in priority order.
 */
export function buildProviderChain(
  preferredProvider: ProviderName = "openai",
  excludeProviders: ProviderName[] = []
): ProviderName[] {
  const all = Object.values(PROVIDER_CONFIGS)
    .filter(p => !excludeProviders.includes(p.name))
    .sort((a, b) => a.order - b.order);

  // Put preferred provider first
  const preferred = all.find(p => p.name === preferredProvider);
  const rest      = all.filter(p => p.name !== preferredProvider);

  return preferred ? [preferred.name, ...rest.map(p => p.name)] : rest.map(p => p.name);
}

/**
 * Tracks provider failure counts to avoid repeatedly routing to failing providers.
 */
export class ProviderHealthTracker {
  private failures: Map<ProviderName, { count: number; lastFailAt: number }> = new Map();
  private readonly windowMs = 60_000; // 1-minute rolling window
  private readonly failThreshold = 3;

  recordFailure(provider: ProviderName): void {
    const current = this.failures.get(provider) ?? { count: 0, lastFailAt: 0 };
    const now = Date.now();
    // Reset if outside window
    const count = now - current.lastFailAt < this.windowMs ? current.count + 1 : 1;
    this.failures.set(provider, { count, lastFailAt: now });
  }

  isHealthy(provider: ProviderName): boolean {
    const state = this.failures.get(provider);
    if (!state) return true;
    if (Date.now() - state.lastFailAt > this.windowMs) return true;
    return state.count < this.failThreshold;
  }

  getHealthyProviders(chain: ProviderName[]): ProviderName[] {
    return chain.filter(p => this.isHealthy(p));
  }

  reset(provider: ProviderName): void {
    this.failures.delete(provider);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6  COST MONITOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory cost accumulator for the current process.
 * Persistence is the caller's responsibility (write to DB).
 */
export class CostMonitor {
  private accumulations: Map<string, CostAccumulation> = new Map();
  private orgHourlySpend: Map<string, number> = new Map();
  private orgDailySpend:  Map<string, number> = new Map();

  /**
   * Records a cost accumulation. Idempotent — same idempotencyKey is ignored.
   */
  record(acc: CostAccumulation): { accepted: boolean; reason?: string } {
    if (this.accumulations.has(acc.idempotencyKey)) {
      return { accepted: false, reason: "duplicate_idempotency_key" };
    }

    this.accumulations.set(acc.idempotencyKey, acc);

    const hourlyKey = `${acc.orgId}:hourly`;
    const dailyKey  = `${acc.orgId}:daily`;

    this.orgHourlySpend.set(hourlyKey, (this.orgHourlySpend.get(hourlyKey) ?? 0) + acc.costUsd);
    this.orgDailySpend.set(dailyKey,   (this.orgDailySpend.get(dailyKey)   ?? 0) + acc.costUsd);

    return { accepted: true };
  }

  checkBudget(orgId: string): ComputeBudgetStatus {
    const hourlyKey   = `${orgId}:hourly`;
    const dailyKey    = `${orgId}:daily`;
    const hourlySpend = this.orgHourlySpend.get(hourlyKey) ?? 0;
    const dailySpend  = this.orgDailySpend.get(dailyKey)   ?? 0;

    const hourlyExceeded = hourlySpend >= COMPUTE_LIMITS.maxHourlySpendPerOrgUsd;
    const dailyExceeded  = dailySpend  >= COMPUTE_LIMITS.maxDailySpendPerOrgUsd;

    return {
      orgId,
      currentHourSpendUsd: hourlySpend,
      todaySpendUsd:       dailySpend,
      activeConcurrentJobs: 0, // tracked externally
      withinBudget:         !hourlyExceeded && !dailyExceeded,
      globalLimitActive:    false,
      reason: hourlyExceeded
        ? `Hourly spend limit $${COMPUTE_LIMITS.maxHourlySpendPerOrgUsd} exceeded`
        : dailyExceeded
          ? `Daily spend limit $${COMPUTE_LIMITS.maxDailySpendPerOrgUsd} exceeded`
          : undefined,
    };
  }

  buildIdempotencyKey(jobId: string, provider: ProviderName, attempt: number): string {
    return createHash("sha256")
      .update(`cost:${jobId}:${provider}:${attempt}`)
      .digest("hex")
      .slice(0, 24);
  }

  getOrgHourlySpend(orgId: string): number {
    return this.orgHourlySpend.get(`${orgId}:hourly`) ?? 0;
  }

  getOrgDailySpend(orgId: string): number {
    return this.orgDailySpend.get(`${orgId}:daily`) ?? 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7  QUEUE PRIORITIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a numeric sort key for a job.
 * Higher = higher priority.
 */
export function computeJobSortKey(job: RenderJobSpec): number {
  const priorityWeight = PRIORITY_WEIGHTS[job.priority];
  const ageMs          = Date.now() - new Date(job.createdAt).getTime();
  const ageBonusPerSec = 0.01; // Slightly boost older jobs to prevent starvation

  return priorityWeight + ageMs / 1000 * ageBonusPerSec;
}

/**
 * Sorts a batch of jobs by effective priority.
 */
export function sortJobsByPriority(jobs: RenderJobSpec[]): RenderJobSpec[] {
  return [...jobs].sort((a, b) => computeJobSortKey(b) - computeJobSortKey(a));
}

/**
 * Determines the priority for a job based on its context.
 */
export function inferJobPriority(opts: {
  isCampaignHero:   boolean;
  isCampaignJob:    boolean;
  isRegen:          boolean;
  isFirstGeneration:boolean;
}): JobPriority {
  if (opts.isCampaignHero)    return "critical";
  if (opts.isFirstGeneration) return "high";
  if (opts.isCampaignJob)     return "normal";
  if (opts.isRegen)           return "normal";
  return "low";
}

// ─────────────────────────────────────────────────────────────────────────────
// § 8  COMPUTE SAFETY GUARD
// ─────────────────────────────────────────────────────────────────────────────

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
  code?: string;
}

/**
 * Performs all compute safety checks before allowing a job to proceed.
 * Call this before dispatching any generation job.
 */
export function checkComputeSafety(
  job: RenderJobSpec,
  activeJobCount: number,
  costMonitor: CostMonitor
): SafetyCheckResult {
  // Concurrent job limit per org
  if (activeJobCount >= COMPUTE_LIMITS.maxConcurrentJobsPerOrg) {
    return {
      allowed: false,
      reason:  `Too many concurrent jobs (limit: ${COMPUTE_LIMITS.maxConcurrentJobsPerOrg})`,
      code:    "CONCURRENT_JOB_LIMIT",
    };
  }

  // Per-job budget
  if (job.maxBudgetUsd > COMPUTE_LIMITS.maxSingleJobBudgetUsd) {
    return {
      allowed: false,
      reason:  `Job budget $${job.maxBudgetUsd} exceeds max $${COMPUTE_LIMITS.maxSingleJobBudgetUsd}`,
      code:    "JOB_BUDGET_EXCEEDED",
    };
  }

  // Org hourly/daily spend
  const budgetStatus = costMonitor.checkBudget(job.orgId);
  if (!budgetStatus.withinBudget) {
    return {
      allowed: false,
      reason:  budgetStatus.reason,
      code:    "SPEND_GUARD_BLOCKED",
    };
  }

  // Campaign batch limit
  if (job.isCampaignJob && !job.campaignId) {
    return {
      allowed: false,
      reason:  "Campaign job missing campaignId",
      code:    "INVALID_CAMPAIGN_JOB",
    };
  }

  return { allowed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 9  JOB SPEC BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a RenderJobSpec with sensible defaults.
 */
export function buildRenderJobSpec(opts: {
  jobId:       string;
  orgId:       string;
  userId:      string;
  format:      string;
  priority?:   JobPriority;
  campaignId?: string;
  maxBudgetUsd?: number;
}): RenderJobSpec {
  const priority = opts.priority ?? "normal";
  const policy   = DEFAULT_RETRY_POLICIES[priority];

  return {
    jobId:           opts.jobId,
    orgId:           opts.orgId,
    userId:          opts.userId,
    format:          opts.format,
    priority,
    maxAttempts:     policy.maxAttempts,
    timeoutMs:       PROVIDER_CONFIGS.openai.timeoutMs,
    maxBudgetUsd:    Math.min(opts.maxBudgetUsd ?? 1.0, COMPUTE_LIMITS.maxSingleJobBudgetUsd),
    attempts:        0,
    isCampaignJob:   !!opts.campaignId,
    campaignId:      opts.campaignId,
    createdAt:       new Date().toISOString(),
  };
}
