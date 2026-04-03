/**
 * packages/shared/src/__tests__/style-presets.test.ts
 *
 * Unit tests for ai/archetypes/stylePresets.ts and archetypes.ts
 *
 * Pure — no DB, no HTTP.
 *
 * Covers:
 *  - STYLE_PRESETS          — all 5 presets, required fields, color format
 *  - ARCHETYPE_PREFERRED_PRESETS — all 20 archetypes mapped, valid preset IDs
 *  - pickPresetForPlatform  — format → preset mapping
 *  - getStylePreset         — lookup, throws for unknown
 *  - isValidPresetId        — valid/invalid detection
 *  - ALL_ARCHETYPES         — count, shape, unique IDs
 *  - ARCHETYPE_MAP          — map integrity
 *  - getArchetype           — lookup, throws for unknown
 *  - selectArchetypeAndPreset — returns valid result, never throws
 *  - buildArchetypeMetadata   — shape, all fields present
 */

import {
  STYLE_PRESETS,
  ARCHETYPE_PREFERRED_PRESETS,
  pickPresetForPlatform,
  getStylePreset,
  isValidPresetId,
} from '../ai/archetypes/stylePresets';

import {
  ALL_ARCHETYPES,
  ARCHETYPE_MAP,
  getArchetype,
} from '../ai/archetypes/archetypes';

import {
  selectArchetypeAndPreset,
  buildArchetypeMetadata,
  type ArchetypeIntelligenceInput,
} from '../ai/archetypes/intelligenceEngine';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const VALID_PRESET_IDS = ['clean', 'bold', 'professional', 'minimal', 'expressive'] as const;
type PresetId = typeof VALID_PRESET_IDS[number];

const BASE_INPUT: ArchetypeIntelligenceInput = {
  prompt:        'Buy our product now',
  format:        'instagram_post',
  imageProvided: false,
  faceDetected:  false,
};

