/**
 * apps/arkiol-core/src/__tests__/stage-validator.test.ts
 *
 * Unit tests for engines/validation/stage-validator.ts
 *
 * All functions are pure (no DB, no HTTP, no Next.js runtime).
 *
 * Covers:
 *  - Constant sets: VALID_ARCHETYPES, VALID_PRESETS, VALID_DENSITY_PROFILES,
 *    VALID_HOOK_STRATEGIES, VALID_COMPOSITION_PATTERNS, VALID_FORMATS
 *  - validateDesignGenome — valid, missing required fields, auto-repair
 *  - validateEvaluationScores — shape, score bounds, composite derivation
 *  - validateFormat — normalization, partial match, unknown fallback
 */

import {
  VALID_ARCHETYPES,
  VALID_PRESETS,
  VALID_DENSITY_PROFILES,
  VALID_HOOK_STRATEGIES,
  VALID_COMPOSITION_PATTERNS,
  VALID_FORMATS,
  validateDesignGenome,
  validateEvaluationScores,
  validateFormat,
} from '../engines/validation/stage-validator';

// ── Minimal valid genome fixture ──────────────────────────────────────────────
const VALID_GENOME = {
  layoutFamily:          'magazine',
  variationId:           'var-001',
  archetype:             'BOLD_CLAIM',
  preset:                'bold',
  typographyPersonality: 1,
  densityProfile:        'balanced',
  hookStrategy:          'bold_headline',
  compositionPattern:    'centered_axis',
  motionEligible:        false,
};

// ══════════════════════════════════════════════════════════════════════════════
// Constant set integrity
// ══════════════════════════════════════════════════════════════════════════════
describe('VALID_ARCHETYPES', () => {
  it('is a Set with at least 10 entries', () => {
    expect(VALID_ARCHETYPES.size).toBeGreaterThanOrEqual(10);
  });

  it('contains expected core archetypes', () => {
    expect(VALID_ARCHETYPES.has('BOLD_CLAIM')).toBe(true);
    expect(VALID_ARCHETYPES.has('MINIMAL_CLEAN')).toBe(true);
    expect(VALID_ARCHETYPES.has('LUXURY_PREMIUM')).toBe(true);
    expect(VALID_ARCHETYPES.has('TECH_FUTURISTIC')).toBe(true);
    expect(VALID_ARCHETYPES.has('EMOTIONAL_STORY')).toBe(true);
  });

  it('does not contain lowercase versions', () => {
    expect(VALID_ARCHETYPES.has('bold_claim')).toBe(false);
    expect(VALID_ARCHETYPES.has('minimal_clean')).toBe(false);
  });
});

describe('VALID_PRESETS', () => {
  it('contains all 5 canonical presets', () => {
    const expected = ['clean', 'bold', 'professional', 'minimal', 'expressive'];
    for (const p of expected) expect(VALID_PRESETS.has(p)).toBe(true);
    expect(VALID_PRESETS.size).toBe(5);
  });
});

describe('VALID_DENSITY_PROFILES', () => {
  it('contains exactly 4 profiles', () => {
    expect(VALID_DENSITY_PROFILES.size).toBe(4);
  });

  it('contains sparse, balanced, rich, dense', () => {
    expect(VALID_DENSITY_PROFILES.has('sparse')).toBe(true);
    expect(VALID_DENSITY_PROFILES.has('balanced')).toBe(true);
    expect(VALID_DENSITY_PROFILES.has('rich')).toBe(true);
    expect(VALID_DENSITY_PROFILES.has('dense')).toBe(true);
  });
});

describe('VALID_HOOK_STRATEGIES', () => {
  it('has at least 8 strategies', () => {
    expect(VALID_HOOK_STRATEGIES.size).toBeGreaterThanOrEqual(8);
  });

  it('contains bold_headline and visual_lead', () => {
    expect(VALID_HOOK_STRATEGIES.has('bold_headline')).toBe(true);
    expect(VALID_HOOK_STRATEGIES.has('visual_lead')).toBe(true);
  });

  it('does not contain uppercase versions', () => {
    expect(VALID_HOOK_STRATEGIES.has('BOLD_HEADLINE')).toBe(false);
  });
});

describe('VALID_COMPOSITION_PATTERNS', () => {
  it('has at least 8 patterns', () => {
    expect(VALID_COMPOSITION_PATTERNS.size).toBeGreaterThanOrEqual(8);
  });

  it('contains core patterns', () => {
    expect(VALID_COMPOSITION_PATTERNS.has('centered_axis')).toBe(true);
    expect(VALID_COMPOSITION_PATTERNS.has('rule_of_thirds')).toBe(true);
    expect(VALID_COMPOSITION_PATTERNS.has('golden_ratio')).toBe(true);
  });
});

