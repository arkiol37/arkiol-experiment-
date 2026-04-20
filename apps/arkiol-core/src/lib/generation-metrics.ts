// src/lib/generation-metrics.ts
//
// Lightweight in-process metrics for the generation pipeline. Counters
// + rolling latency + recent rejection reasons — enough to answer "is
// the system healthy right now?" without a full APM.
//
// Exposed at GET /api/health/generation so ops can dashboard it or
// the worker can self-report. Resets on process restart; for
// cross-restart retention, surface values into an external time-series
// DB from the route handler.

interface RollingWindow {
  values:    number[];
  capacity:  number;
}

function pushRolling(win: RollingWindow, v: number): void {
  win.values.push(v);
  if (win.values.length > win.capacity) win.values.shift();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

// ── Metric state ─────────────────────────────────────────────────────────────

interface MetricState {
  // Counters
  generationsTotal:     number;
  generationsSucceeded: number;
  generationsFailed:    number;
  marketplaceApproved:  number;
  marketplaceRejected:  number;
  heroMissingCount:     number;
  resilientRetries:     number;
  recoveryActions:      number;
  // Rolling latency (last 100 renders)
  latencyMs:            RollingWindow;
  // Last N rejection reasons (for debugging recent regressions)
  recentRejections:     string[];
  startedAt:            number;
}

const state: MetricState = {
  generationsTotal:     0,
  generationsSucceeded: 0,
  generationsFailed:    0,
  marketplaceApproved:  0,
  marketplaceRejected:  0,
  heroMissingCount:     0,
  resilientRetries:     0,
  recoveryActions:      0,
  latencyMs:            { values: [], capacity: 100 },
  recentRejections:     [],
  startedAt:            Date.now(),
};

const RECENT_REJECTIONS_CAP = 20;

// ── Recording helpers ────────────────────────────────────────────────────────

export function recordGenerationStart(): void {
  state.generationsTotal++;
}

export function recordGenerationSuccess(latencyMs: number): void {
  state.generationsSucceeded++;
  pushRolling(state.latencyMs, latencyMs);
}

export function recordGenerationFailure(reason: string): void {
  state.generationsFailed++;
  if (state.recentRejections.length >= RECENT_REJECTIONS_CAP) state.recentRejections.shift();
  state.recentRejections.push(`err:${reason.slice(0, 80)}`);
}

export function recordMarketplaceVerdict(approved: boolean, failedCriteria?: string[]): void {
  if (approved) {
    state.marketplaceApproved++;
  } else {
    state.marketplaceRejected++;
    const reason = failedCriteria && failedCriteria.length > 0
      ? `marketplace:[${failedCriteria.join(",")}]`
      : "marketplace:unknown";
    if (state.recentRejections.length >= RECENT_REJECTIONS_CAP) state.recentRejections.shift();
    state.recentRejections.push(reason);
  }
}

export function recordHeroMissing(): void {
  state.heroMissingCount++;
}

export function recordResilientRetry(): void {
  state.resilientRetries++;
}

export function recordRecoveryActions(n: number): void {
  state.recoveryActions += n;
}

// ── Snapshot (for /api/health/generation) ────────────────────────────────────

export interface MetricsSnapshot {
  uptime_ms: number;
  counters: {
    generationsTotal:     number;
    generationsSucceeded: number;
    generationsFailed:    number;
    marketplaceApproved:  number;
    marketplaceRejected:  number;
    heroMissingCount:     number;
    resilientRetries:     number;
    recoveryActions:      number;
  };
  successRate: number;
  marketplacePassRate: number;
  latency: {
    samples: number;
    p50_ms:  number;
    p90_ms:  number;
    p99_ms:  number;
    max_ms:  number;
  };
  recentRejections: string[];
}

export function snapshot(): MetricsSnapshot {
  const sorted = state.latencyMs.values.slice().sort((a, b) => a - b);
  const totalDone = state.generationsSucceeded + state.generationsFailed;
  const totalMp   = state.marketplaceApproved + state.marketplaceRejected;
  return {
    uptime_ms: Date.now() - state.startedAt,
    counters: {
      generationsTotal:     state.generationsTotal,
      generationsSucceeded: state.generationsSucceeded,
      generationsFailed:    state.generationsFailed,
      marketplaceApproved:  state.marketplaceApproved,
      marketplaceRejected:  state.marketplaceRejected,
      heroMissingCount:     state.heroMissingCount,
      resilientRetries:     state.resilientRetries,
      recoveryActions:      state.recoveryActions,
    },
    successRate: totalDone > 0 ? state.generationsSucceeded / totalDone : 0,
    marketplacePassRate: totalMp > 0 ? state.marketplaceApproved / totalMp : 0,
    latency: {
      samples: sorted.length,
      p50_ms:  percentile(sorted, 0.50),
      p90_ms:  percentile(sorted, 0.90),
      p99_ms:  percentile(sorted, 0.99),
      max_ms:  sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    },
    recentRejections: state.recentRejections.slice(),
  };
}

// Reset — test-only hook.
export function __resetMetrics(): void {
  state.generationsTotal     = 0;
  state.generationsSucceeded = 0;
  state.generationsFailed    = 0;
  state.marketplaceApproved  = 0;
  state.marketplaceRejected  = 0;
  state.heroMissingCount     = 0;
  state.resilientRetries     = 0;
  state.recoveryActions      = 0;
  state.latencyMs.values     = [];
  state.recentRejections     = [];
  state.startedAt            = Date.now();
}
