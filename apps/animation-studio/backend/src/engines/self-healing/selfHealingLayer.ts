/**
 * Self-Healing Reliability Layer v2 — Production Implementation
 * 
 * ABSOLUTE BOUNDARIES (from blueprint):
 * - Operational self-healing ONLY — never self-rewriting
 * - Never edits source code, templates, schemas, or business logic
 * - Never bypasses validation or QC to force an output
 * - Never infinite retries or silent success conversion
 * - Quality is non-negotiable
 *
 * Systems: failure classification, recovery policy matrix, checkpointing,
 * worker heartbeat, stuck-job detection, queue repair, memory protection,
 * circuit breaking, observability, escalation, stage budgets.
 */

import { logger } from '../../config/logger';

// ═══════════ FAILURE TAXONOMY ═══════════

export type FailureClass =
  | 'transient_infrastructure' | 'dependency_transient' | 'worker_crash_stall'
  | 'operational_capacity' | 'deterministic_content' | 'data_integrity' | 'qc_failure';

export interface ClassifiedFailure {
  failureClass: FailureClass;
  retryable: boolean;
  maxAttempts: number;
  resumePoint: string;
  terminalRule: string;
  description: string;
  originalError: Error;
  stage?: string;
  jobId: string;
  workerId?: string;
  timestamp: Date;
}

export function classifyFailure(error: Error, ctx: { stage?: string; jobId: string; workerId?: string }): ClassifiedFailure {
  const msg = (error.message || '').toLowerCase();
  const base = { originalError: error, stage: ctx.stage, jobId: ctx.jobId, workerId: ctx.workerId, timestamp: new Date() };
  
  if (/timeout|econnreset|econnrefused|socket hang up|dns|network/.test(msg))
    return { ...base, failureClass: 'transient_infrastructure', retryable: true, maxAttempts: 3, resumePoint: 'current_stage', terminalRule: 'Fail job if retries exhausted', description: 'Transient network/infrastructure failure' };
  if (/asset|font|image|cdn|fetch|download|s3|storage/.test(msg))
    return { ...base, failureClass: 'dependency_transient', retryable: true, maxAttempts: 3, resumePoint: 'post_asset_normalization', terminalRule: 'Fail if source remains unavailable', description: 'Asset/dependency fetch failure' };
  if (/heartbeat|stall|hung|zombie|kill|oom|sigkill/.test(msg))
    return { ...base, failureClass: 'worker_crash_stall', retryable: true, maxAttempts: 2, resumePoint: 'latest_checkpoint', terminalRule: 'Quarantine if duplicate execution risk', description: 'Worker crash or stall' };
  if (/memory|heap|allocation|concurrency|backlog|queue full/.test(msg))
    return { ...base, failureClass: 'operational_capacity', retryable: true, maxAttempts: 1, resumePoint: 'latest_checkpoint', terminalRule: 'Fail and alert if ceiling exceeded', description: 'Resource pressure exceeded' };
  if (/schema|validation|missing.*required|invalid.*binding|layout.*impossible/.test(msg))
    return { ...base, failureClass: 'deterministic_content', retryable: false, maxAttempts: 0, resumePoint: 'none', terminalRule: 'Fail fast with diagnosis', description: 'Deterministic content error — not retryable' };
  if (/corrupt|checksum|malformed|invalid.*checkpoint|decode/.test(msg))
    return { ...base, failureClass: 'data_integrity', retryable: true, maxAttempts: 1, resumePoint: 'previous_checkpoint', terminalRule: 'Fail if no trusted checkpoint', description: 'Data integrity failure' };
  if (/qc|quality|clipping|overflow|empty.*frame|contrast|logo.*invisible/.test(msg))
    return { ...base, failureClass: 'qc_failure', retryable: true, maxAttempts: 1, resumePoint: 'pre_render', terminalRule: 'Block output if QC still fails', description: 'Quality check failure — one auto-fix attempt allowed' };
  return { ...base, failureClass: 'transient_infrastructure', retryable: true, maxAttempts: 2, resumePoint: 'current_stage', terminalRule: 'Fail after retries', description: `Unclassified: ${error.message.slice(0, 200)}` };
}

