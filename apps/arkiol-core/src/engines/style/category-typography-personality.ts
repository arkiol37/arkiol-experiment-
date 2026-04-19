// src/engines/style/category-typography-personality.ts
//
// Category-specific typography personality.
//
// The existing `CategoryStylePack` already controls headline/subhead weights,
// tracking, and uppercase preference. That covers display-tier personality
// but leaves body / cta / bullet text treatment identical across categories,
// so a fitness template and a wellness template end up with the same reading
// rhythm — bold energy and soft calm read as the same body weight + leading.
//
// This module layers a richer personality on top: per-role expression that
// extends through body, cta, bullets, and contact text so the *whole* text
// treatment expresses the category.
//
// Personalities are tuned for these four anchor feelings (plus 9 others
// tuned to match the existing pack set):
//
//   • business   — structured, clean      (sans, tight headline, measured body)
//   • wellness   — soft, calm             (light weights, loose leading, wide tracking)
//   • fitness    — bold, energetic        (heavy weights, tight leading, uppercase cta)
//   • education  — clear, approachable    (comfortable leading, friendly weight)

import type { CategoryStylePack } from "./category-style-packs";

// ── Personality shape ──────────────────────────────────────────────────────
//
// Each role expresses independent dials. Fields are optional — only values
// the personality cares about are set, so the base theme retains its own
// character where the personality has no opinion.

export interface RolePersonality {
  /** Multiplier on base line-height (1.0 = unchanged). */
  lineHeightMultiplier?: number;
  /** Letter-spacing as em fraction. */
  letterSpacing?: number;
  /** Absolute weight override. */
  fontWeight?: number;
  /** Text-transform (rare outside cta/badge/eyebrow). */
  textTransform?: "uppercase" | "none";
}

export interface TypographyPersonality {
  /** Category id this personality targets. */
  categoryId: string;
  /** Human-readable descriptor for logging/inspection. */
  feel: string;

  // Per-role expression. Omitted roles inherit from the base theme.
  headline?:  RolePersonality;
  subhead?:   RolePersonality;
  body?:      RolePersonality;
  cta?:       RolePersonality;
  bullet?:    RolePersonality;
  contact?:   RolePersonality;
  legal?:     RolePersonality;
  eyebrow?:   RolePersonality;
  badge?:     RolePersonality;
}

// ── Personality library ────────────────────────────────────────────────────
//
// Each entry is a *coherent* vibe — headline + body + cta should feel like
// they came from the same art director. Avoid contradicting the pack's
// existing headline direction; instead, carry it through other zones.

const BUSINESS: TypographyPersonality = {
  categoryId: "business",
  feel:       "structured, clean, measured",
  headline:   { letterSpacing: -0.025, fontWeight: 700 },
  subhead:    { letterSpacing:  0.040, fontWeight: 500, lineHeightMultiplier: 1.32 },
  body:       { letterSpacing:  0.005, fontWeight: 400, lineHeightMultiplier: 1.50 },
  cta:        { letterSpacing:  0.060, fontWeight: 700, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.55, fontWeight: 400 },
  contact:    { lineHeightMultiplier: 1.40, fontWeight: 400, letterSpacing: 0.015 },
  legal:      { lineHeightMultiplier: 1.35, fontWeight: 300 },
};

const WELLNESS: TypographyPersonality = {
  categoryId: "wellness",
  feel:       "soft, calm, airy",
  headline:   { letterSpacing: -0.005, fontWeight: 300 },
  subhead:    { letterSpacing:  0.060, fontWeight: 300, lineHeightMultiplier: 1.45 },
  body:       { letterSpacing:  0.020, fontWeight: 300, lineHeightMultiplier: 1.65 },
  cta:        { letterSpacing:  0.080, fontWeight: 500, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.70, fontWeight: 300 },
  contact:    { lineHeightMultiplier: 1.55, fontWeight: 300 },
  legal:      { lineHeightMultiplier: 1.50, fontWeight: 300 },
  eyebrow:    { letterSpacing:  0.280, fontWeight: 400 },
};

const FITNESS: TypographyPersonality = {
  categoryId: "fitness",
  feel:       "bold, energetic, compressed",
  headline:   { letterSpacing:  0.020, fontWeight: 900, textTransform: "uppercase" },
  subhead:    { letterSpacing:  0.030, fontWeight: 700, lineHeightMultiplier: 1.18 },
  body:       { letterSpacing:  0.000, fontWeight: 500, lineHeightMultiplier: 1.32 },
  cta:        { letterSpacing:  0.110, fontWeight: 800, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.40, fontWeight: 600 },
  contact:    { lineHeightMultiplier: 1.25, fontWeight: 600 },
  legal:      { lineHeightMultiplier: 1.25, fontWeight: 500 },
  badge:      { letterSpacing:  0.180, fontWeight: 800 },
  eyebrow:    { letterSpacing:  0.220, fontWeight: 700 },
};

