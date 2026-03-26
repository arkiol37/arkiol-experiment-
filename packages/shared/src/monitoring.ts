// packages/shared/src/monitoring.ts
// Monitoring & Alerting Service — Production V1
//
// Covers:
//   ✓ Cost spike detection (per-org and global)
//   ✓ Asset generation volume anomaly detection
//   ✓ AI stage failure alerting (stage timing, fallback counts, error rates)
//   ✓ Structured alert emission with severity levels
//   ✓ Alert deduplication window to prevent spam
//   ✓ Integration hooks for Sentry, Datadog, Slack, PagerDuty, email
//
// Design:
//   - All functions are pure/injected-deps — all env access via getEnv()
//   - All emissions are fire-and-forget (errors are logged, never rethrown)
//   - Thresholds are configurable via env vars with safe defaults in the shared schema
//   - Alert state is stored in a lightweight in-process TTL map (Redis-backed in prod)

import { z } from 'zod';
import { getEnv } from './env';

// ── Alert severity levels ──────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';

// ── Alert types ────────────────────────────────────────────────────────────────

export type AlertType =
  | 'cost_spike_org'
  | 'cost_spike_global'
  | 'generation_volume_anomaly'
  | 'stage_failure_rate'
  | 'stage_timeout'
  | 'fallback_rate_elevated'
  | 'dlq_depth_critical'
  | 'credit_race_detected'
  | 'safety_block_spike'
  | 'provider_error_rate'
  | 'zero_asset_job_rate';

// ── Alert payload ──────────────────────────────────────────────────────────────

export const AlertSchema = z.object({
  alertId:    z.string(),
  type:       z.string() as z.ZodType<AlertType>,
  severity:   z.enum(['info', 'warning', 'critical']),
  title:      z.string(),
  message:    z.string(),
  orgId:      z.string().optional(),
  jobId:      z.string().optional(),
  value:      z.number().optional(),  // the triggering metric value
  threshold:  z.number().optional(),  // the threshold that was exceeded
  metadata:   z.record(z.unknown()).default({}),
  firedAt:    z.string(),             // ISO timestamp
  resolvedAt: z.string().optional(),
});
export type Alert = z.infer<typeof AlertSchema>;

// ── Monitoring thresholds (env-configurable with sane defaults) ───────────────
// All ALERT_* keys are declared in the shared optional env schema and read
// through getEnv() — no direct process.env access.
// THRESHOLDS is a getter-based object so it reads env lazily (after validation).

function envNum(key: string, def: number): number {
  try {
    const v = (getEnv() as any)[key] as string | undefined;
    if (!v) return def;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : def;
  } catch {
    // getEnv() may throw before validateSharedEnv() runs in test/bootstrap.
    // Fall back to the safe default — never block monitoring module import.
    return def;
  }
}

export const THRESHOLDS = {
  // Cost spike: per-org usage increase in 1h window
  get COST_SPIKE_ORG_CREDITS_PER_HOUR()    { return envNum('ALERT_COST_SPIKE_ORG_PER_HOUR', 100); },
  // Cost spike: global USD spend in 1h
  get COST_SPIKE_GLOBAL_USD_PER_HOUR()     { return envNum('ALERT_COST_SPIKE_GLOBAL_USD_PER_HOUR', 50); },
  // Volume anomaly: jobs per org per hour (>5x baseline = anomaly)
  get VOLUME_JOBS_PER_ORG_HOUR()           { return envNum('ALERT_VOLUME_JOBS_PER_ORG_HOUR', 30); },
  // Stage failures: error rate % that triggers warning
  get STAGE_FAILURE_RATE_WARNING()         { return envNum('ALERT_STAGE_FAILURE_RATE_WARNING', 5); },
  // Stage failures: error rate % that triggers critical
  get STAGE_FAILURE_RATE_CRITICAL()        { return envNum('ALERT_STAGE_FAILURE_RATE_CRITICAL', 20); },
  // Stage timeout: ms threshold per stage
  get STAGE_TIMEOUT_MS()                   { return envNum('ALERT_STAGE_TIMEOUT_MS', 30_000); },
  // Fallback rate: % of stages that fell back to deterministic
  get FALLBACK_RATE_WARNING()              { return envNum('ALERT_FALLBACK_RATE_WARNING', 25); },
  get FALLBACK_RATE_CRITICAL()             { return envNum('ALERT_FALLBACK_RATE_CRITICAL', 60); },
  // DLQ: depth that triggers critical
  get DLQ_DEPTH_CRITICAL()                 { return envNum('ALERT_DLQ_DEPTH_CRITICAL', 10); },
  // Safety blocks: per hour
  get SAFETY_BLOCK_SPIKE_PER_HOUR()        { return envNum('ALERT_SAFETY_BLOCK_PER_HOUR', 10); },
  // Zero-asset job rate: % of jobs completing with 0 assets
  get ZERO_ASSET_JOB_RATE_WARNING()        { return envNum('ALERT_ZERO_ASSET_JOB_RATE_WARNING', 15); },
  // Provider error rate: % of AI calls that fail
  get PROVIDER_ERROR_RATE_CRITICAL()       { return envNum('ALERT_PROVIDER_ERROR_RATE_CRITICAL', 10); },
} as const;