// ══════════════════════════════════════════════════════════════════════════════
// STYLE_PRESETS
// ══════════════════════════════════════════════════════════════════════════════
describe('STYLE_PRESETS', () => {
  it('has all 5 preset ids', () => {
    for (const id of VALID_PRESET_IDS) {
      expect(STYLE_PRESETS[id]).toBeDefined();
    }
  });

  it('every preset has required fields', () => {
    for (const [, preset] of Object.entries(STYLE_PRESETS)) {
      expect(typeof preset.id).toBe('string');
      expect(typeof preset.bg).toBe('string');
      expect(typeof preset.text).toBe('string');
      expect(typeof preset.primary).toBe('string');
      expect(typeof preset.secondary).toBe('string');
      expect(typeof preset.accent).toBe('string');
      expect(typeof preset.headlineFont).toBe('string');
      expect(typeof preset.bodyFont).toBe('string');
      expect(typeof preset.buttonRadius).toBe('number');
      expect(typeof preset.buttonPaddingX).toBe('number');
      expect(typeof preset.buttonPaddingY).toBe('number');
      expect(typeof preset.allowGradient).toBe('boolean');
    }
  });

  it('all color fields are hex strings starting with #', () => {
    const colorKeys = ['bg', 'text', 'primary', 'secondary', 'accent'] as const;
    for (const [, preset] of Object.entries(STYLE_PRESETS)) {
      for (const key of colorKeys) {
        expect(preset[key]).toMatch(/^#/);
      }
    }
  });

  it('all button radii are non-negative integers', () => {
    for (const [, preset] of Object.entries(STYLE_PRESETS)) {
      expect(Number.isInteger(preset.buttonRadius)).toBe(true);
      expect(preset.buttonRadius).toBeGreaterThanOrEqual(0);
    }
  });

  it('all buttonPaddingX and Y are positive', () => {
    for (const [, preset] of Object.entries(STYLE_PRESETS)) {
      expect(preset.buttonPaddingX).toBeGreaterThan(0);
      expect(preset.buttonPaddingY).toBeGreaterThan(0);
    }
  });

  it('presets that allowGradient have non-empty gradient string', () => {
    for (const [, preset] of Object.entries(STYLE_PRESETS)) {
      if (preset.allowGradient) {
        expect(preset.gradient.length).toBeGreaterThan(0);
      }
    }
  });

  it('bold preset has dark background', () => {
    // bold.bg is #0B0F19 — a very dark color
    expect(STYLE_PRESETS.bold.bg.toLowerCase()).not.toBe('#ffffff');
  });

  it('clean and minimal presets have white background', () => {
    expect(STYLE_PRESETS.clean.bg.toUpperCase()).toBe('#FFFFFF');
    expect(STYLE_PRESETS.minimal.bg.toUpperCase()).toBe('#FFFFFF');
  });

  it('each preset id matches its key', () => {
    for (const [key, preset] of Object.entries(STYLE_PRESETS)) {
      expect(preset.id).toBe(key);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ARCHETYPE_PREFERRED_PRESETS
// ══════════════════════════════════════════════════════════════════════════════
describe('ARCHETYPE_PREFERRED_PRESETS', () => {
  it('has exactly 20 archetype entries', () => {
    expect(Object.keys(ARCHETYPE_PREFERRED_PRESETS).length).toBe(20);
  });

  it('all values are valid preset IDs', () => {
    for (const [, presetId] of Object.entries(ARCHETYPE_PREFERRED_PRESETS)) {
      expect(isValidPresetId(presetId)).toBe(true);
    }
  });

  it('AGGRESSIVE_POWER maps to bold', () => {
    expect(ARCHETYPE_PREFERRED_PRESETS.AGGRESSIVE_POWER).toBe('bold');
  });

  it('MINIMAL_CLEAN maps to minimal', () => {
    expect(ARCHETYPE_PREFERRED_PRESETS.MINIMAL_CLEAN).toBe('minimal');
  });

  it('LUXURY_PREMIUM maps to minimal', () => {
    expect(ARCHETYPE_PREFERRED_PRESETS.LUXURY_PREMIUM).toBe('minimal');
  });

  it('EDUCATIONAL_EXPLAINER maps to professional', () => {
    expect(ARCHETYPE_PREFERRED_PRESETS.EDUCATIONAL_EXPLAINER).toBe('professional');
  });

  it('MUSIC_ARTISTIC maps to expressive', () => {
    expect(ARCHETYPE_PREFERRED_PRESETS.MUSIC_ARTISTIC).toBe('expressive');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// pickPresetForPlatform
// ══════════════════════════════════════════════════════════════════════════════
describe('pickPresetForPlatform', () => {
  it('resume → professional', () => {
    expect(pickPresetForPlatform('resume')).toBe('professional');
  });

  it('presentation → professional', () => {
    expect(pickPresetForPlatform('presentation_slide')).toBe('professional');
  });

  it('poster → bold', () => {
    expect(pickPresetForPlatform('poster')).toBe('bold');
  });

  it('youtube_thumbnail → bold', () => {
    expect(pickPresetForPlatform('youtube_thumbnail')).toBe('bold');
  });

  it('instagram_post → expressive', () => {
    expect(pickPresetForPlatform('instagram_post')).toBe('expressive');
  });

  it('instagram_story → expressive', () => {
    expect(pickPresetForPlatform('instagram_story')).toBe('expressive');
  });

  it('business_card (businesscard match) → minimal', () => {
    expect(pickPresetForPlatform('businesscard')).toBe('minimal');
  });

  it('unknown format defaults to clean', () => {
    expect(pickPresetForPlatform('flyer')).toBe('clean');
    expect(pickPresetForPlatform('logo')).toBe('clean');
    expect(pickPresetForPlatform('unknown_format')).toBe('clean');
  });

  it('is case-insensitive', () => {
    expect(pickPresetForPlatform('YOUTUBE_THUMBNAIL')).toBe('bold');
    expect(pickPresetForPlatform('Resume')).toBe('professional');
  });

  it('always returns a valid preset ID', () => {
    const formats = ['instagram_post', 'youtube_thumbnail', 'flyer', 'resume', 'logo', 'poster'];
    for (const fmt of formats) {
      expect(isValidPresetId(pickPresetForPlatform(fmt))).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getStylePreset
// ══════════════════════════════════════════════════════════════════════════════
describe('getStylePreset', () => {
  for (const id of VALID_PRESET_IDS) {
    it(`returns preset for "${id}"`, () => {
      const p = getStylePreset(id);
      expect(p.id).toBe(id);
    });
  }

  it('throws for unknown preset id', () => {
    expect(() => getStylePreset('unknown' as any)).toThrow();
  });

  it('thrown error mentions the unknown id', () => {
    try {
      getStylePreset('ghost' as any);
    } catch (e: any) {
      expect(e.message).toContain('ghost');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// isValidPresetId
// ══════════════════════════════════════════════════════════════════════════════
describe('isValidPresetId', () => {
  for (const id of VALID_PRESET_IDS) {
    it(`returns true for "${id}"`, () => {
      expect(isValidPresetId(id)).toBe(true);
    });
  }

  it('returns false for unknown id', () => {
    expect(isValidPresetId('neon')).toBe(false);
    expect(isValidPresetId('')).toBe(false);
    expect(isValidPresetId('BOLD')).toBe(false); // case-sensitive
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ALL_ARCHETYPES
// ══════════════════════════════════════════════════════════════════════════════
describe('ALL_ARCHETYPES', () => {
  it('has exactly 20 archetypes', () => {
    expect(ALL_ARCHETYPES.length).toBe(20);
  });

  it('all archetype IDs are unique', () => {
    const ids = ALL_ARCHETYPES.map(a => a.id);
    expect(new Set(ids).size).toBe(20);
  });

  it('all archetypes have required shape', () => {
    for (const a of ALL_ARCHETYPES) {
      expect(typeof a.id).toBe('string');
      expect(a.id.length).toBeGreaterThan(0);
    }
  });

  it('includes AGGRESSIVE_POWER', () => {
    expect(ALL_ARCHETYPES.some(a => a.id === 'AGGRESSIVE_POWER')).toBe(true);
  });

  it('includes LUXURY_PREMIUM', () => {
    expect(ALL_ARCHETYPES.some(a => a.id === 'LUXURY_PREMIUM')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ARCHETYPE_MAP
// ══════════════════════════════════════════════════════════════════════════════
describe('ARCHETYPE_MAP', () => {
  it('has same size as ALL_ARCHETYPES', () => {
    expect(ARCHETYPE_MAP.size).toBe(ALL_ARCHETYPES.length);
  });

  it('every archetype is reachable by ID', () => {
    for (const a of ALL_ARCHETYPES) {
      expect(ARCHETYPE_MAP.get(a.id)).toBeDefined();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getArchetype
// ══════════════════════════════════════════════════════════════════════════════
describe('getArchetype', () => {
  it('returns archetype for known id', () => {
    const a = getArchetype('MINIMAL_CLEAN');
    expect(a.id).toBe('MINIMAL_CLEAN');
  });

  it('throws for unknown archetype id', () => {
    expect(() => getArchetype('NOT_A_REAL_ID' as any)).toThrow();
  });

  it('thrown error mentions the unknown id', () => {
    try {
      getArchetype('GHOST_ARCHETYPE' as any);
    } catch (e: any) {
      expect(e.message).toContain('GHOST_ARCHETYPE');
    }
  });

  it('is consistent with ARCHETYPE_MAP', () => {
    for (const a of ALL_ARCHETYPES) {
      expect(getArchetype(a.id)).toBe(ARCHETYPE_MAP.get(a.id));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// selectArchetypeAndPreset
// ══════════════════════════════════════════════════════════════════════════════
describe('selectArchetypeAndPreset', () => {
  it('never throws', () => {
    expect(() => selectArchetypeAndPreset(BASE_INPUT)).not.toThrow();
  });

  it('returns object with archetype, preset, stageMs', () => {
    const result = selectArchetypeAndPreset(BASE_INPUT);
    expect(result.archetype).toBeDefined();
    expect(result.preset).toBeDefined();
    expect(typeof result.stageMs).toBe('number');
  });

  it('stageMs is non-negative', () => {
    const result = selectArchetypeAndPreset(BASE_INPUT);
    expect(result.stageMs).toBeGreaterThanOrEqual(0);
  });

  it('archetype has archetypeId from ALL_ARCHETYPES', () => {
    const result = selectArchetypeAndPreset(BASE_INPUT);
    const ids = ALL_ARCHETYPES.map(a => a.id);
    expect(ids).toContain(result.archetype.archetypeId);
  });

  it('preset has valid presetId', () => {
    const result = selectArchetypeAndPreset(BASE_INPUT);
    expect(isValidPresetId(result.preset.presetId)).toBe(true);
  });

  it('archetype confidence is in [0, 1]', () => {
    const result = selectArchetypeAndPreset(BASE_INPUT);
    expect(result.archetype.confidence).toBeGreaterThanOrEqual(0);
    expect(result.archetype.confidence).toBeLessThanOrEqual(1);
  });

  it('sports keyword selects SPORTS_ACTION', () => {
    const result = selectArchetypeAndPreset({ ...BASE_INPUT, prompt: 'win the game athlete sport' });
    expect(result.archetype.archetypeId).toBe('SPORTS_ACTION');
  });

  it('music keyword selects MUSIC_ARTISTIC', () => {
    const result = selectArchetypeAndPreset({ ...BASE_INPUT, prompt: 'new album music artist release concert' });
    expect(result.archetype.archetypeId).toBe('MUSIC_ARTISTIC');
  });

  it('luxury keyword selects LUXURY_PREMIUM', () => {
    const result = selectArchetypeAndPreset({ ...BASE_INPUT, prompt: 'luxury premium exclusive elite vip gold' });
    expect(result.archetype.archetypeId).toBe('LUXURY_PREMIUM');
  });

  it('kids keyword selects KIDS_PLAYFUL', () => {
    const result = selectArchetypeAndPreset({ ...BASE_INPUT, prompt: 'kids children play fun toys baby school' });
    expect(result.archetype.archetypeId).toBe('KIDS_PLAYFUL');
  });

  it('userOverride preset is respected when set', () => {
    const result = selectArchetypeAndPreset({
      ...BASE_INPUT,
      userOverride: { archetypeId: 'auto', presetId: 'minimal' },
    });
    expect(result.preset.presetId).toBe('minimal');
    expect(result.preset.brandOverride).toBe(true);
  });

  it('userOverride archetype is respected when set', () => {
    const result = selectArchetypeAndPreset({
      ...BASE_INPUT,
      userOverride: { archetypeId: 'CINEMATIC_DARK', presetId: 'auto' },
    });
    expect(result.archetype.archetypeId).toBe('CINEMATIC_DARK');
  });

  it('is consistent for identical inputs', () => {
    const a = selectArchetypeAndPreset(BASE_INPUT);
    const b = selectArchetypeAndPreset(BASE_INPUT);
    expect(a.archetype.archetypeId).toBe(b.archetype.archetypeId);
    expect(a.preset.presetId).toBe(b.preset.presetId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildArchetypeMetadata
// ══════════════════════════════════════════════════════════════════════════════
describe('buildArchetypeMetadata', () => {
  it('returns without throwing', () => {
    const result = selectArchetypeAndPreset(BASE_INPUT);
    expect(() => buildArchetypeMetadata(result)).not.toThrow();
  });

  it('has all 8 required fields', () => {
    const meta = buildArchetypeMetadata(selectArchetypeAndPreset(BASE_INPUT));
    expect(typeof meta.archetypeId).toBe('string');
    expect(typeof meta.archetypeConfidence).toBe('number');
    expect(typeof meta.archetypeReasoning).toBe('string');
    expect(typeof meta.archetypeFallback).toBe('boolean');
    expect(typeof meta.presetId).toBe('string');
    expect(typeof meta.presetBrandOverride).toBe('boolean');
    expect(typeof meta.presetReasoning).toBe('string');
    expect(typeof meta.intelligenceMs).toBe('number');
  });

  it('archetypeId matches the result archetype', () => {
    const result = selectArchetypeAndPreset(BASE_INPUT);
    const meta   = buildArchetypeMetadata(result);
    expect(meta.archetypeId).toBe(result.archetype.archetypeId);
  });

  it('presetId matches the result preset', () => {
    const result = selectArchetypeAndPreset(BASE_INPUT);
    const meta   = buildArchetypeMetadata(result);
    expect(meta.presetId).toBe(result.preset.presetId);
  });

  it('archetypeConfidence is in [0, 1]', () => {
    const meta = buildArchetypeMetadata(selectArchetypeAndPreset(BASE_INPUT));
    expect(meta.archetypeConfidence).toBeGreaterThanOrEqual(0);
    expect(meta.archetypeConfidence).toBeLessThanOrEqual(1);
  });

  it('intelligenceMs is non-negative', () => {
    const meta = buildArchetypeMetadata(selectArchetypeAndPreset(BASE_INPUT));
    expect(meta.intelligenceMs).toBeGreaterThanOrEqual(0);
  });
});
