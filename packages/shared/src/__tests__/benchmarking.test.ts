/**
 * packages/shared/src/__tests__/benchmarking.test.ts
 *
 * Unit tests for benchmarking.ts
 *
 * Pure functions — no DB, no HTTP, no Prisma.
 *
 * Covers:
 *  - computeRenderQuality — scoring dimensions, boundary conditions,
 *    hasBrand vs no-brand baseline, hierarchy, density, violations, composite
 *  - buildAssetBenchmark  — shape, required fields, quality embedded,
 *    renderedAt is ISO, does not throw
 *  - summarizeJobBenchmarks — empty input, averages, fallbackRate,
 *    violationRate, worstStage detection
 *  - buildStageTracesFromPerfs (stageTrace.ts) — shape, count, id format
 */

import {
  computeRenderQuality,
  buildAssetBenchmark,
  summarizeJobBenchmarks,
  type ScoreInputs,
  type StagePerf,
  type BuildBenchmarkParams,
} from '../benchmarking';

import {
  buildStageTracesFromPerfs,
} from '../stageTrace';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const PERFECT_INPUTS: ScoreInputs = {
  hasBrand:       true,
  brandScore:     100,
  hierarchyValid: true,
  densityAnalysis: { isOverloaded: false, totalDensityScore: 50 },
  violations:     [],
};

const WORST_INPUTS: ScoreInputs = {
  hasBrand:       false,
  brandScore:     0,
  hierarchyValid: false,
  densityAnalysis: { isOverloaded: true, totalDensityScore: 200 },
  violations:     Array.from({ length: 10 }, (_, i) => `style:contrast-${i}`),
};

function makeStagePerf(id: string, durationMs = 100, ok = true): StagePerf {
  return {
    stageId:   id as any,
    durationMs,
    ok,
    fallback:  !ok,
    errorCount: ok ? 0 : 1,
  };
}

function makeBenchmarkParams(overrides: Partial<BuildBenchmarkParams> = {}): BuildBenchmarkParams {
  return {
    assetId:         'asset-001',
    jobId:           'job-001',
    orgId:           'org-001',
    format:          'instagram_post',
    variationIdx:    0,
    stylePreset:     'bold',
    outputFormat:    'svg',
    stagePerfs:      [makeStagePerf('intent'), makeStagePerf('layout')],
    scoreInputs:     PERFECT_INPUTS,
    totalPipelineMs: 1500,
    anyFallback:     false,
    violationCount:  0,
    layoutFamily:    'hero_split',
    ...overrides,
  };
}

function makeBenchmark(overrides: Partial<BuildBenchmarkParams> = {}) {
  return buildAssetBenchmark(makeBenchmarkParams(overrides));
}

