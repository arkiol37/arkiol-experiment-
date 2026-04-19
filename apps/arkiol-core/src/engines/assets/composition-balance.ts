// src/engines/assets/composition-balance.ts
// Composition balance — text vs. visual support.
//
// Step 20 introduces an explicit balance metric so templates don't drift
// into "wall of text" or "floating decorations on an empty canvas". Each
// active text zone adds to a weighted text score; each visible meaningful
// visual adds to a weighted visual score. The ratio of the two is checked
// against a target band. When a plan falls outside the band we can either
// flag it (for debugging / reasoning output) or rebalance by adding
// decorative components targeted at the weak side.
//
// This module is a pure analyzer + a targeted rebalancer. It does NOT
// replace the existing "enforceTextVisualBalance" cap — that rule prevents
// over-decoration (the upper ceiling). This module handles the inverse
// case: under-decoration relative to text load.

import type { ZoneId }      from "../layout/families";
import type { BriefAnalysis } from "../ai/brief-analyzer";

import { composeDecorativeRoster } from "./decorative-components";

// ── Target band ──────────────────────────────────────────────────────────────
// Ratio = visualScore / textScore. Values outside this band count as
// unbalanced. Band is intentionally wide because good designs span a range
// of ratios — we only want to catch the clear outliers.

export const BALANCE_MIN_RATIO = 0.45;   // below this → text-heavy
export const BALANCE_MAX_RATIO = 2.40;   // above this → visually-overloaded

// ── Zone weights ─────────────────────────────────────────────────────────────
// Different text zones carry different amounts of copy. A headline is one
// line; a body paragraph can be five. Weights encode the expected visual
// mass each zone contributes.

const TEXT_ZONE_WEIGHT: Partial<Record<ZoneId, number>> = {
  headline:       1.5,
  title:          1.2,
  subhead:        1.0,
  section_header: 1.0,
  body:           2.2,   // long-form is the biggest contributor
  tagline:        0.7,
  cta:            0.6,
  badge:          0.4,
  price:          0.5,
  name:           0.4,
  company:        0.4,
  contact:        0.3,
  legal:          0.3,
  bullet_1:       0.8,
  bullet_2:       0.8,
  bullet_3:       0.8,
};

// Every text zone we care about. Zones outside this list don't contribute
// to text density.
const TEXT_ZONES: ReadonlyArray<ZoneId> = Object.keys(TEXT_ZONE_WEIGHT) as ZoneId[];

// ── Plan shape (narrow contract) ─────────────────────────────────────────────
// Accept only what we need from the caller's CompositionPlan so this module
// doesn't pull in the full asset-selector surface and cause a circular
// import through composeDecorativeRoster + selector.

export interface BalanceElement {
  role:         "background" | "support" | "accent" | "divider" | "icon-group";
  coverageHint: number;
  url?:         string;
  prompt:       string;
}

export interface BalanceInput {
  elements:    readonly BalanceElement[];
  activeZones: readonly ZoneId[];
  brief:       BriefAnalysis;
}

// ── Report ───────────────────────────────────────────────────────────────────

export type BalanceBand = "text-heavy" | "visually-overloaded" | "balanced";

export interface BalanceReport {
  textZoneCount:        number;
  textScore:            number;      // weighted
  visualCount:          number;      // meaningful visuals only
  visibleVisualCount:   number;      // ... that actually render
  backgroundCount:      number;
  meaningfulCoverage:   number;      // summed coverage of visible meaningful visuals
  visualScore:          number;      // weighted
  ratio:                number;      // visualScore / textScore (0 when textScore=0)
  band:                 BalanceBand;
  notes:                string[];
}

// Visual score weights. Accent/divider/icon-group contribute less than
// support, because they're small. Background doesn't count toward visual
// density — it's the canvas, not content.
const VISUAL_ROLE_WEIGHT: Record<BalanceElement["role"], number> = {
  background:    0,
  support:       1.6,
  divider:       0.7,
  "icon-group":  0.6,
  accent:        0.5,
};

function isMeaningfulRole(role: BalanceElement["role"]): boolean {
  return role !== "background";
}

function isVisible(e: BalanceElement): boolean {
  const hasContent = (typeof e.url === "string" && e.url.length > 0)
                  || (typeof e.prompt === "string" && e.prompt.trim().length > 0);
  return hasContent && e.coverageHint >= 0.02;
}

// ── Brief → expected text mass ───────────────────────────────────────────────
// A quick length-based bump so templates with especially long copy demand
// more visual support, not just "enough to match the zone count".

function briefTextMultiplier(brief: BriefAnalysis): number {
  const totalChars = [
    brief.headline ?? "",
    brief.intent   ?? "",
    ...(brief.keywords ?? []),
  ].reduce((sum, s) => sum + s.length, 0);
  // 0 chars → 1.0; ~200 chars → 1.25; ~400 chars → 1.5; capped at 1.75
  return Math.min(1.75, 1 + totalChars / 800);
}

// ── Analyzer ─────────────────────────────────────────────────────────────────

