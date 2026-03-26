// packages/shared/src/observability.ts
// PRODUCTION OBSERVABILITY — Structured Logging, Tracing, Health, and Diagnostics
//
// Provides a unified observability layer across workers, orchestration, automation,
// and generation pipelines. All log events are structured JSON — compatible with
// Datadog, Grafana Loki, AWS CloudWatch, and any OpenTelemetry-compatible sink.
//
// Components:
//   1. StructuredLogger       — consistent log envelope with correlation IDs
//   2. PipelineTracer         — distributed trace spans for generation pipelines
//   3. WorkerHealthReporter   — periodic heartbeat + health snapshot
//   4. MetricEmitter          — counters, histograms, and gauges for dashboards
//   5. HealthCheckRunner      — composite health checks for /api/health
//   6. AlertRuleEngine        — in-process alert evaluation (DLQ depth, error rate, stuck jobs)
//   7. DiagnosticDumper       — on-demand diagnostic snapshot for admin dashboards

import { z } from 'zod';

// ── Log levels ────────────────────────────────────────────────────────────────

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = typeof LOG_LEVELS[number];

// ── Structured log envelope ───────────────────────────────────────────────────

export interface LogEnvelope {
  level:         LogLevel;
  msg:           string;
  timestamp:     string;          // ISO 8601
  service:       string;          // 'arkiol-core' | 'animation-studio' | 'worker:generation' | etc.
  env:           string;          // 'production' | 'staging' | 'development'
  correlationId: string;          // traces across a single request lifecycle
  traceId?:      string;          // distributed trace ID (set by gateway/LB)
  spanId?:       string;          // span within the trace
  jobId?:        string;
  orgId?:        string;
  userId?:       string;
  workerId?:     string;
  stage?:        string;
  durationMs?:   number;
  errorCode?:    string;
  stack?:        string;
  [key: string]: unknown;         // arbitrary structured fields
}

// ── Structured logger factory ─────────────────────────────────────────────────

export interface LoggerOptions {
  service:   string;
  env:       string;
  workerId?: string;
  sink?:     (envelope: LogEnvelope) => void;  // custom sink (default: JSON to stdout)
}

export function createStructuredLogger(opts: LoggerOptions) {
  const { service, env, workerId } = opts;
  const sink = opts.sink ?? ((e: LogEnvelope) => {
    process.stdout.write(JSON.stringify(e) + '\n');
  });

  function log(level: LogLevel, fields: Record<string, unknown>, msg: string): void {
    const envelope: LogEnvelope = {
      level,
      msg,
      timestamp:     new Date().toISOString(),
      service,
      env,
      correlationId: (fields.correlationId as string) ?? buildCorrelationId(
        (fields.jobId as string) ?? '',
        (fields.orgId as string) ?? '',
        (fields.stage as string) ?? ''
      ),
      ...(workerId && { workerId }),
      ...fields,
    };
    sink(envelope);
  }

  return {
    debug: (fields: Record<string, unknown>, msg: string) => log('debug', fields, msg),
    info:  (fields: Record<string, unknown>, msg: string) => log('info',  fields, msg),
    warn:  (fields: Record<string, unknown>, msg: string) => log('warn',  fields, msg),
    error: (fields: Record<string, unknown>, msg: string) => log('error', fields, msg),
    fatal: (fields: Record<string, unknown>, msg: string) => log('fatal', fields, msg),
    // Convenience: log plain object
    raw:   (fields: Record<string, unknown>, msg: string, level: LogLevel = 'info') => log(level, fields, msg),
  };
}

// ── Correlation ID builder ────────────────────────────────────────────────────