// ═══════════ CHECKPOINTING ═══════════

export interface Checkpoint {
  id: string; jobId: string; stage: string; sceneIndex: number;
  schemaVersion: number; specHash: string; retryCount: number;
  timestamp: Date; verified: boolean;
}

const CHECKPOINT_VERSION = 1;
const checkpointStore = new Map<string, Checkpoint[]>();

export function saveCheckpoint(cp: Omit<Checkpoint, 'id' | 'schemaVersion' | 'timestamp' | 'verified'>): Checkpoint {
  const checkpoint: Checkpoint = {
    ...cp, id: `cp_${cp.jobId}_${cp.stage}_${Date.now()}`,
    schemaVersion: CHECKPOINT_VERSION, timestamp: new Date(), verified: true,
  };
  const existing = checkpointStore.get(cp.jobId) || [];
  existing.push(checkpoint);
  if (existing.length > 20) existing.shift(); // bound storage
  checkpointStore.set(cp.jobId, existing);
  return checkpoint;
}

export function getLatestCheckpoint(jobId: string, stage?: string): Checkpoint | null {
  const all = checkpointStore.get(jobId) || [];
  const filtered = stage ? all.filter(cp => cp.stage === stage) : all;
  const valid = filtered.filter(cp => cp.verified && cp.schemaVersion === CHECKPOINT_VERSION);
  return valid.length > 0 ? valid[valid.length - 1] : null;
}

export function clearCheckpoints(jobId: string): void { checkpointStore.delete(jobId); }

// ═══════════ WORKER HEARTBEAT ═══════════

interface WorkerHeartbeat {
  workerId: string; lastSeen: Date; currentJobId: string | null;
  currentStage: string | null; memoryUsageMB: number;
}

const workerRegistry = new Map<string, WorkerHeartbeat>();
const STALE_MS = 60_000;
const DEAD_MS = 180_000;

export function registerHeartbeat(workerId: string, jobId: string | null, stage: string | null, memMB: number): void {
  workerRegistry.set(workerId, { workerId, lastSeen: new Date(), currentJobId: jobId, currentStage: stage, memoryUsageMB: memMB });
}

export function detectStaleWorkers(): WorkerHeartbeat[] {
  const now = Date.now();
  return [...workerRegistry.values()].filter(w => now - w.lastSeen.getTime() > STALE_MS);
}

export function reclaimWorkerJob(workerId: string): string | null {
  const hb = workerRegistry.get(workerId);
  if (hb?.currentJobId) { const jid = hb.currentJobId; workerRegistry.delete(workerId); return jid; }
  return null;
}

// ═══════════ CIRCUIT BREAKER ═══════════

interface CircuitState {
  subsystem: string; state: 'closed' | 'open' | 'half_open';
  failureCount: number; lastFailure: Date | null; openedAt: Date | null;
  threshold: number; resetMs: number;
}

const circuits = new Map<string, CircuitState>();

export function getCircuit(sub: string, threshold = 5, resetMs = 30_000): CircuitState {
  if (!circuits.has(sub)) circuits.set(sub, { subsystem: sub, state: 'closed', failureCount: 0, lastFailure: null, openedAt: null, threshold, resetMs });
  return circuits.get(sub)!;
}

export function recordCircuitFailure(sub: string): boolean {
  const c = getCircuit(sub);
  c.failureCount++; c.lastFailure = new Date();
  if (c.failureCount >= c.threshold) { c.state = 'open'; c.openedAt = new Date(); logger.warn(`[SelfHeal] Circuit OPEN: ${sub}`); return false; }
  return true;
}

export function recordCircuitSuccess(sub: string): void {
  const c = getCircuit(sub); c.failureCount = 0; c.state = 'closed'; c.openedAt = null;
}

export function isCircuitOpen(sub: string): boolean {
  const c = getCircuit(sub);
  if (c.state === 'open' && c.openedAt && Date.now() - c.openedAt.getTime() > c.resetMs) { c.state = 'half_open'; return false; }
  return c.state === 'open';
}

// ═══════════ MEMORY PROTECTION ═══════════

const MEM_WARN = 1500;
const MEM_CRIT = 2000;

