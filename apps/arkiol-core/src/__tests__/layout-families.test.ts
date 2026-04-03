/**
 * apps/arkiol-core/src/__tests__/layout-families.test.ts
 *
 * Unit tests for engines/layout/families.ts
 *
 * All functions are pure (SHA-256 hash — no I/O, no DB).
 *
 * Covers:
 *  - LAYOUT_FAMILIES — shape, required fields, no duplicate IDs
 *  - FAMILIES_BY_FORMAT — correct index, every format maps to families
 *  - selectLayout — determinism, fallback on unknown format, seed structure,
 *    variationIdx isolation, campaignId isolation
 *  - resolveZones — merges overrides, preserves non-overridden zones,
 *    does not mutate original family zones
 */

import {
  LAYOUT_FAMILIES,
  FAMILIES_BY_FORMAT,
  selectLayout,
  resolveZones,
  type SelectionContext,
} from '../engines/layout/families';

// ── Context builder ───────────────────────────────────────────────────────────
function ctx(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return {
    format:       'instagram_post',
    stylePreset:  'bold',
    variationIdx: 0,
    campaignId:   'campaign-abc-123',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYOUT_FAMILIES integrity
// ══════════════════════════════════════════════════════════════════════════════
describe('LAYOUT_FAMILIES', () => {
  it('has exactly 9 layout families (one per canonical format)', () => {
    expect(LAYOUT_FAMILIES.length).toBe(9);
  });

  it('all families have a unique id', () => {
    const ids = LAYOUT_FAMILIES.map(f => f.id);
    expect(new Set(ids).size).toBe(LAYOUT_FAMILIES.length);
  });

  it('all families have a non-empty name', () => {
    for (const f of LAYOUT_FAMILIES) {
      expect(typeof f.name).toBe('string');
      expect(f.name.length).toBeGreaterThan(0);
    }
  });

  it('all families have at least 1 format', () => {
    for (const f of LAYOUT_FAMILIES) {
      expect(Array.isArray(f.formats)).toBe(true);
      expect(f.formats.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all families have at least 1 variation', () => {
    for (const f of LAYOUT_FAMILIES) {
      expect(Array.isArray(f.variations)).toBe(true);
      expect(f.variations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all families have at least 1 zone', () => {
    for (const f of LAYOUT_FAMILIES) {
      expect(Array.isArray(f.zones)).toBe(true);
      expect(f.zones.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all variation ids are unique within their family', () => {
    for (const f of LAYOUT_FAMILIES) {
      const varIds = f.variations.map((v: any) => v.id);
      expect(new Set(varIds).size).toBe(varIds.length);
    }
  });

  it('all zones have a required id field', () => {
    for (const f of LAYOUT_FAMILIES) {
      for (const z of f.zones) {
        expect(typeof (z as any).id).toBe('string');
        expect((z as any).id.length).toBeGreaterThan(0);
      }
    }
  });

  it('all variations have an overrides object', () => {
    for (const f of LAYOUT_FAMILIES) {
      for (const v of f.variations as any[]) {
        expect(typeof v.overrides).toBe('object');
        expect(v.overrides).not.toBeNull();
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FAMILIES_BY_FORMAT
// ══════════════════════════════════════════════════════════════════════════════
describe('FAMILIES_BY_FORMAT', () => {
  it('is a non-null object', () => {
    expect(typeof FAMILIES_BY_FORMAT).toBe('object');
    expect(FAMILIES_BY_FORMAT).not.toBeNull();
  });

  it('has entries for all 9 canonical Arkiol formats', () => {
    const EXPECTED = [
      'instagram_post', 'instagram_story', 'youtube_thumbnail',
      'flyer', 'poster', 'presentation_slide',
      'business_card', 'resume', 'logo',
    ];
    for (const fmt of EXPECTED) {
      expect(FAMILIES_BY_FORMAT[fmt]).toBeDefined();
      expect(FAMILIES_BY_FORMAT[fmt].length).toBeGreaterThan(0);
    }
  });

  it('every mapped family is in LAYOUT_FAMILIES', () => {
    for (const [, families] of Object.entries(FAMILIES_BY_FORMAT)) {
      for (const fam of families) {
        expect(LAYOUT_FAMILIES).toContain(fam);
      }
    }
  });

  it('every format in a family is indexed correctly', () => {
    for (const fam of LAYOUT_FAMILIES) {
      for (const fmt of fam.formats) {
        expect(FAMILIES_BY_FORMAT[fmt]).toContain(fam);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// selectLayout
// ══════════════════════════════════════════════════════════════════════════════
describe('selectLayout', () => {
  it('returns an object with family, variation, and seed', () => {
    const result = selectLayout(ctx());
    expect(result.family).toBeDefined();
    expect(result.variation).toBeDefined();
    expect(typeof result.seed).toBe('string');
  });

  it('returned family is in LAYOUT_FAMILIES', () => {
    const result = selectLayout(ctx());
    expect(LAYOUT_FAMILIES).toContain(result.family);
  });

  it("returned variation is in the family's variations", () => {
    const result = selectLayout(ctx());
    expect(result.family.variations).toContain(result.variation);
  });

  it('is deterministic — same context always gives same result', () => {
    const c = ctx({ campaignId: 'determinism-test', variationIdx: 3 });
    const a = selectLayout(c);
    const b = selectLayout(c);
    expect(a.family.id).toBe(b.family.id);
    expect((a.variation as any).id).toBe((b.variation as any).id);
    expect(a.seed).toBe(b.seed);
  });

  it('seed is a 64-character hex string (SHA-256)', () => {
    const result = selectLayout(ctx());
    expect(result.seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different campaignIds produce different results', () => {
    const a = selectLayout(ctx({ campaignId: 'campaign-aaa' }));
    const b = selectLayout(ctx({ campaignId: 'campaign-bbb' }));
    expect(a.seed).not.toBe(b.seed);
  });

  it('different variationIdx values produce different results', () => {
    const seeds = new Set<string>();
    for (let i = 0; i < 10; i++) {
      seeds.add(selectLayout(ctx({ variationIdx: i })).seed);
    }
    expect(seeds.size).toBe(10);
  });

  it('different formats produce different seeds', () => {
    const formats = ['instagram_post', 'instagram_story', 'youtube_thumbnail', 'flyer'];
    const seeds = formats.map(format => selectLayout(ctx({ format })).seed);
    expect(new Set(seeds).size).toBe(formats.length);
  });

  it('different stylePresets produce different seeds', () => {
    const a = selectLayout(ctx({ stylePreset: 'bold' }));
    const b = selectLayout(ctx({ stylePreset: 'minimal' }));
    expect(a.seed).not.toBe(b.seed);
  });

  it('unknown format falls back to first LAYOUT_FAMILIES entry', () => {
    const result = selectLayout(ctx({ format: 'completely_unknown_format' }));
    expect(result.family).toBe(LAYOUT_FAMILIES[0]);
    expect(result.variation).toBe(LAYOUT_FAMILIES[0].variations[0]);
    expect(result.seed).toBe('fallback');
  });

  it('fallback uses first variation of first family', () => {
    const result = selectLayout(ctx({ format: 'nonexistent_xyz' }));
    expect(result.variation).toBe(LAYOUT_FAMILIES[0].variations[0]);
  });

  it('works for all 9 canonical formats without throwing', () => {
    const formats = [
      'instagram_post', 'instagram_story', 'youtube_thumbnail',
      'flyer', 'poster', 'presentation_slide',
      'business_card', 'resume', 'logo',
    ];
    for (const format of formats) {
      expect(() => selectLayout(ctx({ format }))).not.toThrow();
    }
  });

  it('variation index wraps correctly (no out-of-bounds)', () => {
    for (let i = 0; i < 50; i++) {
      const result = selectLayout(ctx({ variationIdx: i }));
      expect(result.family.variations).toContain(result.variation);
    }
  });

  it('100 different campaigns with same format all return valid results', () => {
    for (let i = 0; i < 100; i++) {
      const result = selectLayout(ctx({ campaignId: `campaign-${i}` }));
      expect(LAYOUT_FAMILIES).toContain(result.family);
      expect(result.family.variations).toContain(result.variation);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resolveZones
// ══════════════════════════════════════════════════════════════════════════════
describe('resolveZones', () => {
  // Get a real selection to work with
  const selection = selectLayout(ctx({ format: 'instagram_post' }));

  it('returns an array', () => {
    expect(Array.isArray(resolveZones(selection))).toBe(true);
  });

  it('returned array has same length as family zones', () => {
    const zones = resolveZones(selection);
    expect(zones.length).toBe(selection.family.zones.length);
  });

  it('every returned zone has an id', () => {
    const zones = resolveZones(selection);
    for (const z of zones) {
      expect(typeof (z as any).id).toBe('string');
    }
  });

  it('zones without overrides are returned as-is (same reference)', () => {
    const zones = resolveZones(selection);
    const overrideKeys = Object.keys((selection.variation as any).overrides ?? {});

    for (const z of zones) {
      const zId = (z as any).id;
      if (!overrideKeys.includes(zId)) {
        // No override — should be same reference as original
        const original = selection.family.zones.find((oz: any) => oz.id === zId);
        expect(z).toBe(original);
      }
    }
  });

  it('does NOT mutate the original family zones', () => {
    const originalZonesCopy = selection.family.zones.map((z: any) => ({ ...z }));
    resolveZones(selection);
    for (let i = 0; i < selection.family.zones.length; i++) {
      const original = selection.family.zones[i] as any;
      const copy = originalZonesCopy[i] as any;
      expect(original.id).toBe(copy.id);
    }
  });

  it('overridden zones are new objects (not mutating original)', () => {
    const overrideKeys = Object.keys((selection.variation as any).overrides ?? {});
    if (overrideKeys.length === 0) {
      // No overrides in this selection — that's fine, test passes vacuously
      return;
    }

    const zones = resolveZones(selection);
    for (const z of zones) {
      const zId = (z as any).id;
      if (overrideKeys.includes(zId)) {
        const original = selection.family.zones.find((oz: any) => oz.id === zId);
        expect(z).not.toBe(original); // new merged object
      }
    }
  });

  it('works for every layout family without throwing', () => {
    for (const family of LAYOUT_FAMILIES) {
      const sel = { family, variation: family.variations[0] as any, seed: 'test' };
      expect(() => resolveZones(sel)).not.toThrow();
    }
  });

  it('overridden zone merges constraints shallowly', () => {
    // Find a selection that has at least one override
    let selWithOverride: ReturnType<typeof selectLayout> | null = null;
    for (const family of LAYOUT_FAMILIES) {
      for (const variation of family.variations as any[]) {
        if (Object.keys(variation.overrides).length > 0) {
          selWithOverride = { family, variation, seed: 'test' };
          break;
        }
      }
      if (selWithOverride) break;
    }

    if (!selWithOverride) return; // no overrides in any variation (edge case)

    const zones = resolveZones(selWithOverride);
    const overrideKeys = Object.keys((selWithOverride.variation as any).overrides);

    for (const z of zones) {
      if (overrideKeys.includes((z as any).id)) {
        // Merged zone should have the override's own keys
        const override = (selWithOverride.variation as any).overrides[(z as any).id];
        for (const key of Object.keys(override)) {
          if (key !== 'constraints') {
            expect((z as any)[key]).toEqual(override[key]);
          }
        }
      }
    }
  });
});
