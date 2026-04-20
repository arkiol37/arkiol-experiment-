// src/engines/render/svg-builder-ultimate.ts  — Arkiol Ultimate v4  (Canva-parity)
//
// KEY v4 CHANGES:
//  • Font size uses zone HEIGHT as primary driver (not minFontSize as base)
//    → Hero headline on 1080px canvas now targets 64-100px like Canva
//  • Eyebrow zone gets a leading left-bar accent (magazine convention)
//  • Line-height tightened for display sizes (1.1x at 72px+, 1.2x at 48px+)
//  • Badge gets pill stroke + semi-transparent fill matching primary colour
//  • renderUltimateSvg draws background gradient as full-canvas gradient rect
//  • All decorations placed in <g class="decor"> below text for clean z-order
//  • extractBg bug fixed (was called extractBg, defined as extractBgForPipeline)

import "server-only";
import { chatJSON }                from "../../lib/openai";
import { withRetry }               from "../../lib/error-handling";
import { Zone, ZoneId }            from "../layout/families";
import { BriefAnalysis }           from "../ai/brief-analyzer";
import { FORMAT_DIMS }             from "../../lib/types";
import { measureTextInZone, measureLineWidth, getSvgLineYPositions } from "./text-measure";
import { buildUltimateFontFaces, getFontStack } from "./font-registry-ultimate";
import { selectTheme, applyBrandColors, DesignTheme, ThemeTypography, ZoneTypography, THEMES, type ThemeFont } from "./design-themes";
import { detectCategoryPack, type CategoryStylePack } from "../style/category-style-packs";
import { getTypographyPersonality, type RolePersonality } from "../style/category-typography-personality";
import { selectFontPair } from "../style/font-pairing";
import { getCategoryKit, mergeKitDecorations } from "../style/category-template-kits";
import { renderDecorations, buildBackgroundDefs, renderMeshOverlay } from "./svg-decorations";
import { buildSectionFrames } from "./section-frames";
import { enforceStrictTypographyHierarchy, type TypographyItem } from "../hierarchy/strict-typography";
import { computeTextInset, refinedLineHeight } from "./text-rhythm";
import { enrichDecorations } from "./decoration-intelligence";
import {
  selectTemplateType,
  shapeThemeForTemplateType,
  type TemplateType,
} from "../templates/template-types";
import {
  assignComponents,
  analyzeComponents,
  renderComponentBackplates,
  type ComponentAssignment,
  type ComponentCoverageReport,
} from "../components/component-system";
import {
  mapContentToComponents,
  describeMappingReport,
  type MappingCoverageReport,
} from "../components/content-component-mapper";
import {
  restructureTextMap,
  analyzeContentCoverage,
  type ContentCoverageReport,
  type RestructureAction,
} from "../content/content-structure";
import {
  generateStructuredContent,
  buildFallbackStructuredContent,
  describeStructuredContent,
  type StructuredContent,
} from "../ai/structured-content";
import { pickBestTheme, scoreCandidateQuality, scoreThemeQuality, recordOutputFingerprint, isRecentDuplicate, isBlandCandidate, checkMarketplaceQuality } from "../evaluation/candidate-quality";
import { evaluateRejection } from "../evaluation/rejection-rules";
import { passesMarketplaceStandard, describeMarketplaceVerdict } from "../evaluation/marketplace-gate";
import { analyzeStyleIntent, deriveStyleDirective, applyStyleDirective } from "../style/style-intelligence";
import { computeLearningBias, applyThemeBias } from "../memory/learning-signals";
import { matchPatternToBrief, buildInspirationOverrides } from "../inspiration/pattern-matcher";
import { type PersonalizationContext } from "../personalization/dna-applicator";
import { createHash } from "crypto";
import { z } from "zod";

// ── GPT content cache ─────────────────────────────────────────────────────────
// Avoids redundant GPT-4o calls for the same brief+format combination.
// Keyed on SHA-256(headline + intent + tone + format + brandPrimary).
// Used heavily during bulk generation where many jobs share the same prompt.
// TTL: 5 minutes. Max entries: 200 (LRU eviction via insertion-order Map).
const CACHE_TTL_MS   = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 200;

interface CacheEntry { result: BuildResult; expiresAt: number; }
const _svgContentCache = new Map<string, CacheEntry>();

function svgCacheGet(key: string): BuildResult | null {
  const entry = _svgContentCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _svgContentCache.delete(key); return null; }
  return entry.result;
}
function svgCacheSet(key: string, result: BuildResult): void {
  // LRU eviction: delete oldest entry when at capacity
  if (_svgContentCache.size >= CACHE_MAX_SIZE) {
    const oldest = _svgContentCache.keys().next().value;
    if (oldest) _svgContentCache.delete(oldest);
  }
  _svgContentCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}
function buildCacheKey(brief: BriefAnalysis, format: string, brandPrimary?: string, variationIdx = 0): string {
  return createHash('sha256')
    .update(JSON.stringify({
      headline:  brief.headline,
      intent:    brief.intent,
      tone:      brief.tone,
      colorMood: brief.colorMood,
      format,
      brandPrimary: brandPrimary ?? '',
      variationIdx,
    }))
    .digest('hex');
}

// Exported for tests / monitoring only
export function getSvgContentCacheStats() {
  return { size: _svgContentCache.size, maxSize: CACHE_MAX_SIZE };
}

export interface SvgContent {
  backgroundColor: string;
  backgroundGradient?: { type: "linear" | "radial" | "none"; colors: string[]; angle?: number };
  textContents: Array<{ zoneId: string; text: string; fontSize: number; weight: number; color: string; fontFamily: string; letterSpacing?: number; textTransform?: "uppercase" | "none"; }>;
  ctaStyle?: { backgroundColor: string; textColor: string; borderRadius: number; paddingH: number; paddingV: number; shadow?: boolean; };
  overlayOpacity?: number;
  overlayColor?: string;
  accentShape?: { type: "rect" | "circle" | "line" | "none"; color: string; x: number; y: number; w: number; h: number; opacity?: number; borderRadius?: number; };
  _selectedTheme?: DesignTheme;
  /** Template type the composer shaped the theme for (checklist, tips, quote, ...). */
  _templateType?: TemplateType;
  /** Component assignments — every populated zone is mapped to a
   *  reusable visual block (checklist_item, tip_card, step_block,
   *  quote_box, content_card, cta_button, badge, labeled_section)
   *  so the renderer can emit backplates instead of floating text. */
  _components?: ComponentAssignment[];
  /** Coverage summary derived from `_components`. Used by the rejection
   *  gate and the quality verdict. */
  _componentReport?: ComponentCoverageReport;
  /** Content-aware restructuring report — records which list was split
   *  out of body/subhead/tagline into bullets and the final item count
   *  the template rendered. Used by the `unstructured_content`
   *  rejection rule to drop list-style templates that still ship as a
   *  single paragraph. */
  _contentCoverage?: ContentCoverageReport;
  _contentActions?: RestructureAction[];
  /** Structured-content payload used to populate the zones. Retained on
   *  the content object so the admission audit can log which template
   *  shape was actually requested from the model and how many items
   *  were delivered. */
  _structuredContent?: StructuredContent;
  /** Step 8 — per-role mapping of structured content to canvas zones.
   *  Lists expected vs placed roles, item counts, and whether the
   *  mapper detected compressed / underfilled output. Consumed by the
   *  `unmapped_content`, `underfilled_components` and
   *  `compressed_content` rejection rules. */
  _contentMapping?: MappingCoverageReport;
}