export function buildCorrelationId(jobId: string, orgId: string, stage: string): string {
  const h = simpleHash(`${jobId}:${orgId}:${stage}`);
  return `cid_${h}`;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── Pipeline tracer ───────────────────────────────────────────────────────────

export interface TraceSpan {
  traceId:    string;
  spanId:     string;
  parentId:   string | null;
  name:       string;       // e.g. 'generation.pipeline', 'stage.LayoutIntelligence'
  startMs:    number;
  endMs:      number | null;
  durationMs: number | null;
  status:     'running' | 'ok' | 'fallback' | 'error';
  tags:       Record<string, string | number | boolean>;
  logs:       Array<{ timestampMs: number; fields: Record<string, unknown> }>;
}

export interface PipelineTracer {
  startSpan(name: string, tags?: Record<string, string | number | boolean>, parentId?: string): TraceSpan;
  endSpan(span: TraceSpan, status?: TraceSpan['status']): void;
  addLog(span: TraceSpan, fields: Record<string, unknown>): void;
  getSpans(): TraceSpan[];
  toExportFormat(): object;  // OpenTelemetry-compatible JSON
}

export function createPipelineTracer(traceId?: string): PipelineTracer {
  const id     = traceId ?? `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const spans: TraceSpan[] = [];

  function startSpan(name: string, tags: Record<string, string | number | boolean> = {}, parentId?: string): TraceSpan {
    const span: TraceSpan = {
      traceId:    id,
      spanId:     `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      parentId:   parentId ?? null,
      name,
      startMs:    Date.now(),
      endMs:      null,
      durationMs: null,
      status:     'running',
      tags,
      logs:       [],
    };
    spans.push(span);
    return span;
  }

  function endSpan(span: TraceSpan, status: TraceSpan['status'] = 'ok'): void {
    span.endMs      = Date.now();
    span.durationMs = span.endMs - span.startMs;
    span.status     = status;
  }

  function addLog(span: TraceSpan, fields: Record<string, unknown>): void {
    span.logs.push({ timestampMs: Date.now(), fields });
  }

  function getSpans(): TraceSpan[] { return [...spans]; }

  function toExportFormat(): object {
    return {
      traceId: id,
      spans:   spans.map(s => ({
        spanId:     s.spanId,
        parentId:   s.parentId,
        name:       s.name,
        startTime:  new Date(s.startMs).toISOString(),
        endTime:    s.endMs ? new Date(s.endMs).toISOString() : null,
        durationMs: s.durationMs,
        status:     s.status,
        tags:       s.tags,
        logsCount:  s.logs.length,
      })),
    };
  }

  return { startSpan, endSpan, addLog, getSpans, toExportFormat };
}

// ── Metric emitter ────────────────────────────────────────────────────────────

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricPoint {
  name:      string;
  type:      MetricType;
  value:     number;
  labels:    Record<string, string>;
  timestamp: string;
}

const _metrics: MetricPoint[] = [];
const MAX_METRICS = 10_000;

export function emitMetric(
  name:   string,
  type:   MetricType,
  value:  number,
  labels: Record<string, string> = {}
): void {
  if (_metrics.length >= MAX_METRICS) _metrics.shift();  // ring buffer
  _metrics.push({ name, type, value, labels, timestamp: new Date().toISOString() });
}

export function getMetrics(nameFilter?: string): MetricPoint[] {
  if (nameFilter) return _metrics.filter(m => m.name === nameFilter);
  return [..._metrics];
}

// Convenience helpers
export const metrics = {
  jobStarted:     (orgId: string) => emitMetric('job.started',     'counter', 1, { orgId }),
  jobCompleted:   (orgId: string, durationMs: number) => {
    emitMetric('job.completed',   'counter',   1,          { orgId });
    emitMetric('job.duration_ms', 'histogram', durationMs, { orgId });
  },
  jobFailed:      (orgId: string, errorCode: string) => emitMetric('job.failed',     'counter', 1, { orgId, errorCode }),
  jobDeadLettered:(orgId: string) => emitMetric('job.dead_lettered','counter', 1, { orgId }),
  creditCharged:  (orgId: string, amount: number) => emitMetric('credits.charged',  'counter', amount, { orgId }),
  creditRefunded: (orgId: string, amount: number) => emitMetric('credits.refunded', 'counter', amount, { orgId }),
  webhookDelivered: (orgId: string) => emitMetric('webhook.delivered', 'counter', 1, { orgId }),
  webhookFailed:    (orgId: string) => emitMetric('webhook.failed',    'counter', 1, { orgId }),
  stageFallback:    (stage: string) => emitMetric('stage.fallback',    'counter', 1, { stage }),
  stageLatency:     (stage: string, ms: number) => emitMetric('stage.latency_ms', 'histogram', ms, { stage }),
  parallelSpeedup:  (ratio: number) => emitMetric('pipeline.parallel_speedup', 'gauge', ratio, {}),
};

