// src/engines/templates/template-types.ts
//
// TEMPLATE TYPE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
// Gallery outputs used to collapse into one homogeneous look per brief.
// This module introduces an explicit *template type* layer that sits ABOVE
// theme selection: the pipeline first decides "what kind of design is this"
// (checklist, tips, quote, step-by-step, list-based, promotional,
// educational, minimal) and then the theme is shaped so the output
// visibly reads as that type.
//
// Each type carries:
//   - a keyword set used to bias selection from the brief
//   - a layout bias (top-anchor / stacked / framed / etc.)
//   - a decoration contribution that the composer adds on top of the
//     base theme so the type announces itself visually
//   - a copy-style hint (headline cadence, CTA voice)
//
// Selection is deterministic: given the same brief and variationIdx the
// same template type is picked. Rotation across variationIdx guarantees
// that a multi-variation gallery surfaces clearly different types.

import type { BriefAnalysis } from "../ai/brief-analyzer";
import type { DesignTheme, DecorShape } from "../render/design-themes";

// ── Type catalog ─────────────────────────────────────────────────────────────

export type TemplateType =
  | "checklist"
  | "tips"
  | "quote"
  | "step_by_step"
  | "list_based"
  | "promotional"
  | "educational"
  | "minimal";

export const TEMPLATE_TYPES: readonly TemplateType[] = [
  "checklist",
  "tips",
  "quote",
  "step_by_step",
  "list_based",
  "promotional",
  "educational",
  "minimal",
] as const;

export type LayoutBias =
  | "top_anchor"     // primary content stacks under a top banner / badge
  | "centered"       // headline centered, supporting elements frame it
  | "stacked_left"   // left-aligned column (steps / lists)
  | "bordered"       // content sits inside a frame / card
  | "split_hero"     // hero block + supporting column
  | "open_canvas";   // plenty of whitespace, few elements

export interface TemplateTypeConfig {
  id:            TemplateType;
  name:          string;
  description:   string;
  /** Keywords (lowercase) that pull the selector toward this type. */
  keywords:      string[];
  /** Structural / compositional bias the theme should honor. */
  layoutBias:    LayoutBias;
  /** Zones the type leans on (audit + future targeted enrichment). */
  keyZones:      string[];
  /** Decoration kinds this type characteristically adds. */
  signatureKinds: string[];
  /** Recommended CTA tone hint (for downstream rewriting). */
  ctaVoice:      "imperative" | "inviting" | "curious" | "urgent" | "quiet";
}