export interface BuildResult { content: SvgContent; violations: string[]; }

const TextOnlySchema = z.object({
  textContents: z.array(z.object({ zoneId: z.string(), text: z.string().max(400) })),
  themeOverride: z.enum(["vibrant_burst","dark_luxe","lush_green","floral_romance","cosmic_purple","power_black","ocean_blue","clean_minimal","sunset_warm","sage_wellness","navy_pro","modern_editorial","peach_bliss","tropical_paradise","retro_pop","golden_hour","lavender_dream","sky_fresh","coral_energy","earth_coffee","auto"]).optional(),
});

// ── Font size targeting — zone-height driven like Canva ───────────────────────
// For hero zones (headline, name) we target filling ~65% of zone height.
// For secondary zones (subhead, body) we target ~55%.
// The multiplier from the theme nudges up display zones only.
interface FontSizeHint {
  charCount: number;
  urgency: number;
  hierarchyBias: "headline" | "balanced" | "detail" | "cta";
}

function targetFontSize(zone: Zone, zoneId: ZoneId, canvasH: number, hMult: number, hint?: FontSizeHint, zoneFsMultiplier?: number): number {
  const zH = (zone.height / 100) * canvasH;
  let fill = 0.55;

  if (["headline","name"].includes(zoneId)) {
    fill = 0.72;
    if (hint) {
      if (hint.charCount <= 12)      fill = 0.92;
      else if (hint.charCount <= 20) fill = 0.85;
      else if (hint.charCount <= 35) fill = 0.75;
      else if (hint.charCount > 50)  fill = 0.58;
      if (hint.hierarchyBias === "headline") fill = Math.min(0.95, fill + 0.08);
    }
  } else if (["subhead","tagline"].includes(zoneId)) {
    fill = 0.56;
    if (hint?.hierarchyBias === "detail") fill = 0.52;
    if (hint && hint.charCount > 80)      fill = 0.48;
  } else if (["price"].includes(zoneId)) {
    fill = 0.70;
  } else if (["cta","badge","eyebrow","section_header"].includes(zoneId)) {
    fill = 0.52;
    if (hint && zoneId === "cta" && hint.urgency > 0.7) fill = 0.60;
  } else if (["body","body_text","contact","legal"].includes(zoneId)) {
    fill = 0.42;
    if (hint && hint.charCount > 300) fill = 0.38;
  }

  if (zoneFsMultiplier) fill *= zoneFsMultiplier;

  let fs = Math.round(zH * fill);
  if (["headline","name","price"].includes(zoneId)) fs = Math.round(fs * hMult);

  const lo = zone.minFontSize ?? 10;
  const hi = zone.maxFontSize ?? 200;
  return Math.min(hi, Math.max(lo, fs));
}

// Line-height policy moved to text-rhythm.refinedLineHeight —
// role-aware and size-aware with better body/bullet defaults.

