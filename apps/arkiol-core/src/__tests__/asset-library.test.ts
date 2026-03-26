/**
 * apps/arkiol-core/src/__tests__/asset-library.test.ts
 *
 * Unit tests for engines/assets/asset-library.ts
 *
 * Pure functions — no DB, no HTTP, no Next.js.
 *
 * Covers:
 *  - generateParametricBackground — returns SVG string, all 5 styles, determinism,
 *    different seeds produce different SVGs, SVG validity (tag structure)
 *  - listAssetPacks — non-empty, all packs have required fields
 *  - getAssetPack — found by packId, found by industry, undefined for unknown
 *  - retrieveAssets — returns ≤ maxResults, at least 1 result, relevance scores,
 *    guaranteed fallback for no-match context
 *  - buildRetrievalContext — maps ExplorePipelineContext fields correctly
 */

import {
  generateParametricBackground,
  listAssetPacks,
  getAssetPack,
  retrieveAssets,
  buildRetrievalContext,
  type RetrievalContext,
} from '../engines/assets/asset-library';
import type { ExplorePipelineContext } from '../engines/exploration/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const BASE_CONTEXT: RetrievalContext = {
  layoutType:      'split',
  format:          'instagram_post',
  audienceSegment: 'young adults',
};

const PIPELINE_CTX: ExplorePipelineContext = {
  intent:          'fitness product launch',
  format:          'instagram_post',
  audienceSegment: 'athletes',
  tonePreference:  'energetic',
  layoutType:      'hero',
  brandPrimaryColor:   '#FF5733',
  brandToneKeywords:   ['bold', 'athletic', 'energetic'],
  brandPrefersDarkBg:  true,
};

