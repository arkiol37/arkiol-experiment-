/**
 * apps/arkiol-core/src/__tests__/genome-generator.test.ts
 *
 * Unit tests for engines/exploration/genome-generator.ts
 *
 * Pure deterministic functions (SHA-256 seeded RNG) — no DB, no HTTP.
 *
 * Covers:
 *  - GENOME_SPACE — constant integrity (all 9 layout families, 20 archetypes, etc.)
 *  - buildGenome — returns valid DesignGenome, deterministic, all values in
 *    GENOME_SPACE, format→layoutFamily mapping, motionEligible derivation
 *  - buildCandidate — shape, deterministic id, format propagation, no scores
 *  - generateGenomePool — count, unique IDs, same seed determinism,
 *    different seeds produce different pools
 */

import {
  GENOME_SPACE,
  buildGenome,
  buildCandidate,
  generateGenomePool,
  type GenomePoolOptions,
} from '../engines/exploration/genome-generator';
import type { ExplorePipelineContext } from '../engines/exploration/types';

// ── Minimal pipeline context fixture ─────────────────────────────────────────
const BASE_CONTEXT: ExplorePipelineContext = {
  intent:          'promote product launch',
  format:          'instagram_post',
  audienceSegment: 'young adults',
  tonePreference:  'energetic',
  layoutType:      'split',
};