describe('VALID_FORMATS', () => {
  it('has at least 15 formats', () => {
    expect(VALID_FORMATS.size).toBeGreaterThanOrEqual(15);
  });

  it('contains all major social formats', () => {
    const expected = [
      'youtube_thumbnail', 'instagram_post', 'instagram_story',
      'tiktok_ad', 'linkedin_post', 'facebook_ad',
    ];
    for (const f of expected) expect(VALID_FORMATS.has(f)).toBe(true);
  });

  it('contains print formats', () => {
    expect(VALID_FORMATS.has('flyer')).toBe(true);
    expect(VALID_FORMATS.has('poster')).toBe(true);
    expect(VALID_FORMATS.has('business_card')).toBe(true);
    expect(VALID_FORMATS.has('resume')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// validateDesignGenome
// ══════════════════════════════════════════════════════════════════════════════
describe('validateDesignGenome — valid inputs', () => {
  it('returns valid=true for a well-formed genome', () => {
    const result = validateDesignGenome(VALID_GENOME);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returned data contains all required fields', () => {
    const result = validateDesignGenome(VALID_GENOME);
    expect(result.data).not.toBeNull();
    const g = result.data!;
    expect(g.layoutFamily).toBe('magazine');
    expect(g.variationId).toBe('var-001');
    expect(g.archetype).toBe('BOLD_CLAIM');
    expect(g.preset).toBe('bold');
    expect(g.typographyPersonality).toBe(1);
    expect(g.densityProfile).toBe('balanced');
    expect(g.hookStrategy).toBe('bold_headline');
    expect(g.compositionPattern).toBe('centered_axis');
    expect(g.motionEligible).toBe(false);
  });

  it('does not set repaired=true for valid input', () => {
    const result = validateDesignGenome(VALID_GENOME);
    expect(result.repaired).toBe(false);
    expect(result.repairLog).toHaveLength(0);
  });

  it('motionEligible=true is preserved', () => {
    const result = validateDesignGenome({ ...VALID_GENOME, motionEligible: true });
    expect(result.data?.motionEligible).toBe(true);
  });

  it('accepts all 5 typographyPersonality values (0–4)', () => {
    for (const tp of [0, 1, 2, 3, 4]) {
      const result = validateDesignGenome({ ...VALID_GENOME, typographyPersonality: tp });
      expect(result.valid).toBe(true);
      expect(result.data?.typographyPersonality).toBe(tp);
    }
  });

  it('accepts all valid presets', () => {
    for (const preset of VALID_PRESETS) {
      const result = validateDesignGenome({ ...VALID_GENOME, preset });
      expect(result.valid).toBe(true);
      expect(result.data?.preset).toBe(preset);
    }
  });

  it('accepts all valid archetypes', () => {
    for (const archetype of VALID_ARCHETYPES) {
      const result = validateDesignGenome({ ...VALID_GENOME, archetype });
      expect(result.valid).toBe(true);
      expect(result.data?.archetype).toBe(archetype);
    }
  });
});

describe('validateDesignGenome — missing required fields', () => {
  it('fails when layoutFamily is missing', () => {
    const { layoutFamily: _, ...rest } = VALID_GENOME;
    const result = validateDesignGenome(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('layoutFamily'))).toBe(true);
  });

  it('fails when variationId is missing', () => {
    const { variationId: _, ...rest } = VALID_GENOME;
    const result = validateDesignGenome(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('variationId'))).toBe(true);
  });

  it('fails for null input', () => {
    const result = validateDesignGenome(null);
    expect(result.valid).toBe(false);
    expect(result.data).toBeNull();
  });

  it('fails for non-object input', () => {
    expect(validateDesignGenome('string').valid).toBe(false);
    expect(validateDesignGenome(42).valid).toBe(false);
    expect(validateDesignGenome([]).valid).toBe(false);
  });
});

describe('validateDesignGenome — auto-repair', () => {
  it('repairs invalid archetype to BOLD_CLAIM', () => {
    const result = validateDesignGenome({ ...VALID_GENOME, archetype: 'NOT_REAL' });
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.data?.archetype).toBe('BOLD_CLAIM');
    expect(result.repairLog.some(r => r.includes('BOLD_CLAIM'))).toBe(true);
  });

  it('repairs invalid preset to "bold"', () => {
    const result = validateDesignGenome({ ...VALID_GENOME, preset: 'fancy' });
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.data?.preset).toBe('bold');
  });

  it('repairs invalid densityProfile to "balanced"', () => {
    const result = validateDesignGenome({ ...VALID_GENOME, densityProfile: 'ultra_dense' });
    expect(result.valid).toBe(true);
    expect(result.data?.densityProfile).toBe('balanced');
  });

  it('repairs invalid hookStrategy to "bold_headline"', () => {
    const result = validateDesignGenome({ ...VALID_GENOME, hookStrategy: 'unknown_strat' });
    expect(result.valid).toBe(true);
    expect(result.data?.hookStrategy).toBe('bold_headline');
  });

  it('repairs invalid compositionPattern to "centered_axis"', () => {
    const result = validateDesignGenome({ ...VALID_GENOME, compositionPattern: 'random_scatter' });
    expect(result.valid).toBe(true);
    expect(result.data?.compositionPattern).toBe('centered_axis');
  });

  it('clamps typographyPersonality=5 to 4', () => {
    const result = validateDesignGenome({ ...VALID_GENOME, typographyPersonality: 5 });
    expect(result.valid).toBe(true);
    expect(result.data?.typographyPersonality).toBe(4);
  });

  it('clamps typographyPersonality=-1 to 0', () => {
    const result = validateDesignGenome({ ...VALID_GENOME, typographyPersonality: -1 });
    expect(result.valid).toBe(true);
    expect(result.data?.typographyPersonality).toBe(0);
  });

  it('rounds typographyPersonality=2.7 to 3', () => {
    const result = validateDesignGenome({ ...VALID_GENOME, typographyPersonality: 2.7 });
    expect(result.valid).toBe(true);
    expect(result.data?.typographyPersonality).toBe(3);
  });

  it('repairs multiple fields at once and still returns valid', () => {
    const result = validateDesignGenome({
      ...VALID_GENOME,
      archetype:          'INVALID',
      preset:             'garbage',
      densityProfile:     'wrong',
      typographyPersonality: 99,
    });
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.repairLog.length).toBeGreaterThanOrEqual(3);
  });

  it('coerces non-boolean motionEligible to boolean', () => {
    const result = validateDesignGenome({ ...VALID_GENOME, motionEligible: 1 });
    expect(typeof result.data?.motionEligible).toBe('boolean');
    expect(result.data?.motionEligible).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// validateEvaluationScores
// ══════════════════════════════════════════════════════════════════════════════
describe('validateEvaluationScores', () => {
  const VALID_SCORES = {
    readability:              0.8,
    visualHierarchyClarity:  0.7,
    platformOptimization:    0.9,
    brandAlignment:          0.85,
    visualBalance:           0.75,
    attentionPotential:      0.95,
    compositeScore:          0.84,
    weakestDimension:        'brandAlignment',
    evaluationMs:            42,
  };

  it('returns valid=true for a well-formed scores object', () => {
    const result = validateEvaluationScores(VALID_SCORES);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails for null input', () => {
    expect(validateEvaluationScores(null).valid).toBe(false);
  });

  it('fails for non-object input', () => {
    expect(validateEvaluationScores('string').valid).toBe(false);
    expect(validateEvaluationScores(42).valid).toBe(false);
  });

  it('data is not null for valid input', () => {
    expect(validateEvaluationScores(VALID_SCORES).data).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// validateFormat
// ══════════════════════════════════════════════════════════════════════════════
describe('validateFormat', () => {
  it('returns valid=true for all formats in VALID_FORMATS', () => {
    for (const fmt of VALID_FORMATS) {
      const result = validateFormat(fmt);
      expect(result.valid).toBe(true);
    }
  });

  it('returns the format as-is when it is valid', () => {
    const result = validateFormat('instagram_post');
    expect(result.data).toBe('instagram_post');
    expect(result.repaired).toBe(false);
  });

  it('normalises spaces and hyphens to underscores', () => {
    const result = validateFormat('instagram post');
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
  });

  it('normalises to lowercase', () => {
    const result = validateFormat('INSTAGRAM_POST');
    expect(result.valid).toBe(true);
    expect(result.data).toBe('instagram_post');
    expect(result.repaired).toBe(true);
  });

  it('ig_post alias resolves to a valid format', () => {
    const result = validateFormat('ig_post');
    expect(result.valid).toBe(true);
  });

  it('ig_story alias resolves to a valid format', () => {
    const result = validateFormat('ig_story');
    expect(result.valid).toBe(true);
  });

  it('yt_thumb alias resolves to a valid format', () => {
    const result = validateFormat('yt_thumb');
    expect(result.valid).toBe(true);
  });

  it('completely unknown format falls back to instagram_post', () => {
    const result = validateFormat('completely_unknown_xyz_123');
    expect(result.valid).toBe(true);
    expect(result.data).toBe('instagram_post');
    expect(result.repaired).toBe(true);
    expect(result.repairLog.some(r => r.includes('instagram_post'))).toBe(true);
  });

  it('returns valid=false for empty string', () => {
    expect(validateFormat('').valid).toBe(false);
  });

  it('returns valid=false for non-string input', () => {
    expect(validateFormat(null).valid).toBe(false);
    expect(validateFormat(42).valid).toBe(false);
    expect(validateFormat(undefined).valid).toBe(false);
    expect(validateFormat({}).valid).toBe(false);
  });

  it('repairLog is empty for exact match', () => {
    const result = validateFormat('youtube_thumbnail');
    expect(result.repairLog).toHaveLength(0);
    expect(result.repaired).toBe(false);
  });

  it('repairLog is populated for repaired formats', () => {
    const result = validateFormat('completely_unknown');
    expect(result.repairLog.length).toBeGreaterThan(0);
  });
});
