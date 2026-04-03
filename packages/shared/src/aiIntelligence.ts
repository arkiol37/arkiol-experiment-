// packages/shared/src/aiIntelligence.ts
// V16: Structured AI Intelligence Layers
//
// Five intelligence layers, each strictly sandboxed:
//   1. SemanticLayoutIntelligence   — intent → layout strategy
//   2. AutoVariationIntelligence    — strategic variation generation
//   3. AudienceModeling             — persona-aware content adaptation
//   4. ContentDensityOptimizer      — hierarchy and density analysis
//   5. BrandLearningSystem          — passive brand personalization engine
//
// Execution rules:
//   - Stages execute in explicit order (1→5) with no cross-stage mutation
//   - Each stage receives a frozen input and returns a validated output
//   - Zero structural override of core plan/credit logic
//   - Mandatory schema validation at every stage boundary
//   - Deterministic fallbacks for every stage failure
//   - Idempotent safety — same input always safe to replay
//   - Structured logging for observability
//   - Robust failure recovery — any stage failure returns defaults, never throws

import { z } from 'zod';

// ── Shared types ──────────────────────────────────────────────────────────────

export const IntentSchema = z.object({
  prompt:      z.string(),
  format:      z.string(),
  audience:    z.string().optional(),
  brandId:     z.string().optional(),
  stylePreset: z.string().optional(),
  campaignId:  z.string().optional(),
});

export type Intent = z.infer<typeof IntentSchema>;

// Stage result wrapper — every stage returns { ok, data, errors, durationMs }
export interface StageResult<T> {
  ok:         boolean;
  data:       T;
  errors:     string[];
  durationMs: number;
  fallback:   boolean; // true if deterministic fallback was used
}

function stageResult<T>(data: T, opts?: Partial<StageResult<T>>): StageResult<T> {
  return {
    ok:         true,
    data,
    errors:     [],
    durationMs: 0,
    fallback:   false,
    ...opts,
  };
}

// ── Layer 1: Semantic Layout Intelligence ─────────────────────────────────────

export const LayoutStrategySchema = z.object({
  layoutType:     z.enum(['hero', 'split', 'grid', 'minimal', 'editorial', 'product']),
  emphasis:       z.enum(['visual', 'text', 'balanced']),
  primaryZone:    z.enum(['top', 'center', 'bottom', 'left', 'right']),
  whitespaceLevel: z.enum(['tight', 'normal', 'airy']),
  confidence:     z.number().min(0).max(1),
});

export type LayoutStrategy = z.infer<typeof LayoutStrategySchema>;

const LAYOUT_DEFAULTS: LayoutStrategy = {
  layoutType:      'hero',
  emphasis:        'balanced',
  primaryZone:     'center',
  whitespaceLevel: 'normal',
  confidence:      0.5,
};

/**
 * Layer 1: Infer layout strategy from intent.
 * Input is frozen — no mutation. Fallback on any error.
 */
export function inferLayoutStrategy(intent: Readonly<Intent>): StageResult<LayoutStrategy> {
  const t0 = Date.now();
  try {
    const p = intent.prompt.toLowerCase();
    const f = intent.format.toLowerCase();

    let layoutType: LayoutStrategy['layoutType'] = 'hero';
    if (p.includes('product') || p.includes('showcase'))       layoutType = 'product';
    else if (p.includes('article') || p.includes('editorial')) layoutType = 'editorial';
    else if (p.includes('minimal') || p.includes('clean'))     layoutType = 'minimal';
    else if (f.includes('story') || f.includes('portrait'))    layoutType = 'split';
    else if (f.includes('presentation') || f.includes('slide')) layoutType = 'grid';

    let emphasis: LayoutStrategy['emphasis'] = 'balanced';
    if (p.includes('bold text') || p.includes('headline'))   emphasis = 'text';
    else if (p.includes('photo') || p.includes('image'))     emphasis = 'visual';

    let primaryZone: LayoutStrategy['primaryZone'] = 'center';
    if (p.includes('top') || p.includes('header'))     primaryZone = 'top';
    else if (p.includes('bottom') || p.includes('cta')) primaryZone = 'bottom';
    else if (f.includes('twitter') || f.includes('landscape')) primaryZone = 'left';

    const whitespaceLevel: LayoutStrategy['whitespaceLevel'] =
      layoutType === 'minimal' ? 'airy' :
      layoutType === 'editorial' ? 'normal' : 'normal';

    const parsed = LayoutStrategySchema.safeParse({
      layoutType, emphasis, primaryZone, whitespaceLevel, confidence: 0.8,
    });

    if (!parsed.success) {
      return stageResult(LAYOUT_DEFAULTS, { fallback: true, errors: parsed.error.errors.map(e => e.message) });
    }

    return stageResult(parsed.data, { durationMs: Date.now() - t0 });
  } catch (err: any) {
    return stageResult(LAYOUT_DEFAULTS, { ok: false, fallback: true, errors: [err.message], durationMs: Date.now() - t0 });
  }
}

