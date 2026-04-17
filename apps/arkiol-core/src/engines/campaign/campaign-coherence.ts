// src/engines/campaign/campaign-coherence.ts
//
// Campaign coherence engine — ensures multi-output campaigns share consistent
// style, messaging progression, and visual thread across all formats.
//
// Validates that:
//   1. Color palette is consistent across all formats
//   2. Typography personality is shared
//   3. Narrative arc progresses logically
//   4. Visual weight shifts appropriately per beat
//   5. Messaging doesn't repeat or contradict across formats
//
// Produces a CoherenceReport with issues and auto-fix suggestions.

import type { CampaignPlan, CampaignFormatPlan, VisualIdentity } from "./creative-director";
import type { NarrativeArc, FormatNarrativeAssignment, NarrativeBeat } from "./narrative-arc";

// ── Coherence report ────────────────────────────────────────────────────────

export interface CoherenceIssue {
  severity: "warning" | "error";
  category: "palette" | "typography" | "narrative" | "messaging" | "visual_weight";
  format?: string;
  issue: string;
  suggestion: string;
}

export interface CoherenceReport {
  coherent: boolean;
  score: number;
  issues: CoherenceIssue[];
  summary: string;
}

// ── Style DNA — the shared visual thread across a campaign ──────────────────

export interface CampaignStyleDNA {
  primaryColor: string;
  accentColor: string;
  typographyPersonality: number;
  hookStrategy: string;
  compositionPattern: string;
  tone: string;
}

export function extractStyleDNA(identity: VisualIdentity): CampaignStyleDNA {
  return {
    primaryColor: identity.primaryColor,
    accentColor: identity.accentColor,
    typographyPersonality: identity.typographyPersonality,
    hookStrategy: identity.hookStrategy,
    compositionPattern: identity.compositionPattern,
    tone: identity.tone,
  };
}

// ── Messaging progression — ensures text evolves across the arc ─────────────

export interface MessagingProgression {
  formatHeadlines: Array<{ format: string; headline: string; beat: NarrativeBeat }>;
  hasRepetition: boolean;
  hasProgression: boolean;
  repetitionPairs: Array<[string, string]>;
}

export function analyzeMessagingProgression(
  formats: CampaignFormatPlan[],
  assignments: FormatNarrativeAssignment[],
): MessagingProgression {
  const formatHeadlines = formats.map(f => {
    const assignment = assignments.find(a => a.format === f.format);
    return {
      format: f.format,
      headline: f.headline,
      beat: assignment?.beat ?? ("hook" as NarrativeBeat),
    };
  });

  const repetitionPairs: Array<[string, string]> = [];
  for (let i = 0; i < formatHeadlines.length; i++) {
    for (let j = i + 1; j < formatHeadlines.length; j++) {
      if (areTooSimilar(formatHeadlines[i].headline, formatHeadlines[j].headline)) {
        repetitionPairs.push([formatHeadlines[i].format, formatHeadlines[j].format]);
      }
    }
  }

  const beatOrder = formatHeadlines.map(fh => fh.beat);
  const hasProgression = beatOrder.length <= 1 || !beatOrder.every(b => b === beatOrder[0]);

  return {
    formatHeadlines,
    hasRepetition: repetitionPairs.length > 0,
    hasProgression,
    repetitionPairs,
  };
}

function areTooSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return false;
  return intersection.length / union.size > 0.75;
}

// ── Full coherence check ────────────────────────────────────────────────────

export function checkCampaignCoherence(
  plan: CampaignPlan,
  arc: NarrativeArc,
  assignments: FormatNarrativeAssignment[],
): CoherenceReport {
  const issues: CoherenceIssue[] = [];

  checkPaletteConsistency(plan, issues);
  checkNarrativeFlow(arc, assignments, issues);
  checkMessagingCoherence(plan.formats, assignments, issues);
  checkVisualWeightProgression(assignments, issues);
  checkRoleDistribution(plan.formats, issues);

  const errorCount = issues.filter(i => i.severity === "error").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;

  const score = Math.max(0, 1 - errorCount * 0.2 - warningCount * 0.05);
  const coherent = errorCount === 0 && warningCount <= 2;

  const summary = coherent
    ? `Campaign is coherent across ${plan.formats.length} formats with ${arc.arcType} narrative arc`
    : `${errorCount} errors and ${warningCount} warnings detected in campaign coherence`;

  return { coherent, score, issues, summary };
}

function checkPaletteConsistency(plan: CampaignPlan, issues: CoherenceIssue[]): void {
  const { identity } = plan;

  if (!identity.primaryColor || !identity.accentColor) {
    issues.push({
      severity: "error",
      category: "palette",
      issue: "Campaign identity missing primary or accent color",
      suggestion: "Ensure buildVisualIdentity populates both colors",
    });
  }

  if (identity.primaryColor === identity.accentColor) {
    issues.push({
      severity: "warning",
      category: "palette",
      issue: "Primary and accent colors are identical — low visual variety",
      suggestion: "Use a complementary or analogous accent color",
    });
  }
}

