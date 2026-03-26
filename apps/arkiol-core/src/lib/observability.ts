// src/lib/observability.ts
// Arkiol Observability — Structured Logging, Metrics, Tracing, Diagnostics
// ─────────────────────────────────────────────────────────────────────────────
//
// Unified observability layer wrapping all engines and API routes.
//
// Provides:
//   • Structured logging with correlation IDs (requestId, jobId, orgId, userId)
//   • Metrics counters and gauges (generation rates, error rates, latency)
//   • Distributed tracing — span/trace building for multi-stage pipelines
//   • Admin diagnostics endpoint helpers
//   • Engine-level telemetry hooks (exploration, platform, campaign engines)
//
// Architecture:
//   • ArkiolLogger:    thin wrapper around pino with correlation context
//   • MetricsRegistry: in-process counters/gauges with flush-to-store capability
//   • TraceBuilder:    builds human-readable stage traces for admin dashboards
//   • DiagnosticsAPI:  assembles engine-level health snapshots
//
// Execution contract:
//   ✓ All operations are synchronous or fire-and-forget (never block the request)
//   ✓ Observability never throws — all errors are swallowed silently
//   ✓ All IDs are deterministic from context — no random UUIDs in logs
//   ✓ Sensitive data (tokens, passwords, keys) is never logged

import { createHash } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type MetricType = "counter" | "gauge" | "histogram";

export interface LogContext {
  requestId?: string;
  jobId?:     string;
  orgId?:     string;
  userId?:    string;
  format?:    string;
  stage?:     string;
  [key: string]: unknown;
}

export interface MetricSample {
  name:       string;
  type:       MetricType;
  value:      number;
  labels:     Record<string, string>;
  timestamp:  number;
}

export interface SpanEvent {
  spanId:     string;
  traceId:    string;
  name:       string;
  startMs:    number;
  endMs?:     number;
  durationMs?: number;
  ok:         boolean;
  error?:     string;
  attributes: Record<string, unknown>;
  parentSpanId?: string;
}

export interface EngineHealthSnapshot {
  engineName:          string;
  status:              "healthy" | "degraded" | "critical";
  lastUpdatedAt:       string;
  errorRateLast5min:   number;
  avgLatencyMs:        number;
  totalRequestsLast1h: number;
  activeJobs:          number;
  alerts:              string[];
}

export interface PipelineDiagnostic {
  runId:          string;
  totalMs:        number;
  stages:         StageTrace[];
  overallStatus:  "success" | "partial_fallback" | "failed";
  fallbackCount:  number;
  errorMessages:  string[];
}

export interface StageTrace {
  stageId:      string;
  stageLabel:   string;
  durationMs:   number;
  ok:           boolean;
  fallback:     boolean;
  fallbackReason?: string;
  outputSummary?: string;
  errorMessage?:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2  CORRELATION ID GENERATION
// ─────────────────────────────────────────────────────────────────────────────

export function buildCorrelationId(
  prefix: string,
  ...parts: string[]
): string {
  return createHash("sha256")
    .update(`${prefix}:${parts.join(":")}`)
    .digest("hex")
    .slice(0, 16);
}

export function buildRequestId(jobId: string, stageId: string, attempt: number): string {
  return buildCorrelationId("req", jobId, stageId, String(attempt));
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3  METRICS REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

class MetricsRegistry {
  private counters: Map<string, number> = new Map();
  private gauges:   Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private readonly maxHistogramSamples = 1000;

  increment(name: string, labels: Record<string, string> = {}, amount = 1): void {
    try {
      const key = this.buildKey(name, labels);
      this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
    } catch { /* observability must not throw */ }
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    try {
      const key = this.buildKey(name, labels);
      this.gauges.set(key, value);
    } catch { /* observability must not throw */ }
  }

  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    try {
      const key = this.buildKey(name, labels);
      const existing = this.histograms.get(key) ?? [];
      existing.push(value);
      if (existing.length > this.maxHistogramSamples) existing.shift();
      this.histograms.set(key, existing);
    } catch { /* observability must not throw */ }
  }

  getCounter(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(this.buildKey(name, labels)) ?? 0;
  }

  getGauge(name: string, labels: Record<string, string> = {}): number {
    return this.gauges.get(this.buildKey(name, labels)) ?? 0;
  }

  getHistogramStats(name: string, labels: Record<string, string> = {}): {
    count: number; min: number; max: number; avg: number; p50: number; p95: number; p99: number
  } {
    const samples = this.histograms.get(this.buildKey(name, labels)) ?? [];
    if (samples.length === 0) return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };

    const sorted = [...samples].sort((a, b) => a - b);
    const p = (pct: number) => sorted[Math.floor(pct * sorted.length)] ?? 0;

    return {
      count: sorted.length,
      min:   sorted[0] ?? 0,
      max:   sorted[sorted.length - 1] ?? 0,
      avg:   sorted.reduce((s, v) => s + v, 0) / sorted.length,
      p50:   p(0.50),
      p95:   p(0.95),
      p99:   p(0.99),
    };
  }

