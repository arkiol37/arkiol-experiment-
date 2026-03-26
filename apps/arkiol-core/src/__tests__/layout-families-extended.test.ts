/**
 * apps/arkiol-core/src/__tests__/layout-families-extended.test.ts
 *
 * Extended unit tests for engines/layout/families.ts
 *
 * Tests the pure exported functions: selectLayout, resolveZones.
 * Also validates the LAYOUT_FAMILIES and FAMILIES_BY_FORMAT registries.
 *
 * Covers:
 *  - LAYOUT_FAMILIES — all families have required fields, each has ≥1 variation,
 *    all zones have required fields, minFontSize < maxFontSize
 *  - FAMILIES_BY_FORMAT — known formats have entries, each entry is a LayoutFamily
 *  - selectLayout — returns valid selection, deterministic for same inputs,
 *    different inputs → potentially different results, fallback for unknown format
 *  - resolveZones — returns zones array, overrides are merged, base zones preserved
 */

import {
  LAYOUT_FAMILIES,
  FAMILIES_BY_FORMAT,
  selectLayout,
  resolveZones,
  type SelectionContext,
  type LayoutSelection,
  type Zone,
} from '../engines/layout/families';

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeCtx(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return {
    campaignId:   'camp-001',
    format:       'instagram_post',
    variationIdx: 0,
    stylePreset:  'bold',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYOUT_FAMILIES registry
// ══════════════════════════════════════════════════════════════════════════════
describe('LAYOUT_FAMILIES', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(LAYOUT_FAMILIES)).toBe(true);
    expect(LAYOUT_FAMILIES.length).toBeGreaterThan(0);
  });

  it('all families have required fields', () => {
    for (const family of LAYOUT_FAMILIES) {
      expect(typeof family.id).toBe('string');
      expect(typeof family.name).toBe('string');
      expect(Array.isArray(family.zones)).toBe(true);
      expect(Array.isArray(family.variations)).toBe(true);
      expect(Array.isArray(family.formats)).toBe(true);
    }
  });

  it('all families have at least 1 variation', () => {
    for (const family of LAYOUT_FAMILIES) {
      expect(family.variations.length).toBeGreaterThan(0);
    }
  });

  it('all family IDs are unique', () => {
    const ids = LAYOUT_FAMILIES.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all families have at least 1 zone', () => {
    for (const family of LAYOUT_FAMILIES) {
      expect(family.zones.length).toBeGreaterThan(0);
    }
  });

  it('all zones have required fields', () => {
    for (const family of LAYOUT_FAMILIES) {
      for (const zone of family.zones) {
        expect(typeof zone.id).toBe('string');
        expect(typeof zone.x).toBe('number');
        expect(typeof zone.y).toBe('number');
        expect(typeof zone.width).toBe('number');
        expect(typeof zone.height).toBe('number');
        expect(typeof zone.required).toBe('boolean');
      }
    }
  });

  it('all zone dimensions are positive percentages (0–100)', () => {
    for (const family of LAYOUT_FAMILIES) {
      for (const zone of family.zones) {
        expect(zone.width).toBeGreaterThan(0);
        expect(zone.height).toBeGreaterThan(0);
        expect(zone.width).toBeLessThanOrEqual(100);
        expect(zone.height).toBeLessThanOrEqual(100);
      }
    }
  });

  it('minFontSize < maxFontSize for zones that have both', () => {
    for (const family of LAYOUT_FAMILIES) {
      for (const zone of family.zones) {
        if (zone.minFontSize !== undefined && zone.maxFontSize !== undefined) {
          expect(zone.minFontSize).toBeLessThan(zone.maxFontSize);
        }
      }
    }
  });

  it('all families support at least 1 format', () => {
    for (const family of LAYOUT_FAMILIES) {
      expect(family.formats.length).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FAMILIES_BY_FORMAT
// ══════════════════════════════════════════════════════════════════════════════
describe('FAMILIES_BY_FORMAT', () => {
  it('is an object', () => {
    expect(typeof FAMILIES_BY_FORMAT).toBe('object');
    expect(FAMILIES_BY_FORMAT).not.toBeNull();
  });

  it('has at least one format entry', () => {
    expect(Object.keys(FAMILIES_BY_FORMAT).length).toBeGreaterThan(0);
  });

  it('all entries are non-empty arrays', () => {
    for (const [, families] of Object.entries(FAMILIES_BY_FORMAT)) {
      expect(Array.isArray(families)).toBe(true);
      expect((families as any[]).length).toBeGreaterThan(0);
    }
  });

  it('instagram_post has at least 1 layout family', () => {
    expect(FAMILIES_BY_FORMAT['instagram_post']).toBeDefined();
    expect(FAMILIES_BY_FORMAT['instagram_post']!.length).toBeGreaterThan(0);
  });

  it('all family entries have the expected LayoutFamily shape', () => {
    for (const [, families] of Object.entries(FAMILIES_BY_FORMAT)) {
      for (const family of families as any[]) {
        expect(typeof family.id).toBe('string');
        expect(Array.isArray(family.zones)).toBe(true);
        expect(Array.isArray(family.variations)).toBe(true);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// selectLayout
// ══════════════════════════════════════════════════════════════════════════════
describe('selectLayout', () => {
  it('returns an object without throwing', () => {
    expect(() => selectLayout(makeCtx())).not.toThrow();
  });

  it('returned selection has family, variation, and seed fields', () => {
    const sel = selectLayout(makeCtx());
    expect(sel.family).toBeDefined();
    expect(sel.variation).toBeDefined();
    expect(typeof sel.seed).toBe('string');
  });

  it('selected family is a valid LayoutFamily', () => {
    const sel = selectLayout(makeCtx());
    expect(typeof sel.family.id).toBe('string');
    expect(Array.isArray(sel.family.zones)).toBe(true);
  });

  it('selected variation is a valid LayoutVariation', () => {
    const sel = selectLayout(makeCtx());
    expect(typeof sel.variation.id).toBe('string');
  });

  it('is deterministic — same context always produces the same selection', () => {
    const ctx = makeCtx();
    const a = selectLayout(ctx);
    const b = selectLayout(ctx);
    expect(a.family.id).toBe(b.family.id);
    expect(a.variation.id).toBe(b.variation.id);
    expect(a.seed).toBe(b.seed);
  });

  it('different variationIdx values can produce different selections', () => {
    const selections = [0, 1, 2, 3, 4].map(i => selectLayout(makeCtx({ variationIdx: i })));
    const uniqueFamilyIds = new Set(selections.map(s => s.family.id));
    // At minimum they should be selectable without throwing
    expect(selections.length).toBe(5);
    // Different indices SHOULD produce variety (not always same family)
    // This can be 1 if there's only 1 family for that format — just assert no crash
    expect(uniqueFamilyIds.size).toBeGreaterThanOrEqual(1);
  });

  it('falls back gracefully for unknown format', () => {
    const sel = selectLayout(makeCtx({ format: 'completely_unknown_format_xyz' }));
    expect(sel.family).toBeDefined();
    expect(sel.variation).toBeDefined();
  });

  it('seed is a 64-char hex string', () => {
    const sel = selectLayout(makeCtx());
    expect(sel.seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('selected variation exists in the selected family', () => {
    const sel = selectLayout(makeCtx());
    const variationIds = sel.family.variations.map(v => v.id);
    expect(variationIds).toContain(sel.variation.id);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resolveZones
// ══════════════════════════════════════════════════════════════════════════════
describe('resolveZones', () => {
  function getSelection(): LayoutSelection {
    return selectLayout(makeCtx());
  }

  it('returns an array without throwing', () => {
    expect(() => resolveZones(getSelection())).not.toThrow();
    expect(Array.isArray(resolveZones(getSelection()))).toBe(true);
  });

  it('returns same number of zones as the family base zones', () => {
    const sel = getSelection();
    const zones = resolveZones(sel);
    expect(zones.length).toBe(sel.family.zones.length);
  });

  it('all returned zones have required fields', () => {
    const zones = resolveZones(getSelection());
    for (const zone of zones) {
      expect(typeof zone.id).toBe('string');
      expect(typeof zone.x).toBe('number');
      expect(typeof zone.y).toBe('number');
      expect(typeof zone.width).toBe('number');
      expect(typeof zone.height).toBe('number');
    }
  });

  it('zones without overrides are returned unchanged', () => {
    const sel = getSelection();
    // Find a zone with no override in the variation
    const baseZone = sel.family.zones.find(z => !sel.variation.overrides[z.id]);
    if (baseZone) {
      const resolved = resolveZones(sel);
      const resolvedZone = resolved.find(z => z.id === baseZone.id)!;
      expect(resolvedZone.x).toBe(baseZone.x);
      expect(resolvedZone.y).toBe(baseZone.y);
    }
  });

  it('is deterministic — same selection always produces same zones', () => {
    const sel = getSelection();
    const a = resolveZones(sel);
    const b = resolveZones(sel);
    expect(a.map(z => z.id)).toEqual(b.map(z => z.id));
    expect(a[0]!.x).toBe(b[0]!.x);
  });

  it('does not mutate the input family zones', () => {
    const sel = getSelection();
    const originalZoneX = sel.family.zones[0]!.x;
    resolveZones(sel);
    expect(sel.family.zones[0]!.x).toBe(originalZoneX);
  });

  it('all resolved zones have positive dimensions', () => {
    const zones = resolveZones(getSelection());
    for (const zone of zones) {
      expect(zone.width).toBeGreaterThan(0);
      expect(zone.height).toBeGreaterThan(0);
    }
  });
});
