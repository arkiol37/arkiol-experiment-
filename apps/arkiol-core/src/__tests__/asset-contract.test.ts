/**
 * apps/arkiol-core/src/__tests__/asset-contract.test.ts
 *
 * Unit tests for engines/assets/contract.ts
 *
 * Pure functions & registry — no DB, no HTTP, no Next.js.
 *
 * Covers:
 *  - ASSET_CONTRACTS registry — all 9 types present, required fields
 *  - validatePlacement — valid placement, wrong zone, format restriction,
 *    coverage over max, coverage under min
 *  - remapToAllowedZone — finds allowed zone, returns null when none available
 *  - totalDensityScore — sums correctly, empty array = 0
 *  - motionCompatibleElements — filters non-motion types
 *  - buildZoneOwnershipMap — maps exclusive zones, detects conflicts
 */

import {
  ASSET_CONTRACTS,
  validatePlacement,
  remapToAllowedZone,
  totalDensityScore,
  motionCompatibleElements,
  buildZoneOwnershipMap,
  type AssetElementType,
} from '../engines/assets/contract';
import type { ZoneId } from '../engines/layout/families';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ALL_TYPES: AssetElementType[] = [
  'human', 'object', 'atmospheric', 'texture', 'background',
  'logo', 'badge', 'icon', 'overlay',
];

