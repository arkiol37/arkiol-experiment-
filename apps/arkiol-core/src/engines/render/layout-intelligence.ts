import { BriefAnalysis } from "../ai/brief-analyzer";
import { DesignTheme, THEMES, applyBrandColors } from "./design-themes";

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
  const candidateCount = Math.max(3, Math.min(options.candidateCount ?? 6, 10));
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

  return rawCandidates.sort((a, b) => b.score.total - a.score.total);
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
  const spacingDensity: LayoutDensity =
    content.bodyLength > 320 ? "compact" : content.headlineLength < 24 && brief.tone !== "urgent" ? "airy" : "balanced";

  let compositionStyle: CompositionStyle = "stacked";
  if (/luxury|fashion|editorial|magazine/.test(categoryText)) compositionStyle = "editorial";
  else if (/tech|saas|product|app|launch/.test(categoryText)) compositionStyle = "split";
  else if (/sale|promo|offer|fitness|energy/.test(categoryText) || content.urgency > 0.7) compositionStyle = "hero";
  else if (content.hierarchyBias === "headline") compositionStyle = "poster";
  else if (brief.tone === "minimal") compositionStyle = "minimal";

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
  taste: VisualTasteProfile,
  pattern: InspirationPattern,
  variationIdx: number,
  brand?: { primaryColor: string; secondaryColor: string }
): DesignTheme {
  const ranked = THEMES
    .map(theme => {
      let score = 0;
      if (theme.tones.includes(brief.tone)) score += 4;
      if (theme.colorMoods.includes(brief.colorMood)) score += 3;
      if (taste.typographyMode === "display-heavy" && (theme.headlineSizeMultiplier ?? 1) > 1.3) score += 2;
      if (taste.spacingDensity === "airy" && ["clean_minimal", "modern_editorial", "sage_wellness", "lavender_dream"].includes(theme.id)) score += 2;
      if (pattern.composition === "hero" && ["vibrant_burst", "sunset_warm", "coral_energy", "power_black"].includes(theme.id)) score += 2;
      if (pattern.composition === "editorial" && ["dark_luxe", "modern_editorial", "clean_minimal", "earth_coffee"].includes(theme.id)) score += 2;
      return { theme, score };
    })
    .sort((a, b) => b.score - a.score);

  const selected = ranked[Math.min(variationIdx, Math.min(4, ranked.length - 1))]?.theme ?? ranked[0].theme;
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
  const headlineWidth = pattern.composition === "split" ? 42 : pattern.composition === "editorial" ? 58 : 70;
  const headlineHeight = content.headlineLength > 54 ? 20 : 16;
  const ctaBoost = content.hierarchyBias === "cta" ? 1.2 : 1;
  const yShift = variationIdx % 2 === 0 ? 0 : 2;

  const elements: LayoutElement[] = [
    {
      id: "headline",
      region: "hero",
      priority: 10,
      rect: { x: safeZone.left, y: 12 + yShift, w: headlineWidth, h: headlineHeight },
      align,
      emphasis: content.hierarchyBias === "headline" ? 1.3 : 1,
      maxLines: content.headlineLength > 42 ? 4 : 3,
      contentLength: content.headlineLength,
    },
  ];

  if (brief.subhead) {
    elements.push({
      id: "subhead",
      region: "support",
      priority: 7,
      rect: { x: safeZone.left, y: 34 + yShift, w: headlineWidth + 6, h: content.subheadLength > 90 ? 14 : 10 },
      align,
      maxLines: content.subheadLength > 100 ? 4 : 3,
      contentLength: content.subheadLength,
    });
  }

  if (brief.body) {
    elements.push({
      id: "body",
      region: "body",
      priority: 5,
      rect: { x: safeZone.left, y: 48 + yShift, w: pattern.composition === "split" ? 36 : 56, h: content.bodyLength > 260 ? 22 : 16 },
      align,
      maxLines: content.bodyLength > 320 ? 8 : 5,
      contentLength: content.bodyLength,
    });
  }

  if (brief.cta) {
    elements.push({
      id: "cta",
      region: "cta",
      priority: 9,
      rect: { x: safeZone.left, y: content.bodyLength > 260 ? 77 : 72, w: Math.min(32, 18 + brief.cta.length * 0.7 * ctaBoost), h: 8 },
      align: pattern.composition === "poster" ? "center" : "left",
      emphasis: ctaBoost,
      maxLines: 1,
      contentLength: content.ctaLength,
    });
  }

  if (pattern.composition === "split") {
    elements.push({
      id: "media",
      region: "media",
      priority: 6,
      rect: { x: 56, y: 10, w: 34, h: 72 },
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

  const total =
    balance * 0.18 +
    contrast * 0.16 +
    readability * 0.16 +
    whitespace * 0.12 +
    hierarchyClarity * 0.16 +
    novelty * 0.1 +
    brandAlignment * 0.12;

  return {
    balance,
    contrast,
    readability,
    whitespace,
    hierarchyClarity,
    novelty,
    brandAlignment,
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
