// src/engines/campaign/narrative-arc.ts
//
// Narrative arc intelligence — structures campaign outputs around a storytelling
// flow (hook → problem → solution → CTA) so multi-format campaigns feel like
// a coherent story rather than isolated templates.
//
// Each format in a campaign is assigned a narrative beat. The arc defines
// messaging emphasis, visual weight, and emotional progression per beat.
// Works for both static templates and future animation/video outputs.

import type { CampaignObjective, CampaignTone } from "./creative-director";

// ── Narrative beat — a single step in the storytelling flow ─────────────────

export type NarrativeBeat =
  | "hook"        // Grab attention — bold visual, short punchy text
  | "problem"     // Surface the pain point or need
  | "solution"    // Present the product/service as the answer
  | "proof"       // Social proof, testimonials, stats
  | "cta"         // Call to action — drive the conversion
  | "reminder";   // Retargeting/follow-up — gentle nudge

export interface NarrativeBeatSpec {
  beat: NarrativeBeat;
  messagingEmphasis: "headline_dominant" | "balanced" | "body_heavy" | "cta_dominant";
  emotionalTone: "attention" | "empathy" | "confidence" | "trust" | "urgency" | "warmth";
  visualWeight: "high" | "medium" | "low";
  textDensity: "sparse" | "moderate" | "rich";
  suggestedHookStrategy: string;
}

// ── Narrative arc — the full storytelling structure ─────────────────────────

export type ArcType =
  | "classic"        // hook → problem → solution → cta
  | "direct"         // hook → solution → cta (skip problem for simple offers)
  | "storytelling"   // hook → problem → proof → solution → cta
  | "awareness"      // hook → solution → proof → reminder
  | "urgency";       // hook → cta (minimal, fast conversion)

export interface NarrativeArc {
  arcType: ArcType;
  beats: NarrativeBeatSpec[];
  totalBeats: number;
}

// ── Beat specifications ────────────────────────────────────────────────────

const BEAT_SPECS: Record<NarrativeBeat, NarrativeBeatSpec> = {
  hook: {
    beat: "hook",
    messagingEmphasis: "headline_dominant",
    emotionalTone: "attention",
    visualWeight: "high",
    textDensity: "sparse",
    suggestedHookStrategy: "bold_headline",
  },
  problem: {
    beat: "problem",
    messagingEmphasis: "balanced",
    emotionalTone: "empathy",
    visualWeight: "medium",
    textDensity: "moderate",
    suggestedHookStrategy: "contrast_punch",
  },
  solution: {
    beat: "solution",
    messagingEmphasis: "balanced",
    emotionalTone: "confidence",
    visualWeight: "high",
    textDensity: "moderate",
    suggestedHookStrategy: "visual_lead",
  },
  proof: {
    beat: "proof",
    messagingEmphasis: "body_heavy",
    emotionalTone: "trust",
    visualWeight: "low",
    textDensity: "rich",
    suggestedHookStrategy: "social_proof",
  },
  cta: {
    beat: "cta",
    messagingEmphasis: "cta_dominant",
    emotionalTone: "urgency",
    visualWeight: "high",
    textDensity: "sparse",
    suggestedHookStrategy: "urgency_frame",
  },
  reminder: {
    beat: "reminder",
    messagingEmphasis: "balanced",
    emotionalTone: "warmth",
    visualWeight: "medium",
    textDensity: "moderate",
    suggestedHookStrategy: "negative_space",
  },
};

// ── Arc templates ──────────────────────────────────────────────────────────

const ARC_TEMPLATES: Record<ArcType, NarrativeBeat[]> = {
  classic:      ["hook", "problem", "solution", "cta"],
  direct:       ["hook", "solution", "cta"],
  storytelling: ["hook", "problem", "proof", "solution", "cta"],
  awareness:    ["hook", "solution", "proof", "reminder"],
  urgency:      ["hook", "cta"],
};

// ── Select the right arc for the campaign ──────────────────────────────────

export function selectNarrativeArc(
  objective: CampaignObjective,
  tone: CampaignTone,
  formatCount: number,
): NarrativeArc {
  const arcType = selectArcType(objective, tone, formatCount);
  const beatSequence = ARC_TEMPLATES[arcType];

  return {
    arcType,
    beats: beatSequence.map(b => ({ ...BEAT_SPECS[b] })),
    totalBeats: beatSequence.length,
  };
}

function selectArcType(
  objective: CampaignObjective,
  tone: CampaignTone,
  formatCount: number,
): ArcType {
  if (tone === "urgent" || objective === "conversion" && formatCount <= 2) return "urgency";
  if (objective === "conversion") return "direct";
  if (objective === "awareness" || objective === "retention") return "awareness";
  if (objective === "engagement" && formatCount >= 4) return "storytelling";
  if (formatCount >= 4) return "storytelling";
  if (formatCount <= 2) return "direct";
  return "classic";
}

// ── Assign beats to campaign formats ───────────────────────────────────────

