import { BriefAnalysis } from "../ai/brief-analyzer";
import { DesignTheme, THEMES, applyBrandColors, selectTheme } from "./design-themes";
import { detectCategoryPack } from "./category-style-packs";
import { scoreThemeQuality, isBlandCandidate } from "./candidate-quality";

export type LayoutDensity = "airy" | "balanced" | "compact";
export type CompositionStyle = "editorial" | "hero" | "split" | "stacked" | "poster" | "minimal";
export type LayoutRegion = "header" | "hero" | "support" | "body" | "cta" | "footer" | "media";

export interface SafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GridSystem {
  columns: number;
  gutter: number;
  margin: number;
  baseline: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutElement {
  id: string;
  region: LayoutRegion;
  priority: number;
  rect: LayoutRect;
  align: "left" | "center" | "right";
  emphasis?: number;
  maxLines?: number;
  contentLength?: number;
}

export interface ContentSignals {
  headlineLength: number;
  subheadLength: number;
  bodyLength: number;
  ctaLength: number;
  keywordDensity: number;
  emphasisWords: string[];
  hierarchyBias: "headline" | "balanced" | "detail" | "cta";
  urgency: number;
}

export interface VisualTasteProfile {
  paletteMode: "brand-led" | "theme-led" | "hybrid";
  typographyMode: "display-heavy" | "balanced" | "readability-first";
  spacingDensity: LayoutDensity;
  compositionStyle: CompositionStyle;
  contrastBias: number;
  noveltyBias: number;
}

export interface InspirationPattern {
  id: string;
  name: string;
  composition: CompositionStyle;
  spacingDensity: LayoutDensity;
  signature: string[];
  suitability: Array<BriefAnalysis["tone"] | BriefAnalysis["colorMood"]>;
}

export interface LayoutCandidateScore {
  balance: number;
  contrast: number;
  readability: number;
  whitespace: number;
  hierarchyClarity: number;
  novelty: number;
  brandAlignment: number;
  visualRichness: number;
  decorationDiversity: number;
  total: number;
}

export interface LayoutCandidate {
  id: string;
  theme: DesignTheme;
  grid: GridSystem;
  safeZone: SafeZone;
  style: VisualTasteProfile;
  pattern: InspirationPattern;
  elements: LayoutElement[];
  score: LayoutCandidateScore;
  notes: string[];
}

export interface LayoutEngineOptions {
  brief: BriefAnalysis;
  brand?: { primaryColor: string; secondaryColor: string };
  category?: string;
  prompt?: string;
  candidateCount?: number;
  variationSeed?: number;
}

const INSPIRATION_LIBRARY: InspirationPattern[] = [
  {
    id: "editorial-frame",
    name: "Editorial Frame",
    composition: "editorial",
    spacingDensity: "airy",
    signature: ["dominant headline", "framing accents", "disciplined margins", "quiet CTA"],
    suitability: ["professional", "luxury", "minimal", "muted", "light"],
  },
  {
    id: "hero-conversion",
    name: "Hero Conversion",
    composition: "hero",
    spacingDensity: "balanced",
    signature: ["oversized headline", "clear CTA lane", "support copy rail", "high contrast button"],
    suitability: ["bold", "energetic", "urgent", "vibrant", "warm"],
  },
  {
    id: "split-story",
    name: "Split Story",
    composition: "split",
    spacingDensity: "balanced",
    signature: ["text-media split", "anchored CTA", "asymmetric massing", "modular support zones"],
    suitability: ["professional", "playful", "cool", "dark"],
  },
  {
    id: "poster-punch",
    name: "Poster Punch",
    composition: "poster",
    spacingDensity: "compact",
    signature: ["stacked hierarchy", "big focal word", "compressed spacing", "expressive accents"],
    suitability: ["bold", "energetic", "urgent", "vibrant"],
  },
  {
    id: "minimal-stack",
    name: "Minimal Stack",
    composition: "stacked",
    spacingDensity: "airy",
    signature: ["single reading path", "measured gaps", "delicate support text", "restrained decoration"],
    suitability: ["minimal", "warm", "light", "monochrome"],
  },
];

export function generateIntelligentLayouts(options: LayoutEngineOptions): LayoutCandidate[] {
  const candidateCount = Math.max(3, Math.min(options.candidateCount ?? 8, 12));
  const content = analyzeContentSignals(options.brief, options.prompt);
  const taste = deriveVisualTaste(options.brief, options.category, options.brand, content);

  const rawCandidates = Array.from({ length: candidateCount }, (_, index) => {
    const pattern = pickInspirationPattern(options.brief, taste, index);
    const theme = selectSmartTheme(options.brief, taste, pattern, index, options.brand);
    const grid = buildGrid(pattern, taste, content, index);
    const safeZone = deriveSafeZone(pattern, taste, content);
    const elements = composeElements(options.brief, grid, safeZone, pattern, taste, content, index);
    const refined = refineCandidate(elements, grid, safeZone, theme, content, taste);
    const score = scoreCandidate(refined, theme, content, taste, options.brand);

    return {
      id: `candidate_${index + 1}`,
      theme,
      grid,
      safeZone,
      style: taste,
      pattern,
      elements: refined,
      score,
      notes: buildCandidateNotes(pattern, taste, content, score),
    } satisfies LayoutCandidate;
  });

  // Filter out bland candidates — if a theme scores poorly on visual richness,
  // demote it so richer candidates surface first.
  const scored = rawCandidates.sort((a, b) => b.score.total - a.score.total);

  // If the top candidate is bland and we have non-bland alternatives, swap
  if (scored.length > 1 && isBlandCandidate(scored[0].theme)) {
    const firstRich = scored.find(c => !isBlandCandidate(c.theme));
    if (firstRich) {
      const richIdx = scored.indexOf(firstRich);
      [scored[0], scored[richIdx]] = [scored[richIdx], scored[0]];
    }
  }

  return scored;
}

export function pickBestLayout(options: LayoutEngineOptions): LayoutCandidate {
  return generateIntelligentLayouts(options)[0];
}

function analyzeContentSignals(brief: BriefAnalysis, prompt?: string): ContentSignals {
  const headlineLength = (brief.headline ?? "").trim().length;
  const subheadLength = (brief.subhead ?? "").trim().length;
  const bodyLength = (brief.body ?? "").trim().length;
  const ctaLength = (brief.cta ?? "").trim().length;
  const allKeywords = [...(brief.keywords ?? []), ...extractPromptKeywords(prompt ?? "")].filter(Boolean);
  const emphasisWords = allKeywords
    .filter(word => word.length > 3)
    .slice(0, 4)
    .sort((a, b) => b.length - a.length);

  const keywordDensity = Math.min(1, allKeywords.length / 8);
  const urgency = brief.tone === "urgent" ? 1 : brief.tone === "energetic" ? 0.72 : ctaLength > 0 ? 0.46 : 0.2;

  let hierarchyBias: ContentSignals["hierarchyBias"] = "balanced";
  if (headlineLength <= 28 && emphasisWords.length >= 2) hierarchyBias = "headline";
  else if (bodyLength > 240 || subheadLength > 110) hierarchyBias = "detail";
  else if (ctaLength > 0 && (ctaLength <= 16 || urgency > 0.7)) hierarchyBias = "cta";

  return {
    headlineLength,
    subheadLength,
    bodyLength,
    ctaLength,
    keywordDensity,
    emphasisWords,
    hierarchyBias,
    urgency,
  };
}

function deriveVisualTaste(
  brief: BriefAnalysis,
  category: string | undefined,
  brand: LayoutEngineOptions["brand"],
  content: ContentSignals
): VisualTasteProfile {
  const categoryText = `${category ?? ""} ${brief.intent ?? ""}`.toLowerCase();
  const paletteMode = brand ? "hybrid" : "theme-led";
  const typographyMode = content.bodyLength > 260 ? "readability-first" : content.hierarchyBias === "headline" ? "display-heavy" : "balanced";

  // Detect category style pack for composition and spacing preferences
  const pack = detectCategoryPack(brief);

  // Spacing density: category pack preference > content-based heuristic
  let spacingDensity: LayoutDensity;
  if (pack) {
    spacingDensity = pack.spacingDensity;
  } else if (content.hierarchyBias === "headline" && content.headlineLength <= 20) {
    spacingDensity = "airy";
  } else if (content.hierarchyBias === "detail" || content.bodyLength > 320) {
    spacingDensity = "compact";
  } else {
    spacingDensity = content.headlineLength < 24 && brief.tone !== "urgent" ? "airy" : "balanced";
  }

  // Composition style: category pack preference > keyword-based heuristic
  let compositionStyle: CompositionStyle;
  if (pack) {
    compositionStyle = pack.compositionBias;
  } else if (/luxury|fashion|editorial|magazine/.test(categoryText)) {
    compositionStyle = "editorial";
  } else if (/tech|saas|product|app|launch/.test(categoryText)) {
    compositionStyle = "split";
  } else if (/sale|promo|offer|fitness|energy/.test(categoryText) || content.urgency > 0.7) {
    compositionStyle = "hero";
  } else if (content.hierarchyBias === "headline") {
    compositionStyle = "poster";
  } else if (content.hierarchyBias === "cta") {
    compositionStyle = "hero";
  } else if (content.hierarchyBias === "detail") {
    compositionStyle = "editorial";
  } else if (brief.tone === "minimal") {
    compositionStyle = "minimal";
  } else {
    compositionStyle = "stacked";
  }

  const contrastBias = brief.tone === "luxury" ? 0.7 : brief.tone === "urgent" ? 0.95 : 0.82;
  const noveltyBias = brief.tone === "playful" || brief.colorMood === "vibrant" ? 0.78 : 0.48;

  return {
    paletteMode,
    typographyMode,
    spacingDensity,
    compositionStyle,
    contrastBias,
    noveltyBias,
  };
}

function pickInspirationPattern(brief: BriefAnalysis, taste: VisualTasteProfile, variationIdx: number): InspirationPattern {
  const ranked = INSPIRATION_LIBRARY
    .map(pattern => {
      let score = 0;
      if (pattern.composition === taste.compositionStyle) score += 4;
      if (pattern.spacingDensity === taste.spacingDensity) score += 2;
      if (pattern.suitability.includes(brief.tone)) score += 2;
      if (pattern.suitability.includes(brief.colorMood)) score += 1;
      score += Math.max(0, variationIdx % 3 - 1);
      return { pattern, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[Math.min(variationIdx, ranked.length - 1)].pattern;
}

function selectSmartTheme(
  brief: BriefAnalysis,
  _taste: VisualTasteProfile,
  _pattern: InspirationPattern,
  variationIdx: number,
  brand?: { primaryColor: string; secondaryColor: string }
): DesignTheme {
  // Delegate to the centralized selectTheme() which uses weighted random
  // selection with anti-repetition tracking and category-aware boosting.
  // This replaces the old deterministic ranking that always produced the
  // same themes for the same brief, causing visual repetition.
  const selected = selectTheme(brief, variationIdx);
  return applyBrandColors(selected, brand);
}

function buildGrid(pattern: InspirationPattern, taste: VisualTasteProfile, content: ContentSignals, variationIdx: number): GridSystem {
  const columns = pattern.composition === "split" ? 12 : pattern.composition === "editorial" ? 8 : 6;
  const baseline = taste.spacingDensity === "compact" ? 8 : taste.spacingDensity === "airy" ? 16 : 12;
  const gutter = pattern.composition === "poster" ? 18 : 24;
  const margin = content.headlineLength > 50 ? 72 : variationIdx % 2 === 0 ? 80 : 64;
  return { columns, gutter, margin, baseline };
}

function deriveSafeZone(pattern: InspirationPattern, taste: VisualTasteProfile, content: ContentSignals): SafeZone {
  const inset = taste.spacingDensity === "compact" ? 6 : taste.spacingDensity === "airy" ? 10 : 8;
  return {
    top: inset,
    right: inset + (pattern.composition === "split" ? 2 : 0),
    bottom: inset + (content.ctaLength > 0 ? 2 : 0),
    left: inset,
  };
}

function composeElements(
  brief: BriefAnalysis,
  grid: GridSystem,
  safeZone: SafeZone,
  pattern: InspirationPattern,
  taste: VisualTasteProfile,
  content: ContentSignals,
  variationIdx: number
): LayoutElement[] {
  const align = pattern.composition === "poster" ? "center" : "left";
  const isSplit = pattern.composition === "split";
  const isEditorial = pattern.composition === "editorial";
  const isPoster = pattern.composition === "poster";
  const contentWidth = isSplit ? 42 : isEditorial ? 58 : isPoster ? 80 : 70;
  const yShift = variationIdx % 2 === 0 ? 0 : 2;
  const ctaBoost = content.hierarchyBias === "cta" ? 1.2 : 1;

  let headlineHeight: number;
  if (content.hierarchyBias === "headline" && content.headlineLength <= 20) {
    headlineHeight = 28;
  } else if (content.headlineLength > 54) {
    headlineHeight = 22;
  } else if (content.headlineLength > 35) {
    headlineHeight = 18;
  } else if (content.headlineLength <= 20) {
    headlineHeight = content.hierarchyBias === "headline" ? 22 : 14;
  } else {
    headlineHeight = 16;
  }

  // Vertical flow cursor — tracks the bottom of the last placed element
  // plus the minimum gap, so elements stack without overlap
  const minGap = taste.spacingDensity === "compact" ? 2 : taste.spacingDensity === "airy" ? 5 : 3;
  let cursorY = safeZone.top + 2 + yShift;

  // Eyebrow / badge zone above headline (if present)
  const elements: LayoutElement[] = [];

  if (brief.badge) {
    elements.push({
      id: "badge",
      region: "header",
      priority: 4,
      rect: { x: safeZone.left, y: cursorY, w: Math.min(30, 8 + (brief.badge.length ?? 0) * 1.2), h: 5 },
      align,
      maxLines: 1,
      contentLength: brief.badge.length ?? 0,
    });
    cursorY += 5 + minGap;
  }

  const headlineAlign = content.hierarchyBias === "headline" ? "center" as const : align;
  const headlineW = content.hierarchyBias === "headline" && !isSplit ? Math.min(88, contentWidth + 12) : contentWidth;
  elements.push({
    id: "headline",
    region: "hero",
    priority: 10,
    rect: { x: safeZone.left, y: cursorY, w: headlineW, h: headlineHeight },
    align: headlineAlign,
    emphasis: content.hierarchyBias === "headline" ? 1.3
      : content.emphasisWords.length >= 3 ? 1.15
      : 1,
    maxLines: content.headlineLength > 42 ? 4 : content.headlineLength > 20 ? 3 : 2,
    contentLength: content.headlineLength,
  });
  cursorY += headlineHeight + minGap;

  // Subhead
  if (brief.subhead) {
    const subH = content.subheadLength > 120 ? 14 : content.subheadLength > 60 ? 10 : 8;
    elements.push({
      id: "subhead",
      region: "support",
      priority: 7,
      rect: { x: safeZone.left, y: cursorY, w: contentWidth + 6, h: subH },
      align,
      maxLines: content.subheadLength > 100 ? 4 : content.subheadLength > 50 ? 3 : 2,
      contentLength: content.subheadLength,
    });
    cursorY += subH + minGap;
  }

  if (brief.body) {
    const isDetailBias = content.hierarchyBias === "detail";
    const bodyH = isDetailBias
      ? (content.bodyLength > 400 ? 28 : content.bodyLength > 260 ? 24 : content.bodyLength > 100 ? 20 : 14)
      : (content.bodyLength > 400 ? 24 : content.bodyLength > 260 ? 20 : content.bodyLength > 100 ? 16 : 10);
    const bodyW = isSplit ? 36 : isEditorial ? 52 : isDetailBias ? 62 : 56;
    elements.push({
      id: "body",
      region: "body",
      priority: 5,
      rect: { x: safeZone.left, y: cursorY, w: bodyW, h: bodyH },
      align,
      maxLines: content.bodyLength > 320 ? 8 : content.bodyLength > 200 ? 6 : 4,
      contentLength: content.bodyLength,
    });
    cursorY += bodyH + minGap;
  }

  if (brief.cta) {
    const isCtaDriven = content.hierarchyBias === "cta";
    const ctaW = isCtaDriven
      ? Math.min(44, 22 + content.ctaLength * 0.8 * ctaBoost)
      : Math.min(38, 18 + content.ctaLength * 0.7 * ctaBoost);
    const ctaH = isCtaDriven ? 10 : 8;
    const ctaY = isCtaDriven
      ? Math.max(cursorY, 100 - safeZone.bottom - 18)
      : Math.max(cursorY, 100 - safeZone.bottom - 14);
    elements.push({
      id: "cta",
      region: "cta",
      priority: isCtaDriven ? 10 : 9,
      rect: { x: safeZone.left, y: ctaY, w: ctaW, h: ctaH },
      align: isPoster || isCtaDriven ? "center" : "left",
      emphasis: isCtaDriven ? Math.max(ctaBoost, 1.3) : ctaBoost,
      maxLines: 1,
      contentLength: content.ctaLength,
    });
    cursorY = ctaY + ctaH + minGap;
  }

  // Media zone for split compositions
  if (isSplit) {
    elements.push({
      id: "media",
      region: "media",
      priority: 6,
      rect: { x: 56, y: safeZone.top, w: 100 - 56 - safeZone.right, h: 100 - safeZone.top - safeZone.bottom },
      align: "center",
    });
  }

  return elements;
}

function refineCandidate(
  elements: LayoutElement[],
  grid: GridSystem,
  safeZone: SafeZone,
  theme: DesignTheme,
  content: ContentSignals,
  taste: VisualTasteProfile
): LayoutElement[] {
  const refined = elements.map(element => ({ ...element, rect: { ...element.rect } }));

  for (const element of refined) {
    const maxRight = 100 - safeZone.right;
    const maxBottom = 100 - safeZone.bottom;
    if (element.rect.x + element.rect.w > maxRight) {
      element.rect.w = Math.max(12, maxRight - element.rect.x);
    }
    if (element.rect.y + element.rect.h > maxBottom) {
      element.rect.h = Math.max(6, maxBottom - element.rect.y);
    }

    if (element.id === "headline" && content.headlineLength > 56) {
      element.rect.w = Math.min(78, element.rect.w + 8);
      element.rect.h += 4;
    }

    if (element.id === "cta" && taste.spacingDensity === "compact") {
      element.rect.y = Math.min(84, element.rect.y + 2);
    }
  }

  const headline = refined.find(el => el.id === "headline");
  const subhead = refined.find(el => el.id === "subhead");
  if (headline && subhead) {
    const gap = subhead.rect.y - (headline.rect.y + headline.rect.h);
    if (gap < grid.baseline / 3) {
      subhead.rect.y = headline.rect.y + headline.rect.h + grid.baseline / 3;
    }
  }

  const body = refined.find(el => el.id === "body");
  const cta = refined.find(el => el.id === "cta");
  if (body && cta) {
    const bodyBottom = body.rect.y + body.rect.h;
    if (cta.rect.y - bodyBottom < grid.baseline / 2) {
      cta.rect.y = bodyBottom + grid.baseline / 2;
    }
  }

  if (theme.overlayOpacity && theme.overlayOpacity > 0.5 && taste.contrastBias > 0.9) {
    const headlineEl = refined.find(el => el.id === "headline");
    if (headlineEl) headlineEl.emphasis = Math.max(1.1, headlineEl.emphasis ?? 1);
  }

  return refined;
}

function scoreCandidate(
  elements: LayoutElement[],
  theme: DesignTheme,
  content: ContentSignals,
  taste: VisualTasteProfile,
  brand?: { primaryColor: string; secondaryColor: string }
): LayoutCandidateScore {
  const occupiedArea = elements.reduce((sum, el) => sum + el.rect.w * el.rect.h, 0);
  const whitespace = clamp(1 - occupiedArea / 7200, 0.18, 0.92);
  const hierarchyClarity = clamp((elements.find(el => el.id === "headline")?.priority ?? 0) / 10 + (content.hierarchyBias === "headline" ? 0.12 : 0), 0.45, 0.98);
  const readability = clamp((taste.typographyMode === "readability-first" ? 0.92 : 0.8) - (content.bodyLength > 300 ? 0.05 : 0) + whitespace * 0.08, 0.42, 0.98);
  const contrast = clamp(taste.contrastBias - ((theme.overlayOpacity ?? 0) > 0.6 ? 0.04 : 0) + 0.03, 0.5, 0.99);
  const balance = clamp(1 - Math.abs(centerOfMass(elements) - 50) / 50, 0.36, 0.99);
  const novelty = clamp(taste.noveltyBias + (taste.compositionStyle === "poster" || taste.compositionStyle === "split" ? 0.1 : 0), 0.3, 0.96);
  const brandAlignment = clamp(brand ? 0.92 : 0.72 + (theme.tones.includes("professional") ? 0.04 : 0), 0.45, 0.98);

  // Visual richness and decoration diversity from quality scoring system
  const themeQuality = scoreThemeQuality(theme);
  const visualRichness = themeQuality.decorationRichness * 0.4 + themeQuality.premiumElements * 0.35 + themeQuality.visualLayering * 0.25;
  const decorationDiversity = themeQuality.decorationDiversity;

  const total =
    balance * 0.14 +
    contrast * 0.14 +
    readability * 0.14 +
    whitespace * 0.10 +
    hierarchyClarity * 0.14 +
    novelty * 0.08 +
    brandAlignment * 0.10 +
    visualRichness * 0.08 +
    decorationDiversity * 0.08;

  return {
    balance,
    contrast,
    readability,
    whitespace,
    hierarchyClarity,
    novelty,
    brandAlignment,
    visualRichness,
    decorationDiversity,
    total,
  };
}

function buildCandidateNotes(
  pattern: InspirationPattern,
  taste: VisualTasteProfile,
  content: ContentSignals,
  score: LayoutCandidateScore
): string[] {
  return [
    `pattern:${pattern.name}`,
    `composition:${taste.compositionStyle}`,
    `spacing:${taste.spacingDensity}`,
    `hierarchy:${content.hierarchyBias}`,
    `score:${score.total.toFixed(3)}`,
  ];
}

function extractPromptKeywords(prompt: string): string[] {
  return prompt
    .split(/[^a-zA-Z0-9]+/)
    .map(token => token.trim().toLowerCase())
    .filter(token => token.length >= 4)
    .slice(0, 8);
}

function centerOfMass(elements: LayoutElement[]): number {
  const totalWeight = elements.reduce((sum, el) => sum + el.priority, 0) || 1;
  const weighted = elements.reduce((sum, el) => sum + (el.rect.x + el.rect.w / 2) * el.priority, 0);
  return weighted / totalWeight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