const EDUCATION: TypographyPersonality = {
  categoryId: "education",
  feel:       "clear, approachable, comfortable",
  headline:   { letterSpacing: -0.015, fontWeight: 600 },
  subhead:    { letterSpacing:  0.010, fontWeight: 500, lineHeightMultiplier: 1.35 },
  body:       { letterSpacing:  0.000, fontWeight: 400, lineHeightMultiplier: 1.55 },
  cta:        { letterSpacing:  0.040, fontWeight: 600, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.60, fontWeight: 400 },
  contact:    { lineHeightMultiplier: 1.45, fontWeight: 400 },
  legal:      { lineHeightMultiplier: 1.40, fontWeight: 300 },
};

const WELLNESS_ADJACENT_BEAUTY: TypographyPersonality = {
  categoryId: "beauty",
  feel:       "editorial, refined, breathable",
  headline:   { letterSpacing: -0.005, fontWeight: 300 },
  subhead:    { letterSpacing:  0.040, fontWeight: 300, lineHeightMultiplier: 1.40 },
  body:       { letterSpacing:  0.020, fontWeight: 300, lineHeightMultiplier: 1.60 },
  cta:        { letterSpacing:  0.100, fontWeight: 500, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.65, fontWeight: 300 },
  contact:    { lineHeightMultiplier: 1.45, fontWeight: 300 },
  legal:      { lineHeightMultiplier: 1.40, fontWeight: 300 },
  eyebrow:    { letterSpacing:  0.280, fontWeight: 400 },
};

const FASHION: TypographyPersonality = {
  categoryId: "fashion",
  feel:       "editorial, high-contrast, luxurious",
  headline:   { letterSpacing:  0.020, fontWeight: 300, textTransform: "uppercase" },
  subhead:    { letterSpacing:  0.080, fontWeight: 300, lineHeightMultiplier: 1.40 },
  body:       { letterSpacing:  0.030, fontWeight: 300, lineHeightMultiplier: 1.60 },
  cta:        { letterSpacing:  0.120, fontWeight: 500, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.60, fontWeight: 300 },
  contact:    { lineHeightMultiplier: 1.50, fontWeight: 300 },
  legal:      { lineHeightMultiplier: 1.40, fontWeight: 300 },
  eyebrow:    { letterSpacing:  0.300, fontWeight: 300 },
};

const FOOD: TypographyPersonality = {
  categoryId: "food",
  feel:       "warm, inviting, savoury",
  headline:   { letterSpacing: -0.010, fontWeight: 700 },
  subhead:    { letterSpacing:  0.010, fontWeight: 400, lineHeightMultiplier: 1.32 },
  body:       { letterSpacing:  0.000, fontWeight: 400, lineHeightMultiplier: 1.50 },
  cta:        { letterSpacing:  0.050, fontWeight: 700, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.55, fontWeight: 400 },
  contact:    { lineHeightMultiplier: 1.40, fontWeight: 400 },
  legal:      { lineHeightMultiplier: 1.35, fontWeight: 400 },
};

const TRAVEL: TypographyPersonality = {
  categoryId: "travel",
  feel:       "open, spacious, sunlit",
  headline:   { letterSpacing: -0.020, fontWeight: 700 },
  subhead:    { letterSpacing:  0.020, fontWeight: 400, lineHeightMultiplier: 1.38 },
  body:       { letterSpacing:  0.005, fontWeight: 400, lineHeightMultiplier: 1.58 },
  cta:        { letterSpacing:  0.060, fontWeight: 600, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.60, fontWeight: 400 },
  contact:    { lineHeightMultiplier: 1.45, fontWeight: 400 },
  legal:      { lineHeightMultiplier: 1.40, fontWeight: 300 },
};

const MOTIVATION: TypographyPersonality = {
  categoryId: "motivation",
  feel:       "dramatic, quotable, poster",
  headline:   { letterSpacing:  0.010, fontWeight: 800, textTransform: "uppercase" },
  subhead:    { letterSpacing:  0.080, fontWeight: 300, lineHeightMultiplier: 1.30 },
  body:       { letterSpacing:  0.010, fontWeight: 400, lineHeightMultiplier: 1.45 },
  cta:        { letterSpacing:  0.140, fontWeight: 800, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.50, fontWeight: 500 },
  contact:    { lineHeightMultiplier: 1.35, fontWeight: 500 },
  legal:      { lineHeightMultiplier: 1.35, fontWeight: 400 },
  eyebrow:    { letterSpacing:  0.300, fontWeight: 600 },
};

