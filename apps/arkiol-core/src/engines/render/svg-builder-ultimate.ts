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
import { renderDecorations, buildBackgroundDefs, renderMeshOverlay } from "./svg-decorations";
import { pickBestTheme, scoreCandidateQuality, scoreThemeQuality, recordOutputFingerprint, isRecentDuplicate, isBlandCandidate } from "../evaluation/candidate-quality";
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
  textContents: Array<{ zoneId: string; text: string; fontSize: number; weight: number; color: string; fontFamily: string; }>;
  ctaStyle?: { backgroundColor: string; textColor: string; borderRadius: number; paddingH: number; paddingV: number; shadow?: boolean; };
  overlayOpacity?: number;
  overlayColor?: string;
  accentShape?: { type: "rect" | "circle" | "line" | "none"; color: string; x: number; y: number; w: number; h: number; opacity?: number; borderRadius?: number; };
  _selectedTheme?: DesignTheme;
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

function targetFontSize(zone: Zone, zoneId: ZoneId, canvasH: number, hMult: number, hint?: FontSizeHint): number {
  const zH = (zone.height / 100) * canvasH;
  let fill = 0.55;

  if (["headline","name"].includes(zoneId)) {
    fill = 0.70;
    if (hint) {
      if (hint.charCount <= 20)      fill = 0.85;
      else if (hint.charCount <= 35) fill = 0.75;
      else if (hint.charCount > 50)  fill = 0.58;
      if (hint.hierarchyBias === "headline") fill = Math.min(0.95, fill + 0.08);
    }
  } else if (["subhead","tagline","price"].includes(zoneId)) {
    fill = 0.62;
    if (hint?.hierarchyBias === "detail") fill = 0.55;
  } else if (["cta","badge","eyebrow","section_header"].includes(zoneId)) {
    fill = 0.52;
    if (hint && zoneId === "cta" && hint.urgency > 0.7) fill = 0.60;
  } else if (["body","body_text","contact","legal"].includes(zoneId)) {
    fill = 0.45;
    if (hint && hint.charCount > 300) fill = 0.40;
  }

  let fs = Math.round(zH * fill);
  if (["headline","name","price"].includes(zoneId)) fs = Math.round(fs * hMult);

  const lo = zone.minFontSize ?? 10;
  const hi = zone.maxFontSize ?? 200;
  return Math.min(hi, Math.max(lo, fs));
}