// ══════════════════════════════════════════════════════════════════════════════
// computeRenderQuality
// ══════════════════════════════════════════════════════════════════════════════
describe('computeRenderQuality', () => {
  it('returns all 6 quality dimensions', () => {
    const q = computeRenderQuality(PERFECT_INPUTS);
    expect(typeof q.brandAlignment).toBe('number');
    expect(typeof q.hierarchyIntegrity).toBe('number');
    expect(typeof q.densityFit).toBe('number');
    expect(typeof q.contrastCompliance).toBe('number');
    expect(typeof q.violationPenalty).toBe('number');
    expect(typeof q.overallScore).toBe('number');
  });

  it('all scores are in [0, 1]', () => {
    for (const inputs of [PERFECT_INPUTS, WORST_INPUTS]) {
      const q = computeRenderQuality(inputs);
      for (const [, v] of Object.entries(q)) {
        expect(v as number).toBeGreaterThanOrEqual(0);
        expect(v as number).toBeLessThanOrEqual(1);
      }
    }
  });

  it('perfect inputs produce overallScore close to 1.0', () => {
    const q = computeRenderQuality(PERFECT_INPUTS);
    expect(q.overallScore).toBeGreaterThan(0.9);
  });

  it('worst inputs produce lower overallScore than perfect', () => {
    const perfect = computeRenderQuality(PERFECT_INPUTS);
    const worst   = computeRenderQuality(WORST_INPUTS);
    expect(worst.overallScore).toBeLessThan(perfect.overallScore);
  });

  it('hasBrand=true with brandScore=100 gives max brandAlignment (1.0)', () => {
    const q = computeRenderQuality({ ...PERFECT_INPUTS, brandScore: 100, hasBrand: true });
    expect(q.brandAlignment).toBe(1.0);
  });

  it('hasBrand=false gives neutral brandAlignment baseline (0.7)', () => {
    const q = computeRenderQuality({ ...PERFECT_INPUTS, hasBrand: false });
    expect(q.brandAlignment).toBeCloseTo(0.7, 5);
  });

  it('hierarchyValid=false reduces hierarchyIntegrity to 0.5', () => {
    const q = computeRenderQuality({ ...PERFECT_INPUTS, hierarchyValid: false });
    expect(q.hierarchyIntegrity).toBe(0.5);
  });

  it('hierarchyValid=true gives hierarchyIntegrity=1.0', () => {
    const q = computeRenderQuality({ ...PERFECT_INPUTS, hierarchyValid: true });
    expect(q.hierarchyIntegrity).toBe(1.0);
  });

  it('overloaded density gives densityFit=0.4', () => {
    const q = computeRenderQuality({
      ...PERFECT_INPUTS,
      densityAnalysis: { isOverloaded: true, totalDensityScore: 200 },
    });
    expect(q.densityFit).toBe(0.4);
  });

  it('density score > 100 but not overloaded gives densityFit=0.6', () => {
    const q = computeRenderQuality({
      ...PERFECT_INPUTS,
      densityAnalysis: { isOverloaded: false, totalDensityScore: 150 },
    });
    expect(q.densityFit).toBe(0.6);
  });

  it('normal density (≤100, not overloaded) gives densityFit=1.0', () => {
    const q = computeRenderQuality({
      ...PERFECT_INPUTS,
      densityAnalysis: { isOverloaded: false, totalDensityScore: 80 },
    });
    expect(q.densityFit).toBe(1.0);
  });

  it('no violations gives contrastCompliance=1.0 and violationPenalty=1.0', () => {
    const q = computeRenderQuality({ ...PERFECT_INPUTS, violations: [] });
    expect(q.contrastCompliance).toBe(1.0);
    expect(q.violationPenalty).toBe(1.0);
  });

  it('all style violations reduces contrastCompliance', () => {
    const q = computeRenderQuality({
      ...PERFECT_INPUTS,
      violations: ['style:contrast-1', 'style:contrast-2'],
    });
    expect(q.contrastCompliance).toBeLessThan(1.0);
  });

  it('10+ violations reduces violationPenalty to 0', () => {
    const q = computeRenderQuality({
      ...PERFECT_INPUTS,
      violations: Array.from({ length: 10 }, (_, i) => `v${i}`),
    });
    expect(q.violationPenalty).toBe(0);
  });

  it('is deterministic — same inputs produce same output', () => {
    const a = computeRenderQuality(PERFECT_INPUTS);
    const b = computeRenderQuality(PERFECT_INPUTS);
    expect(a.overallScore).toBe(b.overallScore);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildAssetBenchmark
// ══════════════════════════════════════════════════════════════════════════════
describe('buildAssetBenchmark', () => {
  it('returns without throwing', () => {
    expect(() => buildAssetBenchmark(makeBenchmarkParams())).not.toThrow();
  });

  it('has all required fields', () => {
    const b = makeBenchmark();
    expect(typeof b.assetId).toBe('string');
    expect(typeof b.jobId).toBe('string');
    expect(typeof b.orgId).toBe('string');
    expect(typeof b.format).toBe('string');
    expect(typeof b.variationIdx).toBe('number');
    expect(typeof b.stylePreset).toBe('string');
    expect(typeof b.outputFormat).toBe('string');
    expect(Array.isArray(b.stagePerfs)).toBe(true);
    expect(b.quality).toBeDefined();
    expect(typeof b.totalPipelineMs).toBe('number');
    expect(b.abVariants).toBeDefined();
    expect(typeof b.anyFallback).toBe('boolean');
    expect(typeof b.violationCount).toBe('number');
    expect(typeof b.layoutFamily).toBe('string');
    expect(typeof b.renderedAt).toBe('string');
  });

  it('renderedAt is a valid ISO timestamp', () => {
    const b = makeBenchmark();
    expect(() => new Date(b.renderedAt)).not.toThrow();
    expect(new Date(b.renderedAt).toISOString()).toBe(b.renderedAt);
  });

  it('quality object has overallScore in [0, 1]', () => {
    const b = makeBenchmark();
    expect(b.quality.overallScore).toBeGreaterThanOrEqual(0);
    expect(b.quality.overallScore).toBeLessThanOrEqual(1);
  });

  it('assetId and jobId are preserved from params', () => {
    const b = makeBenchmark({ assetId: 'my-asset', jobId: 'my-job' });
    expect(b.assetId).toBe('my-asset');
    expect(b.jobId).toBe('my-job');
  });

  it('totalPipelineMs is preserved from params', () => {
    const b = makeBenchmark({ totalPipelineMs: 9999 });
    expect(b.totalPipelineMs).toBe(9999);
  });

  it('anyFallback=true is preserved', () => {
    expect(makeBenchmark({ anyFallback: true }).anyFallback).toBe(true);
    expect(makeBenchmark({ anyFallback: false }).anyFallback).toBe(false);
  });

  it('outputFormat is preserved', () => {
    expect(makeBenchmark({ outputFormat: 'gif' }).outputFormat).toBe('gif');
    expect(makeBenchmark({ outputFormat: 'png' }).outputFormat).toBe('png');
  });

  it('abVariants is an object', () => {
    expect(typeof makeBenchmark().abVariants).toBe('object');
  });

  it('perfect score inputs produce high quality.overallScore', () => {
    const b = makeBenchmark({ scoreInputs: PERFECT_INPUTS });
    expect(b.quality.overallScore).toBeGreaterThan(0.9);
  });

  it('worst inputs produce lower quality.overallScore', () => {
    const good = makeBenchmark({ scoreInputs: PERFECT_INPUTS });
    const bad  = makeBenchmark({ scoreInputs: WORST_INPUTS });
    expect(bad.quality.overallScore).toBeLessThan(good.quality.overallScore);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// summarizeJobBenchmarks
// ══════════════════════════════════════════════════════════════════════════════
describe('summarizeJobBenchmarks', () => {
  it('empty benchmarks array returns zero-filled summary', () => {
    const s = summarizeJobBenchmarks('job-001', 'org-001', []);
    expect(s.assetCount).toBe(0);
    expect(s.avgOverallScore).toBe(0);
    expect(s.avgPipelineMs).toBe(0);
    expect(s.jobId).toBe('job-001');
    expect(s.orgId).toBe('org-001');
  });

  it('empty input completedAt is a valid ISO timestamp', () => {
    const s = summarizeJobBenchmarks('j', 'o', []);
    expect(() => new Date(s.completedAt)).not.toThrow();
  });

  it('single benchmark: avgOverallScore matches that benchmark', () => {
    const b = makeBenchmark({ scoreInputs: PERFECT_INPUTS });
    const s = summarizeJobBenchmarks('j', 'o', [b]);
    expect(s.avgOverallScore).toBeCloseTo(b.quality.overallScore, 3);
  });

  it('assetCount matches number of benchmarks', () => {
    const benchmarks = [makeBenchmark(), makeBenchmark(), makeBenchmark()];
    const s = summarizeJobBenchmarks('j', 'o', benchmarks);
    expect(s.assetCount).toBe(3);
  });

  it('fallbackRate=1.0 when all benchmarks have anyFallback=true', () => {
    const benchmarks = [
      makeBenchmark({ anyFallback: true }),
      makeBenchmark({ anyFallback: true }),
    ];
    const s = summarizeJobBenchmarks('j', 'o', benchmarks);
    expect(s.fallbackRate).toBe(1.0);
  });

  it('fallbackRate=0 when no benchmarks have anyFallback', () => {
    const benchmarks = [makeBenchmark({ anyFallback: false }), makeBenchmark({ anyFallback: false })];
    const s = summarizeJobBenchmarks('j', 'o', benchmarks);
    expect(s.fallbackRate).toBe(0);
  });

  it('fallbackRate is in [0, 1]', () => {
    const b = [makeBenchmark({ anyFallback: true }), makeBenchmark({ anyFallback: false })];
    const s = summarizeJobBenchmarks('j', 'o', b);
    expect(s.fallbackRate).toBeGreaterThanOrEqual(0);
    expect(s.fallbackRate).toBeLessThanOrEqual(1);
  });

  it('all numeric averages are in [0, 1] range (or positive for ms)', () => {
    const benchmarks = [makeBenchmark(), makeBenchmark()];
    const s = summarizeJobBenchmarks('j', 'o', benchmarks);
    expect(s.avgOverallScore).toBeGreaterThanOrEqual(0);
    expect(s.avgBrandAlignment).toBeGreaterThanOrEqual(0);
    expect(s.avgHierarchyScore).toBeGreaterThanOrEqual(0);
    expect(s.avgPipelineMs).toBeGreaterThan(0);
  });

  it('worstStage is identified when stagePerfs are present', () => {
    const slow = makeStagePerf('asset_engine', 5000);
    const fast = makeStagePerf('intent', 100);
    const b = makeBenchmark({ stagePerfs: [slow, fast] });
    const s = summarizeJobBenchmarks('j', 'o', [b]);
    expect(s.worstStage).toBe('asset_engine');
  });

  it('completedAt is a valid ISO timestamp', () => {
    const s = summarizeJobBenchmarks('j', 'o', [makeBenchmark()]);
    expect(() => new Date(s.completedAt)).not.toThrow();
    expect(new Date(s.completedAt).toISOString()).toBe(s.completedAt);
  });

  it('avgPipelineMs rounds to integer', () => {
    const benchmarks = [
      makeBenchmark({ totalPipelineMs: 1001 }),
      makeBenchmark({ totalPipelineMs: 1002 }),
    ];
    const s = summarizeJobBenchmarks('j', 'o', benchmarks);
    expect(Number.isInteger(s.avgPipelineMs)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildStageTracesFromPerfs (stageTrace.ts)
// ══════════════════════════════════════════════════════════════════════════════
describe('buildStageTracesFromPerfs', () => {
  const PERFS: StagePerf[] = [
    makeStagePerf('intent',   100, true),
    makeStagePerf('layout',   200, true),
    makeStagePerf('brand',    150, false),
  ];

  it('returns without throwing', () => {
    expect(() => buildStageTracesFromPerfs('job-1', 'asset-1', 'org-1', PERFS)).not.toThrow();
  });

  it('returns same number of traces as perfs', () => {
    const traces = buildStageTracesFromPerfs('job-1', 'asset-1', 'org-1', PERFS);
    expect(traces.length).toBe(PERFS.length);
  });

  it('returns empty array for empty perfs', () => {
    const traces = buildStageTracesFromPerfs('j', 'a', 'o', []);
    expect(traces).toEqual([]);
  });

  it('all traces have required fields', () => {
    const traces = buildStageTracesFromPerfs('job-1', 'asset-1', 'org-1', PERFS);
    for (const t of traces) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.jobId).toBe('string');
      expect(typeof t.assetId).toBe('string');
      expect(typeof t.orgId).toBe('string');
      expect(typeof t.stageId).toBe('string');
      expect(typeof t.stageIdx).toBe('number');
      expect(typeof t.durationMs).toBe('number');
      expect(typeof t.ok).toBe('boolean');
    }
  });

  it('stageIdx increments from 0', () => {
    const traces = buildStageTracesFromPerfs('j', 'a', 'o', PERFS);
    traces.forEach((t, i) => expect(t.stageIdx).toBe(i));
  });

  it('id contains jobId, assetId, and stageId', () => {
    const traces = buildStageTracesFromPerfs('job-x', 'asset-x', 'o', PERFS);
    expect(traces[0]!.id).toContain('job-x');
    expect(traces[0]!.id).toContain('asset-x');
    expect(traces[0]!.id).toContain('intent');
  });

  it('jobId/assetId/orgId are propagated to all traces', () => {
    const traces = buildStageTracesFromPerfs('J', 'A', 'O', PERFS);
    for (const t of traces) {
      expect(t.jobId).toBe('J');
      expect(t.assetId).toBe('A');
      expect(t.orgId).toBe('O');
    }
  });

  it('ok=false perf maps to fallback=true in trace', () => {
    const traces = buildStageTracesFromPerfs('j', 'a', 'o', PERFS);
    const brandTrace = traces.find(t => t.stageId === 'brand')!;
    expect(brandTrace.ok).toBe(false);
    expect(brandTrace.fallback).toBe(true);
  });

  it('durationMs is preserved', () => {
    const traces = buildStageTracesFromPerfs('j', 'a', 'o', PERFS);
    expect(traces[0]!.durationMs).toBe(100);
    expect(traces[1]!.durationMs).toBe(200);
  });
});