export const TEMPLATE_TYPE_CONFIGS: Record<TemplateType, TemplateTypeConfig> = {
  checklist: {
    id:            "checklist",
    name:          "Checklist",
    description:   "A checkable list of benefits / features / must-haves.",
    keywords:      ["checklist", "must have", "essentials", "benefits", "features", "todo", "to-do", "to do"],
    layoutBias:    "stacked_left",
    keyZones:      ["headline", "badge", "body_text", "cta"],
    signatureKinds:["checklist", "icon_symbol", "section_divider"],
    ctaVoice:      "imperative",
  },
  tips: {
    id:            "tips",
    name:          "Tips",
    description:   "Bite-sized advice. Banner-led, icon-forward.",
    keywords:      ["tips", "hacks", "ideas", "advice", "tricks", "pro tip", "pro-tip", "how to"],
    layoutBias:    "top_anchor",
    keyZones:      ["badge", "headline", "subhead", "body_text"],
    signatureKinds:["banner_strip", "icon_symbol", "deco_ring"],
    ctaVoice:      "inviting",
  },
  quote: {
    id:            "quote",
    name:          "Quote",
    description:   "A featured quotation with attribution and ornament.",
    keywords:      ["quote", "\"", "\u201c", "\u201d", "said", "wisdom", "words", "mantra"],
    layoutBias:    "centered",
    keyZones:      ["headline", "subhead", "body_text"],
    signatureKinds:["sticker_circle", "section_divider", "frame_border"],
    ctaVoice:      "quiet",
  },
  step_by_step: {
    id:            "step_by_step",
    name:          "Step-by-Step",
    description:   "Numbered walkthrough of an ordered sequence.",
    keywords:      ["step", "steps", "how to", "guide", "walkthrough", "tutorial", "process"],
    layoutBias:    "stacked_left",
    keyZones:      ["badge", "headline", "body_text", "cta"],
    signatureKinds:["sticker_circle", "section_divider", "accent_bar"],
    ctaVoice:      "imperative",
  },
  list_based: {
    id:            "list_based",
    name:          "List",
    description:   "An enumerated line-up of items or categories.",
    keywords:      ["list", "top", "best", "picks", "roundup", "lineup", "favorites", "ranking"],
    layoutBias:    "stacked_left",
    keyZones:      ["badge", "headline", "body_text"],
    signatureKinds:["dots_grid", "section_divider", "accent_bar"],
    ctaVoice:      "curious",
  },
  promotional: {
    id:            "promotional",
    name:          "Promotional",
    description:   "Sale / launch / offer — loud, ribboned, price-forward.",
    keywords:      ["sale", "offer", "promo", "discount", "deal", "launch", "new", "limited", "shop", "buy", "save", "% off"],
    layoutBias:    "split_hero",
    keyZones:      ["badge", "headline", "cta"],
    signatureKinds:["ribbon", "price_tag", "starburst", "banner_strip"],
    ctaVoice:      "urgent",
  },
  educational: {
    id:            "educational",
    name:          "Educational",
    description:   "Explainer-style — framed, annotated, information-dense.",
    keywords:      ["learn", "explainer", "lesson", "class", "course", "educational", "study", "training", "coach"],
    layoutBias:    "bordered",
    keyZones:      ["eyebrow", "headline", "body_text", "cta"],
    signatureKinds:["frame_border", "icon_symbol", "section_divider"],
    ctaVoice:      "inviting",
  },
  minimal: {
    id:            "minimal",
    name:          "Minimal",
    description:   "Clean, typographic — elegant over ornate.",
    keywords:      ["minimal", "clean", "simple", "calm", "quiet", "wellness", "mindful", "breathe", "reset"],
    layoutBias:    "open_canvas",
    keyZones:      ["headline", "subhead", "cta"],
    signatureKinds:["accent_bar", "section_divider", "corner_bracket"],
    ctaVoice:      "quiet",
  },
};

// ── Selection ────────────────────────────────────────────────────────────────
// Rotation order ensures that when a brief is generated across several
// variations the gallery shows a mix of types rather than eight copies of
// the same archetype.
const ROTATION_ORDER: TemplateType[] = [
  "promotional",
  "tips",
  "step_by_step",
  "educational",
  "checklist",
  "list_based",
  "quote",
  "minimal",
];

export interface TemplateTypeDecision {
  type:      TemplateType;
  config:    TemplateTypeConfig;
  reason:    "override" | "keyword_match" | "rotation";
  keywordScore?: number;
  rotationIndex?: number;
}

/**
 * Decide a template type for a brief + variation index.
 *
 *   - If the caller already decided (override), honor it.
 *   - Otherwise score every type against the brief's prompt + keywords
 *     + headline. The winning type seeds the rotation so variationIdx
 *     still cycles through different types for the same brief, but the
 *     first variation leans into the brief's natural category.
 *   - If nothing scores, fall back to the rotation order keyed on
 *     variationIdx.
 */
export function selectTemplateType(
  brief:        BriefAnalysis,
  variationIdx: number,
  override?:    TemplateType,
): TemplateTypeDecision {
  if (override) {
    return { type: override, config: TEMPLATE_TYPE_CONFIGS[override], reason: "override" };
  }

  const corpus = buildCorpus(brief);
  const scores = scoreAllTypes(corpus);

  const best = scores[0];
  if (best && best.score > 0) {
    // Seed rotation from the winning keyword match; subsequent variations
    // walk forward through the rotation order so the gallery shows
    // diverse types even though each share the same brief.
    const seedIdx   = ROTATION_ORDER.indexOf(best.type);
    const step      = Math.max(0, Math.floor(variationIdx)) % ROTATION_ORDER.length;
    const pickIdx   = (seedIdx + step) % ROTATION_ORDER.length;
    const picked    = ROTATION_ORDER[pickIdx];
    return {
      type:          picked,
      config:        TEMPLATE_TYPE_CONFIGS[picked],
      reason:        step === 0 ? "keyword_match" : "rotation",
      keywordScore:  best.score,
      rotationIndex: pickIdx,
    };
  }

  const pickIdx = Math.max(0, Math.floor(variationIdx)) % ROTATION_ORDER.length;
  const picked  = ROTATION_ORDER[pickIdx];
  return {
    type:          picked,
    config:        TEMPLATE_TYPE_CONFIGS[picked],
    reason:        "rotation",
    rotationIndex: pickIdx,
  };
}