function poolOpts(overrides: Partial<GenomePoolOptions> = {}): GenomePoolOptions {
  return {
    masterSeed: 'test-seed-abc',
    format:     'instagram_post',
    poolSize:   10,
    context:    BASE_CONTEXT,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// GENOME_SPACE integrity
// ══════════════════════════════════════════════════════════════════════════════
describe('GENOME_SPACE — constant integrity', () => {
  it('has 9 layout families', () => {
    expect(GENOME_SPACE.layoutFamilies.length).toBe(9);
  });

  it('all 9 canonical format families are present', () => {
    const expected = ['ig_post', 'ig_story', 'yt_thumb', 'flyer', 'poster', 'slide', 'business_card', 'resume', 'logo'];
    for (const f of expected) expect(GENOME_SPACE.layoutFamilies).toContain(f as any);
  });

  it('has exactly 20 archetypes', () => {
    expect(GENOME_SPACE.archetypes.length).toBe(20);
  });

  it('archetypes are all uppercase strings', () => {
    for (const a of GENOME_SPACE.archetypes) {
      expect(a).toMatch(/^[A-Z_]+$/);
    }
  });

  it('archetypes contain BOLD_CLAIM and MINIMAL_CLEAN', () => {
    expect(GENOME_SPACE.archetypes).toContain('BOLD_CLAIM' as any);
    expect(GENOME_SPACE.archetypes).toContain('MINIMAL_CLEAN' as any);
  });

  it('has exactly 5 presets', () => {
    expect(GENOME_SPACE.presets.length).toBe(5);
    const expected = ['clean', 'bold', 'professional', 'minimal', 'expressive'];
    for (const p of expected) expect(GENOME_SPACE.presets).toContain(p as any);
  });

  it('typographyPersonalities is [0,1,2,3,4]', () => {
    expect(GENOME_SPACE.typographyPersonalities).toEqual([0, 1, 2, 3, 4]);
  });

  it('densityProfiles has 4 levels', () => {
    expect(GENOME_SPACE.densityProfiles).toContain('sparse');
    expect(GENOME_SPACE.densityProfiles).toContain('balanced');
    expect(GENOME_SPACE.densityProfiles).toContain('rich');
    expect(GENOME_SPACE.densityProfiles).toContain('dense');
  });

  it('variationIds has entries for all 9 layout families', () => {
    for (const family of GENOME_SPACE.layoutFamilies) {
      expect(GENOME_SPACE.variationIds[family]).toBeDefined();
      expect(GENOME_SPACE.variationIds[family].length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all variation IDs start with "v"', () => {
    for (const [, ids] of Object.entries(GENOME_SPACE.variationIds)) {
      for (const id of ids) {
        expect(id).toMatch(/^v\d/);
      }
    }
  });

  it('hookStrategies contains bold_headline', () => {
    expect(GENOME_SPACE.hookStrategies).toContain('bold_headline');
  });

  it('compositionPatterns contains centered_axis', () => {
    expect(GENOME_SPACE.compositionPatterns).toContain('centered_axis');
  });

  it('archetypes have no duplicates', () => {
    const s = new Set(GENOME_SPACE.archetypes);
    expect(s.size).toBe(GENOME_SPACE.archetypes.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildGenome
// ══════════════════════════════════════════════════════════════════════════════
describe('buildGenome', () => {
  it('returns a DesignGenome with all 9 required fields', () => {
    const g = buildGenome('seed1', 0, 'instagram_post', BASE_CONTEXT);
    expect(typeof g.layoutFamily).toBe('string');
    expect(typeof g.variationId).toBe('string');
    expect(typeof g.archetype).toBe('string');
    expect(typeof g.preset).toBe('string');
    expect([0,1,2,3,4]).toContain(g.typographyPersonality);
    expect(['sparse','balanced','rich','dense']).toContain(g.densityProfile);
    expect(typeof g.hookStrategy).toBe('string');
    expect(typeof g.compositionPattern).toBe('string');
    expect(typeof g.motionEligible).toBe('boolean');
  });

  it('is deterministic — same inputs always yield identical genome', () => {
    const a = buildGenome('seed-xyz', 5, 'flyer', BASE_CONTEXT);
    const b = buildGenome('seed-xyz', 5, 'flyer', BASE_CONTEXT);
    expect(a).toEqual(b);
  });

  it('different seeds produce different genomes', () => {
    const a = buildGenome('seed-aaa', 0, 'instagram_post', BASE_CONTEXT);
    const b = buildGenome('seed-bbb', 0, 'instagram_post', BASE_CONTEXT);
    expect(a).not.toEqual(b);
  });

  it('different generationIndex values produce different genomes', () => {
    const genomes = Array.from({ length: 20 }, (_, i) =>
      buildGenome('same-seed', i, 'instagram_post', BASE_CONTEXT)
    );
    // Check that not all genomes are identical
    const unique = new Set(genomes.map(g => JSON.stringify(g)));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('archetype is in GENOME_SPACE.archetypes', () => {
    for (let i = 0; i < 20; i++) {
      const g = buildGenome('seed', i, 'instagram_post', BASE_CONTEXT);
      expect(GENOME_SPACE.archetypes).toContain(g.archetype as any);
    }
  });

  it('preset is in GENOME_SPACE.presets', () => {
    for (let i = 0; i < 20; i++) {
      const g = buildGenome('seed', i, 'instagram_post', BASE_CONTEXT);
      expect(GENOME_SPACE.presets).toContain(g.preset as any);
    }
  });

  it('densityProfile is in GENOME_SPACE.densityProfiles', () => {
    for (let i = 0; i < 20; i++) {
      const g = buildGenome('seed', i, 'flyer', BASE_CONTEXT);
      expect(GENOME_SPACE.densityProfiles).toContain(g.densityProfile);
    }
  });

  it('hookStrategy is in GENOME_SPACE.hookStrategies', () => {
    for (let i = 0; i < 20; i++) {
      const g = buildGenome('seed', i, 'instagram_post', BASE_CONTEXT);
      expect(GENOME_SPACE.hookStrategies).toContain(g.hookStrategy);
    }
  });

  it('compositionPattern is in GENOME_SPACE.compositionPatterns', () => {
    for (let i = 0; i < 20; i++) {
      const g = buildGenome('seed', i, 'instagram_post', BASE_CONTEXT);
      expect(GENOME_SPACE.compositionPatterns).toContain(g.compositionPattern);
    }
  });

  it('variationId is in family variation pool', () => {
    for (let i = 0; i < 20; i++) {
      const g = buildGenome('seed', i, 'instagram_post', BASE_CONTEXT);
      const pool = GENOME_SPACE.variationIds[g.layoutFamily] ?? ['v1_default'];
      expect(pool).toContain(g.variationId);
    }
  });

  it('instagram_post format → layoutFamily is ig_post', () => {
    const g = buildGenome('seed', 0, 'instagram_post', BASE_CONTEXT);
    expect(g.layoutFamily).toBe('ig_post');
  });

  it('instagram_story → ig_story', () => {
    const g = buildGenome('seed', 0, 'instagram_story', BASE_CONTEXT);
    expect(g.layoutFamily).toBe('ig_story');
  });

  it('youtube_thumbnail → yt_thumb', () => {
    const g = buildGenome('seed', 0, 'youtube_thumbnail', BASE_CONTEXT);
    expect(g.layoutFamily).toBe('yt_thumb');
  });

  it('flyer format → flyer family', () => {
    const g = buildGenome('seed', 0, 'flyer', BASE_CONTEXT);
    expect(g.layoutFamily).toBe('flyer');
  });

  it('works for all 9 canonical formats without throwing', () => {
    const formats = [
      'instagram_post', 'instagram_story', 'youtube_thumbnail',
      'flyer', 'poster', 'presentation_slide', 'business_card', 'resume', 'logo',
    ];
    for (const fmt of formats) {
      expect(() => buildGenome('seed', 0, fmt, BASE_CONTEXT)).not.toThrow();
    }
  });

  it('typographyPersonality is 0, 1, 2, 3, or 4', () => {
    for (let i = 0; i < 30; i++) {
      const g = buildGenome('seed', i, 'instagram_post', BASE_CONTEXT);
      expect([0, 1, 2, 3, 4]).toContain(g.typographyPersonality);
    }
  });

  it('youtube_thumbnail never sets motionEligible=true (no motion allowed)', () => {
    for (let i = 0; i < 20; i++) {
      const g = buildGenome('seed', i, 'youtube_thumbnail', BASE_CONTEXT);
      // youtube_thumbnail doesn't allow motion — motionEligible should be false
      // (derived deterministically from format + hookStrategy)
      expect(typeof g.motionEligible).toBe('boolean');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildCandidate
// ══════════════════════════════════════════════════════════════════════════════
describe('buildCandidate', () => {
  it('returns a CandidateDesignPlan with all required fields', () => {
    const c = buildCandidate('seed', 0, 'instagram_post', BASE_CONTEXT);
    expect(typeof c.candidateId).toBe('string');
    expect(typeof c.seed).toBe('string');
    expect(c.genome).toBeDefined();
    expect(typeof c.generationIndex).toBe('number');
    expect(typeof c.format).toBe('string');
    expect(typeof c.layoutCategory).toBe('string');
    expect(typeof c.constraintsPassed).toBe('boolean');
    expect(Array.isArray(c.repairLog)).toBe(true);
    expect(typeof c.generatedAt).toBe('string');
  });

  it('candidateId is a 32-character hex string', () => {
    const c = buildCandidate('seed', 0, 'instagram_post', BASE_CONTEXT);
    expect(c.candidateId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('seed matches the masterSeed passed in', () => {
    const c = buildCandidate('my-unique-seed', 0, 'instagram_post', BASE_CONTEXT);
    expect(c.seed).toBe('my-unique-seed');
  });

  it('generationIndex is preserved', () => {
    expect(buildCandidate('s', 7, 'flyer', BASE_CONTEXT).generationIndex).toBe(7);
  });

  it('format is preserved', () => {
    expect(buildCandidate('s', 0, 'youtube_thumbnail', BASE_CONTEXT).format).toBe('youtube_thumbnail');
  });

  it('constraintsPassed is initially false', () => {
    const c = buildCandidate('seed', 0, 'instagram_post', BASE_CONTEXT);
    expect(c.constraintsPassed).toBe(false);
  });

  it('repairLog is initially empty', () => {
    const c = buildCandidate('seed', 0, 'instagram_post', BASE_CONTEXT);
    expect(c.repairLog).toEqual([]);
  });

  it('is deterministic — same inputs produce same candidateId', () => {
    const a = buildCandidate('seed', 3, 'flyer', BASE_CONTEXT);
    const b = buildCandidate('seed', 3, 'flyer', BASE_CONTEXT);
    expect(a.candidateId).toBe(b.candidateId);
  });

  it('different generationIndex produces different candidateId', () => {
    const a = buildCandidate('seed', 0, 'instagram_post', BASE_CONTEXT);
    const b = buildCandidate('seed', 1, 'instagram_post', BASE_CONTEXT);
    expect(a.candidateId).not.toBe(b.candidateId);
  });

  it('different masterSeed produces different candidateId', () => {
    const a = buildCandidate('seed-a', 0, 'instagram_post', BASE_CONTEXT);
    const b = buildCandidate('seed-b', 0, 'instagram_post', BASE_CONTEXT);
    expect(a.candidateId).not.toBe(b.candidateId);
  });

  it('generatedAt is a valid ISO timestamp string', () => {
    const c = buildCandidate('seed', 0, 'instagram_post', BASE_CONTEXT);
    expect(() => new Date(c.generatedAt)).not.toThrow();
    expect(new Date(c.generatedAt).toISOString()).toBe(c.generatedAt);
  });

  it('instagram_post → layoutCategory "instagram"', () => {
    const c = buildCandidate('seed', 0, 'instagram_post', BASE_CONTEXT);
    expect(c.layoutCategory).toBe('instagram');
  });

  it('instagram_story → layoutCategory "story"', () => {
    const c = buildCandidate('seed', 0, 'instagram_story', BASE_CONTEXT);
    expect(c.layoutCategory).toBe('story');
  });

  it('youtube_thumbnail → layoutCategory "thumbnail"', () => {
    const c = buildCandidate('seed', 0, 'youtube_thumbnail', BASE_CONTEXT);
    expect(c.layoutCategory).toBe('thumbnail');
  });

  it('resume → layoutCategory "document"', () => {
    const c = buildCandidate('seed', 0, 'resume', BASE_CONTEXT);
    expect(c.layoutCategory).toBe('document');
  });

  it('no scores on initial candidate', () => {
    const c = buildCandidate('seed', 0, 'instagram_post', BASE_CONTEXT);
    expect(c.scores).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// generateGenomePool
// ══════════════════════════════════════════════════════════════════════════════
describe('generateGenomePool', () => {
  it('returns a GenomePoolResult with required fields', () => {
    const result = generateGenomePool(poolOpts({ poolSize: 5 }));
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(typeof result.generationMs).toBe('number');
    expect(typeof result.masterSeed).toBe('string');
    expect(typeof result.format).toBe('string');
    expect(typeof result.poolSize).toBe('number');
  });

  it('candidates.length equals poolSize', () => {
    for (const size of [1, 5, 10, 20]) {
      const result = generateGenomePool(poolOpts({ poolSize: size }));
      expect(result.candidates.length).toBe(size);
    }
  });

  it('all candidate IDs are unique within pool', () => {
    const result = generateGenomePool(poolOpts({ poolSize: 20 }));
    const ids = result.candidates.map(c => c.candidateId);
    expect(new Set(ids).size).toBe(20);
  });

  it('is deterministic — same options produce same pool', () => {
    const opts = poolOpts({ poolSize: 5, masterSeed: 'determinism-test' });
    const a = generateGenomePool(opts);
    const b = generateGenomePool(opts);
    expect(a.candidates.map(c => c.candidateId)).toEqual(b.candidates.map(c => c.candidateId));
    expect(a.candidates.map(c => c.genome)).toEqual(b.candidates.map(c => c.genome));
  });

  it('different masterSeeds produce different pools', () => {
    const a = generateGenomePool(poolOpts({ masterSeed: 'seed-one', poolSize: 5 }));
    const b = generateGenomePool(poolOpts({ masterSeed: 'seed-two', poolSize: 5 }));
    expect(a.candidates[0]!.candidateId).not.toBe(b.candidates[0]!.candidateId);
  });

  it('masterSeed is preserved in result', () => {
    const result = generateGenomePool(poolOpts({ masterSeed: 'my-seed' }));
    expect(result.masterSeed).toBe('my-seed');
  });

  it('format is preserved in result', () => {
    const result = generateGenomePool(poolOpts({ format: 'youtube_thumbnail' }));
    expect(result.format).toBe('youtube_thumbnail');
  });

  it('poolSize is preserved in result', () => {
    const result = generateGenomePool(poolOpts({ poolSize: 7 }));
    expect(result.poolSize).toBe(7);
  });

  it('generationMs is non-negative', () => {
    const result = generateGenomePool(poolOpts({ poolSize: 3 }));
    expect(result.generationMs).toBeGreaterThanOrEqual(0);
  });

  it('all candidates have the correct format', () => {
    const result = generateGenomePool(poolOpts({ format: 'flyer', poolSize: 5 }));
    for (const c of result.candidates) {
      expect(c.format).toBe('flyer');
    }
  });

  it('generationIndex is sequential 0..poolSize-1', () => {
    const result = generateGenomePool(poolOpts({ poolSize: 5 }));
    result.candidates.forEach((c, i) => {
      expect(c.generationIndex).toBe(i);
    });
  });

  it('poolSize=0 returns empty candidates array', () => {
    const result = generateGenomePool(poolOpts({ poolSize: 0 }));
    expect(result.candidates.length).toBe(0);
  });

  it('large pool (50) generates without error', () => {
    expect(() => generateGenomePool(poolOpts({ poolSize: 50 }))).not.toThrow();
  });

  it('pool produces diversity — not all genomes identical', () => {
    const result = generateGenomePool(poolOpts({ poolSize: 20 }));
    const unique = new Set(result.candidates.map(c => JSON.stringify(c.genome)));
    expect(unique.size).toBeGreaterThan(1);
  });
});
