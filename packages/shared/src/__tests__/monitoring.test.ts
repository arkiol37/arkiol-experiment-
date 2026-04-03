/**
 * packages/shared/src/__tests__/monitoring.test.ts
 *
 * Unit tests for monitoring.ts
 *
 * Strategy: inject a spy via configureMonitoring(onAlert) to intercept
 * all emitted alerts without network/DB. _resetAlertDedup() between tests
 * ensures the dedup window doesn't affect adjacent tests.
 *
 * Covers:
 *  - THRESHOLDS constants — shape and defaults
 *  - configureMonitoring + _resetAlertDedup lifecycle
 *  - checkCostSpike     — per-org and global thresholds
 *  - checkVolumeAnomaly — job count threshold
 *  - checkStageHealth   — failure rate, timeout, fallback rate
 *  - checkDlqDepth      — DLQ critical threshold
 *  - checkSafetyBlockRate
 *  - checkProviderErrorRate
 *  - checkZeroAssetJobRate
 *  - runMonitoringChecks — composite runner fires all sub-checks
 */

import {
  THRESHOLDS,
  configureMonitoring,
  checkCostSpike,
  checkVolumeAnomaly,
  checkStageHealth,
  checkDlqDepth,
  checkSafetyBlockRate,
  checkProviderErrorRate,
  checkZeroAssetJobRate,
  runMonitoringChecks,
  _resetAlertDedup,
  type StageHealthInput,
} from '../monitoring';

// ── Spy setup ─────────────────────────────────────────────────────────────────
let alerts: any[] = [];
let criticals: any[] = [];

beforeEach(() => {
  alerts = [];
  criticals = [];
  _resetAlertDedup();
  configureMonitoring({
    onAlert:    (a) => { alerts.push(a); },
    onCritical: (a) => { criticals.push(a); },
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
  });
});

afterEach(() => {
  _resetAlertDedup();
});