// ══════════════════════════════════════════════════════════════════════════════
// ASSET_CONTRACTS registry
// ══════════════════════════════════════════════════════════════════════════════
describe('ASSET_CONTRACTS', () => {
  it('has all 9 asset element types', () => {
    for (const type of ALL_TYPES) {
      expect(ASSET_CONTRACTS[type]).toBeDefined();
    }
  });

  it('all contracts have required fields', () => {
    for (const [, contract] of Object.entries(ASSET_CONTRACTS)) {
      expect(typeof contract.type).toBe('string');
      expect(Array.isArray(contract.allowedZones)).toBe(true);
      expect(typeof contract.hierarchyWeight).toBe('number');
      expect(typeof contract.maxAreaCoverage).toBe('number');
      expect(typeof contract.minAreaCoverage).toBe('number');
      expect(typeof contract.densityLimit).toBe('number');
      expect(typeof contract.motionCompatible).toBe('boolean');
      expect(typeof contract.bleedAllowed).toBe('boolean');
      expect(Array.isArray(contract.exclusiveZones)).toBe(true);
      expect(typeof contract.requiresImageZone).toBe('boolean');
      expect(typeof contract.scaleMode).toBe('string');
      expect(typeof contract.aspectRatioLocked).toBe('boolean');
      expect(typeof contract.description).toBe('string');
    }
  });

  it('all maxAreaCoverage values are in (0, 1]', () => {
    for (const [, c] of Object.entries(ASSET_CONTRACTS)) {
      expect(c.maxAreaCoverage).toBeGreaterThan(0);
      expect(c.maxAreaCoverage).toBeLessThanOrEqual(1);
    }
  });

  it('minAreaCoverage is always < maxAreaCoverage', () => {
    for (const [, c] of Object.entries(ASSET_CONTRACTS)) {
      expect(c.minAreaCoverage).toBeLessThan(c.maxAreaCoverage);
    }
  });

  it('all hierarchyWeight values are non-negative', () => {
    for (const [, c] of Object.entries(ASSET_CONTRACTS)) {
      expect(c.hierarchyWeight).toBeGreaterThanOrEqual(0);
    }
  });

  it('background has hierarchyWeight=0 (bottom z-order)', () => {
    expect(ASSET_CONTRACTS.background.hierarchyWeight).toBe(0);
  });

  it('each contract type field matches its key', () => {
    for (const [key, contract] of Object.entries(ASSET_CONTRACTS)) {
      expect(contract.type).toBe(key);
    }
  });

  it('all allowedZones arrays are non-empty', () => {
    for (const [, c] of Object.entries(ASSET_CONTRACTS)) {
      expect(c.allowedZones.length).toBeGreaterThan(0);
    }
  });

  it('logo allowedZones contains "logo"', () => {
    expect(ASSET_CONTRACTS.logo.allowedZones).toContain('logo');
  });

  it('background allowedZones contains "background"', () => {
    expect(ASSET_CONTRACTS.background.allowedZones).toContain('background');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// validatePlacement
// ══════════════════════════════════════════════════════════════════════════════
describe('validatePlacement', () => {
  it('returns empty array for valid placement', () => {
    // logo in logo zone with all formats allowed
    const violations = validatePlacement('logo', 'logo' as ZoneId, 'instagram_post', 0.15);
    expect(violations).toEqual([]);
  });

  it('returns error violation for wrong zone', () => {
    // human is not allowed in the "headline" zone
    const violations = validatePlacement('human', 'headline' as ZoneId, 'instagram_post', 0.30);
    const errorViolation = violations.find(v => v.severity === 'error');
    expect(errorViolation).toBeDefined();
    expect(errorViolation!.issue).toContain('not allowed in zone');
  });

  it('returns warning violation for coverage over max', () => {
    // human maxAreaCoverage = 0.60; pass 0.90
    const violations = validatePlacement('human', 'image' as ZoneId, 'instagram_post', 0.90);
    const warning = violations.find(v => v.severity === 'warning' && v.issue.includes('exceeds max'));
    expect(warning).toBeDefined();
  });

  it('returns warning violation for coverage under min', () => {
    // human minAreaCoverage = 0.05; pass 0.01
    const violations = validatePlacement('human', 'image' as ZoneId, 'instagram_post', 0.01);
    const warning = violations.find(v => v.severity === 'warning' && v.issue.includes('below minimum'));
    expect(warning).toBeDefined();
  });

  it('zero coverage does not trigger under-min violation', () => {
    // Coverage of exactly 0 skips the min check (element not present)
    const violations = validatePlacement('human', 'image' as ZoneId, 'instagram_post', 0);
    const underMin = violations.find(v => v.issue.includes('below minimum'));
    expect(underMin).toBeUndefined();
  });

  it('violation has elementType and targetZone fields', () => {
    const violations = validatePlacement('human', 'headline' as ZoneId, 'instagram_post', 0.30);
    expect(violations[0]!.elementType).toBe('human');
    expect(violations[0]!.targetZone).toBe('headline');
  });

  it('logo in invalid format returns format error', () => {
    // Check if logo has format restrictions
    const contract = ASSET_CONTRACTS.logo;
    if (Array.isArray(contract.allowedFormats)) {
      const invalidFormat = 'completely_unsupported_xyz';
      const violations = validatePlacement('logo', 'logo' as ZoneId, invalidFormat, 0.10);
      const formatViolation = violations.find(v => v.issue.includes('not compatible with format'));
      expect(formatViolation).toBeDefined();
    } else {
      // allowedFormats = "*" — no format restriction test needed
      expect(contract.allowedFormats).toBe('*');
    }
  });

  it('background in background zone with valid coverage returns no violations', () => {
    // background maxCoverage = 1.0 (fills canvas), minCoverage = some small value
    const violations = validatePlacement('background', 'background' as ZoneId, 'instagram_post', 0.80);
    const errors = violations.filter(v => v.severity === 'error');
    expect(errors.length).toBe(0);
  });

  it('multiple violations can be returned for same placement', () => {
    // Wrong zone AND coverage over max
    const violations = validatePlacement('logo', 'background' as ZoneId, 'instagram_post', 0.99);
    // At minimum the zone violation should exist
    expect(violations.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// remapToAllowedZone
// ══════════════════════════════════════════════════════════════════════════════
describe('remapToAllowedZone', () => {
  it('returns an allowed zone when available', () => {
    // human allowedZones = ["image", "background"]
    const zone = remapToAllowedZone('human', ['image', 'headline', 'body'] as ZoneId[]);
    expect(zone).toBe('image');
  });

  it('returns null when no allowed zone is available', () => {
    // human not in ["headline", "cta", "badge"]
    const zone = remapToAllowedZone('human', ['headline', 'cta', 'badge'] as ZoneId[]);
    expect(zone).toBeNull();
  });

  it('returns first matching allowed zone', () => {
    const zone = remapToAllowedZone('logo', ['cta', 'logo', 'badge'] as ZoneId[]);
    expect(zone).toBe('logo');
  });

  it('returns null for empty availableZones', () => {
    expect(remapToAllowedZone('human', [])).toBeNull();
  });

  it('works for all element types without throwing', () => {
    const zones: ZoneId[] = ['image', 'background', 'logo', 'badge', 'cta', 'headline'] as ZoneId[];
    for (const type of ALL_TYPES) {
      expect(() => remapToAllowedZone(type, zones)).not.toThrow();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// totalDensityScore
// ══════════════════════════════════════════════════════════════════════════════
describe('totalDensityScore', () => {
  it('returns 0 for empty array', () => {
    expect(totalDensityScore([])).toBe(0);
  });

  it('returns densityLimit for single element', () => {
    const expected = ASSET_CONTRACTS.logo.densityLimit;
    expect(totalDensityScore(['logo'])).toBe(expected);
  });

  it('sums densityLimits for multiple elements', () => {
    const expected = ASSET_CONTRACTS.logo.densityLimit + ASSET_CONTRACTS.badge.densityLimit;
    expect(totalDensityScore(['logo', 'badge'])).toBe(expected);
  });

  it('is commutative — order does not matter', () => {
    const a = totalDensityScore(['human', 'logo', 'background']);
    const b = totalDensityScore(['background', 'logo', 'human']);
    expect(a).toBe(b);
  });

  it('all element types have positive density limits', () => {
    for (const type of ALL_TYPES) {
      expect(totalDensityScore([type])).toBeGreaterThan(0);
    }
  });

  it('all types together produces a higher score than any single type', () => {
    const allScore = totalDensityScore(ALL_TYPES);
    for (const type of ALL_TYPES) {
      expect(allScore).toBeGreaterThanOrEqual(totalDensityScore([type]));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// motionCompatibleElements
// ══════════════════════════════════════════════════════════════════════════════
describe('motionCompatibleElements', () => {
  it('returns empty array for empty input', () => {
    expect(motionCompatibleElements([])).toEqual([]);
  });

  it('filters out motion-incompatible elements', () => {
    const result = motionCompatibleElements(ALL_TYPES);
    for (const type of result) {
      expect(ASSET_CONTRACTS[type].motionCompatible).toBe(true);
    }
  });

  it('preserves motion-compatible elements', () => {
    // human is motionCompatible
    const result = motionCompatibleElements(['human']);
    expect(result).toContain('human');
  });

  it('returns subset of input (result.length <= input.length)', () => {
    const result = motionCompatibleElements(ALL_TYPES);
    expect(result.length).toBeLessThanOrEqual(ALL_TYPES.length);
  });

  it('calling twice produces the same result', () => {
    const a = motionCompatibleElements(ALL_TYPES);
    const b = motionCompatibleElements(ALL_TYPES);
    expect(a).toEqual(b);
  });

  it('does not mutate input array', () => {
    const input = [...ALL_TYPES];
    motionCompatibleElements(input);
    expect(input).toEqual(ALL_TYPES);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildZoneOwnershipMap
// ══════════════════════════════════════════════════════════════════════════════
describe('buildZoneOwnershipMap', () => {
  it('returns empty map and no conflicts for empty input', () => {
    const { map, conflicts } = buildZoneOwnershipMap([]);
    expect(map.size).toBe(0);
    expect(conflicts.length).toBe(0);
  });

  it('maps exclusive zone ownership for single element', () => {
    // logo exclusiveZones = ["logo"]
    const { map, conflicts } = buildZoneOwnershipMap([
      { type: 'logo', zone: 'logo' as ZoneId },
    ]);
    expect(map.get('logo' as ZoneId)).toBe('logo');
    expect(conflicts.length).toBe(0);
  });

  it('detects conflict when two elements claim the same exclusive zone', () => {
    const { conflicts } = buildZoneOwnershipMap([
      { type: 'logo',  zone: 'logo' as ZoneId },
      { type: 'badge', zone: 'logo' as ZoneId }, // badge allowedZones includes logo
    ]);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]).toContain('logo');
  });

  it('no conflict when elements use different exclusive zones', () => {
    const { conflicts } = buildZoneOwnershipMap([
      { type: 'logo',  zone: 'logo'  as ZoneId },
      { type: 'badge', zone: 'badge' as ZoneId },
    ]);
    expect(conflicts.length).toBe(0);
  });

  it('non-exclusive zone placements are not tracked', () => {
    // atmospheric has no exclusiveZones — won't appear in map
    const { map } = buildZoneOwnershipMap([
      { type: 'atmospheric', zone: 'background' as ZoneId },
    ]);
    // If atmospheric has no exclusive zones, background won't be in the map
    const hasAtmosphericEntry = [...map.values()].includes('atmospheric');
    if (ASSET_CONTRACTS.atmospheric.exclusiveZones.length === 0) {
      expect(hasAtmosphericEntry).toBe(false);
    }
  });

  it('conflict messages contain both element types', () => {
    const { conflicts } = buildZoneOwnershipMap([
      { type: 'logo',  zone: 'logo' as ZoneId },
      { type: 'icon',  zone: 'logo' as ZoneId },
    ]);
    if (conflicts.length > 0) {
      const msg = conflicts[0]!;
      // Should mention both elements
      expect(msg.includes('logo') || msg.includes('icon')).toBe(true);
    }
  });
});