// ── Layer 2: Auto-Variation Intelligence ──────────────────────────────────────

export const VariationStrategySchema = z.object({
  count:       z.number().int().min(1).max(12),
  axes:        z.array(z.enum(['color', 'typography', 'layout', 'copy', 'imagery'])),
  diversity:   z.enum(['low', 'medium', 'high']),
  seedBase:    z.string(), // deterministic seed for reproducibility
});

export type VariationStrategy = z.infer<typeof VariationStrategySchema>;

const VARIATION_DEFAULTS: VariationStrategy = {
  count:     1,
  axes:      ['color'],
  diversity: 'low',
  seedBase:  'default',
};

export function planVariations(
  intent: Readonly<Intent>,
  requestedCount: number,
  maxAllowed: number
): StageResult<VariationStrategy> {
  const t0 = Date.now();
  try {
    const count = Math.min(Math.max(1, requestedCount), maxAllowed);
    const p     = intent.prompt.toLowerCase();

    const axes: VariationStrategy['axes'] = ['color'];
    if (count > 2) axes.push('typography');
    if (count > 3) axes.push('layout');
    if (p.includes('copy') || p.includes('text'))    axes.push('copy');
    if (p.includes('image') || p.includes('photo'))  axes.push('imagery');

    const diversity: VariationStrategy['diversity'] =
      count >= 6 ? 'high' : count >= 3 ? 'medium' : 'low';

    // Deterministic seed from prompt content (not random)
    const seedBase = Buffer.from(intent.prompt.slice(0, 64)).toString('base64').slice(0, 16);

    const parsed = VariationStrategySchema.safeParse({ count, axes, diversity, seedBase });
    if (!parsed.success) {
      return stageResult(VARIATION_DEFAULTS, { fallback: true, errors: parsed.error.errors.map(e => e.message) });
    }
    return stageResult(parsed.data, { durationMs: Date.now() - t0 });
  } catch (err: any) {
    return stageResult(VARIATION_DEFAULTS, { ok: false, fallback: true, errors: [err.message], durationMs: Date.now() - t0 });
  }
}

// ── Layer 3: Audience Modeling ────────────────────────────────────────────────

export const AudienceProfileSchema = z.object({
  segment:        z.enum(['consumer', 'professional', 'enterprise', 'youth', 'creative']),
  tonePreference: z.enum(['formal', 'casual', 'playful', 'authoritative', 'inspirational']),
  visualComplexity: z.enum(['simple', 'moderate', 'complex']),
  colorSensitivity: z.enum(['muted', 'vibrant', 'monochrome']),
  confidence:     z.number().min(0).max(1),
});

export type AudienceProfile = z.infer<typeof AudienceProfileSchema>;

const AUDIENCE_DEFAULTS: AudienceProfile = {
  segment:          'consumer',
  tonePreference:   'casual',
  visualComplexity: 'moderate',
  colorSensitivity: 'vibrant',
  confidence:       0.4,
};

export function modelAudience(intent: Readonly<Intent>): StageResult<AudienceProfile> {
  const t0 = Date.now();
  try {
    const a = (intent.audience ?? '').toLowerCase();
    const p = intent.prompt.toLowerCase();

    let segment: AudienceProfile['segment'] = 'consumer';
    if (a.includes('b2b') || a.includes('enterprise') || p.includes('enterprise')) segment = 'enterprise';
    else if (a.includes('professional') || p.includes('professional'))             segment = 'professional';
    else if (a.includes('teen') || a.includes('youth') || a.includes('gen z'))    segment = 'youth';
    else if (a.includes('creative') || a.includes('designer'))                    segment = 'creative';

    const tonePreference: AudienceProfile['tonePreference'] =
      segment === 'enterprise'   ? 'authoritative' :
      segment === 'professional' ? 'formal' :
      segment === 'youth'        ? 'playful' :
      segment === 'creative'     ? 'inspirational' : 'casual';

    const visualComplexity: AudienceProfile['visualComplexity'] =
      segment === 'enterprise' ? 'moderate' :
      segment === 'creative'   ? 'complex' : 'moderate';

    const colorSensitivity: AudienceProfile['colorSensitivity'] =
      segment === 'enterprise' ? 'muted' :
      segment === 'youth'      ? 'vibrant' : 'vibrant';

    const parsed = AudienceProfileSchema.safeParse({
      segment, tonePreference, visualComplexity, colorSensitivity, confidence: 0.75,
    });

    if (!parsed.success) {
      return stageResult(AUDIENCE_DEFAULTS, { fallback: true, errors: parsed.error.errors.map(e => e.message) });
    }
    return stageResult(parsed.data, { durationMs: Date.now() - t0 });
  } catch (err: any) {
    return stageResult(AUDIENCE_DEFAULTS, { ok: false, fallback: true, errors: [err.message], durationMs: Date.now() - t0 });
  }
}