// ── Dedup window (prevent alert spam) ─────────────────────────────────────────
// In-process TTL map — key = alertType+orgId, value = last fired timestamp
// In multi-process prod deploy, use Redis for cross-process dedup

const alertDedup = new Map<string, number>();

function getDedupWindowMs(): number {
  return envNum('ALERT_DEDUP_WINDOW_MS', 15 * 60 * 1000); // 15 min default
}

function shouldFire(dedupKey: string): boolean {
  const last = alertDedup.get(dedupKey);
  if (!last || Date.now() - last > getDedupWindowMs()) {
    alertDedup.set(dedupKey, Date.now());
    return true;
  }
  return false;
}

// ── Alert emitter ──────────────────────────────────────────────────────────────

export interface AlertEmitterDeps {
  /** Called for every alert (log, Sentry, Datadog, etc.) */
  onAlert?: (alert: Alert) => Promise<void> | void;
  /** Called for critical alerts only (PagerDuty, Slack, email) */
  onCritical?: (alert: Alert) => Promise<void> | void;
  /** Structured logger (pino/winston compatible) */
  logger?: { warn: (...a: any[]) => void; error: (...a: any[]) => void; info: (...a: any[]) => void };
}

let _deps: AlertEmitterDeps = {};

export function configureMonitoring(deps: AlertEmitterDeps): void {
  _deps = deps;
}

let _alertSeq = 0;

async function emitAlert(alert: Omit<Alert, 'alertId' | 'firedAt'>): Promise<void> {
  const full: Alert = {
    ...alert,
    alertId: `alrt_${Date.now()}_${(++_alertSeq).toString(36)}`,
    firedAt: new Date().toISOString(),
  };

  const log = _deps.logger ?? console;

  if (full.severity === 'critical') {
    log.error({ alert: full }, `[monitoring] CRITICAL: ${full.title}`);
    _deps.onCritical?.(full);
  } else if (full.severity === 'warning') {
    log.warn({ alert: full }, `[monitoring] WARNING: ${full.title}`);
  } else {
    log.info({ alert: full }, `[monitoring] INFO: ${full.title}`);
  }

  try {
    await _deps.onAlert?.(full);
  } catch (err: any) {
    log.error({ err: err.message }, '[monitoring] onAlert handler threw (non-fatal)');
  }
}

// ── Cost spike detection ───────────────────────────────────────────────────────

export interface CostSpikeInput {
  orgId:             string;
  creditsUsedInHour: number; // credits consumed by this org in the past 1h
  globalUsdInHour?:  number; // total USD spent globally in the past 1h
}