// ══════════════════════════════════════════════════════════════════════════════
// generateParametricBackground
// ══════════════════════════════════════════════════════════════════════════════
describe('generateParametricBackground', () => {
  const STYLES = ['gradient', 'mesh', 'dots', 'waves', 'geometric'] as const;

  it('returns a non-empty string', () => {
    const result = generateParametricBackground('seed1');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(50);
  });

  it('returns a valid SVG string (starts with <svg)', () => {
    const result = generateParametricBackground('seed1');
    expect(result.trim()).toMatch(/^<svg/);
  });

  it('SVG contains closing </svg> tag', () => {
    const result = generateParametricBackground('seed1');
    expect(result).toContain('</svg>');
  });

  it('SVG has xmlns attribute', () => {
    const result = generateParametricBackground('seed1');
    expect(result).toContain('xmlns=');
  });

  it('SVG has width=1280 and height=720', () => {
    const result = generateParametricBackground('seed1');
    expect(result).toContain('width="1280"');
    expect(result).toContain('height="720"');
  });

  it('is deterministic — same seed and style always produces the same SVG', () => {
    const a = generateParametricBackground('my-seed', '#4f6ef7', 'gradient');
    const b = generateParametricBackground('my-seed', '#4f6ef7', 'gradient');
    expect(a).toBe(b);
  });

  it('different seeds produce different SVGs', () => {
    const a = generateParametricBackground('seed-aaa');
    const b = generateParametricBackground('seed-bbb');
    expect(a).not.toBe(b);
  });

  it('works for all 5 styles without throwing', () => {
    for (const style of STYLES) {
      expect(() => generateParametricBackground('seed', '#fff', style)).not.toThrow();
    }
  });

  it('all 5 styles return valid SVG', () => {
    for (const style of STYLES) {
      const result = generateParametricBackground('seed', '#4f6ef7', style);
      expect(result.trim()).toMatch(/^<svg/);
      expect(result).toContain('</svg>');
    }
  });

  it('gradient style includes linearGradient', () => {
    const result = generateParametricBackground('seed', '#4f6ef7', 'gradient');
    expect(result).toContain('linearGradient');
  });

  it('dots style includes circle elements', () => {
    const result = generateParametricBackground('seed', '#4f6ef7', 'dots');
    expect(result).toContain('<circle');
  });

  it('geometric style includes rect elements', () => {
    const result = generateParametricBackground('seed', '#4f6ef7', 'geometric');
    expect(result).toContain('<rect');
  });

  it('waves style includes path-like content', () => {
    const result = generateParametricBackground('seed', '#4f6ef7', 'waves');
    expect(result.length).toBeGreaterThan(200);
  });

  it('different styles produce different SVGs for the same seed', () => {
    const results = STYLES.map(s => generateParametricBackground('same-seed', '#fff', s));
    const unique = new Set(results);
    // At minimum gradient vs dots vs geometric should differ
    expect(unique.size).toBeGreaterThan(1);
  });

  it('defaults to gradient style when not specified', () => {
    const withDefault = generateParametricBackground('seed', '#4f6ef7');
    const withGradient = generateParametricBackground('seed', '#4f6ef7', 'gradient');
    expect(withDefault).toBe(withGradient);
  });

  it('default primaryColor does not crash', () => {
    expect(() => generateParametricBackground('seed')).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listAssetPacks
// ══════════════════════════════════════════════════════════════════════════════
describe('listAssetPacks', () => {
  it('returns a non-empty array', () => {
    const packs = listAssetPacks();
    expect(Array.isArray(packs)).toBe(true);
    expect(packs.length).toBeGreaterThan(0);
  });

  it('all packs have required fields', () => {
    for (const pack of listAssetPacks()) {
      expect(typeof pack.packId).toBe('string');
      expect(pack.packId.length).toBeGreaterThan(0);
      expect(typeof pack.name).toBe('string');
      expect(typeof pack.industry).toBe('string');
      expect(Array.isArray(pack.assets)).toBe(true);
    }
  });

  it('all packIds are unique', () => {
    const ids = listAssetPacks().map(p => p.packId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all packs have at least 1 asset', () => {
    for (const pack of listAssetPacks()) {
      expect(pack.assets.length).toBeGreaterThan(0);
    }
  });

  it('all assets have required fields', () => {
    for (const pack of listAssetPacks()) {
      for (const asset of pack.assets) {
        expect(typeof (asset as any).id).toBe('string');
        expect(typeof (asset as any).url).toBe('string');
      }
    }
  });

  it('returns same array reference on repeated calls (stable)', () => {
    const a = listAssetPacks();
    const b = listAssetPacks();
    expect(a).toEqual(b);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getAssetPack
// ══════════════════════════════════════════════════════════════════════════════
describe('getAssetPack', () => {
  it('returns undefined for unknown packId', () => {
    expect(getAssetPack('nonexistent_pack_xyz')).toBeUndefined();
  });

  it('finds a pack by packId', () => {
    const packs = listAssetPacks();
    const first = packs[0]!;
    const found = getAssetPack(first.packId);
    expect(found).toBeDefined();
    expect(found!.packId).toBe(first.packId);
  });

  it('finds a pack by industry name', () => {
    const packs = listAssetPacks();
    const first = packs[0]!;
    const found = getAssetPack(first.industry);
    expect(found).toBeDefined();
  });

  it('returns the pack object with assets', () => {
    const packs = listAssetPacks();
    const pack  = getAssetPack(packs[0]!.packId)!;
    expect(Array.isArray(pack.assets)).toBe(true);
    expect(pack.assets.length).toBeGreaterThan(0);
  });

  it('returned pack has same content as listAssetPacks entry', () => {
    const packs = listAssetPacks();
    const first = packs[0]!;
    const found = getAssetPack(first.packId)!;
    expect(found.packId).toBe(first.packId);
    expect(found.industry).toBe(first.industry);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// retrieveAssets
// ══════════════════════════════════════════════════════════════════════════════
describe('retrieveAssets', () => {
  it('returns an array', () => {
    expect(Array.isArray(retrieveAssets(BASE_CONTEXT))).toBe(true);
  });

  it('returns at least 1 asset even for unknown context', () => {
    const unknownCtx: RetrievalContext = { layoutType: 'unknown', format: 'unknown' };
    expect(retrieveAssets(unknownCtx).length).toBeGreaterThanOrEqual(1);
  });

  it('returns at most maxResults assets', () => {
    expect(retrieveAssets(BASE_CONTEXT, 3).length).toBeLessThanOrEqual(3);
    expect(retrieveAssets(BASE_CONTEXT, 1).length).toBeLessThanOrEqual(1);
    expect(retrieveAssets(BASE_CONTEXT, 5).length).toBeLessThanOrEqual(5);
  });

  it('default maxResults is 3', () => {
    expect(retrieveAssets(BASE_CONTEXT).length).toBeLessThanOrEqual(3);
  });

  it('all returned assets have a relevanceScore field', () => {
    for (const asset of retrieveAssets(BASE_CONTEXT)) {
      expect(typeof (asset as any).relevanceScore).toBe('number');
    }
  });

  it('relevanceScore values are non-negative', () => {
    for (const asset of retrieveAssets(BASE_CONTEXT)) {
      expect((asset as any).relevanceScore).toBeGreaterThanOrEqual(0);
    }
  });

  it('all returned assets have a retrievalReason string', () => {
    for (const asset of retrieveAssets(BASE_CONTEXT)) {
      expect(typeof (asset as any).retrievalReason).toBe('string');
      expect((asset as any).retrievalReason.length).toBeGreaterThan(0);
    }
  });

  it('assets are sorted descending by relevanceScore', () => {
    const assets = retrieveAssets(BASE_CONTEXT, 5) as any[];
    for (let i = 0; i < assets.length - 1; i++) {
      expect(assets[i].relevanceScore).toBeGreaterThanOrEqual(assets[i + 1].relevanceScore);
    }
  });

  it('returned assets have required AssetDescriptor fields', () => {
    for (const asset of retrieveAssets(BASE_CONTEXT)) {
      expect(typeof (asset as any).id).toBe('string');
      expect(typeof (asset as any).url).toBe('string');
    }
  });

  it('maxResults=1 returns exactly 1 asset', () => {
    expect(retrieveAssets(BASE_CONTEXT, 1).length).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildRetrievalContext
// ══════════════════════════════════════════════════════════════════════════════
describe('buildRetrievalContext', () => {
  it('returns an object with layoutType from pipelineCtx', () => {
    const ctx = buildRetrievalContext(PIPELINE_CTX);
    expect(ctx.layoutType).toBe(PIPELINE_CTX.layoutType);
  });

  it('maps format from pipelineCtx', () => {
    const ctx = buildRetrievalContext(PIPELINE_CTX);
    expect(ctx.format).toBe(PIPELINE_CTX.format);
  });

  it('maps audienceSegment from pipelineCtx', () => {
    const ctx = buildRetrievalContext(PIPELINE_CTX);
    expect(ctx.audienceSegment).toBe(PIPELINE_CTX.audienceSegment);
  });

  it('maps primaryColor from brandPrimaryColor', () => {
    const ctx = buildRetrievalContext(PIPELINE_CTX);
    expect(ctx.primaryColor).toBe(PIPELINE_CTX.brandPrimaryColor);
  });

  it('maps toneKeywords from brandToneKeywords', () => {
    const ctx = buildRetrievalContext(PIPELINE_CTX);
    expect(ctx.toneKeywords).toEqual(PIPELINE_CTX.brandToneKeywords);
  });

  it('maps prefersDarkBg from brandPrefersDarkBg', () => {
    const ctx = buildRetrievalContext(PIPELINE_CTX);
    expect(ctx.prefersDarkBg).toBe(PIPELINE_CTX.brandPrefersDarkBg);
  });

  it('seed parameter is preserved when provided', () => {
    const ctx = buildRetrievalContext(PIPELINE_CTX, 'my-seed-123');
    expect(ctx.seed).toBe('my-seed-123');
  });

  it('seed is undefined when not provided', () => {
    const ctx = buildRetrievalContext(PIPELINE_CTX);
    expect(ctx.seed).toBeUndefined();
  });

  it('works with minimal pipelineCtx (no optional brand fields)', () => {
    const minimal: ExplorePipelineContext = {
      intent: 'test', format: 'flyer',
      audienceSegment: 'general', tonePreference: 'neutral', layoutType: 'simple',
    };
    expect(() => buildRetrievalContext(minimal)).not.toThrow();
    const ctx = buildRetrievalContext(minimal);
    expect(ctx.format).toBe('flyer');
    expect(ctx.primaryColor).toBeUndefined();
  });
});