function checkNarrativeFlow(
  arc: NarrativeArc,
  assignments: FormatNarrativeAssignment[],
  issues: CoherenceIssue[],
): void {
  if (assignments.length === 0) return;

  const firstBeat = assignments[0]?.beat;
  if (firstBeat !== "hook") {
    issues.push({
      severity: "warning",
      category: "narrative",
      format: assignments[0].format,
      issue: `Campaign opens with "${firstBeat}" instead of "hook"`,
      suggestion: "Reorder formats so the hero format carries the hook beat",
    });
  }

  const hasCta = assignments.some(a => a.beat === "cta");
  if (!hasCta && arc.beats.some(b => b.beat === "cta")) {
    issues.push({
      severity: "warning",
      category: "narrative",
      issue: "Arc specifies a CTA beat but no format is assigned to it",
      suggestion: "Add a CTA-focused format or assign the CTA beat to the last format",
    });
  }

  if (assignments.length > arc.totalBeats + 2) {
    issues.push({
      severity: "warning",
      category: "narrative",
      issue: `${assignments.length} formats but only ${arc.totalBeats} narrative beats — some formats share beats`,
      suggestion: "Consider extending the arc or reducing format count",
    });
  }
}

function checkMessagingCoherence(
  formats: CampaignFormatPlan[],
  assignments: FormatNarrativeAssignment[],
  issues: CoherenceIssue[],
): void {
  const progression = analyzeMessagingProgression(formats, assignments);

  if (progression.hasRepetition) {
    for (const [a, b] of progression.repetitionPairs) {
      issues.push({
        severity: "warning",
        category: "messaging",
        issue: `Formats "${a}" and "${b}" have near-identical headlines`,
        suggestion: "Adapt headlines to match each format's narrative beat",
      });
    }
  }

  if (!progression.hasProgression && formats.length > 1) {
    issues.push({
      severity: "warning",
      category: "messaging",
      issue: "All formats assigned to the same narrative beat — no progression",
      suggestion: "Distribute formats across different beats for story flow",
    });
  }
}

function checkVisualWeightProgression(
  assignments: FormatNarrativeAssignment[],
  issues: CoherenceIssue[],
): void {
  if (assignments.length < 2) return;

  const weights = assignments.map(a => a.beatSpec.visualWeight);
  const allSame = weights.every(w => w === weights[0]);

  if (allSame && assignments.length >= 3) {
    issues.push({
      severity: "warning",
      category: "visual_weight",
      issue: "All formats have identical visual weight — no dynamic variation",
      suggestion: "Vary visual weight across beats (high for hook/CTA, lower for proof)",
    });
  }
}

function checkRoleDistribution(
  formats: CampaignFormatPlan[],
  issues: CoherenceIssue[],
): void {
  const heroCount = formats.filter(f => f.role === "hero").length;
  const ctaCount = formats.filter(f => f.role === "cta").length;

  if (heroCount === 0 && formats.length > 0) {
    issues.push({
      severity: "error",
      category: "narrative",
      issue: "No hero format in campaign — needs a primary attention-grabbing design",
      suggestion: "Assign the highest-priority format as hero",
    });
  }

  if (heroCount > 2) {
    issues.push({
      severity: "warning",
      category: "narrative",
      issue: `${heroCount} hero formats — too many competing for primary attention`,
      suggestion: "Limit to 1-2 hero formats; mark others as supporting",
    });
  }

  if (ctaCount === 0 && formats.length >= 3) {
    issues.push({
      severity: "warning",
      category: "narrative",
      issue: "No CTA-role format in a 3+ format campaign",
      suggestion: "Assign at least one format as CTA to close the narrative arc",
    });
  }
}

// ── Build coherent format-level prompt additions ────────────────────────────

export function buildCoherenceContext(
  styleDNA: CampaignStyleDNA,
  assignment: FormatNarrativeAssignment,
  totalFormats: number,
): string {
  return [
    `Campaign style: primary=${styleDNA.primaryColor}, accent=${styleDNA.accentColor}`,
    `Typography personality: ${styleDNA.typographyPersonality}`,
    `Shared tone: ${styleDNA.tone}`,
    `This format's narrative role: ${assignment.beat} (${assignment.beatIndex + 1} of ${totalFormats})`,
    `Messaging emphasis: ${assignment.beatSpec.messagingEmphasis}`,
    `Emotional tone for this beat: ${assignment.beatSpec.emotionalTone}`,
    assignment.isArcStart ? "This is the campaign opener — maximum impact" : "",
    assignment.isArcEnd ? "This is the campaign closer — drive action" : "",
  ].filter(Boolean).join(". ");
}