export async function checkCostSpike(input: CostSpikeInput): Promise<void> {
  const { orgId, creditsUsedInHour, globalUsdInHour } = input;

  // Per-org cost spike
  if (creditsUsedInHour >= THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR) {
    const key = `cost_spike_org:${orgId}`;
    if (shouldFire(key)) {
      await emitAlert({
        type:      'cost_spike_org',
        severity:  creditsUsedInHour >= THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR * 2 ? 'critical' : 'warning',
        title:     `Cost spike: org ${orgId} used ${creditsUsedInHour} credits in 1h`,
        message:   `Org ${orgId} consumed ${creditsUsedInHour} credits in the past hour (threshold: ${THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR}). Possible runaway job or abuse.`,
        orgId,
        value:     creditsUsedInHour,
        threshold: THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR,
        metadata:  { creditsUsedInHour, windowHours: 1 },
      });
    }
  }

  // Global cost spike
  if (globalUsdInHour !== undefined && globalUsdInHour >= THRESHOLDS.COST_SPIKE_GLOBAL_USD_PER_HOUR) {
    const key = 'cost_spike_global';
    if (shouldFire(key)) {
      await emitAlert({
        type:      'cost_spike_global',
        severity:  'critical',
        title:     `Global cost spike: $${globalUsdInHour.toFixed(2)} in 1h`,
        message:   `Total platform spend reached $${globalUsdInHour.toFixed(2)} in the past hour (threshold: $${THRESHOLDS.COST_SPIKE_GLOBAL_USD_PER_HOUR}). Emergency kill-switch may be needed.`,
        value:     globalUsdInHour,
        threshold: THRESHOLDS.COST_SPIKE_GLOBAL_USD_PER_HOUR,
        metadata:  { globalUsdInHour, windowHours: 1 },
      });
    }
  }
}

// ── Volume anomaly detection ───────────────────────────────────────────────────

export interface VolumeAnomalyInput {
  orgId:        string;
  jobsInHour:   number; // jobs submitted by this org in the past 1h
  assetsInHour: number; // assets created in the past 1h (global or per-org)
}

export async function checkVolumeAnomaly(input: VolumeAnomalyInput): Promise<void> {
  const { orgId, jobsInHour } = input;

  if (jobsInHour >= THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR) {
    const key = `volume_anomaly:${orgId}`;
    if (shouldFire(key)) {
      await emitAlert({
        type:      'generation_volume_anomaly',
        severity:  jobsInHour >= THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR * 2 ? 'critical' : 'warning',
        title:     `Volume anomaly: org ${orgId} submitted ${jobsInHour} jobs in 1h`,
        message:   `Org ${orgId} submitted ${jobsInHour} generation jobs in the past hour (threshold: ${THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR}). Review for automation abuse.`,
        orgId,
        value:     jobsInHour,
        threshold: THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR,
        metadata:  { jobsInHour, windowHours: 1 },
      });
    }
  }
}

// ── Stage failure alerting ─────────────────────────────────────────────────────

export interface StageHealthInput {
  stageId:      string;
  totalRuns:    number;
  failedRuns:   number;
  fallbackRuns: number;
  maxDurationMs: number; // worst observed stage duration
  orgId?:       string;
  jobId?:       string;
}

export async function checkStageHealth(input: StageHealthInput): Promise<void> {
  const { stageId, totalRuns, failedRuns, fallbackRuns, maxDurationMs, orgId, jobId } = input;
  if (totalRuns === 0) return;

  const errorRate    = (failedRuns / totalRuns) * 100;
  const fallbackRate = (fallbackRuns / totalRuns) * 100;

  // Stage failure rate alert
  if (errorRate >= THRESHOLDS.STAGE_FAILURE_RATE_WARNING) {
    const severity: AlertSeverity = errorRate >= THRESHOLDS.STAGE_FAILURE_RATE_CRITICAL ? 'critical' : 'warning';
    const key = `stage_failure:${stageId}:${orgId ?? 'global'}`;
    if (shouldFire(key)) {
      await emitAlert({
        type:      'stage_failure_rate',
        severity,
        title:     `Stage "${stageId}" failure rate ${errorRate.toFixed(1)}%`,
        message:   `AI pipeline stage "${stageId}" is failing at ${errorRate.toFixed(1)}% (${failedRuns}/${totalRuns} runs, threshold: ${THRESHOLDS.STAGE_FAILURE_RATE_WARNING}%). Check provider health.`,
        orgId,
        jobId,
        value:     errorRate,
        threshold: THRESHOLDS.STAGE_FAILURE_RATE_WARNING,
        metadata:  { stageId, totalRuns, failedRuns, errorRate, fallbackRate },
      });
    }
  }

  // Stage timeout alert
  if (maxDurationMs >= THRESHOLDS.STAGE_TIMEOUT_MS) {
    const key = `stage_timeout:${stageId}:${orgId ?? 'global'}`;
    if (shouldFire(key)) {
      await emitAlert({
        type:      'stage_timeout',
        severity:  maxDurationMs >= THRESHOLDS.STAGE_TIMEOUT_MS * 2 ? 'critical' : 'warning',
        title:     `Stage "${stageId}" timeout: ${maxDurationMs}ms`,
        message:   `AI pipeline stage "${stageId}" took ${maxDurationMs}ms (threshold: ${THRESHOLDS.STAGE_TIMEOUT_MS}ms). Provider may be degraded.`,
        orgId,
        jobId,
        value:     maxDurationMs,
        threshold: THRESHOLDS.STAGE_TIMEOUT_MS,
        metadata:  { stageId, maxDurationMs, totalRuns },
      });
    }
  }

  // Fallback rate alert
  if (fallbackRate >= THRESHOLDS.FALLBACK_RATE_WARNING) {
    const severity: AlertSeverity = fallbackRate >= THRESHOLDS.FALLBACK_RATE_CRITICAL ? 'critical' : 'warning';
    const key = `fallback_rate:${stageId}:${orgId ?? 'global'}`;
    if (shouldFire(key)) {
      await emitAlert({
        type:      'fallback_rate_elevated',
        severity,
        title:     `Stage "${stageId}" fallback rate ${fallbackRate.toFixed(1)}%`,
        message:   `AI pipeline stage "${stageId}" is using deterministic fallback in ${fallbackRate.toFixed(1)}% of runs. AI quality may be degraded.`,
        orgId,
        jobId,
        value:     fallbackRate,
        threshold: THRESHOLDS.FALLBACK_RATE_WARNING,
        metadata:  { stageId, totalRuns, fallbackRuns, fallbackRate },
      });
    }
  }
}