export async function buildUltimateSvgContent(
  zones: Zone[], brief: BriefAnalysis, format: string,
  brand?: { primaryColor: string; secondaryColor: string; fontDisplay: string },
  variationIdx = 0,
  themePreferences?: string[],
  personalization?: PersonalizationContext,
): Promise<BuildResult> {
  const violations: string[] = [];
  const dims   = FORMAT_DIMS[format] ?? { width: 1080, height: 1080 };

  // ── Multi-candidate theme selection ──────────────────────────────────────
  // Generate 4 candidate themes and pick the richest, most unique one.
  // This prevents bland/gradient-heavy outputs by evaluating quality before
  // committing to a theme.
  const THEME_CANDIDATES = 4;
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

  // If the winner is a recent duplicate, try harder with offset seeds
  if (isRecentDuplicate(theme)) {
    const extraOffset = Date.now() % 10000;
    let retry = selectTheme(brief, variationIdx + extraOffset);
    if (brand) retry = applyBrandColors(retry, { primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor });
    if (categoryPack) retry = applyCategoryPackOverrides(retry, categoryPack, brand);
    if (!isBlandCandidate(retry)) theme = retry;
  }

  // ── Style intelligence — adapt palette, typography, mood to brief intent
  const styleIntent = analyzeStyleIntent(brief, categoryPack?.id);
  const styleDirective = deriveStyleDirective(styleIntent, categoryPack, brand ? { primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor } : undefined);
  theme = applyStyleDirective(theme, styleDirective, !!brand);

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

  // Record after style application so fingerprint reflects actual output
  recordOutputFingerprint(theme);

  // ── Cache lookup — keyed on theme + brief + pack so style variety is preserved
  const packSuffix = categoryPack ? ':' + categoryPack.id : '';
  const cacheKey = buildCacheKey(brief, format, brand?.primaryColor, variationIdx) + ':' + theme.id + packSuffix;
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

  let raw: unknown;
  try {
    raw = await withRetry(
      () => chatJSON(
        [{role:"system",content:systemPrompt},{role:"user",content:"Generate text content as JSON."}],
        {model:"gpt-4o",temperature:0.7,max_tokens:800}
      ),
      {maxAttempts:3}
    );
  } catch (e: any) {
    violations.push("AI failed: " + e.message);
    raw = buildFallbackTextContent(zones, brief);
  }

  const parsed  = TextOnlySchema.safeParse(raw);
  if (!parsed.success) violations.push("Schema validation failed");
  const aiText  = parsed.success ? parsed.data : buildFallbackTextContent(zones, brief) as any;

  if (aiText.themeOverride && aiText.themeOverride !== "auto") {
    const ov = THEMES.find(t => t.id === aiText.themeOverride);
    if (ov) {
      let overridden = brand ? applyBrandColors(ov,{primaryColor:brand.primaryColor,secondaryColor:brand.secondaryColor}) : ov;
      if (categoryPack) overridden = applyCategoryPackOverrides(overridden, categoryPack, brand);
      theme = overridden;
    }
  }

  const textMap   = new Map(aiText.textContents.map((tc: any) => [tc.zoneId, tc.text]));
  const typo      = theme.typography;
  const hMult     = theme.headlineSizeMultiplier ?? 1.0;

  const _headlineLen = (brief.headline ?? "").length;
  const _briefUrgency = brief.tone === "urgent" ? 1 : brief.tone === "energetic" ? 0.72 : brief.cta ? 0.46 : 0.2;
  const _briefKeywords = (brief.keywords ?? []).filter((k: string) => k.length > 3);
  let _briefHierarchy: FontSizeHint["hierarchyBias"] = "balanced";
  if (_headlineLen > 0 && _headlineLen <= 28 && _briefKeywords.length >= 2) _briefHierarchy = "headline";
  else if ((brief.body ?? "").length > 240 || (brief.subhead ?? "").length > 110) _briefHierarchy = "detail";
  else if (brief.cta && ((brief.cta ?? "").length <= 16 || _briefUrgency > 0.7)) _briefHierarchy = "cta";

  const textContents = zones
    .filter(z => !["background","image","accent"].includes(z.id))
    .flatMap(zone => {
      const text = textMap.get(zone.id) as string | undefined;
      if (!text?.trim()) return [];
      const zt = resolveZoneTypo(zone.id as ZoneId, typo, theme);
      if (!zt) return [];
      const hint: FontSizeHint = { charCount: text.trim().length, urgency: _briefUrgency, hierarchyBias: _briefHierarchy };
      const fontSize = targetFontSize(zone, zone.id as ZoneId, dims.height, hMult, hint);
      return [{ zoneId:zone.id, text:text.trim(), fontSize, weight:zt.fontWeight, color:zt.color, fontFamily:zt.fontFamily as string }];
    });

  const {primaryBgColor, gradient} = extractBgFromTheme(theme);

  // Apply category CTA radius bias
  let ctaBorderRadius = theme.ctaStyle.borderRadius;
  if (categoryPack) {
    if (categoryPack.ctaRadiusBias === "pill")    ctaBorderRadius = 50;
    else if (categoryPack.ctaRadiusBias === "sharp") ctaBorderRadius = Math.min(ctaBorderRadius, 4);
    else if (categoryPack.ctaRadiusBias === "rounded") ctaBorderRadius = Math.max(8, Math.min(ctaBorderRadius, 16));
  }

  const content: SvgContent = {
    backgroundColor:primaryBgColor, backgroundGradient:gradient, textContents,
    ctaStyle:{ backgroundColor:theme.ctaStyle.backgroundColor, textColor:theme.ctaStyle.textColor,
      borderRadius:ctaBorderRadius, paddingH:theme.ctaStyle.paddingH,
      paddingV:theme.ctaStyle.paddingV, shadow:theme.ctaStyle.shadow ?? false },
    overlayOpacity:theme.overlayOpacity ?? 0, overlayColor:theme.overlayColor ?? "#000000",
    accentShape:{ type:"none", color:"#000000", x:0, y:0, w:0, h:0 },
    _selectedTheme:theme,
  };

  // ── Post-build quality evaluation ──────────────────────────────────────
  const qualityScore = scoreCandidateQuality(theme, content);
  if (qualityScore.total < 0.35) {
    violations.push(`quality:low_score(${qualityScore.total.toFixed(2)}) — template may appear bland`);
  }
  if (qualityScore.contentCompleteness < 0.45) {
    violations.push(`quality:sparse_content(${qualityScore.contentCompleteness.toFixed(2)}) — few text zones populated`);
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

  // Determine headline font: prefer pack's display fonts if they match the theme's available set
  const headlineFont = resolvePackFont(pack.preferredDisplayFonts, theme.typography.display, brand?.fontDisplay);
  const bodyFont = resolvePackFont(pack.preferredBodyFonts, theme.typography.body);

  // Build overridden typography
  const headline = {
    ...theme.typography.headline,
    fontFamily: headlineFont,
    fontSizeMultiplier: boostedHMult,
    letterSpacing: pack.headlineLetterSpacing,
    ...(pack.preferUppercase ? { textTransform: "uppercase" as const } : {}),
  };

  const subhead = {
    ...theme.typography.subhead,
    fontFamily: bodyFont !== theme.typography.body ? bodyFont : theme.typography.subhead.fontFamily,
  };

  const body_text = {
    ...theme.typography.body_text,
    fontFamily: bodyFont,
  };

  return {
    ...theme,
    headlineSizeMultiplier: boostedHMult,
    typography: {
      ...theme.typography,
      display: headlineFont,
      body: bodyFont,
      headline,
      subhead,
      body_text,
    },
  };
}

/** Pick the best font from the pack's preferences, falling back to the theme's default */
function resolvePackFont(
  preferred: ThemeFont[],
  themeDefault: ThemeFont,
  brandFont?: string,
): ThemeFont {
  // Brand font always wins if specified
  if (brandFont) return themeDefault;
  // Use the first preferred font — all ThemeFont values are registered in the font registry
  return preferred.length > 0 ? preferred[0] : themeDefault;
}

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
    const m   = measureTextInZone(tc.text, tc.fontSize, tc.fontFamily, tc.weight, zone, width, height);
    const yp  = getSvgLineYPositions(m);
    const fs  = getFontStack(tc.fontFamily);
    const ws  = tc.weight >= 700 ? "bold" : tc.weight >= 600 ? "600" : "normal";
    const zt  = resolveZoneTypo(tc.zoneId as ZoneId, typo, theme);
    const ls  = zt?.letterSpacing ? ` letter-spacing="${(zt.letterSpacing * m.fontSize).toFixed(2)}"` : "";
    const pl  = (l: string) => zt?.textTransform === "uppercase" ? l.toUpperCase() : l;
    // Text shadow only on headline when sitting over image
    const fa  = (tc.zoneId === "headline" && hasImg && (content.overlayOpacity ?? 0) > 0.1) ? ` filter="url(#txt_sh)"` : "";
    // Tighter line-height for large display text (Canva convention)
    const lh  = m.fontSize >= 72 ? m.fontSize * 1.08 : m.fontSize >= 48 ? m.fontSize * 1.14 : m.fontSize * 1.22;
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
  const d   = cty.textTransform === "uppercase" ? tc.text.toUpperCase() : tc.text;
  const fi  = cs.shadow ? ` filter="url(#cta_sh)"` : "";
  const ls  = cty.letterSpacing ? ` letter-spacing="${(cty.letterSpacing * fs).toFixed(2)}"` : ` letter-spacing="${(0.06*fs).toFixed(2)}"`;
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
  return m[zoneId] ?? null;
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
