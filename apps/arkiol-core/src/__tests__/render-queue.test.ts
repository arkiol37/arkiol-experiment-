/**
 * apps/arkiol-core/src/__tests__/render-queue.test.ts
 *
 * Unit tests for engines/queue/render-queue.ts
 *
 * Pure functions & classes — no DB, no HTTP, no Next.js.
 *
 * Covers:
 *  - PROVIDER_CONFIGS — all 5 providers exist, required fields
 *  - DEFAULT_RETRY_POLICIES — all 4 priorities, maxAttempts ordering
 *  - PRIORITY_WEIGHTS — critical > high > normal > low
 *  - COMPUTE_LIMITS — all fields present, sensible values
 *  - calculateRetryDelay — exponential backoff, max cap, deterministic with seed
 *  - shouldRetry — attempt limit, non-retriable error patterns
 *  - RenderTimeoutError — fields, instanceof Error
 *  - buildProviderChain — preferred first, exclude list, fallback order
 *  - ProviderHealthTracker — recordFailure, isHealthy, window reset, getHealthyProviders
 *  - CostMonitor — record idempotency, checkBudget hourly/daily, buildIdempotencyKey
 *  - computeJobSortKey — priority weight dominates for new jobs, age bonus accumulates
 *  - sortJobsByPriority — correct ordering
 *  - inferJobPriority — all 5 cases
 *  - checkComputeSafety — 4 failure modes + success
 *  - buildRenderJobSpec — defaults, maxBudgetUsd cap, priority→policy
 */

import {
  PROVIDER_CONFIGS,
  DEFAULT_RETRY_POLICIES,
  PRIORITY_WEIGHTS,
  COMPUTE_LIMITS,
  calculateRetryDelay,
  shouldRetry,
  RenderTimeoutError,
  buildProviderChain,
  ProviderHealthTracker,
  CostMonitor,
  computeJobSortKey,
  sortJobsByPriority,
  inferJobPriority,
  checkComputeSafety,
  buildRenderJobSpec,
  type RenderJobSpec,
  type RetryPolicy,
  type CostAccumulation,
} from '../engines/queue/render-queue';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const NORMAL_POLICY: RetryPolicy = DEFAULT_RETRY_POLICIES.normal;

function makeJob(overrides: Partial<RenderJobSpec> = {}): RenderJobSpec {
  return {
    jobId:          'job-001',
    orgId:          'org-001',
    userId:         'user-001',
    format:         'instagram_post',
    priority:       'normal',
    maxAttempts:    3,
    timeoutMs:      30_000,
    maxBudgetUsd:   1.0,
    attempts:       0,
    isCampaignJob:  false,
    createdAt:      new Date().toISOString(),
    ...overrides,
  };
}

