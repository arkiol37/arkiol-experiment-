/**
 * packages/shared/src/__tests__/contextual-memory.test.ts
 *
 * Unit tests for aiLearning.ts:
 *  - buildContextualMemory    — pure function, no DB
 *  - FeedbackEventSchema      — Zod schema validation
 *  - FeedbackEventTypeSchema  — valid / invalid event types
 */

import {
  buildContextualMemory,
  FeedbackEventSchema,
  FeedbackEventTypeSchema,
  type FeedbackEvent,
} from '../aiLearning';

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeEvent(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    eventType:  'asset_accepted',
    orgId:      'org-001',
    sessionId:  'session-001',
    occurredAt: new Date().toISOString(),
    metadata:   {},
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// buildContextualMemory
// ══════════════════════════════════════════════════════════════════════════════
describe('buildContextualMemory', () => {
  it('returns a ContextualMemory object', () => {
    const mem = buildContextualMemory('org-001', []);
    expect(typeof mem.orgId).toBe('string');
    expect(Array.isArray(mem.preferredFormats)).toBe(true);
    expect(Array.isArray(mem.preferredStyles)).toBe(true);
    expect(typeof mem.avgQualityScore).toBe('number');
    expect(typeof mem.totalGenerations).toBe('number');
    expect(typeof mem.topVariationAxis).toBe('string');
    expect(typeof mem.lastActiveAt).toBe('string');
  });

  it('orgId is preserved', () => {
    const mem = buildContextualMemory('org-custom', []);
    expect(mem.orgId).toBe('org-custom');
  });

  it('empty history returns avgQualityScore=0.5', () => {
    const mem = buildContextualMemory('org-001', []);
    expect(mem.avgQualityScore).toBe(0.5);
  });

  it('empty history returns empty preferredFormats', () => {
    const mem = buildContextualMemory('org-001', []);
    expect(mem.preferredFormats).toEqual([]);
  });

  it('empty history returns totalGenerations=0', () => {
    const mem = buildContextualMemory('org-001', []);
    expect(mem.totalGenerations).toBe(0);
  });

  it('counts generation_completed events for totalGenerations', () => {
    const history = [
      makeEvent({ eventType: 'generation_completed' }),
      makeEvent({ eventType: 'generation_completed' }),
      makeEvent({ eventType: 'asset_accepted' }),
    ];
    const mem = buildContextualMemory('org-001', history);
    expect(mem.totalGenerations).toBe(2);
  });

  it('averages qualityScore from events', () => {
    const history = [
      makeEvent({ qualityScore: 0.8 }),
      makeEvent({ qualityScore: 0.6 }),
    ];
    const mem = buildContextualMemory('org-001', history);
    expect(mem.avgQualityScore).toBeCloseTo(0.7, 3);
  });

  it('avgQualityScore is 0.5 when no events have qualityScore', () => {
    const history = [makeEvent(), makeEvent()]; // no qualityScore
    const mem = buildContextualMemory('org-001', history);
    expect(mem.avgQualityScore).toBe(0.5);
  });

  it('most frequently used format is first in preferredFormats', () => {
    const history = [
      makeEvent({ format: 'instagram_post' }),
      makeEvent({ format: 'instagram_post' }),
      makeEvent({ format: 'flyer' }),
    ];
    const mem = buildContextualMemory('org-001', history);
    expect(mem.preferredFormats[0]).toBe('instagram_post');
  });

  it('returns at most 3 preferred formats', () => {
    const formats = ['a', 'b', 'c', 'd', 'e'];
    const history = formats.map(format => makeEvent({ format }));
    const mem = buildContextualMemory('org-001', history);
    expect(mem.preferredFormats.length).toBeLessThanOrEqual(3);
  });

  it('lastActiveAt matches last event occurredAt', () => {
    const ts = '2026-01-15T10:00:00.000Z';
    const history = [
      makeEvent({ occurredAt: '2026-01-14T10:00:00.000Z' }),
      makeEvent({ occurredAt: ts }),
    ];
    const mem = buildContextualMemory('org-001', history);
    expect(mem.lastActiveAt).toBe(ts);
  });

  it('lastActiveAt is a valid ISO string for empty history', () => {
    const mem = buildContextualMemory('org-001', []);
    expect(() => new Date(mem.lastActiveAt)).not.toThrow();
  });

  it('avgQualityScore is rounded to 3 decimal places', () => {
    const history = [makeEvent({ qualityScore: 1 / 3 })];
    const mem = buildContextualMemory('org-001', history);
    // 0.333... rounded to 3dp = 0.333
    const decimals = String(mem.avgQualityScore).split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(3);
  });

  it('does not throw for any event type', () => {
    const eventTypes: FeedbackEvent['eventType'][] = [
      'generation_completed', 'asset_accepted', 'asset_rejected',
      'variation_selected', 'export_completed', 'user_edited_output', 'template_applied',
    ];
    const history = eventTypes.map(eventType => makeEvent({ eventType }));
    expect(() => buildContextualMemory('org-001', history)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FeedbackEventTypeSchema
// ══════════════════════════════════════════════════════════════════════════════
describe('FeedbackEventTypeSchema', () => {
  const VALID_TYPES = [
    'generation_completed',
    'asset_accepted',
    'asset_rejected',
    'variation_selected',
    'export_completed',
    'user_edited_output',
    'template_applied',
  ];

  for (const type of VALID_TYPES) {
    it(`accepts valid event type: ${type}`, () => {
      const result = FeedbackEventTypeSchema.safeParse(type);
      expect(result.success).toBe(true);
    });
  }

  it('rejects unknown event type', () => {
    expect(FeedbackEventTypeSchema.safeParse('unknown_event').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(FeedbackEventTypeSchema.safeParse('').success).toBe(false);
  });

  it('rejects null', () => {
    expect(FeedbackEventTypeSchema.safeParse(null).success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FeedbackEventSchema
// ══════════════════════════════════════════════════════════════════════════════
describe('FeedbackEventSchema', () => {
  const MINIMAL = {
    eventType: 'asset_accepted',
    orgId: 'org-001',
    sessionId: 'session-001',
  };

  it('accepts minimal valid event', () => {
    expect(FeedbackEventSchema.safeParse(MINIMAL).success).toBe(true);
  });

  it('defaults metadata to {}', () => {
    const result = FeedbackEventSchema.safeParse(MINIMAL);
    expect(result.success && result.data.metadata).toEqual({});
  });

  it('defaults occurredAt to ISO string', () => {
    const result = FeedbackEventSchema.safeParse(MINIMAL);
    expect(result.success && typeof result.data.occurredAt).toBe('string');
  });

  it('rejects missing orgId', () => {
    const { orgId: _, ...bad } = MINIMAL as any;
    expect(FeedbackEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects missing sessionId', () => {
    const { sessionId: _, ...bad } = MINIMAL as any;
    expect(FeedbackEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects invalid eventType', () => {
    expect(FeedbackEventSchema.safeParse({ ...MINIMAL, eventType: 'bad_type' }).success).toBe(false);
  });

  it('rejects qualityScore > 1', () => {
    expect(FeedbackEventSchema.safeParse({ ...MINIMAL, qualityScore: 1.5 }).success).toBe(false);
  });

  it('rejects qualityScore < 0', () => {
    expect(FeedbackEventSchema.safeParse({ ...MINIMAL, qualityScore: -0.1 }).success).toBe(false);
  });

  it('accepts qualityScore = 0', () => {
    expect(FeedbackEventSchema.safeParse({ ...MINIMAL, qualityScore: 0 }).success).toBe(true);
  });

  it('accepts qualityScore = 1', () => {
    expect(FeedbackEventSchema.safeParse({ ...MINIMAL, qualityScore: 1 }).success).toBe(true);
  });

  it('rejects negative variationIdx', () => {
    expect(FeedbackEventSchema.safeParse({ ...MINIMAL, variationIdx: -1 }).success).toBe(false);
  });

  it('accepts variationIdx = 0', () => {
    expect(FeedbackEventSchema.safeParse({ ...MINIMAL, variationIdx: 0 }).success).toBe(true);
  });

  it('accepts full valid event with all optional fields', () => {
    const full = {
      ...MINIMAL,
      jobId: 'job-001',
      assetId: 'asset-001',
      variationIdx: 2,
      format: 'instagram_post',
      planKey: 'pro',
      durationMs: 1500,
      qualityScore: 0.85,
      metadata: { custom: 'value' },
      occurredAt: new Date().toISOString(),
    };
    expect(FeedbackEventSchema.safeParse(full).success).toBe(true);
  });
});