export interface FormatNarrativeAssignment {
  format: string;
  role: string;
  beat: NarrativeBeat;
  beatSpec: NarrativeBeatSpec;
  beatIndex: number;
  isArcStart: boolean;
  isArcEnd: boolean;
}

export function assignNarrativeBeats(
  formats: Array<{ format: string; role: string; generationPriority: number }>,
  arc: NarrativeArc,
): FormatNarrativeAssignment[] {
  const sorted = [...formats].sort((a, b) => a.generationPriority - b.generationPriority);

  return sorted.map((f, i) => {
    const beatIndex = Math.min(i, arc.beats.length - 1);
    const beatSpec = arc.beats[beatIndex];

    // Override: CTA-role formats always get the CTA beat
    const effectiveBeat = f.role === "cta" ? "cta" : beatSpec.beat;
    const effectiveSpec = f.role === "cta" ? BEAT_SPECS.cta : beatSpec;

    return {
      format: f.format,
      role: f.role,
      beat: effectiveBeat,
      beatSpec: effectiveSpec,
      beatIndex,
      isArcStart: i === 0,
      isArcEnd: i === sorted.length - 1,
    };
  });
}

// ── Generate messaging guidance per beat ────────────────────────────────────

export interface BeatMessagingGuide {
  beat: NarrativeBeat;
  headlineApproach: string;
  subheadApproach: string;
  ctaApproach: string;
  toneShift: string;
}

const BEAT_MESSAGING: Record<NarrativeBeat, BeatMessagingGuide> = {
  hook: {
    beat: "hook",
    headlineApproach: "Bold, attention-grabbing statement or question",
    subheadApproach: "Brief context — one line max",
    ctaApproach: "Omit or keep minimal",
    toneShift: "Maximum energy, create intrigue",
  },
  problem: {
    beat: "problem",
    headlineApproach: "Name the pain point or challenge directly",
    subheadApproach: "Expand on the consequence of inaction",
    ctaApproach: "Omit — don't sell yet",
    toneShift: "Empathetic, relatable",
  },
  solution: {
    beat: "solution",
    headlineApproach: "Present the product/service as the answer",
    subheadApproach: "Highlight key benefit or differentiator",
    ctaApproach: "Soft CTA — 'Discover' or 'See How'",
    toneShift: "Confident, positive",
  },
  proof: {
    beat: "proof",
    headlineApproach: "Lead with a stat, testimonial, or credential",
    subheadApproach: "Supporting evidence or customer quote",
    ctaApproach: "Soft CTA — 'Join X customers' or 'See Results'",
    toneShift: "Trustworthy, factual",
  },
  cta: {
    beat: "cta",
    headlineApproach: "Repeat core value proposition",
    subheadApproach: "Urgency or scarcity element",
    ctaApproach: "Strong, direct action verb — 'Shop Now', 'Get Started', 'Claim Offer'",
    toneShift: "Urgent, decisive",
  },
  reminder: {
    beat: "reminder",
    headlineApproach: "Friendly callback to the main message",
    subheadApproach: "Reinforce the benefit or offer",
    ctaApproach: "Gentle nudge — 'Still interested?' or 'Don't miss out'",
    toneShift: "Warm, non-pushy",
  },
};

export function getBeatMessagingGuide(beat: NarrativeBeat): BeatMessagingGuide {
  return BEAT_MESSAGING[beat];
}

// ── Build narrative prompt context for a single format ──────────────────────

export function buildNarrativePromptContext(
  assignment: FormatNarrativeAssignment,
  arc: NarrativeArc,
): string {
  const guide = getBeatMessagingGuide(assignment.beat);
  const position = assignment.isArcStart ? "opening" : assignment.isArcEnd ? "closing" : "middle";

  return [
    `Narrative role: ${assignment.beat} (${position} of ${arc.arcType} arc)`,
    `Headline approach: ${guide.headlineApproach}`,
    `Subhead approach: ${guide.subheadApproach}`,
    `CTA approach: ${guide.ctaApproach}`,
    `Emotional tone: ${assignment.beatSpec.emotionalTone}`,
    `Visual weight: ${assignment.beatSpec.visualWeight}`,
    `Text density: ${assignment.beatSpec.textDensity}`,
  ].join(". ");
}

// ── Adapt format headline to match its narrative beat ───────────────────────

export function adaptHeadlineForBeat(
  baseHeadline: string,
  beat: NarrativeBeat,
  tone: string,
): string {
  const trimmed = baseHeadline.trim();
  if (!trimmed) return trimmed;

  switch (beat) {
    case "hook":
      if (trimmed.length > 50) return trimmed.slice(0, 47) + "...";
      return trimmed;

    case "problem":
      return trimmed;

    case "solution":
      return trimmed;

    case "proof":
      return trimmed;

    case "cta":
      if (trimmed.length > 40) return trimmed.slice(0, 37) + "...";
      return trimmed;

    case "reminder":
      if (trimmed.length > 60) return trimmed.slice(0, 57) + "...";
      return trimmed;

    default:
      return trimmed;
  }
}