function makeAccumulation(overrides: Partial<CostAccumulation> = {}): CostAccumulation {
  return {
    jobId:           'job-001',
    orgId:           'org-001',
    provider:        'openai' as any,
    costUsd:         0.10,
    idempotencyKey:  'idem-001',
    recordedAt:      new Date().toISOString(),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PROVIDER_CONFIGS
// ══════════════════════════════════════════════════════════════════════════════
describe('PROVIDER_CONFIGS', () => {
  const PROVIDERS = ['openai', 'stability', 'replicate', 'local', 'fallback_svg'] as const;

  it('has all 5 providers', () => {
    for (const p of PROVIDERS) {
      expect(PROVIDER_CONFIGS[p]).toBeDefined();
    }
  });

  it('all providers have required fields', () => {
    for (const [, cfg] of Object.entries(PROVIDER_CONFIGS)) {
      expect(typeof cfg.name).toBe('string');
      expect(typeof cfg.maxCostPerCallUsd).toBe('number');
      expect(typeof cfg.timeoutMs).toBe('number');
      expect(typeof cfg.isFailoverProvider).toBe('boolean');
      expect(typeof cfg.order).toBe('number');
    }
  });

  it('openai is the primary (non-failover) provider', () => {
    expect(PROVIDER_CONFIGS.openai.isFailoverProvider).toBe(false);
  });

  it('all other providers are failover providers', () => {
    const failovers = ['stability', 'replicate', 'local', 'fallback_svg'] as const;
    for (const p of failovers) {
      expect(PROVIDER_CONFIGS[p].isFailoverProvider).toBe(true);
    }
  });

  it('openai has lowest order value (routes first)', () => {
    const orders = Object.values(PROVIDER_CONFIGS).map(p => p.order);
    expect(PROVIDER_CONFIGS.openai.order).toBe(Math.min(...orders));
  });

  it('fallback_svg has highest order value (last resort)', () => {
    const orders = Object.values(PROVIDER_CONFIGS).map(p => p.order);
    expect(PROVIDER_CONFIGS.fallback_svg.order).toBe(Math.max(...orders));
  });

  it('all timeoutMs values are positive', () => {
    for (const [, cfg] of Object.entries(PROVIDER_CONFIGS)) {
      expect(cfg.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('fallback_svg has zero cost', () => {
    expect(PROVIDER_CONFIGS.fallback_svg.maxCostPerCallUsd).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DEFAULT_RETRY_POLICIES
// ══════════════════════════════════════════════════════════════════════════════
describe('DEFAULT_RETRY_POLICIES', () => {
  const PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;

  it('has all 4 priority levels', () => {
    for (const p of PRIORITIES) {
      expect(DEFAULT_RETRY_POLICIES[p]).toBeDefined();
    }
  });

  it('all policies have required fields', () => {
    for (const [, policy] of Object.entries(DEFAULT_RETRY_POLICIES)) {
      expect(typeof policy.maxAttempts).toBe('number');
      expect(typeof policy.baseDelayMs).toBe('number');
      expect(typeof policy.maxDelayMs).toBe('number');
      expect(typeof policy.backoffMultiplier).toBe('number');
      expect(typeof policy.jitterFraction).toBe('number');
    }
  });

  it('critical has most attempts (5)', () => {
    expect(DEFAULT_RETRY_POLICIES.critical.maxAttempts).toBe(5);
  });

  it('low has fewest attempts (2)', () => {
    expect(DEFAULT_RETRY_POLICIES.low.maxAttempts).toBe(2);
  });

  it('maxAttempts decreases from critical → low', () => {
    expect(DEFAULT_RETRY_POLICIES.critical.maxAttempts)
      .toBeGreaterThan(DEFAULT_RETRY_POLICIES.high.maxAttempts);
    expect(DEFAULT_RETRY_POLICIES.high.maxAttempts)
      .toBeGreaterThanOrEqual(DEFAULT_RETRY_POLICIES.normal.maxAttempts);
    expect(DEFAULT_RETRY_POLICIES.normal.maxAttempts)
      .toBeGreaterThan(DEFAULT_RETRY_POLICIES.low.maxAttempts);
  });

  it('all maxDelayMs > baseDelayMs', () => {
    for (const [, policy] of Object.entries(DEFAULT_RETRY_POLICIES)) {
      expect(policy.maxDelayMs).toBeGreaterThan(policy.baseDelayMs);
    }
  });

  it('all jitterFraction values are in (0, 1)', () => {
    for (const [, policy] of Object.entries(DEFAULT_RETRY_POLICIES)) {
      expect(policy.jitterFraction).toBeGreaterThan(0);
      expect(policy.jitterFraction).toBeLessThan(1);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PRIORITY_WEIGHTS
// ══════════════════════════════════════════════════════════════════════════════
describe('PRIORITY_WEIGHTS', () => {
  it('critical > high > normal > low', () => {
    expect(PRIORITY_WEIGHTS.critical).toBeGreaterThan(PRIORITY_WEIGHTS.high);
    expect(PRIORITY_WEIGHTS.high).toBeGreaterThan(PRIORITY_WEIGHTS.normal);
    expect(PRIORITY_WEIGHTS.normal).toBeGreaterThan(PRIORITY_WEIGHTS.low);
  });

  it('all values are positive integers', () => {
    for (const [, w] of Object.entries(PRIORITY_WEIGHTS)) {
      expect(Number.isInteger(w)).toBe(true);
      expect(w).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// COMPUTE_LIMITS
// ══════════════════════════════════════════════════════════════════════════════
describe('COMPUTE_LIMITS', () => {
  it('has all required fields', () => {
    expect(typeof COMPUTE_LIMITS.maxConcurrentJobsPerOrg).toBe('number');
    expect(typeof COMPUTE_LIMITS.maxConcurrentJobsGlobal).toBe('number');
    expect(typeof COMPUTE_LIMITS.maxHourlySpendPerOrgUsd).toBe('number');
    expect(typeof COMPUTE_LIMITS.maxDailySpendPerOrgUsd).toBe('number');
    expect(typeof COMPUTE_LIMITS.maxSingleJobBudgetUsd).toBe('number');
    expect(typeof COMPUTE_LIMITS.campaignBatchMaxFormats).toBe('number');
  });

  it('all values are positive', () => {
    for (const [, v] of Object.entries(COMPUTE_LIMITS)) {
      expect(v).toBeGreaterThan(0);
    }
  });

  it('daily spend > hourly spend', () => {
    expect(COMPUTE_LIMITS.maxDailySpendPerOrgUsd)
      .toBeGreaterThan(COMPUTE_LIMITS.maxHourlySpendPerOrgUsd);
  });

  it('global concurrent > per-org concurrent', () => {
    expect(COMPUTE_LIMITS.maxConcurrentJobsGlobal)
      .toBeGreaterThan(COMPUTE_LIMITS.maxConcurrentJobsPerOrg);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// calculateRetryDelay
// ══════════════════════════════════════════════════════════════════════════════
describe('calculateRetryDelay', () => {
  it('returns a non-negative integer', () => {
    const delay = calculateRetryDelay(0, NORMAL_POLICY, 'seed1');
    expect(Number.isInteger(delay)).toBe(true);
    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it('delay increases with attempt number', () => {
    const d0 = calculateRetryDelay(0, NORMAL_POLICY, 'seed');
    const d1 = calculateRetryDelay(1, NORMAL_POLICY, 'seed');
    const d2 = calculateRetryDelay(2, NORMAL_POLICY, 'seed');
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });

  it('delay never exceeds maxDelayMs by more than jitter', () => {
    for (let i = 0; i < 10; i++) {
      const delay = calculateRetryDelay(i, NORMAL_POLICY, `seed-${i}`);
      const maxAllowed = NORMAL_POLICY.maxDelayMs * (1 + NORMAL_POLICY.jitterFraction);
      expect(delay).toBeLessThanOrEqual(maxAllowed + 1);
    }
  });

  it('is deterministic with the same seed and attempt', () => {
    const a = calculateRetryDelay(2, NORMAL_POLICY, 'fixed-seed');
    const b = calculateRetryDelay(2, NORMAL_POLICY, 'fixed-seed');
    expect(a).toBe(b);
  });

  it('different seeds produce different delays (most of the time)', () => {
    const delays = Array.from({ length: 5 }, (_, i) =>
      calculateRetryDelay(1, NORMAL_POLICY, `seed-${i}`)
    );
    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it('attempt=0 uses baseDelayMs as base', () => {
    // base = 2000 * 2^0 = 2000; clamped; result ≈ 2000 ± jitter
    const delay = calculateRetryDelay(0, NORMAL_POLICY, 'seed');
    const base = NORMAL_POLICY.baseDelayMs;
    const maxJitter = NORMAL_POLICY.jitterFraction * base;
    expect(delay).toBeGreaterThanOrEqual(base - maxJitter - 1);
    expect(delay).toBeLessThanOrEqual(base + maxJitter + 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// shouldRetry
// ══════════════════════════════════════════════════════════════════════════════
describe('shouldRetry', () => {
  it('returns false when attempts >= maxAttempts', () => {
    expect(shouldRetry(makeJob({ attempts: 3, maxAttempts: 3 }), 'network error')).toBe(false);
    expect(shouldRetry(makeJob({ attempts: 5, maxAttempts: 3 }), 'network error')).toBe(false);
  });

  it('returns true for retriable error when under limit', () => {
    expect(shouldRetry(makeJob({ attempts: 1, maxAttempts: 3 }), 'timeout')).toBe(true);
    expect(shouldRetry(makeJob({ attempts: 0, maxAttempts: 3 }), 'network error')).toBe(true);
  });

  it('returns false for kill_switch_active regardless of attempts', () => {
    expect(shouldRetry(makeJob({ attempts: 0 }), 'kill_switch_active')).toBe(false);
  });

  it('returns false for spend_guard_blocked', () => {
    expect(shouldRetry(makeJob({ attempts: 0 }), 'spend_guard_blocked')).toBe(false);
  });

  it('returns false for plan_limit_exceeded', () => {
    expect(shouldRetry(makeJob({ attempts: 0 }), 'plan_limit_exceeded')).toBe(false);
  });

  it('returns false for credit_insufficient', () => {
    expect(shouldRetry(makeJob({ attempts: 0 }), 'credit_insufficient')).toBe(false);
  });

  it('returns false for content_policy_violation', () => {
    expect(shouldRetry(makeJob({ attempts: 0 }), 'content_policy_violation')).toBe(false);
  });

  it('non-retriable checks are case-insensitive', () => {
    expect(shouldRetry(makeJob({ attempts: 0 }), 'KILL_SWITCH_ACTIVE')).toBe(false);
    expect(shouldRetry(makeJob({ attempts: 0 }), 'SPEND_GUARD_BLOCKED')).toBe(false);
  });

  it('returns true for generic retriable errors', () => {
    const retriable = ['ECONNRESET', 'timeout', '503 Service Unavailable', 'rate limit'];
    for (const err of retriable) {
      expect(shouldRetry(makeJob({ attempts: 0, maxAttempts: 3 }), err)).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RenderTimeoutError
// ══════════════════════════════════════════════════════════════════════════════
describe('RenderTimeoutError', () => {
  it('is an instance of Error', () => {
    expect(new RenderTimeoutError('job-1', 30000)).toBeInstanceOf(Error);
  });

  it('jobId and timeoutMs are set', () => {
    const e = new RenderTimeoutError('job-abc', 15000);
    expect(e.jobId).toBe('job-abc');
    expect(e.timeoutMs).toBe(15000);
  });

  it('code is RENDER_TIMEOUT', () => {
    expect(new RenderTimeoutError('j', 1).code).toBe('RENDER_TIMEOUT');
  });

  it('message mentions the jobId and timeoutMs', () => {
    const e = new RenderTimeoutError('job-xyz', 25000);
    expect(e.message).toContain('job-xyz');
    expect(e.message).toContain('25000');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildProviderChain
// ══════════════════════════════════════════════════════════════════════════════
describe('buildProviderChain', () => {
  it('puts preferred provider first', () => {
    const chain = buildProviderChain('openai');
    expect(chain[0]).toBe('openai');
  });

  it('includes all 5 providers when no exclusions', () => {
    expect(buildProviderChain('openai').length).toBe(5);
  });

  it('excludes specified providers', () => {
    const chain = buildProviderChain('openai', ['stability', 'replicate']);
    expect(chain).not.toContain('stability');
    expect(chain).not.toContain('replicate');
  });

  it('excluded preferred provider falls back to next by order', () => {
    const chain = buildProviderChain('openai', ['openai']);
    expect(chain[0]).toBe('stability'); // next by order
    expect(chain).not.toContain('openai');
  });

  it('remaining providers are ordered by their order field', () => {
    const chain = buildProviderChain('openai');
    // After openai (order=1): stability(2), replicate(3), local(4), fallback_svg(99)
    expect(chain[1]).toBe('stability');
    expect(chain[chain.length - 1]).toBe('fallback_svg');
  });

  it('works with stability as preferred', () => {
    const chain = buildProviderChain('stability');
    expect(chain[0]).toBe('stability');
    expect(chain.length).toBe(5);
  });

  it('excludes all providers → returns empty array', () => {
    const all = ['openai', 'stability', 'replicate', 'local', 'fallback_svg'] as any[];
    const chain = buildProviderChain('openai', all);
    expect(chain.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ProviderHealthTracker
// ══════════════════════════════════════════════════════════════════════════════
describe('ProviderHealthTracker', () => {
  it('new providers are healthy', () => {
    const tracker = new ProviderHealthTracker();
    expect(tracker.isHealthy('openai')).toBe(true);
  });

  it('provider becomes unhealthy after 3 failures', () => {
    const tracker = new ProviderHealthTracker();
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    expect(tracker.isHealthy('openai')).toBe(false);
  });

  it('provider remains healthy after 2 failures', () => {
    const tracker = new ProviderHealthTracker();
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    expect(tracker.isHealthy('openai')).toBe(true);
  });

  it('reset() makes provider healthy again', () => {
    const tracker = new ProviderHealthTracker();
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    tracker.reset('openai');
    expect(tracker.isHealthy('openai')).toBe(true);
  });

  it('failures on one provider do not affect another', () => {
    const tracker = new ProviderHealthTracker();
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    expect(tracker.isHealthy('stability')).toBe(true);
  });

  it('getHealthyProviders filters unhealthy providers', () => {
    const tracker = new ProviderHealthTracker();
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    const healthy = tracker.getHealthyProviders(['openai', 'stability', 'replicate']);
    expect(healthy).not.toContain('openai');
    expect(healthy).toContain('stability');
    expect(healthy).toContain('replicate');
  });

  it('getHealthyProviders returns all when none have failed', () => {
    const tracker = new ProviderHealthTracker();
    const chain = ['openai', 'stability', 'replicate'] as const;
    expect(tracker.getHealthyProviders([...chain])).toEqual([...chain]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CostMonitor
// ══════════════════════════════════════════════════════════════════════════════
describe('CostMonitor', () => {
  it('record() returns accepted:true for new key', () => {
    const monitor = new CostMonitor();
    expect(monitor.record(makeAccumulation()).accepted).toBe(true);
  });

  it('record() returns accepted:false for duplicate idempotencyKey', () => {
    const monitor = new CostMonitor();
    const acc = makeAccumulation({ idempotencyKey: 'dup-key' });
    monitor.record(acc);
    const result = monitor.record(acc);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('duplicate_idempotency_key');
  });

  it('getOrgHourlySpend accumulates correctly', () => {
    const monitor = new CostMonitor();
    monitor.record(makeAccumulation({ idempotencyKey: 'k1', costUsd: 5.0 }));
    monitor.record(makeAccumulation({ idempotencyKey: 'k2', costUsd: 3.0 }));
    expect(monitor.getOrgHourlySpend('org-001')).toBeCloseTo(8.0, 5);
  });

  it('getOrgDailySpend accumulates correctly', () => {
    const monitor = new CostMonitor();
    monitor.record(makeAccumulation({ idempotencyKey: 'k1', costUsd: 10.0 }));
    expect(monitor.getOrgDailySpend('org-001')).toBeCloseTo(10.0, 5);
  });

  it('checkBudget returns withinBudget:true when under limits', () => {
    const monitor = new CostMonitor();
    monitor.record(makeAccumulation({ costUsd: 1.0, idempotencyKey: 'k1' }));
    expect(monitor.checkBudget('org-001').withinBudget).toBe(true);
  });

  it('checkBudget returns withinBudget:false when hourly limit exceeded', () => {
    const monitor = new CostMonitor();
    // maxHourlySpendPerOrgUsd = 25.0
    monitor.record(makeAccumulation({ costUsd: 25.0, idempotencyKey: 'k1' }));
    const status = monitor.checkBudget('org-001');
    expect(status.withinBudget).toBe(false);
    expect(status.reason).toMatch(/hourly/i);
  });

  it('checkBudget returns withinBudget:false when daily limit exceeded', () => {
    const monitor = new CostMonitor();
    // max daily = 100 — add in chunks to avoid hourly trigger first
    // Record 5 orgs? No — we need single org. Use 4 × $25 = $100
    monitor.record(makeAccumulation({ costUsd: 25.0, idempotencyKey: 'k1' }));
    monitor.record(makeAccumulation({ costUsd: 25.0, idempotencyKey: 'k2' }));
    monitor.record(makeAccumulation({ costUsd: 25.0, idempotencyKey: 'k3' }));
    monitor.record(makeAccumulation({ costUsd: 25.0, idempotencyKey: 'k4' }));
    const status = monitor.checkBudget('org-001');
    expect(status.withinBudget).toBe(false);
  });

  it('different orgs have isolated budgets', () => {
    const monitor = new CostMonitor();
    monitor.record(makeAccumulation({ orgId: 'org-A', costUsd: 25.0, idempotencyKey: 'k1' }));
    expect(monitor.checkBudget('org-B').withinBudget).toBe(true);
  });

  it('buildIdempotencyKey returns 24-char hex string', () => {
    const monitor = new CostMonitor();
    const key = monitor.buildIdempotencyKey('job-1', 'openai', 0);
    expect(key).toMatch(/^[0-9a-f]{24}$/);
  });

  it('buildIdempotencyKey is deterministic', () => {
    const monitor = new CostMonitor();
    const a = monitor.buildIdempotencyKey('job-1', 'openai', 0);
    const b = monitor.buildIdempotencyKey('job-1', 'openai', 0);
    expect(a).toBe(b);
  });

  it('buildIdempotencyKey differs for different attempts', () => {
    const monitor = new CostMonitor();
    const a = monitor.buildIdempotencyKey('job-1', 'openai', 0);
    const b = monitor.buildIdempotencyKey('job-1', 'openai', 1);
    expect(a).not.toBe(b);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// computeJobSortKey & sortJobsByPriority
// ══════════════════════════════════════════════════════════════════════════════
describe('computeJobSortKey', () => {
  it('critical job has higher sort key than normal job (same age)', () => {
    const now = new Date().toISOString();
    const critical = computeJobSortKey(makeJob({ priority: 'critical', createdAt: now }));
    const normal   = computeJobSortKey(makeJob({ priority: 'normal',   createdAt: now }));
    expect(critical).toBeGreaterThan(normal);
  });

  it('older jobs get a slight bonus (age bonus)', () => {
    const oldDate = new Date(Date.now() - 60_000).toISOString();
    const newDate = new Date().toISOString();
    const old = computeJobSortKey(makeJob({ priority: 'normal', createdAt: oldDate }));
    const now = computeJobSortKey(makeJob({ priority: 'normal', createdAt: newDate }));
    expect(old).toBeGreaterThan(now);
  });
});

describe('sortJobsByPriority', () => {
  it('sorts critical before normal before low', () => {
    const now = new Date().toISOString();
    const jobs = [
      makeJob({ jobId: 'low',      priority: 'low',      createdAt: now }),
      makeJob({ jobId: 'critical', priority: 'critical', createdAt: now }),
      makeJob({ jobId: 'normal',   priority: 'normal',   createdAt: now }),
    ];
    const sorted = sortJobsByPriority(jobs);
    expect(sorted[0]!.jobId).toBe('critical');
    expect(sorted[2]!.jobId).toBe('low');
  });

  it('does not mutate the input array', () => {
    const jobs = [makeJob({ priority: 'low' }), makeJob({ priority: 'critical' })];
    sortJobsByPriority(jobs);
    expect(jobs[0]!.priority).toBe('low'); // original order preserved
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// inferJobPriority
// ══════════════════════════════════════════════════════════════════════════════
describe('inferJobPriority', () => {
  const base = { isCampaignHero: false, isCampaignJob: false, isRegen: false, isFirstGeneration: false };

  it('isCampaignHero → critical', () => {
    expect(inferJobPriority({ ...base, isCampaignHero: true })).toBe('critical');
  });

  it('isFirstGeneration → high', () => {
    expect(inferJobPriority({ ...base, isFirstGeneration: true })).toBe('high');
  });

  it('isCampaignJob → normal', () => {
    expect(inferJobPriority({ ...base, isCampaignJob: true })).toBe('normal');
  });

  it('isRegen → normal', () => {
    expect(inferJobPriority({ ...base, isRegen: true })).toBe('normal');
  });

  it('no flags → low', () => {
    expect(inferJobPriority(base)).toBe('low');
  });

  it('campaignHero overrides all other flags', () => {
    expect(inferJobPriority({ isCampaignHero: true, isCampaignJob: true, isRegen: true, isFirstGeneration: true }))
      .toBe('critical');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkComputeSafety
// ══════════════════════════════════════════════════════════════════════════════
describe('checkComputeSafety', () => {
  it('allows job within all limits', () => {
    const monitor = new CostMonitor();
    const result = checkComputeSafety(makeJob(), 0, monitor);
    expect(result.allowed).toBe(true);
  });

  it('blocks when activeJobCount >= maxConcurrentJobsPerOrg', () => {
    const monitor = new CostMonitor();
    const result = checkComputeSafety(makeJob(), COMPUTE_LIMITS.maxConcurrentJobsPerOrg, monitor);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('CONCURRENT_JOB_LIMIT');
  });

  it('blocks when job maxBudgetUsd > maxSingleJobBudgetUsd', () => {
    const monitor = new CostMonitor();
    const job = makeJob({ maxBudgetUsd: COMPUTE_LIMITS.maxSingleJobBudgetUsd + 1 });
    const result = checkComputeSafety(job, 0, monitor);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('JOB_BUDGET_EXCEEDED');
  });

  it('blocks when hourly spend limit exceeded', () => {
    const monitor = new CostMonitor();
    monitor.record(makeAccumulation({ costUsd: COMPUTE_LIMITS.maxHourlySpendPerOrgUsd, idempotencyKey: 'k1' }));
    const result = checkComputeSafety(makeJob(), 0, monitor);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('SPEND_GUARD_BLOCKED');
  });

  it('blocks campaign job missing campaignId', () => {
    const monitor = new CostMonitor();
    const job = makeJob({ isCampaignJob: true, campaignId: undefined });
    const result = checkComputeSafety(job, 0, monitor);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('INVALID_CAMPAIGN_JOB');
  });

  it('allows campaign job with campaignId set', () => {
    const monitor = new CostMonitor();
    const job = makeJob({ isCampaignJob: true, campaignId: 'camp-001' });
    const result = checkComputeSafety(job, 0, monitor);
    expect(result.allowed).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildRenderJobSpec
// ══════════════════════════════════════════════════════════════════════════════
describe('buildRenderJobSpec', () => {
  const OPTS = { jobId: 'j1', orgId: 'o1', userId: 'u1', format: 'instagram_post' };

  it('returns a job with the provided fields', () => {
    const spec = buildRenderJobSpec(OPTS);
    expect(spec.jobId).toBe('j1');
    expect(spec.orgId).toBe('o1');
    expect(spec.userId).toBe('u1');
    expect(spec.format).toBe('instagram_post');
  });

  it('defaults to "normal" priority', () => {
    expect(buildRenderJobSpec(OPTS).priority).toBe('normal');
  });

  it('uses custom priority when provided', () => {
    expect(buildRenderJobSpec({ ...OPTS, priority: 'critical' }).priority).toBe('critical');
  });

  it('maxAttempts comes from the corresponding retry policy', () => {
    const normal = buildRenderJobSpec({ ...OPTS, priority: 'normal' });
    expect(normal.maxAttempts).toBe(DEFAULT_RETRY_POLICIES.normal.maxAttempts);

    const critical = buildRenderJobSpec({ ...OPTS, priority: 'critical' });
    expect(critical.maxAttempts).toBe(DEFAULT_RETRY_POLICIES.critical.maxAttempts);
  });

  it('maxBudgetUsd defaults to 1.0 and is capped at maxSingleJobBudgetUsd', () => {
    const spec = buildRenderJobSpec(OPTS);
    expect(spec.maxBudgetUsd).toBeLessThanOrEqual(COMPUTE_LIMITS.maxSingleJobBudgetUsd);
  });

  it('maxBudgetUsd is capped even if caller provides a higher value', () => {
    const spec = buildRenderJobSpec({ ...OPTS, maxBudgetUsd: 999 });
    expect(spec.maxBudgetUsd).toBe(COMPUTE_LIMITS.maxSingleJobBudgetUsd);
  });

  it('isCampaignJob is true when campaignId is provided', () => {
    const spec = buildRenderJobSpec({ ...OPTS, campaignId: 'camp-001' });
    expect(spec.isCampaignJob).toBe(true);
    expect(spec.campaignId).toBe('camp-001');
  });

  it('isCampaignJob is false when no campaignId', () => {
    expect(buildRenderJobSpec(OPTS).isCampaignJob).toBe(false);
  });

  it('attempts starts at 0', () => {
    expect(buildRenderJobSpec(OPTS).attempts).toBe(0);
  });

  it('createdAt is a valid ISO timestamp', () => {
    const spec = buildRenderJobSpec(OPTS);
    expect(() => new Date(spec.createdAt)).not.toThrow();
    expect(new Date(spec.createdAt).toISOString()).toBe(spec.createdAt);
  });
});
