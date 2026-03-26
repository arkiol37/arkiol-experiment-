/**
 * apps/arkiol-core/src/__tests__/observability.test.ts
 *
 * Unit tests for lib/observability.ts
 *
 * Covers the deterministic, side-effect-free functions:
 *  - buildCorrelationId — SHA-256 prefix:parts → 16-char hex
 *  - buildRequestId — composed from buildCorrelationId
 *  - buildEngineHealthSnapshot — status derivation, alert rules
 *  - buildFullDiagnosticsReport — structure, systemStatus aggregation
 *
 * The metrics singleton and logger are deliberately stateful between tests;
 * tests are designed to be order-independent by only asserting on properties
 * that don't depend on prior test state.
 */

import {
  buildCorrelationId,
  buildRequestId,
  buildEngineHealthSnapshot,
  buildFullDiagnosticsReport,
  metrics,
} from '../lib/observability';

// ══════════════════════════════════════════════════════════════════════════════
// buildCorrelationId
// ══════════════════════════════════════════════════════════════════════════════
describe('buildCorrelationId', () => {
  it('returns a 16-character string', () => {
    const id = buildCorrelationId('test', 'a', 'b');
    expect(typeof id).toBe('string');
    expect(id.length).toBe(16);
  });

  it('output is a valid lowercase hex string', () => {
    const id = buildCorrelationId('prefix', 'part1');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('same inputs produce the same output (deterministic)', () => {
    const a = buildCorrelationId('job', 'uuid-123', 'stage-1');
    const b = buildCorrelationId('job', 'uuid-123', 'stage-1');
    expect(a).toBe(b);
  });

  it('different prefixes produce different IDs', () => {
    const a = buildCorrelationId('prefix-a', 'same', 'parts');
    const b = buildCorrelationId('prefix-b', 'same', 'parts');
    expect(a).not.toBe(b);
  });

  it('different parts produce different IDs', () => {
    const a = buildCorrelationId('prefix', 'part-a');
    const b = buildCorrelationId('prefix', 'part-b');
    expect(a).not.toBe(b);
  });

  it('part ordering matters', () => {
    const a = buildCorrelationId('p', 'x', 'y');
    const b = buildCorrelationId('p', 'y', 'x');
    expect(a).not.toBe(b);
  });

  it('works with a single part', () => {
    const id = buildCorrelationId('solo', 'only-part');
    expect(id.length).toBe(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('works with many parts', () => {
    const id = buildCorrelationId('multi', 'a', 'b', 'c', 'd', 'e', 'f');
    expect(id.length).toBe(16);
  });

  it('works with empty parts', () => {
    const id = buildCorrelationId('prefix');
    expect(id.length).toBe(16);
  });

  it('returns different IDs for UUID-like inputs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(buildCorrelationId('job', `uuid-${i}`, 'stage'));
    }
    // All 50 should be unique (SHA-256 collisions at 16 chars are astronomically rare)
    expect(ids.size).toBe(50);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildRequestId
// ══════════════════════════════════════════════════════════════════════════════
describe('buildRequestId', () => {
  it('returns a 16-character hex string', () => {
    const id = buildRequestId('job-123', 'stage-1', 1);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic for the same inputs', () => {
    const a = buildRequestId('job-abc', 'stage-2', 3);
    const b = buildRequestId('job-abc', 'stage-2', 3);
    expect(a).toBe(b);
  });

  it('different attempt numbers produce different IDs', () => {
    const a = buildRequestId('same-job', 'same-stage', 1);
    const b = buildRequestId('same-job', 'same-stage', 2);
    expect(a).not.toBe(b);
  });

  it('different jobIds produce different IDs', () => {
    const a = buildRequestId('job-1', 'stage', 1);
    const b = buildRequestId('job-2', 'stage', 1);
    expect(a).not.toBe(b);
  });

  it('different stageIds produce different IDs', () => {
    const a = buildRequestId('job', 'stage-a', 1);
    const b = buildRequestId('job', 'stage-b', 1);
    expect(a).not.toBe(b);
  });

  it('uses "req" prefix (different from a raw buildCorrelationId with a different prefix)', () => {
    const req = buildRequestId('job', 'stage', 1);
    const other = buildCorrelationId('other', 'job', 'stage', '1');
    expect(req).not.toBe(other);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildEngineHealthSnapshot
// ══════════════════════════════════════════════════════════════════════════════
describe('buildEngineHealthSnapshot', () => {
  it('returns an object with engineName matching the input', () => {
    const snap = buildEngineHealthSnapshot('my_engine');
    expect(snap.engineName).toBe('my_engine');
  });

  it('status is one of "healthy", "degraded", or "critical"', () => {
    const snap = buildEngineHealthSnapshot('test_engine');
    expect(['healthy', 'degraded', 'critical']).toContain(snap.status);
  });

  it('lastUpdatedAt is a valid ISO date string', () => {
    const snap = buildEngineHealthSnapshot('test_engine');
    expect(() => new Date(snap.lastUpdatedAt)).not.toThrow();
    expect(new Date(snap.lastUpdatedAt).toISOString()).toBe(snap.lastUpdatedAt);
  });

  it('errorRateLast5min is a non-negative number', () => {
    const snap = buildEngineHealthSnapshot('test_engine');
    expect(snap.errorRateLast5min).toBeGreaterThanOrEqual(0);
  });

  it('avgLatencyMs is a non-negative number', () => {
    const snap = buildEngineHealthSnapshot('test_engine');
    expect(snap.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('totalRequestsLast1h is a non-negative number', () => {
    const snap = buildEngineHealthSnapshot('test_engine');
    expect(snap.totalRequestsLast1h).toBeGreaterThanOrEqual(0);
  });

  it('alerts is an array', () => {
    const snap = buildEngineHealthSnapshot('test_engine');
    expect(Array.isArray(snap.alerts)).toBe(true);
  });

  it('with zero errors, status is "healthy"', () => {
    // Fresh engine name that hasn't accumulated errors
    const snap = buildEngineHealthSnapshot('pristine_engine_no_errors_xyz');
    expect(snap.status).toBe('healthy');
    expect(snap.alerts).toHaveLength(0);
  });

  it('two snapshots for the same engine have the same engineName', () => {
    const a = buildEngineHealthSnapshot('same_engine');
    const b = buildEngineHealthSnapshot('same_engine');
    expect(a.engineName).toBe(b.engineName);
  });

  it('different engine names produce different snapshots', () => {
    const a = buildEngineHealthSnapshot('engine_alpha');
    const b = buildEngineHealthSnapshot('engine_beta');
    expect(a.engineName).not.toBe(b.engineName);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildFullDiagnosticsReport
// ══════════════════════════════════════════════════════════════════════════════
describe('buildFullDiagnosticsReport', () => {
  let report: ReturnType<typeof buildFullDiagnosticsReport>;

  beforeAll(() => {
    report = buildFullDiagnosticsReport();
  });

  it('returns an object with required top-level keys', () => {
    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('engines');
    expect(report).toHaveProperty('metrics');
    expect(report).toHaveProperty('recentErrors');
    expect(report).toHaveProperty('systemStatus');
  });

  it('timestamp is a valid ISO string', () => {
    expect(() => new Date(report.timestamp)).not.toThrow();
    expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
  });

  it('engines is a non-empty array', () => {
    expect(Array.isArray(report.engines)).toBe(true);
    expect(report.engines.length).toBeGreaterThan(0);
  });

  it('engines includes all 6 expected engine names', () => {
    const names = report.engines.map(e => e.engineName);
    expect(names).toContain('exploration_engine');
    expect(names).toContain('platform_intelligence');
    expect(names).toContain('campaign_director');
    expect(names).toContain('render_queue');
    expect(names).toContain('asset_library');
    expect(names).toContain('pipeline_orchestrator');
  });

  it('all engine snapshots have valid status values', () => {
    for (const engine of report.engines) {
      expect(['healthy', 'degraded', 'critical']).toContain(engine.status);
    }
  });

  it('systemStatus is derived from engine statuses', () => {
    expect(['healthy', 'degraded', 'critical']).toContain(report.systemStatus);
  });

  it('systemStatus=critical if any engine is critical', () => {
    if (report.engines.some(e => e.status === 'critical')) {
      expect(report.systemStatus).toBe('critical');
    }
  });

  it('systemStatus=degraded if any engine is degraded (and none are critical)', () => {
    const hasCritical = report.engines.some(e => e.status === 'critical');
    const hasDegraded = report.engines.some(e => e.status === 'degraded');
    if (hasDegraded && !hasCritical) {
      expect(report.systemStatus).toBe('degraded');
    }
  });

  it('systemStatus=healthy only if all engines are healthy', () => {
    const allHealthy = report.engines.every(e => e.status === 'healthy');
    if (allHealthy) {
      expect(report.systemStatus).toBe('healthy');
    }
  });

  it('metrics is an array', () => {
    expect(Array.isArray(report.metrics)).toBe(true);
  });

  it('recentErrors is an array', () => {
    expect(Array.isArray(report.recentErrors)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MetricsRegistry (exported singleton) — basic contract
// ══════════════════════════════════════════════════════════════════════════════
describe('metrics singleton', () => {
  it('is exported as a non-null object', () => {
    expect(metrics).not.toBeNull();
    expect(typeof metrics).toBe('object');
  });

  it('has increment method', () => {
    expect(typeof metrics.increment).toBe('function');
  });

  it('has gauge method', () => {
    expect(typeof metrics.gauge).toBe('function');
  });

  it('has observe method', () => {
    expect(typeof metrics.observe).toBe('function');
  });

  it('has getCounter method', () => {
    expect(typeof metrics.getCounter).toBe('function');
  });

  it('getCounter returns 0 for unseen metric', () => {
    const val = metrics.getCounter('__test_unseen_metric_xyz__', { label: 'test' });
    expect(val).toBe(0);
  });

  it('increment increases the counter', () => {
    const key = '__test_counter_increment__';
    const before = metrics.getCounter(key);
    metrics.increment(key, {}, 5);
    const after = metrics.getCounter(key);
    expect(after).toBe(before + 5);
  });

  it('does not throw when called with unusual inputs', () => {
    expect(() => metrics.increment('', {})).not.toThrow();
    expect(() => metrics.gauge('test', NaN)).not.toThrow();
    expect(() => metrics.observe('test', Infinity)).not.toThrow();
  });

  it('snapshot returns an array', () => {
    const snap = metrics.snapshot();
    expect(Array.isArray(snap)).toBe(true);
  });
});