function buildCorpus(brief: BriefAnalysis): string {
  const parts = [
    brief.headline ?? "",
    brief.subhead ?? "",
    brief.cta ?? "",
    brief.intent ?? "",
    brief.tone ?? "",
    brief.audience ?? "",
    ...(brief.keywords ?? []),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function scoreAllTypes(corpus: string): Array<{ type: TemplateType; score: number }> {
  const out: Array<{ type: TemplateType; score: number }> = [];
  for (const t of TEMPLATE_TYPES) {
    const cfg = TEMPLATE_TYPE_CONFIGS[t];
    let score = 0;
    for (const kw of cfg.keywords) {
      if (!kw) continue;
      if (corpus.includes(kw)) score += kw.length >= 6 ? 2 : 1;
    }
    out.push({ type: t, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ── Theme shaping ────────────────────────────────────────────────────────────
// shapeThemeForTemplateType(theme, type) adds a small, characteristic
// decoration pack that announces the type visually. The base theme's own
// decorations are preserved — we extend rather than replace so palette +
// typography and any existing layering stays intact.
//
// All coordinates are in viewBox % (0..100). Placements live in the
// margins (top strip, bottom strip, left / right edges) so they never
// collide with the headline / subhead / body / cta zones which live
// between y ≈ 8..82.

export function shapeThemeForTemplateType(theme: DesignTheme, type: TemplateType): DesignTheme {
  const addition = decorationsForType(theme, type);
  if (addition.length === 0) return theme;
  return { ...theme, decorations: [...theme.decorations, ...addition] };
}

function decorationsForType(theme: DesignTheme, type: TemplateType): DecorShape[] {
  const p        = theme.palette;
  const accent   = p.highlight ?? p.secondary ?? "#ffffff";
  const ink      = p.text ?? "#111111";
  const surface  = p.surface ?? "rgba(255,255,255,0.12)";

  switch (type) {
    case "checklist": {
      const items = ["Easy to apply", "Saves you time", "Proven results"];
      return [
        { kind:"checklist",        x:7,  y:72, w:86, items, color:ink, checkColor:accent, fontSize:14, opacity:0.92, lineHeight:1.45 },
        { kind:"icon_symbol",      x:93, y:9,  size:14, icon:"check", color:accent, opacity:0.8 },
        { kind:"section_divider",  x:7,  y:68, w:40, color:accent, opacity:0.5, strokeWidth:1.5, ornament:"diamond" },
      ];
    }

    case "tips": {
      return [
        { kind:"banner_strip",     x:6,  y:6,  w:40, h:7, color:accent, text:"PRO TIP", textColor:ink, fontSize:13, opacity:0.95, skew:-6 },
        { kind:"icon_symbol",      x:93, y:10, size:14, icon:"lightning", color:accent, opacity:0.85 },
        { kind:"icon_symbol",      x:8,  y:90, size:11, icon:"sparkle", color:accent, opacity:0.55 },
        { kind:"deco_ring",        x:92, y:90, r:60, color:accent, opacity:0.25, strokeWidth:2 },
        { kind:"section_divider",  x:20, y:86, w:60, color:accent, opacity:0.35, strokeWidth:1, ornament:"dot" },
      ];
    }

    case "quote": {
      return [
        { kind:"sticker_circle",   x:10, y:14, r:30, color:accent, text:"\u201c", textColor:ink, fontSize:44, rotation:-8, opacity:0.95 },
        { kind:"sticker_circle",   x:90, y:86, r:24, color:surface, text:"\u201d", textColor:ink, fontSize:38, rotation:6, opacity:0.9 },
        { kind:"section_divider",  x:30, y:92, w:40, color:accent, opacity:0.5, strokeWidth:1, ornament:"diamond" },
        { kind:"frame_border",     x:4,  y:4,  w:92, h:92, color:accent, opacity:0.2, strokeWidth:1, gap:10, rx:2 },
      ];
    }

    case "step_by_step": {
      const stepColor = accent;
      const labelColor = ink;
      return [
        { kind:"sticker_circle",   x:7,  y:30, r:22, color:stepColor, text:"1", textColor:labelColor, fontSize:22, rotation:0, opacity:1 },
        { kind:"sticker_circle",   x:7,  y:52, r:22, color:stepColor, text:"2", textColor:labelColor, fontSize:22, rotation:0, opacity:0.85 },
        { kind:"sticker_circle",   x:7,  y:74, r:22, color:stepColor, text:"3", textColor:labelColor, fontSize:22, rotation:0, opacity:0.7 },
        { kind:"accent_bar",       x:7,  y:30, w:0.3, h:44, color:accent, rx:1 },
        { kind:"section_divider",  x:20, y:22, w:60, color:accent, opacity:0.45, strokeWidth:1, ornament:"dash" },
      ];
    }

    case "list_based": {
      return [
        { kind:"accent_bar",       x:4,  y:20, w:0.7, h:60, color:accent, rx:1 },
        { kind:"dots_grid",        x:86, y:18, cols:3, rows:10, gap:5, r:1.6, color:accent, opacity:0.5 },
        { kind:"section_divider",  x:12, y:16, w:60, color:accent, opacity:0.5, strokeWidth:1, ornament:"circle" },
        { kind:"section_divider",  x:12, y:86, w:60, color:accent, opacity:0.4, strokeWidth:1, ornament:"circle" },
        { kind:"icon_symbol",      x:93, y:9,  size:12, icon:"star", color:accent, opacity:0.7 },
      ];
    }

    case "promotional": {
      return [
        { kind:"ribbon",           x:68, y:6,  w:30, h:10, color:accent, text:"LIMITED", textColor:ink, fontSize:13, opacity:1, corner:"tr" },
        { kind:"price_tag",        x:78, y:18, w:20, h:12, color:ink, text:"SALE", textColor:accent, fontSize:16, opacity:0.95 },
        { kind:"starburst",        x:82, y:22, r:140, rays:16, color:accent, opacity:0.18, rotation:12 },
        { kind:"banner_strip",     x:0,  y:88, w:100, h:10, color:accent, text:"SHOP TODAY", textColor:ink, fontSize:14, opacity:0.95, skew:0 },
        { kind:"icon_symbol",      x:8,  y:10, size:14, icon:"fire", color:accent, opacity:0.8 },
      ];
    }

    case "educational": {
      return [
        { kind:"frame_border",     x:4,  y:4,  w:92, h:92, color:accent, opacity:0.35, strokeWidth:1.5, gap:6, rx:3 },
        { kind:"icon_symbol",      x:50, y:11, size:14, icon:"sparkle", color:accent, opacity:0.8 },
        { kind:"section_divider",  x:25, y:18, w:50, color:accent, opacity:0.5, strokeWidth:1, ornament:"diamond" },
        { kind:"section_divider",  x:25, y:86, w:50, color:accent, opacity:0.4, strokeWidth:1, ornament:"diamond" },
        { kind:"corner_bracket",   x:5,  y:5,  size:10, color:accent, opacity:0.55, strokeWidth:2, corner:"tl" },
        { kind:"corner_bracket",   x:95, y:95, size:10, color:accent, opacity:0.55, strokeWidth:2, corner:"br" },
      ];
    }

    case "minimal": {
      return [
        { kind:"accent_bar",       x:8,  y:16, w:0.4, h:3.5, color:accent, rx:1 },
        { kind:"section_divider",  x:30, y:90, w:40, color:accent, opacity:0.35, strokeWidth:0.8, ornament:"dot" },
        { kind:"corner_bracket",   x:4,  y:4,  size:7, color:accent, opacity:0.5, strokeWidth:1.5, corner:"tl" },
        { kind:"corner_bracket",   x:96, y:96, size:7, color:accent, opacity:0.5, strokeWidth:1.5, corner:"br" },
      ];
    }
  }
}

// ── Audit helpers ────────────────────────────────────────────────────────────

export function describeTemplateType(type: TemplateType): string {
  return TEMPLATE_TYPE_CONFIGS[type]?.description ?? type;
}

/** All template type ids in rotation order — exposed for orchestration. */
export function listTemplateTypes(): readonly TemplateType[] {
  return TEMPLATE_TYPES;
}