export function analyzeBalance(input: BalanceInput): BalanceReport {
  // Text side.
  const activeTextZones = input.activeZones.filter(z => TEXT_ZONES.includes(z));
  const textZoneCount   = activeTextZones.length;
  const baseTextScore   = activeTextZones
    .reduce((s, z) => s + (TEXT_ZONE_WEIGHT[z] ?? 0), 0);
  const textScore       = baseTextScore * briefTextMultiplier(input.brief);

  // Visual side.
  const meaningful = input.elements.filter(e => isMeaningfulRole(e.role));
  const visible    = meaningful.filter(isVisible);
  const backgrounds = input.elements.filter(e => e.role === "background").length;
  const meaningfulCoverage = visible.reduce((s, e) => s + e.coverageHint, 0);
  const visualScore = visible.reduce(
    (s, e) => s + VISUAL_ROLE_WEIGHT[e.role] * (0.6 + 0.4 * e.coverageHint),
    0,
  );

  const ratio = textScore === 0 ? 0 : visualScore / textScore;

  let band: BalanceBand;
  const notes: string[] = [];
  if (textScore === 0) {
    // No text → can't be "text-heavy" by definition. If we have visuals
    // we're balanced; if we don't, that's a presence problem, not a
    // balance one.
    band = "balanced";
    notes.push("no text zones active → balance check skipped");
  } else if (ratio < BALANCE_MIN_RATIO) {
    band = "text-heavy";
    notes.push(
      `ratio ${ratio.toFixed(2)} < min ${BALANCE_MIN_RATIO} — ` +
      `${textZoneCount} text zone(s) are under-supported by ${visible.length} visual(s)`,
    );
  } else if (ratio > BALANCE_MAX_RATIO) {
    band = "visually-overloaded";
    notes.push(
      `ratio ${ratio.toFixed(2)} > max ${BALANCE_MAX_RATIO} — ` +
      `${visible.length} visuals overwhelm ${textZoneCount} text zone(s)`,
    );
  } else {
    band = "balanced";
    notes.push(`ratio ${ratio.toFixed(2)} inside target band`);
  }

  return {
    textZoneCount,
    textScore,
    visualCount:         meaningful.length,
    visibleVisualCount:  visible.length,
    backgroundCount:     backgrounds,
    meaningfulCoverage,
    visualScore,
    ratio,
    band,
    notes,
  };
}

// ── Rebalance plan ───────────────────────────────────────────────────────────
// When a plan reads as text-heavy we inject decorative components targeted
// at content support: a framed info card behind a body block, a label chip
// near a CTA, a divider between sections. Components are chosen so they
// *contain* or *decorate* text rather than compete with it — the goal is
// better relationship between text and visuals, not more noise.

export interface RebalanceSuggestion {
  // Asset-compatible asset generated by composeDecorativeRoster. The caller
  // routes this through libraryAssetToPlacement / the same pipeline that
  // handles library picks, so no new placement logic is needed.
  asset:    import("../../lib/asset-library").Asset;
  rationale:string;
}

export interface RebalancePlan {
  report:      BalanceReport;
  action:      "add-components" | "none";
  suggestions: RebalanceSuggestion[];
}

export interface RebalanceOptions {
  // Cap how many components a single rebalance pass can add. Default 2 so
  // the upper ceiling (enforceTextVisualBalance) has headroom and we don't
  // ping-pong between adding and dropping.
  maxAdditions?: number;
  // Stable string for deterministic component picks.
  seed?:         string;
}

// Pick which component kinds make sense for a text-heavy plan given the
// active zones. Checklist blocks + framed cards land nicely around body
// text; label chips give CTAs/categories extra visual weight; dividers
// separate stacked sections.
function componentKindsForTextHeavy(activeZones: readonly ZoneId[]) {
  const has = (z: ZoneId) => activeZones.includes(z);

  const kinds: Array<import("./decorative-components").DecorativeComponentKind> = [];
  if (has("body") || has("bullet_1") || has("bullet_2") || has("bullet_3")) {
    kinds.push("framed-info-card", "checklist-block");
  }
  if (has("section_header") || has("subhead")) {
    kinds.push("divider", "ribbon");
  }
  if (has("cta") || has("tagline") || has("badge")) {
    kinds.push("label-chip", "badge");
  }
  // Always allow an accent group as a soft filler when everything else is busy.
  kinds.push("accent-group");
  return kinds;
}

export function planRebalance(
  input: BalanceInput,
  opts:  RebalanceOptions = {},
): RebalancePlan {
  const report = analyzeBalance(input);

  if (report.band !== "text-heavy") {
    return { report, action: "none", suggestions: [] };
  }

  const max = Math.max(1, opts.maxAdditions ?? 2);
  const seed = opts.seed ?? (input.brief.headline ?? "rebalance");
  const kinds = componentKindsForTextHeavy(input.activeZones);

  // composeDecorativeRoster picks at most one per kind; passing a curated
  // kind list here biases the roster toward components that support text
  // rather than generic accent fillers.
  const roster = composeDecorativeRoster({
    seed:     `${seed}::rebalance`,
    limit:    max,
    kinds,
  });

  const suggestions: RebalanceSuggestion[] = roster.map(asset => ({
    asset,
    rationale:
      `text-heavy (ratio ${report.ratio.toFixed(2)} < ${BALANCE_MIN_RATIO}): ` +
      `inject ${asset.kind} "${asset.label}" to support text zones`,
  }));

  return {
    report,
    action: suggestions.length > 0 ? "add-components" : "none",
    suggestions,
  };
}