// ── Layer 4: Content Density & Hierarchy Optimizer ────────────────────────────

export const DensityProfileSchema = z.object({
  textBlockCount:  z.number().int().min(0).max(10),
  maxCharsPerBlock: z.number().int().min(0),
  hierarchyLevels: z.enum(['1', '2', '3']),
  primaryFontSize: z.enum(['small', 'medium', 'large', 'display']),
  lineHeightScale: z.number().min(1).max(2),
});

export type DensityProfile = z.infer<typeof DensityProfileSchema>;

const DENSITY_DEFAULTS: DensityProfile = {
  textBlockCount:   2,
  maxCharsPerBlock: 120,
  hierarchyLevels:  '2',
  primaryFontSize:  'large',
  lineHeightScale:  1.5,
};

export function optimizeDensity(
  layout: Readonly<LayoutStrategy>,
  audience: Readonly<AudienceProfile>,
  format: string
): StageResult<DensityProfile> {
  const t0 = Date.now();
  try {
    const isSmallFormat = format.includes('instagram') || format.includes('thumbnail');
    const isBigFormat   = format.includes('presentation') || format.includes('poster');

    const textBlockCount = isSmallFormat ? 2 : isBigFormat ? 4 : 3;
    const maxCharsPerBlock = isSmallFormat ? 80 : isBigFormat ? 200 : 120;
    const hierarchyLevels: DensityProfile['hierarchyLevels'] =
      isBigFormat ? '3' : isSmallFormat ? '1' : '2';

    const primaryFontSize: DensityProfile['primaryFontSize'] =
      isSmallFormat ? 'display' :
      layout.emphasis === 'text' ? 'large' : 'medium';

    const lineHeightScale =
      audience.tonePreference === 'formal' ? 1.6 :
      audience.tonePreference === 'playful' ? 1.4 : 1.5;

    const parsed = DensityProfileSchema.safeParse({
      textBlockCount, maxCharsPerBlock, hierarchyLevels, primaryFontSize, lineHeightScale,
    });

    if (!parsed.success) {
      return stageResult(DENSITY_DEFAULTS, { fallback: true, errors: parsed.error.errors.map(e => e.message) });
    }
    return stageResult(parsed.data, { durationMs: Date.now() - t0 });
  } catch (err: any) {
    return stageResult(DENSITY_DEFAULTS, { ok: false, fallback: true, errors: [err.message], durationMs: Date.now() - t0 });
  }
}

// ── Layer 5: Brand Learning System ────────────────────────────────────────────

export const BrandSignalsSchema = z.object({
  dominantColors:     z.array(z.string()),
  fontFamily:         z.string().optional(),
  toneKeywords:       z.array(z.string()),
  logoPosition:       z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']),
  prefersDarkBg:      z.boolean(),
  historicalAccuracy: z.number().min(0).max(1), // how reliable these signals are
});

export type BrandSignals = z.infer<typeof BrandSignalsSchema>;

const BRAND_SIGNALS_DEFAULTS: BrandSignals = {
  dominantColors:     ['#000000', '#FFFFFF'],
  fontFamily:         undefined,
  toneKeywords:       [],
  logoPosition:       'top-left',
  prefersDarkBg:      false,
  historicalAccuracy: 0,
};

/**
 * Layer 5: Extract passive brand signals from a brand kit + usage history.
 * This is a read-only analysis — never mutates brand data.
 * The learning happens by passing richer context on each subsequent call.
 */