export async function buildUltimateSvgContent(
  zones: Zone[], brief: BriefAnalysis, format: string,
  brand?: { primaryColor: string; secondaryColor: string; fontDisplay: string },
  variationIdx = 0,
  themePreferences?: string[],
  personalization?: PersonalizationContext,
  // Step 42: when present, the selected theme is post-locked to this
  // anchor via lockThemeToAnchor so every variation in a gallery batch
  // shares palette + typography + corner-radius. Per-variation
  // composition / decoration / layout stay free — only the shared
  // style traits are pinned. Passed transparently from PipelineInput
  // by the coordinator after the first successful render.
  packAnchor?: {
    primary: string; accent: string; surface: string; ink: string;
    fontDisplay: string; fontBody: string;
    cornerRadius: number; ctaShadow: boolean;
  },
  // Template type — if provided, the theme is shaped to visibly
  // announce this type (checklist / tips / quote / step-by-step /
  // list / promotional / educational / minimal). Undefined lets the
  // builder auto-select based on the brief + variationIdx.
  templateType?: TemplateType,
): Promise<BuildResult> {
  const violations: string[] = [];
  const dims   = FORMAT_DIMS[format] ?? { width: 1080, height: 1080 };

  // ── Multi-candidate theme selection ──────────────────────────────────────
  // Generate 6 candidate themes and pick the richest, most unique one.
  // Wider pool catches more marketplace-quality candidates.
  const THEME_CANDIDATES = 6;
  const categoryPack = detectCategoryPack(brief);

  const candidateThemes: DesignTheme[] = [];
  for (let ci = 0; ci < THEME_CANDIDATES; ci++) {
    let t = selectTheme(brief, variationIdx + ci * 7919);
    if (brand) t = applyBrandColors(t, { primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor });
    if (categoryPack) t = applyCategoryPackOverrides(t, categoryPack, brand);
    candidateThemes.push(t);
  }

  // Apply learning bias — reorder candidates so historically high-performing
  // themes are evaluated first (affects dedup anchor selection in pickBestTheme)
  const learningBias = computeLearningBias({ format });
  if (learningBias.confidence > 0) {
    candidateThemes.sort((a, b) => {
      const aBase = scoreThemeQuality(a).total;
      const bBase = scoreThemeQuality(b).total;
      const aBiased = applyThemeBias(a.id, aBase, learningBias);
      const bBiased = applyThemeBias(b.id, bBase, learningBias);
      return bBiased - aBiased;
    });
  }

  // Apply agent theme preferences — boost candidates that match the design plan
  if (themePreferences && themePreferences.length > 0) {
    const prefSet = new Set(themePreferences);
    candidateThemes.sort((a, b) => {
      const aPreferred = prefSet.has(a.id) ? 1 : 0;
      const bPreferred = prefSet.has(b.id) ? 1 : 0;
      return bPreferred - aPreferred;
    });
  }

  // Apply personalization DNA — boost/penalize themes based on user style profile
  if (personalization?.active) {
    const tb = personalization.themeBias;
    candidateThemes.sort((a, b) => {
      const aBoost = (tb.boosts[a.id] ?? 0) + (tb.penalties[a.id] ?? 0);
      const bBoost = (tb.boosts[b.id] ?? 0) + (tb.penalties[b.id] ?? 0);
      return bBoost - aBoost;
    });
  }

  // Pick the best non-bland, non-duplicate candidate
  let theme = pickBestTheme(candidateThemes);

  // If the winner is a recent duplicate, try harder with offset seeds (up to 3 retries)
  if (isRecentDuplicate(theme)) {
    for (let retryIdx = 0; retryIdx < 3; retryIdx++) {
      const extraOffset = (Date.now() + retryIdx * 3571) % 10000;
      let retry = selectTheme(brief, variationIdx + extraOffset);
      if (brand) retry = applyBrandColors(retry, { primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor });
      if (categoryPack) retry = applyCategoryPackOverrides(retry, categoryPack, brand);
      if (!isBlandCandidate(retry) && !isRecentDuplicate(retry)) { theme = retry; break; }
    }
  }

  // ── Style intelligence — adapt palette, typography, mood to brief intent
  const styleIntent = analyzeStyleIntent(brief, categoryPack?.id);
  const styleDirective = deriveStyleDirective(styleIntent, categoryPack, brand ? { primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor } : undefined);
  theme = applyStyleDirective(theme, styleDirective, !!brand);

  // Step 42: pack-anchor override. Locks palette + typography +
  // corner-radius + CTA shadow so every variation in the gallery
  // batch reads as one pack. Runs after style intelligence (so
  // user-brief intent still informs the candidate pool) but before
  // inspiration / personalization which tune details the anchor
  // doesn't touch (headline size, decoration kinds, etc.).
  if (packAnchor) {
    theme = {
      ...theme,
      palette: {
        ...theme.palette,
        primary:    packAnchor.primary,
        secondary:  packAnchor.accent,
        background: packAnchor.surface,
        text:       packAnchor.ink,
      },
      typography: {
        ...theme.typography,
        display: packAnchor.fontDisplay as typeof theme.typography.display,
        body:    packAnchor.fontBody    as typeof theme.typography.body,
      },
      ctaStyle: {
        ...theme.ctaStyle,
        borderRadius: packAnchor.cornerRadius,
        shadow:       packAnchor.ctaShadow,
      },
    };
  }

  // ── Inspiration pattern intelligence — apply real-world pattern overrides
  const inspirationMatch = matchPatternToBrief(brief, format);
  if (inspirationMatch.topScore >= 0.3) {
    const overrides = buildInspirationOverrides(inspirationMatch.hint);
    if (overrides.headlineSizeMultiplier) {
      theme = { ...theme, headlineSizeMultiplier: (theme.headlineSizeMultiplier ?? 1.0) * overrides.headlineSizeMultiplier };
    }
    if (overrides.headlineWeight && theme.typography.headline) {
      theme = { ...theme, typography: { ...theme.typography, headline: { ...theme.typography.headline, fontWeight: overrides.headlineWeight } } };
    }
    if (overrides.headlineLetterSpacing !== undefined && theme.typography.headline) {
      theme = { ...theme, typography: { ...theme.typography, headline: { ...theme.typography.headline, letterSpacing: overrides.headlineLetterSpacing } } };
    }
    if (overrides.headlineTextTransform && theme.typography.headline) {
      theme = { ...theme, typography: { ...theme.typography, headline: { ...theme.typography.headline, textTransform: overrides.headlineTextTransform } } };
    }
    if (overrides.ctaBorderRadius !== undefined) {
      theme = { ...theme, ctaStyle: { ...theme.ctaStyle, borderRadius: overrides.ctaBorderRadius } };
    }
    if (overrides.ctaShadow !== undefined) {
      theme = { ...theme, ctaStyle: { ...theme.ctaStyle, shadow: overrides.ctaShadow } };
    }
    if (overrides.overlayOpacity && overrides.overlayOpacity > (theme.overlayOpacity ?? 0)) {
      theme = { ...theme, overlayOpacity: overrides.overlayOpacity };
    }
  }

  // ── Personalization DNA overrides — adapt theme to user style profile
  if (personalization?.active) {
    const typoOv = personalization.typographyOverrides;
    if (typoOv.headlineWeightBias !== 0 && theme.typography.headline) {
      const newWeight = Math.min(900, Math.max(100, theme.typography.headline.fontWeight + typoOv.headlineWeightBias));
      theme = { ...theme, typography: { ...theme.typography, headline: { ...theme.typography.headline, fontWeight: newWeight } } };
    }
    if (typoOv.headlineSizeScale !== 1.0) {
      theme = { ...theme, headlineSizeMultiplier: (theme.headlineSizeMultiplier ?? 1.0) * typoOv.headlineSizeScale };
    }
    if (typoOv.letterSpacingBias !== 0 && theme.typography.headline) {
      theme = { ...theme, typography: { ...theme.typography, headline: { ...theme.typography.headline, letterSpacing: (theme.typography.headline.letterSpacing ?? 0) + typoOv.letterSpacingBias } } };
    }
    if (typoOv.preferUppercase && theme.typography.headline) {
      theme = { ...theme, typography: { ...theme.typography, headline: { ...theme.typography.headline, textTransform: "uppercase" } } };
    }
    const ctaOv = personalization.ctaBias;
    if (ctaOv.radiusPreference === "pill") theme = { ...theme, ctaStyle: { ...theme.ctaStyle, borderRadius: 50 } };
    else if (ctaOv.radiusPreference === "sharp") theme = { ...theme, ctaStyle: { ...theme.ctaStyle, borderRadius: Math.min(theme.ctaStyle.borderRadius, 4) } };
    if (ctaOv.shadowPreference !== null) theme = { ...theme, ctaStyle: { ...theme.ctaStyle, shadow: ctaOv.shadowPreference } };
  }

  // Enrich decorations to enforce minimum visual richness
  theme = { ...theme, decorations: enrichDecorations(theme.decorations, theme) };

  // ── Template type shaping ────────────────────────────────────────────────
  // The composer picks a template type (checklist / tips / quote / ...) and
  // layers type-specific signature decorations on top of the theme so the
  // gallery surface visibly differs across variations. Selection is
  // deterministic from brief + variationIdx so repeat renders are stable.
  const typeDecision = selectTemplateType(brief, variationIdx, templateType);
  const resolvedTemplateType = typeDecision.type;
  theme = shapeThemeForTemplateType(theme, resolvedTemplateType);
  (theme as any)._templateType = resolvedTemplateType;

  // Record after style application so fingerprint reflects actual output
  recordOutputFingerprint(theme);

  // ── Cache lookup — keyed on theme + brief + pack so style variety is preserved.
  // Template type is folded into the cache key so different types for the
  // same brief + variationIdx aren't served from a single cached entry.
  const packSuffix = categoryPack ? ':' + categoryPack.id : '';
  const cacheKey = buildCacheKey(brief, format, brand?.primaryColor, variationIdx) + ':' + theme.id + packSuffix + ':tt=' + resolvedTemplateType;
  const cached   = svgCacheGet(cacheKey);
  if (cached) return cached;

  const contentZoneLines = zones
    .filter(z => !["background","image","accent"].includes(z.id))
    .map(z => {
      const mc = z.constraints?.maxChars;
      return "  - " + JSON.stringify(z.id) + " " + (mc ? "(max " + mc + " chars)" : "") + " " + (z.required ? "[required]" : "[optional]");
    }).join("\n");

  // Include category context in the GPT prompt for better copy generation
  const categoryHint = categoryPack
    ? `\nCategory: ${categoryPack.name}. Tailor copy style to this category's conventions.`
    : "";

  const systemPrompt = [
    "You are a world-class copywriter creating text for premium design templates (Canva-level quality).",
    "Format: " + format + ". Canvas: " + dims.width + "x" + dims.height + "px. Theme: " + theme.name + "." + categoryHint,
    "Brief: " + JSON.stringify(brief.headline) + " — Intent: " + brief.intent + " — Tone: " + brief.tone + " — Audience: " + brief.audience + ".",
    "",
    "Write PREMIUM, attention-grabbing text for each zone. Quality standards:",
    "• Headlines: Bold, emotional, use power words. Create desire or urgency. Never generic.",
    "• Subheads: Expand on headline with a specific benefit or compelling detail.",
    "• Body: Concrete, scannable. Use numbers, specifics, or social proof when fitting.",
    "• CTA: Action-oriented verb + clear value. 'Get Started Free' > 'Click Here'.",
    "• Badge: Short status label. E.g. 'NEW', 'LIMITED', '#1 RATED', 'BEST SELLER'.",
    "• Eyebrow: 1-3 word category/context label above headline.",
    "",
    "Available zones:\n" + contentZoneLines,
    "Rules: headline ≤50 chars. cta 2-4 words. badge SHOUTED (uppercase). eyebrow 1-3 words max.",
    "NEVER use placeholder text. NEVER repeat the brief verbatim. Transform the brief into marketing copy.",
    "themeOverride: pick theme ID when brief strongly implies it, else 'auto'.",
    "Respond ONLY with valid JSON. No markdown, no explanation.",
  ].join("\n");

  // ── Step 7: Template-type-aware structured content ──────────────────────
  // Ask OpenAI for a STRUCTURED payload (headline + subhead + CTA + N items
  // shaped for the template type — tips, checklist rows, steps, benefits,
  // insights, or list entries). The response is mapped directly onto the
  // canvas zones. When OPENAI_API_KEY is absent or the call fails we fall
  // back to the legacy zone-text path so the gallery still renders.
  const availableZoneIdSet = new Set(zones.map(z => z.id as string));
  let structured: StructuredContent | null = null;
  try {
    structured = await generateStructuredContent({
      brief,
      templateType:  resolvedTemplateType,
      variationIdx,
      format,
      categoryName:  categoryPack?.name,
      availableZoneIds: availableZoneIdSet,
    });
  } catch (e: any) {
    violations.push("structured_content_failed:" + (e?.message ?? "unknown"));
    structured = null;
  }

  let rawTextMap: Map<string, string>;
  let contentMapping: MappingCoverageReport | undefined;

  if (structured && structured.headline) {
    // Step 8 — explicit role → zone mapping. Each StructuredContent
    // field lands in a specific zone following the per-template
    // contract, and every item becomes its own distinct visual block.
    const mapped = mapContentToComponents(structured, resolvedTemplateType, availableZoneIdSet);
    rawTextMap     = mapped.textMap;
    contentMapping = mapped.report;
    violations.push("content_source:structured:" + describeStructuredContent(structured));
    violations.push("content_mapping:" + describeMappingReport(mapped.report));
    if (mapped.report.missingRequired.length) {
      violations.push("content_mapping:missing_required:[" + mapped.report.missingRequired.join(",") + "]");
    }
    if (mapped.report.compressed)  violations.push("content_mapping:compressed");
    if (mapped.report.underfilled) violations.push("content_mapping:underfilled");
  } else {
    // Legacy path — retained as a graceful fallback when structured content
    // isn't available. Same chatJSON call as before; same fallback on
    // failure. Nothing below this block knows which branch ran.
    let raw: unknown;
    try {
      raw = await withRetry(
        () => chatJSON(
          [{ role: "system", content: systemPrompt }, { role: "user", content: "Generate text content as JSON." }],
          { model: "gpt-4o", temperature: 0.7, max_tokens: 800 },
        ),
        { maxAttempts: 3 },
      );
    } catch (e: any) {
      violations.push("AI failed: " + e.message);
      raw = buildFallbackTextContent(zones, brief);
    }

    const parsed = TextOnlySchema.safeParse(raw);
    if (!parsed.success) violations.push("Schema validation failed");
    const aiText = parsed.success ? parsed.data : (buildFallbackTextContent(zones, brief) as any);

    if (aiText.themeOverride && aiText.themeOverride !== "auto") {
      const ov = THEMES.find(t => t.id === aiText.themeOverride);
      if (ov) {
        let overridden = brand ? applyBrandColors(ov, { primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor }) : ov;
        if (categoryPack) overridden = applyCategoryPackOverrides(overridden, categoryPack, brand);
        theme = overridden;
      }
    }

    rawTextMap = new Map<string, string>(aiText.textContents.map((tc: any) => [tc.zoneId as string, tc.text as string]));
    violations.push("content_source:legacy_zone_text");

    // If the legacy path returned an empty bullet set for a list-style
    // template, synthesize a fallback StructuredContent so downstream
    // audits (and inlineGenerate's per-candidate log) still see a coherent
    // template shape instead of a ghost.
    if (!structured) {
      structured = buildFallbackStructuredContent(brief, resolvedTemplateType, variationIdx);
    }
    // Step 8 — even on the legacy path, emit a best-effort mapping
    // report from whatever StructuredContent we now hold so the three
    // mapping-driven rejection rules still evaluate. The legacy
    // rawTextMap remains the source of truth for rendering; the mapper
    // report is audit-only here.
    const legacyMapped = mapContentToComponents(structured, resolvedTemplateType, availableZoneIdSet);
    contentMapping = legacyMapped.report;
    violations.push("content_mapping:legacy:" + describeMappingReport(legacyMapped.report));
  }

  // ── Content-aware restructuring ──────────────────────────────────────────
  // When the composer populated `body` (or subhead/tagline) with a
  // numbered list, bulleted list, or tip/step sequence, and the active
  // template type expects multiple items (checklist / tips /
  // step_by_step / list_based / educational), redistribute the detected
  // items across bullet_1 / bullet_2 / bullet_3 zones so each one
  // renders as its own component row. Source zone is cleared when its
  // entire text was the list; otherwise it stays as a lead line.
  const restructure      = restructureTextMap(rawTextMap, availableZoneIdSet, resolvedTemplateType);
  const textMap          = restructure.textMap;
  const contentActions   = restructure.actions;
  for (const a of contentActions) {
    if (a.kind !== "skip") {
      violations.push(`content_structure:${a.kind}:${a.source}→${a.targets.join("+") || "-"}(${a.items.length})`);
    }
  }

  const typo      = theme.typography;
  const hMult     = theme.headlineSizeMultiplier ?? 1.0;

  const _headlineLen = (brief.headline ?? "").length;
  const _briefUrgency = brief.tone === "urgent" ? 1 : brief.tone === "energetic" ? 0.72 : brief.cta ? 0.46 : 0.2;
  const _briefKeywords = (brief.keywords ?? []).filter((k: string) => k.length > 3);
  let _briefHierarchy: FontSizeHint["hierarchyBias"] = "balanced";
  if (_headlineLen > 0 && _headlineLen <= 28 && _briefKeywords.length >= 2) _briefHierarchy = "headline";
  else if ((brief.body ?? "").length > 240 || (brief.subhead ?? "").length > 110) _briefHierarchy = "detail";
  else if (brief.cta && ((brief.cta ?? "").length <= 16 || _briefUrgency > 0.7)) _briefHierarchy = "cta";

  const rawTextContents: TypographyItem[] = zones
    .filter(z => !["background","image","accent"].includes(z.id))
    .flatMap(zone => {
      const text = textMap.get(zone.id) as string | undefined;
      if (!text?.trim()) return [];
      const zt = resolveZoneTypo(zone.id as ZoneId, typo, theme);
      if (!zt) return [];
      const hint: FontSizeHint = { charCount: text.trim().length, urgency: _briefUrgency, hierarchyBias: _briefHierarchy };
      const fontSize = targetFontSize(zone, zone.id as ZoneId, dims.height, hMult, hint, zt.fontSizeMultiplier);
      return [{
        zoneId: zone.id, text: text.trim(), fontSize,
        weight: zt.fontWeight, color: zt.color, fontFamily: zt.fontFamily as string,
        letterSpacing: zt.letterSpacing,
        textTransform: zt.textTransform as ("uppercase" | "none" | undefined),
      }];
    });

  const strict = enforceStrictTypographyHierarchy(rawTextContents, zones);
  const textContents = strict.items;
  for (const adj of strict.adjustments) {
    violations.push(`hierarchy:${adj.field}:${adj.zoneId}:${adj.from}→${adj.to}(${adj.reason})`);
  }

  const {primaryBgColor, gradient} = extractBgFromTheme(theme);

  // ── Component assignment ──────────────────────────────────────────────────
  // Map every populated zone to a component kind (checklist_item, tip_card,
  // step_block, quote_box, content_card, cta_button, badge, labeled_section)
  // using the template-type-specific rules. The SVG layer will draw
  // backplates for these; the rejection gate reads the report to verify
  // the template is composed rather than floating text.
  const populatedZoneIds = textContents
    .filter(tc => tc.text?.trim().length > 0)
    .map(tc => tc.zoneId);
  const componentAssignments = assignComponents(resolvedTemplateType, populatedZoneIds);
  const componentReport      = analyzeComponents(componentAssignments, populatedZoneIds);
  if (!componentReport.hasStructuredComponents) {
    violations.push(`components:no_structured_components_populated=${populatedZoneIds.length}`);
  }

  // ── Content coverage (post-restructure) ──────────────────────────────────
  // Count how many bullet zones actually carry text after the
  // restructurer ran and compare against the template type's minimum.
  const finalTextMap = new Map<string, string>(textContents.map(tc => [tc.zoneId, tc.text]));
  const contentCoverage = analyzeContentCoverage(finalTextMap, resolvedTemplateType, contentActions);
  if (!contentCoverage.satisfiesMinimum) {
    violations.push(`content_coverage:below_minimum(${contentCoverage.populatedItems}/${contentCoverage.required})`);
  }

  const content: SvgContent = {
    backgroundColor:primaryBgColor, backgroundGradient:gradient, textContents,
    ctaStyle:{ backgroundColor:theme.ctaStyle.backgroundColor, textColor:theme.ctaStyle.textColor,
      borderRadius:theme.ctaStyle.borderRadius, paddingH:theme.ctaStyle.paddingH,
      paddingV:theme.ctaStyle.paddingV, shadow:theme.ctaStyle.shadow ?? false },
    overlayOpacity:theme.overlayOpacity ?? 0, overlayColor:theme.overlayColor ?? "#000000",
    accentShape:{ type:"none", color:"#000000", x:0, y:0, w:0, h:0 },
    _selectedTheme:theme,
    _templateType: resolvedTemplateType,
    _components:   componentAssignments,
    _componentReport: componentReport,
    _contentCoverage: contentCoverage,
    _contentActions:  contentActions,
    _structuredContent: structured ?? undefined,
    _contentMapping:    contentMapping,
  };

  // ── Post-build marketplace quality gate ──────────────────────────────
  const marketplaceReject = checkMarketplaceQuality(theme, content);
  if (marketplaceReject) {
    violations.push(marketplaceReject);
  }
  const qualityScore = scoreCandidateQuality(theme, content);
  if (qualityScore.total < 0.40) {
    violations.push(`quality:low_score(${qualityScore.total.toFixed(2)}) — below marketplace bar`);
  }

  // ── Step 23: consolidated rejection gate ─────────────────────────────
  // Every hard rule in the rejection catalog (too_empty, too_repetitive,
  // gradient_heavy, asset_poor, visually_weak, weak_hierarchy,
  // unreadable, unbalanced) becomes a build violation so the same weak
  // outputs the gallery would filter are also flagged at build time.
  // Soft rules are recorded separately for audit without blocking.
  const rejection = evaluateRejection(theme, content);
  for (const r of rejection.hardReasons) violations.push(`rejection:${r}`);
  for (const r of rejection.softReasons) violations.push(`rejection_soft:${r}`);

  // ── Step 25: marketplace-quality final gate ──────────────────────────
  // Runs *after* the per-template rejection rules. Every earlier gate
  // was about "is this output acceptable?" — this one asks "is this
  // output *marketplace-grade*?" (polished + layered + categorySpecific
  // + assetRich + publishReady). Templates that fail get a
  // "marketplace_gate:<status> failed=[...]" violation the pipeline can
  // act on when filtering the gallery batch.
  const marketplace = passesMarketplaceStandard({
    theme,
    content,
    qualityScore:     qualityScore,
    rejectionVerdict: rejection,
  });
  violations.push(describeMarketplaceVerdict(marketplace));
  for (const c of marketplace.failedCriteria) {
    violations.push(`marketplace_fail:${c}:${marketplace.criteria[c].detail}`);
  }

  const buildResult: BuildResult = { content, violations };
  svgCacheSet(cacheKey, buildResult);
  return buildResult;
}

