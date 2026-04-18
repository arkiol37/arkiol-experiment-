// src/engines/multi-output/style-anchor.ts
//
// Style Anchor — captures the shared visual thread across a multi-output
// generation set. Extracted once from the campaign plan or first render,
// then injected into all subsequent renders to enforce consistency while
// allowing per-format variation.

import type { CampaignPlan, VisualIdentity } from "../campaign/creative-director";
import type { CampaignStyleDNA } from "../campaign/campaign-coherence";
import { extractStyleDNA } from "../campaign/campaign-coherence";

// ── Style Anchor ───────────────────────────────────────────────────────────

export interface StyleAnchor {
  primaryColor: string;
  accentColor: string;
  bgLight: string;
  bgDark: string;
  typographyPersonality: number;
  tone: string;
  hookStrategy: string;
  compositionPattern: string;
  headlineBase: string;
  ctaText: string;
}

// ── Extract from campaign plan ─────────────────────────────────────────────

export function extractStyleAnchor(plan: CampaignPlan): StyleAnchor {
  const id = plan.identity;
  return {
    primaryColor: id.primaryColor,
    accentColor: id.accentColor,
    bgLight: id.bgLight,
    bgDark: id.bgDark,
    typographyPersonality: id.typographyPersonality,
    tone: id.tone,
    hookStrategy: id.hookStrategy,
    compositionPattern: id.compositionPattern,
    headlineBase: id.headline,
    ctaText: id.ctaText,
  };
}

// ── Extract from visual identity directly ──────────────────────────────────

export function extractStyleAnchorFromIdentity(identity: VisualIdentity): StyleAnchor {
  return {
    primaryColor: identity.primaryColor,
    accentColor: identity.accentColor,
    bgLight: identity.bgLight,
    bgDark: identity.bgDark,
    typographyPersonality: identity.typographyPersonality,
    tone: identity.tone,
    hookStrategy: identity.hookStrategy,
    compositionPattern: identity.compositionPattern,
    headlineBase: identity.headline,
    ctaText: identity.ctaText,
  };
}

// ── Build brand override from anchor ───────────────────────────────────────
// Converts anchor colors into a brand object that the pipeline understands.

export function anchorToBrand(anchor: StyleAnchor): {
  primaryColor: string;
  secondaryColor: string;
  fontDisplay: string;
  fontBody: string;
} {
  const fontMap: Record<number, string> = {
    0: "Lato",
    1: "Montserrat",
    2: "Playfair Display",
    3: "Poppins",
    4: "Cormorant Garamond",
  };

  const bodyFontMap: Record<number, string> = {
    0: "Lato",
    1: "DM Sans",
    2: "Lato",
    3: "Nunito Sans",
    4: "Lato",
  };

  return {
    primaryColor: anchor.primaryColor,
    secondaryColor: anchor.accentColor,
    fontDisplay: fontMap[anchor.typographyPersonality] ?? "Montserrat",
    fontBody: bodyFontMap[anchor.typographyPersonality] ?? "Lato",
  };
}

// ── Variation seed derivation ──────────────────────────────────────────────
// Ensures each format gets a unique but deterministic variation seed.

export function deriveVariationIndex(
  baseSeed: string,
  formatIndex: number,
): number {
  let hash = 0;
  const key = `${baseSeed}:${formatIndex}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 10000;
}

// ── Consistency score between two outputs ──────────────────────────────────
// Quick check that two renders share the same visual thread.

export interface ConsistencyCheck {
  consistent: boolean;
  score: number;
  issues: string[];
}

export function checkOutputConsistency(
  anchorThemeId: string | undefined,
  outputThemeId: string | undefined,
  anchorBrand: { primaryColor: string; secondaryColor: string },
  outputBrand: { primaryColor?: string; secondaryColor?: string },
): ConsistencyCheck {
  const issues: string[] = [];
  let score = 1.0;

  if (anchorThemeId && outputThemeId && anchorThemeId !== outputThemeId) {
    score -= 0.15;
  }

  if (anchorBrand.primaryColor !== outputBrand.primaryColor) {
    issues.push("Primary color diverged from anchor");
    score -= 0.25;
  }

  if (anchorBrand.secondaryColor !== outputBrand.secondaryColor) {
    issues.push("Accent color diverged from anchor");
    score -= 0.15;
  }

  return {
    consistent: score >= 0.6 && issues.length === 0,
    score: Math.max(0, score),
    issues,
  };
}