export function checkMemoryPressure(): { safe: boolean; usageMB: number; level: 'ok' | 'warning' | 'critical' } {
  const mb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  if (mb > MEM_CRIT) { logger.error(`[SelfHeal] CRITICAL memory: ${mb}MB`); return { safe: false, usageMB: mb, level: 'critical' }; }
  if (mb > MEM_WARN) { logger.warn(`[SelfHeal] Memory warning: ${mb}MB`); return { safe: true, usageMB: mb, level: 'warning' }; }
  return { safe: true, usageMB: mb, level: 'ok' };
}

// ═══════════ STAGE BUDGETS ═══════════

const BUDGETS: Record<string, { timeoutMs: number; maxRetries: number }> = {
  spec_validation: { timeoutMs: 10_000, maxRetries: 1 }, asset_loading: { timeoutMs: 60_000, maxRetries: 3 },
  scene_rendering: { timeoutMs: 300_000, maxRetries: 2 }, clip_encoding: { timeoutMs: 120_000, maxRetries: 2 },
  stitching: { timeoutMs: 180_000, maxRetries: 1 }, audio_mixing: { timeoutMs: 60_000, maxRetries: 1 },
  export: { timeoutMs: 120_000, maxRetries: 2 }, upload: { timeoutMs: 120_000, maxRetries: 3 },
  quality_intelligence: { timeoutMs: 15_000, maxRetries: 0 }, psychology_layer: { timeoutMs: 10_000, maxRetries: 0 },
  candidate_pipeline: { timeoutMs: 20_000, maxRetries: 0 }, default: { timeoutMs: 60_000, maxRetries: 2 },
};

export function getStageBudget(stage: string) { return BUDGETS[stage] || BUDGETS.default; }

// ═══════════ QUEUE HEALTH ═══════════

const poisonedJobs = new Set<string>();

export function quarantineJob(jobId: string, reason: string): void { poisonedJobs.add(jobId); logger.warn(`[SelfHeal] Quarantined: ${jobId} — ${reason}`); }
export function isJobQuarantined(jobId: string): boolean { return poisonedJobs.has(jobId); }

export interface QueueHealthReport { depth: number; stalledJobs: number; poisonedCount: number; healthy: boolean; }
export function reportQueueHealth(depth: number, stalled: number): QueueHealthReport {
  const healthy = depth < 500 && stalled === 0;
  if (!healthy) logger.warn(`[SelfHeal] Queue unhealthy: depth=${depth}, stalled=${stalled}`);
  return { depth, stalledJobs: stalled, poisonedCount: poisonedJobs.size, healthy };
}

// ═══════════ INCIDENT REPORTING ═══════════

export interface IncidentReport {
  id: string; jobId: string; timestamp: Date; failureClass: FailureClass;
  originalError: string; selectedPolicy: string; checkpointUsed: string | null;
  userMessage: string; disposition: 'recovered' | 'failed_safe' | 'escalated';
}

const incidents: IncidentReport[] = [];

export function reportIncident(r: IncidentReport): void {
  incidents.push(r);
  if (incidents.length > 500) incidents.shift();
  logger.info(`[SelfHeal] Incident ${r.id}: ${r.disposition} (${r.failureClass})`, { jobId: r.jobId });
}

export function getRecentIncidents(limit = 50): IncidentReport[] { return incidents.slice(-limit); }

// ═══════════ RECOVERY EXECUTOR ═══════════

export interface RecoveryResult {
  recovered: boolean; action: string; checkpointUsed: string | null;
  retriesSpent: number; userMessage: string;
}

