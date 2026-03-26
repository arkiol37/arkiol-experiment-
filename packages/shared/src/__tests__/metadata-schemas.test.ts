/**
 * packages/shared/src/__tests__/metadata-schemas.test.ts
 *
 * Unit tests for Zod schemas exported from:
 *  - metadataStore.ts  — StylePerformanceSchema, FormatPerformanceSchema, ABResultSchema
 *  - brandLearning.ts  — BrandLearningContextSchema
 *
 * Pure Zod validation — no DB, no Prisma, no network.
 */

import {
  StylePerformanceSchema,
  FormatPerformanceSchema,
  ABResultSchema,
} from '../metadataStore';

import {
  BrandLearningContextSchema,
} from '../brandLearning';

// ══════════════════════════════════════════════════════════════════════════════
// StylePerformanceSchema
// ══════════════════════════════════════════════════════════════════════════════
describe('StylePerformanceSchema', () => {
  const VALID = {
    id: 'sp_org001_bold',
    orgId: 'org-001',
    stylePreset: 'bold',
    sampleCount: 50,
    avgQualityScore: 0.82,
    avgPipelineMs: 1500,
    avgViolations: 1.2,
    trend: 'improving',
    lastUpdated: new Date().toISOString(),
  };

  it('accepts a valid record', () => {
    expect(StylePerformanceSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects missing id', () => {
    const { id: _, ...bad } = VALID as any;
    expect(StylePerformanceSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects avgQualityScore > 1', () => {
    expect(StylePerformanceSchema.safeParse({ ...VALID, avgQualityScore: 1.1 }).success).toBe(false);
  });

  it('rejects avgQualityScore < 0', () => {
    expect(StylePerformanceSchema.safeParse({ ...VALID, avgQualityScore: -0.1 }).success).toBe(false);
  });

  it('rejects invalid trend', () => {
    expect(StylePerformanceSchema.safeParse({ ...VALID, trend: 'unknown' }).success).toBe(false);
  });

  it('accepts all valid trend values', () => {
    const trends = ['improving', 'stable', 'declining', 'insufficient_data'];
    for (const trend of trends) {
      expect(StylePerformanceSchema.safeParse({ ...VALID, trend }).success).toBe(true);
    }
  });

  it('rejects negative sampleCount', () => {
    expect(StylePerformanceSchema.safeParse({ ...VALID, sampleCount: -1 }).success).toBe(false);
  });

  it('accepts sampleCount=0', () => {
    expect(StylePerformanceSchema.safeParse({ ...VALID, sampleCount: 0 }).success).toBe(true);
  });

  it('rejects negative avgPipelineMs', () => {
    expect(StylePerformanceSchema.safeParse({ ...VALID, avgPipelineMs: -1 }).success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FormatPerformanceSchema
// ══════════════════════════════════════════════════════════════════════════════
describe('FormatPerformanceSchema', () => {
  const VALID = {
    id: 'fp_org001_instagram',
    orgId: 'org-001',
    format: 'instagram_post',
    sampleCount: 100,
    avgQualityScore: 0.75,
    fallbackRate: 0.1,
    lastUpdated: new Date().toISOString(),
  };

  it('accepts a valid record', () => {
    expect(FormatPerformanceSchema.safeParse(VALID).success).toBe(true);
  });

  it('accepts optional topLayoutFamily', () => {
    expect(FormatPerformanceSchema.safeParse({ ...VALID, topLayoutFamily: 'hero_split' }).success).toBe(true);
  });

  it('rejects fallbackRate > 1', () => {
    expect(FormatPerformanceSchema.safeParse({ ...VALID, fallbackRate: 1.1 }).success).toBe(false);
  });

  it('rejects fallbackRate < 0', () => {
    expect(FormatPerformanceSchema.safeParse({ ...VALID, fallbackRate: -0.1 }).success).toBe(false);
  });

  it('accepts fallbackRate=0', () => {
    expect(FormatPerformanceSchema.safeParse({ ...VALID, fallbackRate: 0 }).success).toBe(true);
  });

  it('accepts fallbackRate=1', () => {
    expect(FormatPerformanceSchema.safeParse({ ...VALID, fallbackRate: 1 }).success).toBe(true);
  });

  it('rejects avgQualityScore > 1', () => {
    expect(FormatPerformanceSchema.safeParse({ ...VALID, avgQualityScore: 1.5 }).success).toBe(false);
  });

  it('rejects missing format', () => {
    const { format: _, ...bad } = VALID as any;
    expect(FormatPerformanceSchema.safeParse(bad).success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ABResultSchema
// ══════════════════════════════════════════════════════════════════════════════
describe('ABResultSchema', () => {
  const VALID = {
    id: 'ab_org001_layout_v1_control',
    orgId: 'org-001',
    experimentName: 'layout_strategy_v1',
    variant: 'intent_based',
    sampleCount: 200,
    avgQualityScore: 0.88,
    avgPipelineMs: 1200,
    lastUpdated: new Date().toISOString(),
  };

  it('accepts a valid record', () => {
    expect(ABResultSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects missing experimentName', () => {
    const { experimentName: _, ...bad } = VALID as any;
    expect(ABResultSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects missing variant', () => {
    const { variant: _, ...bad } = VALID as any;
    expect(ABResultSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects avgQualityScore outside [0,1]', () => {
    expect(ABResultSchema.safeParse({ ...VALID, avgQualityScore: 2 }).success).toBe(false);
    expect(ABResultSchema.safeParse({ ...VALID, avgQualityScore: -1 }).success).toBe(false);
  });

  it('rejects negative avgPipelineMs', () => {
    expect(ABResultSchema.safeParse({ ...VALID, avgPipelineMs: -1 }).success).toBe(false);
  });

  it('accepts sampleCount=0', () => {
    expect(ABResultSchema.safeParse({ ...VALID, sampleCount: 0 }).success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BrandLearningContextSchema
// ══════════════════════════════════════════════════════════════════════════════
describe('BrandLearningContextSchema', () => {
  const MINIMAL = {
    orgId: 'org-001',
    sessionId: 'session-001',
  };

  it('accepts minimal valid context', () => {
    expect(BrandLearningContextSchema.safeParse(MINIMAL).success).toBe(true);
  });

  it('accepts full valid context with all optional fields', () => {
    const full = {
      ...MINIMAL,
      brandId: 'brand-001',
      jobId: 'job-001',
      assetId: 'asset-001',
      format: 'instagram_post',
      stylePreset: 'bold',
      qualityScore: 0.9,
      accepted: true,
      durationMs: 1500,
    };
    expect(BrandLearningContextSchema.safeParse(full).success).toBe(true);
  });

  it('rejects missing orgId', () => {
    const { orgId: _, ...bad } = MINIMAL as any;
    expect(BrandLearningContextSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects missing sessionId', () => {
    const { sessionId: _, ...bad } = MINIMAL as any;
    expect(BrandLearningContextSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects qualityScore > 1', () => {
    expect(BrandLearningContextSchema.safeParse({ ...MINIMAL, qualityScore: 1.5 }).success).toBe(false);
  });

  it('rejects qualityScore < 0', () => {
    expect(BrandLearningContextSchema.safeParse({ ...MINIMAL, qualityScore: -0.1 }).success).toBe(false);
  });

  it('accepts qualityScore = 0 and = 1', () => {
    expect(BrandLearningContextSchema.safeParse({ ...MINIMAL, qualityScore: 0 }).success).toBe(true);
    expect(BrandLearningContextSchema.safeParse({ ...MINIMAL, qualityScore: 1 }).success).toBe(true);
  });

  it('rejects negative durationMs', () => {
    expect(BrandLearningContextSchema.safeParse({ ...MINIMAL, durationMs: -1 }).success).toBe(false);
  });

  it('accepts durationMs = 0', () => {
    expect(BrandLearningContextSchema.safeParse({ ...MINIMAL, durationMs: 0 }).success).toBe(true);
  });

  it('optional fields are truly optional (not required)', () => {
    // Only orgId and sessionId should be required
    const result = BrandLearningContextSchema.safeParse(MINIMAL);
    expect(result.success).toBe(true);
  });

  it('accepted can be true or false', () => {
    expect(BrandLearningContextSchema.safeParse({ ...MINIMAL, accepted: true }).success).toBe(true);
    expect(BrandLearningContextSchema.safeParse({ ...MINIMAL, accepted: false }).success).toBe(true);
  });
});