// ── Category Style Pack → Theme overrides ─────────────────────────────────────
// Applies non-destructive typography and sizing overrides from the detected
// category style pack onto the selected theme. Does NOT change palette colors
// (that's the theme's job) — only adjusts headline size, letter-spacing,
// text-transform, and font preferences to match the category's visual identity.

function applyCategoryPackOverrides(
  theme: DesignTheme,
  pack: CategoryStylePack,
  brand?: { primaryColor: string; secondaryColor: string; fontDisplay?: string },
): DesignTheme {
  // Apply headline size boost from category pack
  const baseHMult = theme.headlineSizeMultiplier ?? 1.0;
  const boostedHMult = baseHMult * pack.headlineSizeBoost;

  // Curated font pairing — scores classification contrast, personality
  // alignment, role fitness, and canonical typographic pairings. Replaces
  // the previous first-match serif/sans contrast.
  const softnessBias: "softer" | "harder" | "neutral" =
    pack.id === "wellness" || pack.id === "beauty" || pack.id === "fashion" ? "softer" :
    pack.id === "fitness"  || pack.id === "marketing" || pack.id === "motivation" ? "harder" :
    "neutral";
  const pair = selectFontPair({
    preferredDisplay: pack.preferredDisplayFonts,
    preferredBody:    pack.preferredBodyFonts,
    themeDisplay:     theme.typography.display,
    themeBody:        theme.typography.body,
    brandDisplay:     brand?.fontDisplay,
    softnessBias,
  });
  const headlineFont = pair.display;
  const bodyFont     = pair.body;

  // Uppercase headlines need wider tracking for editorial feel
  let hLetterSpacing = pack.headlineLetterSpacing;
  if (pack.preferUppercase && hLetterSpacing < 0.04) {
    hLetterSpacing = Math.max(hLetterSpacing, 0.05);
  }

  // Typography personality — per-role expression that carries the category
  // character through body, cta, bullets, and micro labels.
  const personality = getTypographyPersonality(pack);
  const applyRole = <T extends Partial<ZoneTypography>>(
    base: T,
    role: RolePersonality | undefined,
  ): T => {
    if (!role) return base;
    return {
      ...base,
      ...(role.fontWeight    !== undefined ? { fontWeight:           role.fontWeight    } : {}),
      ...(role.letterSpacing !== undefined ? { letterSpacing:        role.letterSpacing } : {}),
      ...(role.lineHeightMultiplier !== undefined ? { lineHeightMultiplier: role.lineHeightMultiplier } : {}),
      ...(role.textTransform !== undefined ? { textTransform:        role.textTransform } : {}),
    } as T;
  };

  // Build overridden typography — pack values first, personality layered last
  // so per-role dials (body leading, cta tracking, etc.) take precedence.
  const headline = applyRole({
    ...theme.typography.headline,
    fontFamily: headlineFont,
    fontSizeMultiplier: boostedHMult,
    letterSpacing: hLetterSpacing,
    ...(pack.preferUppercase ? { textTransform: "uppercase" as const } : {}),
    ...(pack.headlineWeight ? { fontWeight: pack.headlineWeight } : {}),
  }, personality?.headline);

  const subhead = applyRole({
    ...theme.typography.subhead,
    fontFamily: bodyFont !== theme.typography.body ? bodyFont : theme.typography.subhead.fontFamily,
    letterSpacing: pack.subheadLetterSpacing,
    ...(pack.subheadWeight ? { fontWeight: pack.subheadWeight } : {}),
    ...(pack.subheadContrast === "subtle" ? { fontSizeMultiplier: 0.55 } :
        pack.subheadContrast === "strong" ? { fontSizeMultiplier: 0.75 } : {}),
  }, personality?.subhead);

  const body_text = applyRole({
    ...theme.typography.body_text,
    fontFamily: bodyFont,
  }, personality?.body);

  const cta     = applyRole({ ...theme.typography.cta     }, personality?.cta);
  const badge   = applyRole({ ...theme.typography.badge   }, personality?.badge);
  const eyebrow = applyRole({ ...theme.typography.eyebrow }, personality?.eyebrow);

  // Apply category template kit — merge signature decorations
  const kit = getCategoryKit(pack.id);
  let decorations = theme.decorations;
  let overlayOpacity = theme.overlayOpacity ?? 0;

  if (kit) {
    const primary = brand?.primaryColor ?? theme.palette.highlight;
    const secondary = brand?.secondaryColor ?? theme.palette.secondary;
    decorations = mergeKitDecorations(theme.decorations, kit, primary, secondary);
    if (kit.overlayBoost > 0) {
      overlayOpacity = Math.max(overlayOpacity, kit.overlayBoost);
    }
  }

  // Apply CTA radius bias from pack
  let ctaStyle = theme.ctaStyle;
  if (pack.ctaRadiusBias === "pill") ctaStyle = { ...ctaStyle, borderRadius: 50 };
  else if (pack.ctaRadiusBias === "sharp") ctaStyle = { ...ctaStyle, borderRadius: Math.min(ctaStyle.borderRadius, 4) };
  else if (pack.ctaRadiusBias === "rounded") ctaStyle = { ...ctaStyle, borderRadius: Math.max(8, Math.min(ctaStyle.borderRadius, 16)) };

  const themed: DesignTheme = {
    ...theme,
    headlineSizeMultiplier: boostedHMult,
    decorations,
    overlayOpacity,
    ctaStyle,
    typography: {
      ...theme.typography,
      display: headlineFont,
      body: bodyFont,
      headline,
      subhead,
      body_text,
      cta,
      badge,
      eyebrow,
    },
  };
  // Stash the personality on the theme so resolveZoneTypo can apply per-zone
  // dials (bullet leading, contact tracking, legal weight) that don't map to
  // a distinct ZoneTypography slot on the theme itself.
  if (personality) {
    (themed as DesignTheme & { _typographyPersonality?: typeof personality })._typographyPersonality = personality;
  }
  return themed;
}