const MARKETING: TypographyPersonality = {
  categoryId: "marketing",
  feel:       "punchy, urgent, conversion-driven",
  headline:   { letterSpacing:  0.000, fontWeight: 800, textTransform: "uppercase" },
  subhead:    { letterSpacing:  0.020, fontWeight: 600, lineHeightMultiplier: 1.22 },
  body:       { letterSpacing:  0.000, fontWeight: 500, lineHeightMultiplier: 1.38 },
  cta:        { letterSpacing:  0.100, fontWeight: 800, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.45, fontWeight: 600 },
  contact:    { lineHeightMultiplier: 1.30, fontWeight: 600 },
  legal:      { lineHeightMultiplier: 1.30, fontWeight: 500 },
  badge:      { letterSpacing:  0.160, fontWeight: 800 },
};

const TECH: TypographyPersonality = {
  categoryId: "tech",
  feel:       "precise, modern, geometric",
  headline:   { letterSpacing: -0.025, fontWeight: 600 },
  subhead:    { letterSpacing:  0.020, fontWeight: 400, lineHeightMultiplier: 1.32 },
  body:       { letterSpacing:  0.005, fontWeight: 400, lineHeightMultiplier: 1.48 },
  cta:        { letterSpacing:  0.060, fontWeight: 600, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.55, fontWeight: 400 },
  contact:    { lineHeightMultiplier: 1.40, fontWeight: 400 },
  legal:      { lineHeightMultiplier: 1.35, fontWeight: 400 },
};

const REAL_ESTATE: TypographyPersonality = {
  categoryId: "realestate",
  feel:       "confident, sophisticated, architectural",
  headline:   { letterSpacing: -0.010, fontWeight: 700 },
  subhead:    { letterSpacing:  0.010, fontWeight: 500, lineHeightMultiplier: 1.30 },
  body:       { letterSpacing:  0.010, fontWeight: 400, lineHeightMultiplier: 1.52 },
  cta:        { letterSpacing:  0.070, fontWeight: 700, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.55, fontWeight: 400 },
  contact:    { lineHeightMultiplier: 1.45, fontWeight: 500 },
  legal:      { lineHeightMultiplier: 1.35, fontWeight: 400 },
};

const PRODUCTIVITY: TypographyPersonality = {
  categoryId: "productivity",
  feel:       "efficient, orderly, utilitarian",
  headline:   { letterSpacing: -0.020, fontWeight: 600 },
  subhead:    { letterSpacing:  0.020, fontWeight: 400, lineHeightMultiplier: 1.30 },
  body:       { letterSpacing:  0.005, fontWeight: 400, lineHeightMultiplier: 1.50 },
  cta:        { letterSpacing:  0.050, fontWeight: 600, textTransform: "uppercase" },
  bullet:     { lineHeightMultiplier: 1.55, fontWeight: 400 },
  contact:    { lineHeightMultiplier: 1.40, fontWeight: 400 },
  legal:      { lineHeightMultiplier: 1.35, fontWeight: 400 },
};

// ── Registry ────────────────────────────────────────────────────────────────

const PERSONALITIES: Record<string, TypographyPersonality> = {
  business:     BUSINESS,
  wellness:     WELLNESS,
  fitness:      FITNESS,
  education:    EDUCATION,
  beauty:       WELLNESS_ADJACENT_BEAUTY,
  fashion:      FASHION,
  food:         FOOD,
  travel:       TRAVEL,
  motivation:   MOTIVATION,
  marketing:    MARKETING,
  tech:         TECH,
  realestate:   REAL_ESTATE,
  productivity: PRODUCTIVITY,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Look up the typography personality for a category pack. Returns null when
 * no personality is registered for the category, so callers fall through to
 * the base theme typography unchanged.
 */
export function getTypographyPersonality(
  pack: Pick<CategoryStylePack, "id"> | string | null | undefined,
): TypographyPersonality | null {
  if (!pack) return null;
  const id = typeof pack === "string" ? pack : pack.id;
  return PERSONALITIES[id] ?? null;
}

/** All registered personalities, for inspection or tests. */
export function listTypographyPersonalities(): TypographyPersonality[] {
  return Object.values(PERSONALITIES);
}