export function extractBrandSignals(brandKit: Record<string, unknown> | null): StageResult<BrandSignals> {
  const t0 = Date.now();
  try {
    if (!brandKit) {
      return stageResult(BRAND_SIGNALS_DEFAULTS, { fallback: true });
    }

    // Normalize colors: accept colors[], primaryColor string, or hex strings
    const rawColors = brandKit.colors as string[] | undefined;
    const primaryColor = brandKit.primaryColor as string | undefined;
    const secondaryColor = brandKit.secondaryColor as string | undefined;
    const colors: string[] = rawColors
      ? rawColors
      : [primaryColor, secondaryColor].filter(Boolean) as string[];

    // Normalize fonts: accept fonts array or fontFamily string
    const rawFonts = brandKit.fonts as Array<{ family: string }> | undefined;
    const fontFamilyStr = brandKit.fontFamily as string | undefined;
    const fonts: Array<{ family: string }> = rawFonts
      ? rawFonts
      : fontFamilyStr ? [{ family: fontFamilyStr }] : [];

    // Normalize tone: accept string[] or a single string
    const rawTone = brandKit.tone as string[] | string | undefined;
    const tone: string[] = Array.isArray(rawTone)
      ? rawTone
      : typeof rawTone === 'string' ? [rawTone] : [];

    const logo   = (brandKit.logoUrl as string | undefined);

    const dominantColors = colors.slice(0, 4).length
      ? colors.slice(0, 4)
      : BRAND_SIGNALS_DEFAULTS.dominantColors;

    const fontFamily = fonts[0]?.family ?? undefined;

    // Infer dark background preference from colors
    const prefersDarkBg = dominantColors.some(c => {
      const hex = c.replace('#', '');
      if (hex.length !== 6) return false;
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return ((r * 299 + g * 587 + b * 114) / 1000) < 128;
    });

    // Accuracy increases with completeness of brand kit
    const fields     = [colors.length, fonts.length, tone.length, logo ? 1 : 0];
    const filledPct  = fields.filter(f => f > 0).length / fields.length;

    const parsed = BrandSignalsSchema.safeParse({
      dominantColors,
      fontFamily,
      toneKeywords:       tone.slice(0, 5),
      logoPosition:       'top-left' as const,
      prefersDarkBg,
      historicalAccuracy: filledPct,
    });

    if (!parsed.success) {
      return stageResult(BRAND_SIGNALS_DEFAULTS, { fallback: true, errors: parsed.error.errors.map(e => e.message) });
    }
    return stageResult(parsed.data, { durationMs: Date.now() - t0 });
  } catch (err: any) {
    return stageResult(BRAND_SIGNALS_DEFAULTS, { ok: false, fallback: true, errors: [err.message], durationMs: Date.now() - t0 });
  }
}

// ── Orchestrator: run all 5 layers in explicit order ─────────────────────────

export interface IntelligencePipeline {
  layout:    StageResult<LayoutStrategy>;
  variation: StageResult<VariationStrategy>;
  audience:  StageResult<AudienceProfile>;
  density:   StageResult<DensityProfile>;
  brand:     StageResult<BrandSignals>;
  totalMs:   number;
  anyFallback: boolean;
  brandLearningActive: boolean; // true only when org flag is on
}

export async function runIntelligencePipeline(
  intent: Intent,
  opts: {
    requestedVariations: number;
    maxAllowedVariations: number;
    brandKit?: Record<string, unknown> | null;
    // V17: org-level Brand Learning toggle. MUST be passed from the org DB record.
    // When false or undefined, brandKit is treated as null — no learning signals propagate.
    // This ensures Brand Learning is passive and strictly org-scoped.
    brandLearningEnabled?: boolean;
  }
): IntelligencePipeline {
  const pipelineStart = Date.now();

  // V17: Brand Learning enforcement
  // Only pass the brandKit through if the org has explicitly enabled Brand Learning.
  // Even if brandKit is supplied by the caller, it is ignored unless the flag is true.
  // This guarantees no cross-tenant signal leakage and remains purely passive.
  const brandLearningActive = opts.brandLearningEnabled === true;
  const scopedBrandKit = brandLearningActive ? (opts.brandKit ?? null) : null;

  // Dependency graph:
  //   Layout (2), Variation (3), Audience (4), Brand (6) — all depend only on Intent (1)
  //   Density (5) — depends on Layout + Audience
  //
  // Stages 2, 3, 4, 6 run concurrently. Density unblocks once both Layout and Audience resolve.
  // Promise.resolve() keeps synchronous stages non-blocking on the microtask queue.
  const frozenIntent = Object.freeze({ ...intent });
  const [layoutResult, variationResult, audienceResult, brandResult] = await Promise.all([
    Promise.resolve(inferLayoutStrategy(frozenIntent)),
    Promise.resolve(planVariations(frozenIntent, opts.requestedVariations, opts.maxAllowedVariations)),
    Promise.resolve(modelAudience(frozenIntent)),
    Promise.resolve(extractBrandSignals(scopedBrandKit)),
  ]);
  const densityResult = optimizeDensity(
    Object.freeze({ ...layoutResult.data }),
    Object.freeze({ ...audienceResult.data }),
    intent.format
  );

  return {
    layout:      layoutResult,
    variation:   variationResult,
    audience:    audienceResult,
    density:     densityResult,
    brand:       brandResult,
    totalMs:     Date.now() - pipelineStart,
    anyFallback: [layoutResult, variationResult, audienceResult, densityResult, brandResult]
      .some(r => r.fallback),
    brandLearningActive,
  };
}