// Font pairing moved to style/font-pairing.selectFontPair — curated,
// score-based, with canonical pair weights and anti-pattern penalties.

// ── SVG Renderer ──────────────────────────────────────────────────────────────
export function renderUltimateSvg(zones: Zone[], content: SvgContent, format: string): string {
  const {width, height} = FORMAT_DIMS[format] ?? {width:1080, height:1080};
  const px  = (pct: number, total: number) => (pct / 100) * total;
  const theme = content._selectedTheme;
  if (!theme) return renderBasicFallback(zones, content, width, height);

  const fontFaces = buildUltimateFontFaces();
  const {defs: bgDefs, fill: bgFill} = buildBackgroundDefs(theme.background);

  // Render decorations and hoist inline defs (radialGradient, filter) into <defs>
  const rawDecor  = renderDecorations(theme.decorations, width, height);
  const hoistedDefs: string[] = [];
  const cleanDecor = rawDecor.replace(
    /<(filter|radialGradient)\b[^>]*>[\s\S]*?<\/\1>/g,
    (m: string) => { hoistedDefs.push(m); return ""; }
  );

  // Standard filters
  const txtShadowFil = `<filter id="txt_sh" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.6)"/></filter>`;
  const ctaShadowFil = content.ctaStyle?.shadow
    ? `<filter id="cta_sh" x="-10%" y="-25%" width="120%" height="175%"><feDropShadow dx="0" dy="5" stdDeviation="10" flood-color="rgba(0,0,0,0.28)"/></filter>`
    : "";
  // Eyebrow accent pill filter (very subtle)
  const eyebrowFil = `<filter id="eyebrow_sh" x="-5%" y="-20%" width="110%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="rgba(0,0,0,0.15)"/></filter>`;

  const allDefs = [
    fontFaces ? `<style>${fontFaces}</style>` : "",
    bgDefs,
    txtShadowFil,
    ctaShadowFil,
    eyebrowFil,
    ...hoistedDefs,
  ].filter(Boolean).join("\n    ");

  // ── Background ──────────────────────────────────────────────────────────────
  let layers = `<rect width="${width}" height="${height}" fill="${bgFill}"/>`;

  // Mesh overlay layers
  const meshOv = renderMeshOverlay(theme.background, width, height);
  if (meshOv) layers += "\n  " + meshOv;

  // Full-canvas overlay (darkens behind text when image zone exists)
  if ((content.overlayOpacity ?? 0) > 0) {
    const iz = zones.find(z => z.id === "image");
    if (iz) {
      const ox=px(iz.x,width), oy=px(iz.y,height), ow=px(iz.width,width), oh=px(iz.height,height);
      layers += `\n  <rect x="${f(ox)}" y="${f(oy)}" width="${f(ow)}" height="${f(oh)}" fill="${content.overlayColor ?? '#000'}" opacity="${content.overlayOpacity}"/>`;
    }
  }

  // ── Section frames (structural regions: header / content / visual / list / cta)
  // Renders BEFORE decorations so decorative detail can layer on top of the
  // structural surfaces, and text stays on top of everything. These frames
  // replace "floating text on a background" with an intentionally composed
  // surface.
  const sectionFrames = buildSectionFrames(zones, theme, format);
  if (sectionFrames.trim()) layers += `\n  <g class="sections" aria-hidden="true">\n    ${sectionFrames}\n  </g>`;

  // ── Component backplates (per-zone visual blocks) ───────────────────────────
  // Turns each populated zone into a real component — checklist items get
  // checkmark badges, step blocks get numbered circles, tip cards get
  // accent rails, quote boxes get large quote glyphs, and generic content
  // cards get a surface-tinted rounded rect. Renders above section frames
  // and below decorations + text so it reads as the component surface
  // that holds the type.
  if (content._components && content._components.length > 0) {
    const backplates = renderComponentBackplates(content._components, zones, theme, width, height);
    if (backplates.trim()) layers += `\n  <g class="components" aria-hidden="true">\n    ${backplates}\n  </g>`;
  }

  // ── Decorations (below text) ─────────────────────────────────────────────────
  if (cleanDecor.trim()) layers += `\n  <g class="decor" aria-hidden="true">\n    ${cleanDecor}\n  </g>`;

  // ── Text zones ───────────────────────────────────────────────────────────────
  const zoneMap = new Map(zones.map(z => [z.id, z]));
  const typo    = theme.typography;
  const hasImg  = zones.some(z => z.id === "image");

  for (const tc of content.textContents) {
    if (!tc.text?.trim()) continue;
    const zone = zoneMap.get(tc.zoneId as ZoneId);
    if (!zone) continue;

    // CTA button
    if (tc.zoneId === "cta" && content.ctaStyle) {
      layers += "\n  " + renderCtaZone(zone, tc, content.ctaStyle, theme, width, height);
      continue;
    }
    // Badge pill
    if (tc.zoneId === "badge") {
      layers += "\n  " + renderBadgeZone(zone, tc, theme, width, height);
      continue;
    }
    // Eyebrow label (with left accent bar)
    if (tc.zoneId === "eyebrow") {
      layers += "\n  " + renderEyebrowZone(zone, tc, theme, width, height);
      continue;
    }

    // Standard text zone
    const zt  = resolveZoneTypo(tc.zoneId as ZoneId, typo, theme);
    // Compute the effective line-height multiplier so measurement and render
    // share the same leading — otherwise text measured at 1.25 but rendered
    // at 1.55 can overflow the zone.
    const effectiveLhMult = refinedLineHeight(tc.fontSize, tc.zoneId, zt?.lineHeightMultiplier) / tc.fontSize;
    const inset = computeTextInset(zone, tc.zoneId, width, height);
    const m   = measureTextInZone(tc.text, tc.fontSize, tc.fontFamily, tc.weight, zone, width, height, effectiveLhMult, inset);
    const yp  = getSvgLineYPositions(m);
    const fs  = getFontStack(tc.fontFamily);
    const ws  = tc.weight >= 700 ? "bold" : tc.weight >= 600 ? "600" : "normal";
    const lsVal = tc.letterSpacing ?? zt?.letterSpacing;
    const ls  = lsVal ? ` letter-spacing="${(lsVal * m.fontSize).toFixed(2)}"` : "";
    const tt  = tc.textTransform ?? zt?.textTransform;
    const pl  = (l: string) => tt === "uppercase" ? l.toUpperCase() : l;
    // Text shadow only on headline when sitting over image
    const fa  = (tc.zoneId === "headline" && hasImg && (content.overlayOpacity ?? 0) > 0.1) ? ` filter="url(#txt_sh)"` : "";
    // Zone-aware line height — editorial rhythm varies by zone purpose.
    // Uses the POST-measurement fontSize so shrunken text still reads well.
    const lh  = refinedLineHeight(m.fontSize, tc.zoneId, zt?.lineHeightMultiplier);
    const tspans = m.lines.map((l,i) =>
      `<tspan x="${f(m.textAnchorX)}" dy="${i===0 ? "0" : f(lh)}">${escSvg(pl(l))}</tspan>`
    );
    layers += `\n  <text font-size="${m.fontSize}" font-weight="${ws}" fill="${tc.color}" font-family="${escAttr(fs)}" text-anchor="${m.svgTextAnchor}"${ls}${fa} dominant-baseline="text-before-edge" y="${f(yp[0])}">${tspans.join("")}</text>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    ${allDefs}
  </defs>
  ${layers}
</svg>`;
}

// ── CTA Button Zone ────────────────────────────────────────────────────────────
function renderCtaZone(
  zone: Zone, tc: SvgContent["textContents"][number],
  cs: NonNullable<SvgContent["ctaStyle"]>,
  theme: DesignTheme, width: number, height: number
): string {
  const px = (p: number, t: number) => (p / 100) * t;
  const zX=px(zone.x,width), zY=px(zone.y,height), zW=px(zone.width,width), zH=px(zone.height,height);
  const fs = tc.fontSize;
  const tw = measureLineWidth(tc.text, fs, tc.fontFamily, tc.weight);
  // Button width: text + padding, capped at zone width
  const bW = Math.min(zW, Math.max(tw + cs.paddingH * 2, 120));
  const bH = Math.min(zH, fs + cs.paddingV * 2);
  const bX = zone.alignH === "center" ? zX + (zW - bW) / 2
           : zone.alignH === "right"  ? zX + zW - bW
           : zX;
  const bY = zY + (zH - bH) / 2;
  const tX = bX + bW / 2;
  // Vertically centre text inside button (cap-height model)
  const tY = bY + bH * 0.63;
  const stk = getFontStack(tc.fontFamily);
  const cty = theme.typography.cta;
  const tt  = tc.textTransform ?? cty.textTransform;
  const d   = tt === "uppercase" ? tc.text.toUpperCase() : tc.text;
  const fi  = cs.shadow ? ` filter="url(#cta_sh)"` : "";
  const lsVal = tc.letterSpacing ?? cty.letterSpacing;
  const ls  = lsVal ? ` letter-spacing="${(lsVal * fs).toFixed(2)}"` : ` letter-spacing="${(0.06*fs).toFixed(2)}"`;
  return `<rect x="${f(bX)}" y="${f(bY)}" width="${f(bW)}" height="${f(bH)}" fill="${cs.backgroundColor}" rx="${cs.borderRadius}"${fi}/>`
    + `<text x="${f(tX)}" y="${f(tY)}" font-size="${fs}" font-weight="${tc.weight}" fill="${cs.textColor}" font-family="${escAttr(stk)}" text-anchor="middle"${ls}>${escSvg(d)}</text>`;
}

// ── Badge Pill Zone ────────────────────────────────────────────────────────────
function renderBadgeZone(
  zone: Zone, tc: SvgContent["textContents"][number],
  theme: DesignTheme, width: number, height: number
): string {
  const px = (p: number, t: number) => (p / 100) * t;
  const zX=px(zone.x,width), zY=px(zone.y,height), zW=px(zone.width,width), zH=px(zone.height,height);
  const fs  = tc.fontSize;
  const d   = tc.text.toUpperCase();
  const tw  = measureLineWidth(d, fs, tc.fontFamily, tc.weight);
  const bW  = Math.min(zW, tw + 28);
  const bH  = Math.min(zH, fs + 14);
  const bX  = zone.alignH === "center" ? zX + (zW - bW) / 2 : zX;
  const bY  = zY + (zH - bH) / 2;
  const rx  = bH / 2;
  const tX  = bX + bW / 2;
  const tY  = bY + bH * 0.65;
  const stk = getFontStack(tc.fontFamily);
  const pri = theme.palette.primary;
  // Semi-transparent pill background in primary colour
  const bg  = pri.startsWith("#") && pri.length === 7 ? pri + "22" : pri;
  return `<rect x="${f(bX)}" y="${f(bY)}" width="${f(bW)}" height="${f(bH)}" fill="${bg}" stroke="${pri}" stroke-width="1.5" rx="${f(rx)}"/>`
    + `<text x="${f(tX)}" y="${f(tY)}" font-size="${fs}" font-weight="${tc.weight}" fill="${tc.color}" font-family="${escAttr(stk)}" text-anchor="middle" letter-spacing="${(0.14*fs).toFixed(2)}">${escSvg(d)}</text>`;
}

// ── Eyebrow Label Zone (with leading accent bar) ───────────────────────────────
function renderEyebrowZone(
  zone: Zone, tc: SvgContent["textContents"][number],
  theme: DesignTheme, width: number, height: number
): string {
  const px = (p: number, t: number) => (p / 100) * t;
  const zX=px(zone.x,width), zY=px(zone.y,height), zW=px(zone.width,width), zH=px(zone.height,height);
  const fs  = tc.fontSize;
  const d   = tc.text.toUpperCase();
  const isCentered = zone.alignH === "center";
  const tX  = isCentered ? zX + zW / 2 : zX;
  const tY  = zY + zH * 0.7;
  const an  = isCentered ? "middle" : "start";
  const stk = getFontStack(tc.fontFamily);
  const ls  = (0.22 * fs).toFixed(2);
  const pri = theme.palette.highlight ?? theme.palette.primary;

  // Left accent bar (only for left-aligned eyebrows — editorial convention)
  let accentBar = "";
  if (!isCentered) {
    const barH = fs * 1.1, barW = Math.max(3, fs * 0.15);
    const barY = tY - fs * 0.85;
    accentBar = `<rect x="${f(zX)}" y="${f(barY)}" width="${f(barW)}" height="${f(barH)}" fill="${pri}" rx="1"/>`;
    // Shift text right past the bar
    const shifted = zX + barW + fs * 0.5;
    return accentBar + `<text x="${f(shifted)}" y="${f(tY)}" font-size="${fs}" font-weight="${tc.weight}" fill="${tc.color}" font-family="${escAttr(stk)}" text-anchor="start" letter-spacing="${ls}">${escSvg(d)}</text>`;
  }

  return accentBar + `<text x="${f(tX)}" y="${f(tY)}" font-size="${fs}" font-weight="${tc.weight}" fill="${tc.color}" font-family="${escAttr(stk)}" text-anchor="${an}" letter-spacing="${ls}">${escSvg(d)}</text>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveZoneTypo(zoneId: ZoneId, typo: ThemeTypography, theme: DesignTheme): ZoneTypography | null {
  const m: Partial<Record<string, ZoneTypography>> = {
    headline: typo.headline, subhead: typo.subhead, body: typo.body_text,
    tagline:  typo.subhead,  eyebrow: typo.eyebrow, cta: typo.cta, badge: typo.badge,
    name:     { ...typo.headline, fontWeight: Math.min(typo.headline.fontWeight, 700) },
    title:    typo.subhead, company: typo.body_text,
    contact:  { ...typo.body_text, fontWeight: 400 },
    section_header: typo.eyebrow,
    bullet_1: typo.body_text, bullet_2: typo.body_text, bullet_3: typo.body_text,
    price:    { ...typo.headline, color: theme.palette.highlight },
    legal:    { ...typo.body_text, fontWeight: 300 },
  };
  const base = m[zoneId];
  if (!base) return null;

  // Apply category personality's zone-specific dials (bullet/contact/legal).
  // body_text already picked up the personality.body dials inside
  // applyCategoryPackOverrides, so these here override *further* for zones
  // that fall through to body_text but want a distinct expression.
  const personality = (theme as DesignTheme & { _typographyPersonality?: import("../style/category-typography-personality").TypographyPersonality })._typographyPersonality;
  if (!personality) return base;

  let role: RolePersonality | undefined;
  if (zoneId === "bullet_1" || zoneId === "bullet_2" || zoneId === "bullet_3") role = personality.bullet;
  else if (zoneId === "contact") role = personality.contact;
  else if (zoneId === "legal")   role = personality.legal;
  if (!role) return base;

  return {
    ...base,
    ...(role.fontWeight    !== undefined ? { fontWeight:           role.fontWeight    } : {}),
    ...(role.letterSpacing !== undefined ? { letterSpacing:        role.letterSpacing } : {}),
    ...(role.lineHeightMultiplier !== undefined ? { lineHeightMultiplier: role.lineHeightMultiplier } : {}),
    ...(role.textTransform !== undefined ? { textTransform:        role.textTransform } : {}),
  };
}

function extractBgFromTheme(theme: DesignTheme): {primaryBgColor: string; gradient: SvgContent["backgroundGradient"]} {
  const bg = theme.background;
  switch (bg.kind) {
    case "solid":           return { primaryBgColor:bg.color,     gradient:{ type:"none",   colors:[bg.color] } };
    case "linear_gradient": return { primaryBgColor:bg.colors[0], gradient:{ type:"linear", colors:bg.colors, angle:bg.angle } };
    case "radial_gradient": return { primaryBgColor:bg.colors[0], gradient:{ type:"radial", colors:bg.colors } };
    default:                return { primaryBgColor:bg.colors[0], gradient:{ type:"linear", colors:bg.colors, angle:145 } };
  }
}

// Keep legacy name for pipeline compatibility
function extractBgForPipeline(theme: DesignTheme) { return extractBgFromTheme(theme); }

function buildFallbackTextContent(zones: Zone[], brief: BriefAnalysis) {
  const map: Record<string, string> = {
    headline: brief.headline,
    subhead:  brief.subhead ?? brief.audience ?? "",
    body:     brief.body ?? "",
    cta:      brief.cta ?? "Learn More",
    badge:    brief.badge ?? "",
    tagline:  brief.tagline ?? brief.keywords?.[0] ?? "",
    eyebrow:  brief.keywords?.[0] ?? "",
    name:     (brief as any).name ?? "",
    title:    (brief as any).title ?? "",
    company:  (brief as any).company ?? "",
    contact:  (brief as any).contact ?? "",
    bullet_1: brief.keywords?.[0] ?? "",
    bullet_2: brief.keywords?.[1] ?? "",
    bullet_3: brief.keywords?.[2] ?? "",
  };
  return {
    textContents: zones
      .filter(z => !["background","image","accent"].includes(z.id))
      .filter(z => map[z.id])
      .map(z => ({ zoneId:z.id, text:map[z.id] })),
    themeOverride: "auto" as const,
  };
}

function renderBasicFallback(zones: Zone[], content: SvgContent, width: number, height: number): string {
  let els = `<rect width="${width}" height="${height}" fill="${content.backgroundColor ?? '#f8f7f4'}"/>`;
  for (const tc of content.textContents) {
    const zone = zones.find(z => z.id === tc.zoneId);
    if (!zone || !tc.text?.trim()) continue;
    const x = ((zone.x + zone.width / 2) / 100) * width;
    const y = ((zone.y + zone.height / 2) / 100) * height;
    els += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${tc.fontSize}" fill="${tc.color}" text-anchor="middle">${escSvg(tc.text)}</text>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${els}</svg>`;
}

function f(n: number): string { return n.toFixed(1); }
function escSvg(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function escAttr(s: string): string { return s.replace(/"/g,"&quot;"); }