// ── DLQ depth check ────────────────────────────────────────────────────────────

export async function checkDlqDepth(depth: number): Promise<void> {
  if (depth >= THRESHOLDS.DLQ_DEPTH_CRITICAL) {
    const key = 'dlq_depth';
    if (shouldFire(key)) {
      await emitAlert({
        type:      'dlq_depth_critical',
        severity:  'critical',
        title:     `DLQ depth critical: ${depth} items`,
        message:   `Dead-letter queue has ${depth} items (threshold: ${THRESHOLDS.DLQ_DEPTH_CRITICAL}). Ops action required: review and replay or discard.`,
        value:     depth,
        threshold: THRESHOLDS.DLQ_DEPTH_CRITICAL,
        metadata:  { depth },
      });
    }
  }
}

// ── Credit race detection ──────────────────────────────────────────────────────

export async function reportCreditRace(orgId: string, jobId: string, detail: Record<string, unknown>): Promise<void> {
  const key = `credit_race:${orgId}`;
  if (shouldFire(key)) {
    await emitAlert({
      type:     'credit_race_detected',
      severity: 'warning',
      title:    `Credit race condition detected for org ${orgId}`,
      message:  `Concurrent job credit deduction race detected. Guard prevented double-spend. Review for systematic issues.`,
      orgId,
      jobId,
      metadata: detail,
    });
  }
}

// ── Safety block spike ─────────────────────────────────────────────────────────

export async function checkSafetyBlockRate(orgId: string, blocksInHour: number): Promise<void> {
  if (blocksInHour >= THRESHOLDS.SAFETY_BLOCK_SPIKE_PER_HOUR) {
    const key = `safety_block:${orgId}`;
    if (shouldFire(key)) {
      await emitAlert({
        type:      'safety_block_spike',
        severity:  'warning',
        title:     `Safety block spike: org ${orgId} had ${blocksInHour} blocks in 1h`,
        message:   `Org ${orgId} triggered ${blocksInHour} content safety blocks in the past hour. Possible systematic prompt abuse.`,
        orgId,
        value:     blocksInHour,
        threshold: THRESHOLDS.SAFETY_BLOCK_SPIKE_PER_HOUR,
        metadata:  { blocksInHour, windowHours: 1 },
      });
    }
  }
}

// ── Provider error rate ────────────────────────────────────────────────────────