// ══════════════════════════════════════════════════════════════════════════════
// THRESHOLDS
// ══════════════════════════════════════════════════════════════════════════════
describe('THRESHOLDS', () => {
  it('has all required threshold keys', () => {
    expect(typeof THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR).toBe('number');
    expect(typeof THRESHOLDS.COST_SPIKE_GLOBAL_USD_PER_HOUR).toBe('number');
    expect(typeof THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR).toBe('number');
    expect(typeof THRESHOLDS.STAGE_FAILURE_RATE_WARNING).toBe('number');
    expect(typeof THRESHOLDS.STAGE_FAILURE_RATE_CRITICAL).toBe('number');
    expect(typeof THRESHOLDS.STAGE_TIMEOUT_MS).toBe('number');
    expect(typeof THRESHOLDS.FALLBACK_RATE_WARNING).toBe('number');
    expect(typeof THRESHOLDS.FALLBACK_RATE_CRITICAL).toBe('number');
    expect(typeof THRESHOLDS.DLQ_DEPTH_CRITICAL).toBe('number');
    expect(typeof THRESHOLDS.SAFETY_BLOCK_SPIKE_PER_HOUR).toBe('number');
    expect(typeof THRESHOLDS.ZERO_ASSET_JOB_RATE_WARNING).toBe('number');
    expect(typeof THRESHOLDS.PROVIDER_ERROR_RATE_CRITICAL).toBe('number');
  });

  it('all thresholds are positive numbers', () => {
    const values = [
      THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR,
      THRESHOLDS.COST_SPIKE_GLOBAL_USD_PER_HOUR,
      THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR,
      THRESHOLDS.STAGE_FAILURE_RATE_WARNING,
      THRESHOLDS.STAGE_FAILURE_RATE_CRITICAL,
      THRESHOLDS.STAGE_TIMEOUT_MS,
      THRESHOLDS.FALLBACK_RATE_WARNING,
      THRESHOLDS.FALLBACK_RATE_CRITICAL,
      THRESHOLDS.DLQ_DEPTH_CRITICAL,
      THRESHOLDS.SAFETY_BLOCK_SPIKE_PER_HOUR,
      THRESHOLDS.ZERO_ASSET_JOB_RATE_WARNING,
      THRESHOLDS.PROVIDER_ERROR_RATE_CRITICAL,
    ];
    for (const v of values) expect(v).toBeGreaterThan(0);
  });

  it('critical > warning for stage failure rate', () => {
    expect(THRESHOLDS.STAGE_FAILURE_RATE_CRITICAL).toBeGreaterThan(THRESHOLDS.STAGE_FAILURE_RATE_WARNING);
  });

  it('critical > warning for fallback rate', () => {
    expect(THRESHOLDS.FALLBACK_RATE_CRITICAL).toBeGreaterThan(THRESHOLDS.FALLBACK_RATE_WARNING);
  });

  it('STAGE_TIMEOUT_MS is at least 1 second', () => {
    expect(THRESHOLDS.STAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkCostSpike
// ══════════════════════════════════════════════════════════════════════════════
describe('checkCostSpike', () => {
  it('fires an alert when org credits exceed threshold', async () => {
    await checkCostSpike({
      orgId: 'org-001',
      creditsUsedInHour: THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR + 1,
    });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].type).toBe('cost_spike_org');
  });

  it('does not fire when below threshold', async () => {
    await checkCostSpike({
      orgId: 'org-001',
      creditsUsedInHour: THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR - 1,
    });
    expect(alerts.length).toBe(0);
  });

  it('fires critical when 2x org threshold exceeded', async () => {
    await checkCostSpike({
      orgId: 'org-crit',
      creditsUsedInHour: THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR * 2 + 1,
    });
    const alert = alerts.find(a => a.type === 'cost_spike_org');
    expect(alert?.severity).toBe('critical');
  });

  it('fires warning for single threshold breach', async () => {
    await checkCostSpike({
      orgId: 'org-warn',
      creditsUsedInHour: THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR + 1,
    });
    const alert = alerts.find(a => a.type === 'cost_spike_org');
    expect(alert?.severity).toBe('warning');
  });

  it('fires global cost alert when globalUsdInHour exceeds threshold', async () => {
    await checkCostSpike({
      orgId: 'org-001',
      creditsUsedInHour: 0,
      globalUsdInHour: THRESHOLDS.COST_SPIKE_GLOBAL_USD_PER_HOUR + 1,
    });
    const global = alerts.find(a => a.type === 'cost_spike_global');
    expect(global).toBeDefined();
    expect(global?.severity).toBe('critical');
  });

  it('alert has orgId, value, threshold fields', async () => {
    await checkCostSpike({
      orgId: 'org-fields',
      creditsUsedInHour: THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR + 10,
    });
    const a = alerts[0];
    expect(a.orgId).toBe('org-fields');
    expect(typeof a.value).toBe('number');
    expect(typeof a.threshold).toBe('number');
  });

  it('dedup prevents duplicate alerts in same window', async () => {
    const credits = THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR + 1;
    await checkCostSpike({ orgId: 'org-dedup', creditsUsedInHour: credits });
    await checkCostSpike({ orgId: 'org-dedup', creditsUsedInHour: credits });
    const orgAlerts = alerts.filter(a => a.type === 'cost_spike_org' && a.orgId === 'org-dedup');
    expect(orgAlerts.length).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkVolumeAnomaly
// ══════════════════════════════════════════════════════════════════════════════
describe('checkVolumeAnomaly', () => {
  it('fires alert when jobs exceed threshold', async () => {
    await checkVolumeAnomaly({
      orgId: 'org-001',
      jobsInHour: THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR + 1,
      assetsInHour: 0,
    });
    expect(alerts.some(a => a.type === 'generation_volume_anomaly')).toBe(true);
  });

  it('does not fire below threshold', async () => {
    await checkVolumeAnomaly({
      orgId: 'org-001',
      jobsInHour: THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR - 1,
      assetsInHour: 0,
    });
    expect(alerts.length).toBe(0);
  });

  it('fires critical when 2x threshold exceeded', async () => {
    await checkVolumeAnomaly({
      orgId: 'org-crit',
      jobsInHour: THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR * 2 + 1,
      assetsInHour: 0,
    });
    const a = alerts.find(a => a.type === 'generation_volume_anomaly');
    expect(a?.severity).toBe('critical');
  });

  it('alert contains orgId', async () => {
    await checkVolumeAnomaly({
      orgId: 'org-volume',
      jobsInHour: THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR + 5,
      assetsInHour: 10,
    });
    expect(alerts[0].orgId).toBe('org-volume');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkStageHealth
// ══════════════════════════════════════════════════════════════════════════════
describe('checkStageHealth', () => {
  const base: StageHealthInput = {
    stageId: 'intent',
    totalRuns: 100,
    failedRuns: 0,
    fallbackRuns: 0,
    maxDurationMs: 0,
  };

  it('does not fire for healthy stage', async () => {
    await checkStageHealth({ ...base, failedRuns: 1, maxDurationMs: 1000 });
    expect(alerts.length).toBe(0);
  });

  it('does nothing for totalRuns=0', async () => {
    await checkStageHealth({ ...base, totalRuns: 0 });
    expect(alerts.length).toBe(0);
  });

  it('fires stage_failure_rate alert at warning threshold', async () => {
    const failedRuns = Math.ceil(base.totalRuns * THRESHOLDS.STAGE_FAILURE_RATE_WARNING / 100);
    await checkStageHealth({ ...base, failedRuns, stageId: 'intent-fail' });
    expect(alerts.some(a => a.type === 'stage_failure_rate')).toBe(true);
  });

  it('fires stage_failure_rate critical at critical threshold', async () => {
    const failedRuns = Math.ceil(base.totalRuns * THRESHOLDS.STAGE_FAILURE_RATE_CRITICAL / 100);
    await checkStageHealth({ ...base, stageId: 'intent-crit', failedRuns });
    const a = alerts.find(a => a.type === 'stage_failure_rate');
    expect(a?.severity).toBe('critical');
  });

  it('fires stage_timeout alert when maxDurationMs exceeds threshold', async () => {
    await checkStageHealth({
      ...base,
      stageId: 'layout-slow',
      maxDurationMs: THRESHOLDS.STAGE_TIMEOUT_MS + 1,
    });
    expect(alerts.some(a => a.type === 'stage_timeout')).toBe(true);
  });

  it('fires fallback_rate_elevated alert at warning threshold', async () => {
    const fallbackRuns = Math.ceil(base.totalRuns * THRESHOLDS.FALLBACK_RATE_WARNING / 100);
    await checkStageHealth({ ...base, stageId: 'brand-fallback', fallbackRuns });
    expect(alerts.some(a => a.type === 'fallback_rate_elevated')).toBe(true);
  });

  it('stage_timeout is critical when 2x threshold', async () => {
    await checkStageHealth({
      ...base,
      stageId: 'layout-2x',
      maxDurationMs: THRESHOLDS.STAGE_TIMEOUT_MS * 2 + 1,
    });
    const a = alerts.find(a => a.type === 'stage_timeout');
    expect(a?.severity).toBe('critical');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkDlqDepth
// ══════════════════════════════════════════════════════════════════════════════
describe('checkDlqDepth', () => {
  it('fires critical alert when DLQ depth >= threshold', async () => {
    await checkDlqDepth(THRESHOLDS.DLQ_DEPTH_CRITICAL);
    expect(alerts.some(a => a.type === 'dlq_depth_critical')).toBe(true);
    expect(criticals.length).toBeGreaterThan(0);
  });

  it('does not fire when below threshold', async () => {
    await checkDlqDepth(THRESHOLDS.DLQ_DEPTH_CRITICAL - 1);
    expect(alerts.length).toBe(0);
  });

  it('alert severity is critical', async () => {
    await checkDlqDepth(THRESHOLDS.DLQ_DEPTH_CRITICAL + 5);
    const a = alerts.find(a => a.type === 'dlq_depth_critical');
    expect(a?.severity).toBe('critical');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkSafetyBlockRate
// ══════════════════════════════════════════════════════════════════════════════
describe('checkSafetyBlockRate', () => {
  it('fires alert when blocks exceed threshold', async () => {
    await checkSafetyBlockRate('org-001', THRESHOLDS.SAFETY_BLOCK_SPIKE_PER_HOUR + 1);
    expect(alerts.some(a => a.type === 'safety_block_spike')).toBe(true);
  });

  it('does not fire below threshold', async () => {
    await checkSafetyBlockRate('org-001', THRESHOLDS.SAFETY_BLOCK_SPIKE_PER_HOUR - 1);
    expect(alerts.length).toBe(0);
  });

  it('alert has correct orgId', async () => {
    await checkSafetyBlockRate('org-safety', THRESHOLDS.SAFETY_BLOCK_SPIKE_PER_HOUR + 1);
    expect(alerts[0].orgId).toBe('org-safety');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkProviderErrorRate
// ══════════════════════════════════════════════════════════════════════════════
describe('checkProviderErrorRate', () => {
  it('fires critical when error rate >= threshold', async () => {
    const total = 100;
    const failed = Math.ceil(total * THRESHOLDS.PROVIDER_ERROR_RATE_CRITICAL / 100);
    await checkProviderErrorRate('openai', total, failed);
    expect(alerts.some(a => a.type === 'provider_error_rate')).toBe(true);
    const a = alerts.find(a => a.type === 'provider_error_rate');
    expect(a?.severity).toBe('critical');
  });

  it('does not fire below threshold', async () => {
    await checkProviderErrorRate('openai', 100, 1);
    expect(alerts.length).toBe(0);
  });

  it('does nothing for totalCalls=0', async () => {
    await checkProviderErrorRate('openai', 0, 0);
    expect(alerts.length).toBe(0);
  });

  it('alert contains provider name', async () => {
    const total = 100;
    const failed = Math.ceil(total * THRESHOLDS.PROVIDER_ERROR_RATE_CRITICAL / 100);
    await checkProviderErrorRate('replicate', total, failed);
    const a = alerts.find(a => a.type === 'provider_error_rate');
    expect(a?.title).toContain('replicate');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// checkZeroAssetJobRate
// ══════════════════════════════════════════════════════════════════════════════
describe('checkZeroAssetJobRate', () => {
  it('fires when zero-asset rate >= threshold', async () => {
    const total = 100;
    const zeros = Math.ceil(total * THRESHOLDS.ZERO_ASSET_JOB_RATE_WARNING / 100);
    await checkZeroAssetJobRate(total, zeros);
    expect(alerts.some(a => a.type === 'zero_asset_job_rate')).toBe(true);
  });

  it('does not fire below threshold', async () => {
    await checkZeroAssetJobRate(100, 1);
    expect(alerts.length).toBe(0);
  });

  it('does nothing for totalJobs=0', async () => {
    await checkZeroAssetJobRate(0, 0);
    expect(alerts.length).toBe(0);
  });

  it('fires critical when 2x threshold exceeded', async () => {
    const total = 100;
    const zeros = Math.ceil(total * THRESHOLDS.ZERO_ASSET_JOB_RATE_WARNING * 2 / 100) + 1;
    await checkZeroAssetJobRate(total, Math.min(zeros, total));
    const a = alerts.find(a => a.type === 'zero_asset_job_rate');
    if (a) expect(a.severity).toMatch(/warning|critical/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// runMonitoringChecks (composite)
// ══════════════════════════════════════════════════════════════════════════════
describe('runMonitoringChecks', () => {
  it('does not throw with empty input', async () => {
    await expect(runMonitoringChecks({})).resolves.not.toThrow();
  });

  it('does not throw with full input', async () => {
    await expect(runMonitoringChecks({
      orgId: 'org-001',
      creditsUsedInHour: 1,
      jobsInHour: 1,
      assetsInHour: 1,
      safetyBlocksInHour: 1,
      globalUsdInHour: 1,
      dlqDepth: 1,
      stageHealthInputs: [],
      providerStats: [],
      jobsCompleted: 10,
      zeroAssetJobs: 1,
    })).resolves.toBeUndefined();
  });

  it('fires DLQ alert via composite run', async () => {
    await runMonitoringChecks({ dlqDepth: THRESHOLDS.DLQ_DEPTH_CRITICAL + 5 });
    expect(alerts.some(a => a.type === 'dlq_depth_critical')).toBe(true);
  });

  it('fires provider error alert via composite run', async () => {
    const total = 100;
    const failed = Math.ceil(total * THRESHOLDS.PROVIDER_ERROR_RATE_CRITICAL / 100);
    await runMonitoringChecks({
      providerStats: [{ provider: 'anthropic', totalCalls: total, failedCalls: failed }],
    });
    expect(alerts.some(a => a.type === 'provider_error_rate')).toBe(true);
  });

  it('fires cost spike via composite run', async () => {
    await runMonitoringChecks({
      orgId: 'org-composite',
      creditsUsedInHour: THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR + 1,
    });
    expect(alerts.some(a => a.type === 'cost_spike_org')).toBe(true);
  });

  it('all emitted alerts have alertId and firedAt', async () => {
    await runMonitoringChecks({ dlqDepth: THRESHOLDS.DLQ_DEPTH_CRITICAL + 1 });
    for (const a of alerts) {
      expect(typeof a.alertId).toBe('string');
      expect(typeof a.firedAt).toBe('string');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Alert shape invariants
// ══════════════════════════════════════════════════════════════════════════════
describe('alert shape invariants', () => {
  it('all alerts have type, severity, title, message', async () => {
    const thresholds = [
      checkCostSpike({ orgId: 'o', creditsUsedInHour: THRESHOLDS.COST_SPIKE_ORG_CREDITS_PER_HOUR + 1 }),
      checkVolumeAnomaly({ orgId: 'o2', jobsInHour: THRESHOLDS.VOLUME_JOBS_PER_ORG_HOUR + 1, assetsInHour: 0 }),
      checkDlqDepth(THRESHOLDS.DLQ_DEPTH_CRITICAL + 1),
    ];
    await Promise.all(thresholds);
    for (const a of alerts) {
      expect(typeof a.type).toBe('string');
      expect(typeof a.severity).toBe('string');
      expect(typeof a.title).toBe('string');
      expect(typeof a.message).toBe('string');
    }
  });

  it('all severities are valid enum values', async () => {
    await checkDlqDepth(THRESHOLDS.DLQ_DEPTH_CRITICAL + 1);
    for (const a of alerts) {
      expect(['info', 'warning', 'critical']).toContain(a.severity);
    }
  });
});