// ── Health check runner ───────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  name:      string;
  status:    HealthStatus;
  latencyMs: number;
  message:   string;
  details?:  Record<string, unknown>;
}

export interface CompositeHealthResult {
  overall:   HealthStatus;
  checks:    HealthCheckResult[];
  timestamp: string;
  uptimeMs:  number;
}

const _startTime = Date.now();

export type HealthCheck = () => Promise<HealthCheckResult>;

export async function runHealthChecks(checks: HealthCheck[]): Promise<CompositeHealthResult> {
  const results = await Promise.allSettled(checks.map(c => c()));
  const checkResults: HealthCheckResult[] = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name:      `check_${i}`,
      status:    'unhealthy' as HealthStatus,
      latencyMs: 0,
      message:   r.reason?.message ?? 'Health check threw',
    };
  });

  const anyUnhealthy = checkResults.some(c => c.status === 'unhealthy');
  const anyDegraded  = checkResults.some(c => c.status === 'degraded');
  const overall: HealthStatus = anyUnhealthy ? 'unhealthy' : anyDegraded ? 'degraded' : 'healthy';

  return {
    overall,
    checks:    checkResults,
    timestamp: new Date().toISOString(),
    uptimeMs:  Date.now() - _startTime,
  };
}

// Built-in checks
export function buildDbHealthCheck(prisma: any): HealthCheck {
  return async () => {
    const t = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { name: 'database', status: 'healthy', latencyMs: Date.now() - t, message: 'OK' };
    } catch (e: any) {
      return { name: 'database', status: 'unhealthy', latencyMs: Date.now() - t, message: e.message };
    }
  };
}

export function buildRedisHealthCheck(getRedis: () => any): HealthCheck {
  return async () => {
    const t = Date.now();
    try {
      const redis = getRedis();
      await redis.ping();
      return { name: 'redis', status: 'healthy', latencyMs: Date.now() - t, message: 'PONG' };
    } catch (e: any) {
      return { name: 'redis', status: 'unhealthy', latencyMs: Date.now() - t, message: e.message };
    }
  };
}

export function buildWorkerHealthCheck(
  workerName:    string,
  getActiveJobs: () => number,
  maxActiveJobs: number
): HealthCheck {
  return async () => {
    const active = getActiveJobs();
    const ratio  = active / maxActiveJobs;
    const status: HealthStatus = ratio > 0.95 ? 'degraded' : 'healthy';
    return {
      name:      `worker.${workerName}`,
      status,
      latencyMs: 0,
      message:   `${active}/${maxActiveJobs} active jobs`,
      details:   { activeJobs: active, maxJobs: maxActiveJobs, utilizationPct: Math.round(ratio * 100) },
    };
  };
}

export function buildDlqHealthCheck(
  getDlqDepth:    () => Promise<number>,
  alertThreshold: number = 10
): HealthCheck {
  return async () => {
    const t = Date.now();
    try {
      const depth  = await getDlqDepth();
      const status: HealthStatus = depth >= alertThreshold ? 'degraded' : 'healthy';
      return {
        name:      'dlq',
        status,
        latencyMs: Date.now() - t,
        message:   `DLQ depth: ${depth}`,
        details:   { depth, alertThreshold },
      };
    } catch (e: any) {
      return { name: 'dlq', status: 'degraded', latencyMs: Date.now() - t, message: e.message };
    }
  };
}