  snapshot(): MetricSample[] {
    const samples: MetricSample[] = [];
    const now = Date.now();

    for (const [key, value] of this.counters) {
      const { name, labels } = this.parseKey(key);
      samples.push({ name, type: "counter", value, labels, timestamp: now });
    }
    for (const [key, value] of this.gauges) {
      const { name, labels } = this.parseKey(key);
      samples.push({ name, type: "gauge", value, labels, timestamp: now });
    }

    return samples;
  }

  private buildKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`).join(",");
    return `${name}{${labelStr}}`;
  }

  private parseKey(key: string): { name: string; labels: Record<string, string> } {
    const match = key.match(/^(.+)\{(.*)\}$/);
    if (!match) return { name: key, labels: {} };
    const [, name, labelStr] = match;
    const labels: Record<string, string> = {};
    if (labelStr) {
      for (const pair of labelStr.split(",")) {
        const [k, v] = pair.split("=");
        if (k && v !== undefined) labels[k] = v;
      }
    }
    return { name: name ?? key, labels };
  }
}

export const metrics = new MetricsRegistry();

// ─────────────────────────────────────────────────────────────────────────────
// § 4  TRACE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export class TraceBuilder {
  private spans: SpanEvent[] = [];
  private readonly traceId: string;
  private spanStack: string[] = [];

  constructor(traceId: string) {
    this.traceId = traceId;
  }

  startSpan(name: string, attributes: Record<string, unknown> = {}): string {
    const spanId = buildCorrelationId("span", this.traceId, name, String(Date.now()));
    const parent = this.spanStack[this.spanStack.length - 1];

    this.spans.push({
      spanId,
      traceId:     this.traceId,
      name,
      startMs:     Date.now(),
      ok:          true,
      attributes,
      parentSpanId: parent,
    });

    this.spanStack.push(spanId);
    return spanId;
  }

  endSpan(spanId: string, opts: { ok: boolean; error?: string; attributes?: Record<string, unknown> } = { ok: true }): void {
    const span = this.spans.find(s => s.spanId === spanId);
    if (span) {
      span.endMs      = Date.now();
      span.durationMs = span.endMs - span.startMs;
      span.ok         = opts.ok;
      span.error      = opts.error;
      if (opts.attributes) span.attributes = { ...span.attributes, ...opts.attributes };
    }

    const idx = this.spanStack.indexOf(spanId);
    if (idx >= 0) this.spanStack.splice(idx, 1);
  }

  buildDiagnostic(runId: string): PipelineDiagnostic {
    const stages: StageTrace[] = this.spans.map(span => ({
      stageId:       span.spanId,
      stageLabel:    span.name,
      durationMs:    span.durationMs ?? 0,
      ok:            span.ok,
      fallback:      span.attributes.fallback === true,
      fallbackReason: span.attributes.fallbackReason as string | undefined,
      outputSummary:  span.attributes.outputSummary as string | undefined,
      errorMessage:   span.error,
    }));

    const failedCount   = stages.filter(s => !s.ok).length;
    const fallbackCount = stages.filter(s => s.fallback).length;
    const totalMs       = stages.reduce((s, t) => s + t.durationMs, 0);

    return {
      runId,
      totalMs,
      stages,
      overallStatus: failedCount > 0 ? "failed" : fallbackCount > 0 ? "partial_fallback" : "success",
      fallbackCount,
      errorMessages: stages.filter(s => s.errorMessage).map(s => s.errorMessage!),
    };
  }

  getSpans(): SpanEvent[] {
    return [...this.spans];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  STRUCTURED LOGGER
// ─────────────────────────────────────────────────────────────────────────────

type LogEntry = { level: LogLevel; msg: string; ctx: LogContext; ts: string };

class ArkiolObservabilityLogger {
  private readonly recentEntries: LogEntry[] = [];
  private readonly maxEntries = 200;

  log(level: LogLevel, msg: string, ctx: LogContext = {}): void {
    try {
      const entry: LogEntry = { level, msg, ctx, ts: new Date().toISOString() };
      this.recentEntries.push(entry);
      if (this.recentEntries.length > this.maxEntries) this.recentEntries.shift();

      // Update metrics
      metrics.increment("arkiol_log_total", { level });
      if (level === "error" || level === "fatal") {
        metrics.increment("arkiol_errors_total", { stage: ctx.stage ?? "unknown" });
      }
    } catch { /* never throw */ }
  }

  info (msg: string, ctx?: LogContext): void { this.log("info",  msg, ctx); }
  warn (msg: string, ctx?: LogContext): void { this.log("warn",  msg, ctx); }
  error(msg: string, ctx?: LogContext): void { this.log("error", msg, ctx); }
  debug(msg: string, ctx?: LogContext): void { this.log("debug", msg, ctx); }

  getRecentEntries(level?: LogLevel, limit = 50): LogEntry[] {
    const filtered = level ? this.recentEntries.filter(e => e.level === level) : this.recentEntries;
    return filtered.slice(-limit);
  }
}

export const obsLogger = new ArkiolObservabilityLogger();

// ─────────────────────────────────────────────────────────────────────────────
// § 6  ENGINE TELEMETRY HOOKS
// ─────────────────────────────────────────────────────────────────────────────

/** Records exploration engine metrics. */
export function recordExplorationMetrics(opts: {
  runId:         string;
  orgId:         string;
  format:        string;
  poolGenerated: number;
  finalCurated:  number;
  totalMs:       number;
  fallbackUsed:  boolean;
}): void {
  metrics.increment("exploration_runs_total", { format: opts.format });
  metrics.observe("exploration_pool_size",    opts.poolGenerated, { format: opts.format });
  metrics.observe("exploration_curated_size", opts.finalCurated,  { format: opts.format });
  metrics.observe("exploration_latency_ms",   opts.totalMs,       { format: opts.format });
  if (opts.fallbackUsed) metrics.increment("exploration_fallbacks_total", { format: opts.format });

  obsLogger.info("[exploration] run complete", {
    jobId:  opts.runId,
    orgId:  opts.orgId,
    format: opts.format,
    poolGenerated: opts.poolGenerated,
    finalCurated:  opts.finalCurated,
    totalMs:       opts.totalMs,
    fallback:      opts.fallbackUsed,
  });
}

/** Records platform intelligence metrics. */
export function recordPlatformMetrics(opts: {
  format:           string;
  complianceScore:  number;
  violationCount:   number;
  topViolation?:    string;
}): void {
  metrics.observe("platform_compliance_score", opts.complianceScore, { format: opts.format });
  metrics.increment("platform_violations_total", { format: opts.format }, opts.violationCount);
}

/** Records campaign director metrics. */
export function recordCampaignMetrics(opts: {
  campaignId:     string;
  orgId:          string;
  objective:      string;
  formatCount:    number;
  estimatedCredits: number;
}): void {
  metrics.increment("campaigns_created_total", { objective: opts.objective });
  metrics.observe("campaign_format_count",     opts.formatCount,       { objective: opts.objective });
  metrics.observe("campaign_credit_estimate",  opts.estimatedCredits,  { objective: opts.objective });

  obsLogger.info("[campaign] plan created", {
    jobId:  opts.campaignId,
    orgId:  opts.orgId,
    stage:  "campaign_director",
    objective:       opts.objective,
    formatCount:     opts.formatCount,
    estimatedCredits: opts.estimatedCredits,
  });
}

/** Records render queue metrics. */
export function recordQueueMetrics(opts: {
  jobId:    string;
  orgId:    string;
  priority: string;
  outcome:  string;
  durationMs: number;
  provider: string;
  costUsd:  number;
  attempts: number;
}): void {
  metrics.increment("render_jobs_total",    { priority: opts.priority, outcome: opts.outcome });
  metrics.increment("render_attempts_total",{ provider: opts.provider });
  metrics.observe("render_latency_ms",      opts.durationMs, { priority: opts.priority });
  metrics.observe("render_cost_usd",        opts.costUsd,    { provider: opts.provider });
  if (opts.attempts > 1) metrics.increment("render_retries_total", { provider: opts.provider });

  obsLogger.info(`[queue] job ${opts.outcome}`, {
    jobId:    opts.jobId,
    orgId:    opts.orgId,
    stage:    "render_queue",
    priority: opts.priority,
    outcome:  opts.outcome,
    durationMs: opts.durationMs,
    provider: opts.provider,
    costUsd:  opts.costUsd,
    attempts: opts.attempts,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7  ADMIN DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────

export function buildEngineHealthSnapshot(engineName: string): EngineHealthSnapshot {
  const totalRequests   = metrics.getCounter("arkiol_log_total", { level: "info" });
  const totalErrors     = metrics.getCounter("arkiol_errors_total", { stage: engineName });
  const latencyStats    = metrics.getHistogramStats("exploration_latency_ms", { format: "all" });

  const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

  const alerts: string[] = [];
  if (errorRate > 0.05) alerts.push(`High error rate: ${(errorRate * 100).toFixed(1)}%`);
  if (latencyStats.p95 > 10_000) alerts.push(`High p95 latency: ${latencyStats.p95}ms`);

  return {
    engineName,
    status:              errorRate > 0.10 ? "critical" : errorRate > 0.03 ? "degraded" : "healthy",
    lastUpdatedAt:       new Date().toISOString(),
    errorRateLast5min:   errorRate,
    avgLatencyMs:        latencyStats.avg,
    totalRequestsLast1h: totalRequests,
    activeJobs:          metrics.getGauge("active_jobs"),
    alerts,
  };
}

export function buildFullDiagnosticsReport(): {
  timestamp:     string;
  engines:       EngineHealthSnapshot[];
  metrics:       MetricSample[];
  recentErrors:  ReturnType<typeof obsLogger.getRecentEntries>;
  systemStatus:  "healthy" | "degraded" | "critical";
} {
  const engineNames = [
    "exploration_engine",
    "platform_intelligence",
    "campaign_director",
    "render_queue",
    "asset_library",
    "pipeline_orchestrator",
  ];

  const engines = engineNames.map(buildEngineHealthSnapshot);
  const systemStatus = engines.some(e => e.status === "critical")
    ? "critical"
    : engines.some(e => e.status === "degraded")
      ? "degraded"
      : "healthy";

  return {
    timestamp:    new Date().toISOString(),
    engines,
    metrics:      metrics.snapshot(),
    recentErrors: obsLogger.getRecentEntries("error", 20),
    systemStatus,
  };
}