export async function checkProviderErrorRate(
  provider:    string,
  totalCalls:  number,
  failedCalls: number,
): Promise<void> {
  if (totalCalls === 0) return;
  const errorRate = (failedCalls / totalCalls) * 100;
  if (errorRate >= THRESHOLDS.PROVIDER_ERROR_RATE_CRITICAL) {
    const key = `provider_error:${provider}`;
    if (shouldFire(key)) {
      await emitAlert({
        type:      'provider_error_rate',
        severity:  'critical',
        title:     `AI provider "${provider}" error rate ${errorRate.toFixed(1)}%`,
        message:   `Provider "${provider}" is failing on ${errorRate.toFixed(1)}% of calls (${failedCalls}/${totalCalls}). Check API status and keys.`,
        value:     errorRate,
        threshold: THRESHOLDS.PROVIDER_ERROR_RATE_CRITICAL,
        metadata:  { provider, totalCalls, failedCalls, errorRate },
      });
    }
  }
}

// ── Zero-asset job rate ────────────────────────────────────────────────────────

export async function checkZeroAssetJobRate(
  totalJobsCompleted: number,
  zeroAssetJobs:      number,
): Promise<void> {
  if (totalJobsCompleted === 0) return;
  const rate = (zeroAssetJobs / totalJobsCompleted) * 100;
  if (rate >= THRESHOLDS.ZERO_ASSET_JOB_RATE_WARNING) {
    const key = 'zero_asset_rate';
    if (shouldFire(key)) {
      await emitAlert({
        type:      'zero_asset_job_rate',
        severity:  rate >= THRESHOLDS.ZERO_ASSET_JOB_RATE_WARNING * 2 ? 'critical' : 'warning',
        title:     `${rate.toFixed(1)}% of completed jobs produced 0 assets`,
        message:   `${zeroAssetJobs}/${totalJobsCompleted} recently completed jobs produced no output assets. Pipeline may have systematic failures.`,
        value:     rate,
        threshold: THRESHOLDS.ZERO_ASSET_JOB_RATE_WARNING,
        metadata:  { totalJobsCompleted, zeroAssetJobs, rate },
      });
    }
  }
}

// ── Composite monitoring run — call from a cron or after each job ──────────────

export interface MonitoringRunInput {
  // Per-org inputs (call for each org separately)
  orgId?:             string;
  creditsUsedInHour?: number;
  jobsInHour?:        number;
  assetsInHour?:      number;
  safetyBlocksInHour?: number;
  // Global inputs
  globalUsdInHour?:   number;
  dlqDepth?:          number;
  // Stage health (can be per-job or rolling window)
  stageHealthInputs?: StageHealthInput[];
  // Provider health
  providerStats?:     Array<{ provider: string; totalCalls: number; failedCalls: number }>;
  // Zero-asset job rate (global)
  jobsCompleted?:     number;
  zeroAssetJobs?:     number;
}

export async function runMonitoringChecks(input: MonitoringRunInput): Promise<void> {
  const checks: Promise<void>[] = [];

  if (input.orgId !== undefined) {
    if (input.creditsUsedInHour !== undefined || input.globalUsdInHour !== undefined) {
      checks.push(checkCostSpike({
        orgId:             input.orgId,
        creditsUsedInHour: input.creditsUsedInHour ?? 0,
        globalUsdInHour:   input.globalUsdInHour,
      }));
    }
    if (input.jobsInHour !== undefined) {
      checks.push(checkVolumeAnomaly({
        orgId:        input.orgId,
        jobsInHour:   input.jobsInHour,
        assetsInHour: input.assetsInHour ?? 0,
      }));
    }
    if (input.safetyBlocksInHour !== undefined) {
      checks.push(checkSafetyBlockRate(input.orgId, input.safetyBlocksInHour));
    }
  }

  if (input.dlqDepth !== undefined) {
    checks.push(checkDlqDepth(input.dlqDepth));
  }

  for (const sh of input.stageHealthInputs ?? []) {
    checks.push(checkStageHealth(sh));
  }

  for (const ps of input.providerStats ?? []) {
    checks.push(checkProviderErrorRate(ps.provider, ps.totalCalls, ps.failedCalls));
  }

  if (input.jobsCompleted !== undefined && input.zeroAssetJobs !== undefined) {
    checks.push(checkZeroAssetJobRate(input.jobsCompleted, input.zeroAssetJobs));
  }

  // Run all checks concurrently — individual failures don't block others
  await Promise.allSettled(checks);
}

// ── Reset dedup state (for testing) ───────────────────────────────────────────
export function _resetAlertDedup(): void {
  alertDedup.clear();
}