// ── Alert rule engine ─────────────────────────────────────────────────────────

export interface AlertRule {
  name:      string;
  evaluate:  () => Promise<{ firing: boolean; value: number; message: string }>;
  severity:  'warning' | 'critical';
}

export interface AlertResult {
  name:      string;
  firing:    boolean;
  severity:  AlertRule['severity'];
  value:     number;
  message:   string;
  evaluatedAt: string;
}

export async function evaluateAlerts(rules: AlertRule[]): Promise<AlertResult[]> {
  const results = await Promise.allSettled(rules.map(async rule => {
    const result = await rule.evaluate();
    return {
      name:        rule.name,
      firing:      result.firing,
      severity:    rule.severity,
      value:       result.value,
      message:     result.message,
      evaluatedAt: new Date().toISOString(),
    };
  }));

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => (r as PromiseFulfilledResult<AlertResult>).value);
}

// Built-in alert rules
export function buildDlqDepthAlert(getDlqDepth: () => Promise<number>, threshold = 10): AlertRule {
  return {
    name:     'dlq_depth_high',
    severity: 'critical',
    evaluate: async () => {
      const depth = await getDlqDepth();
      return { firing: depth >= threshold, value: depth, message: `DLQ depth is ${depth} (threshold: ${threshold})` };
    },
  };
}

export function buildStuckJobAlert(
  getStuckCount: () => Promise<number>,
  threshold = 3
): AlertRule {
  return {
    name:     'stuck_jobs',
    severity: 'warning',
    evaluate: async () => {
      const count = await getStuckCount();
      return { firing: count >= threshold, value: count, message: `${count} jobs stuck in RUNNING state` };
    },
  };
}

export function buildErrorRateAlert(
  windowMs:  number = 5 * 60 * 1000,
  threshold: number = 0.1  // 10% error rate
): AlertRule {
  return {
    name:     'high_error_rate',
    severity: 'warning',
    evaluate: async () => {
      const windowStart = Date.now() - windowMs;
      const recent      = _metrics.filter(m => new Date(m.timestamp).getTime() > windowStart);
      const completed   = recent.filter(m => m.name === 'job.completed').length;
      const failed      = recent.filter(m => m.name === 'job.failed').length;
      const total       = completed + failed;
      const errorRate   = total > 0 ? failed / total : 0;
      return {
        firing:  total > 5 && errorRate >= threshold,
        value:   errorRate,
        message: `Error rate: ${(errorRate * 100).toFixed(1)}% over last ${windowMs / 60000}min (${failed}/${total} jobs)`,
      };
    },
  };
}

// ── Diagnostic dumper ─────────────────────────────────────────────────────────

export interface DiagnosticDump {
  timestamp:      string;
  service:        string;
  uptimeMs:       number;
  metricsSample:  MetricPoint[];  // last 100 metric points
  recentAlerts:   AlertResult[];
  health:         CompositeHealthResult;
  environment:    Record<string, string>;
}

export async function generateDiagnosticDump(
  service:       string,
  healthChecks:  HealthCheck[],
  alertRules:    AlertRule[]
): Promise<DiagnosticDump> {
  const [health, alerts] = await Promise.all([
    runHealthChecks(healthChecks),
    evaluateAlerts(alertRules),
  ]);

  return {
    timestamp:     new Date().toISOString(),
    service,
    uptimeMs:      Date.now() - _startTime,
    metricsSample: _metrics.slice(-100),
    recentAlerts:  alerts,
    health,
    environment: {
      nodeVersion:   process.version,
      platform:      process.platform,
      memoryMb:      String(Math.round(process.memoryUsage().heapUsed / 1024 / 1024)),
      rss:           String(Math.round(process.memoryUsage().rss / 1024 / 1024)),
    },
  };
}