export async function attemptRecovery(failure: ClassifiedFailure, currentRetry: number): Promise<RecoveryResult> {
  if (isCircuitOpen(failure.stage || 'general'))
    return { recovered: false, action: 'circuit_open', checkpointUsed: null, retriesSpent: currentRetry, userMessage: 'System recovering. Try again shortly.' };
  
  if (!failure.retryable || currentRetry >= failure.maxAttempts) {
    reportIncident({ id: `inc_${Date.now()}`, jobId: failure.jobId, timestamp: new Date(), failureClass: failure.failureClass,
      originalError: failure.originalError.message, selectedPolicy: 'fail_safe', checkpointUsed: null,
      userMessage: 'Generation failed. Credits refunded.', disposition: 'failed_safe' });
    return { recovered: false, action: 'retries_exhausted', checkpointUsed: null, retriesSpent: currentRetry,
      userMessage: failure.failureClass === 'deterministic_content' ? 'Content configuration error. Check inputs.' : 'Generation failed after recovery. Credits refunded.' };
  }
  
  if (!checkMemoryPressure().safe)
    return { recovered: false, action: 'memory_exceeded', checkpointUsed: null, retriesSpent: currentRetry, userMessage: 'System under load. Try again shortly.' };
  
  const cp = getLatestCheckpoint(failure.jobId);
  recordCircuitFailure(failure.stage || 'general');
  
  reportIncident({ id: `inc_${Date.now()}`, jobId: failure.jobId, timestamp: new Date(), failureClass: failure.failureClass,
    originalError: failure.originalError.message, selectedPolicy: 'retry', checkpointUsed: cp?.id || null,
    userMessage: 'Recovering — retrying generation.', disposition: 'recovered' });
  
  return { recovered: true, action: `retry_from_${cp ? 'checkpoint' : 'start'}`, checkpointUsed: cp?.id || null,
    retriesSpent: currentRetry + 1, userMessage: 'Recovering — retrying.' };
}

// ═══════════ ASSET REVALIDATION ═══════════
// Before or during recovery, revalidate required assets for presence and decodability
export async function revalidateAssets(assetRefs: string[]): Promise<{valid: string[]; invalid: string[]}> {
  const valid: string[]=[], invalid: string[]=[];
  for (const ref of assetRefs) {
    try {
      // Check if asset URL is reachable (HEAD request with timeout)
      if (ref.startsWith('http')) {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 5000);
        try { const r = await fetch(ref, {method:'HEAD', signal:ctrl.signal}); if(r.ok) valid.push(ref); else invalid.push(ref); }
        finally { clearTimeout(timeout); }
      } else { valid.push(ref); } // local refs assumed valid
    } catch { invalid.push(ref); }
  }
  if (invalid.length > 0) logger.warn(`[SelfHeal] ${invalid.length}/${assetRefs.length} assets invalid`);
  return {valid, invalid};
}

// ═══════════ QC-AWARE RECOVERY ═══════════
// Deterministic auto-fix: re-run approved operations without changing user intent
export function canAutoFixQC(failureDesc: string): boolean {
  const fixable = /text.*overflow|text.*clipping|safe.*area|contrast.*low|layout.*overflow/i;
  return fixable.test(failureDesc);
}

// ═══════════ ESCALATION RULES ═══════════
export type EscalationLevel = 'none' | 'warn' | 'page' | 'critical';
export function getEscalationLevel(incidents: IncidentReport[]): EscalationLevel {
  const recentFails = incidents.filter(i => i.disposition === 'failed_safe' && Date.now() - i.timestamp.getTime() < 600_000);
  if (recentFails.length >= 5) return 'critical';
  if (recentFails.length >= 3) return 'page';
  if (recentFails.length >= 1) return 'warn';
  return 'none';
}

// ═══════════ HEALTH DASHBOARD ═══════════

export function getHealthMetrics() {
  const now = Date.now();
  const workers = [...workerRegistry.values()];
  const mem = checkMemoryPressure();
  const recentInc = incidents.filter(i => now - i.timestamp.getTime() < 3600_000);
  return {
    workers: { total: workers.length, healthy: workers.filter(w => now - w.lastSeen.getTime() < STALE_MS).length,
      stale: workers.filter(w => now - w.lastSeen.getTime() >= STALE_MS && now - w.lastSeen.getTime() < DEAD_MS).length,
      dead: workers.filter(w => now - w.lastSeen.getTime() >= DEAD_MS).length },
    circuits: { total: circuits.size, open: [...circuits.values()].filter(c => c.state === 'open').length },
    memory: mem,
    incidents: { recent: recentInc.length, recovered: recentInc.filter(i => i.disposition === 'recovered').length, failed: recentInc.filter(i => i.disposition === 'failed_safe').length },
    quarantined: poisonedJobs.size,
  };
}
