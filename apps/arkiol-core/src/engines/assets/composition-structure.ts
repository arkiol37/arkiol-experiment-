// src/engines/assets/composition-structure.ts
//
// Step 59: Structural composition balance.
//
// Earlier steps check that assets LAND in canonical slots (Step 56:
// placement-rules) and that the primary DOMINATES (Step 58: visual-
// dominance). What was still missing was a whole-canvas structural
// read — "does this composition feel like a designed layout, or is it a
// random sprinkling of assets?"
//
// A template fails structural balance when any of the following are true:
//
//   1. Foreground mass is crammed into one quadrant while the composition
//      mode doesn't justify the lateralization. Side-left/side-right
//      heroes are allowed to tilt by design; centered-stack / framed
//      heroes are not.
//
//   2. Two or more canvas quadrants are effectively empty while another
//      carries substantial foreground — an isolated cluster with obvious
//      dead zones. Templates should distribute visual weight, not park
//      everything in one corner.
//
//   3. The composition has three or more foreground elements but their
//      anchors don't fit any canonical arrangement (centered_stack,
//      top_bottom, grid, framed_center). This is the "random scatter"
//      signal that the rest of the pipeline can't catch — anchors can be
//      individually legal while the set of them reads as chaos.
//
//   4. Multiple foreground elements occupy the same vertical band but
//      disagree on their alignment axis — a row of decorations where one
//      aligns left and one aligns center breaks the spacing rhythm and
//      reads as careless.
//
// The module takes a CompositionPlan and returns a list of violations.
// The pipeline treats `error` rows as hard rejections and folds
// `warning` rows into the marketplace-gate scoring layer alongside
// Step 56/58 warnings.

import type {
  Anchor,
  CompositionPlan,
  ElementPlacement,
} from "./asset-selector";
import type { AssetElementType } from "./contract";

// ── Thresholds ───────────────────────────────────────────────────────────────

/**
 * Single-quadrant cap for foreground coverage share. Above this, one
 * corner is visually carrying the entire composition. Side-lateralized
 * heroes (side-left / side-right / background-hero) are exempt — they're
 * allowed to tilt by design.
 */
export const MAX_QUADRANT_SHARE = 0.70;

/**
 * A quadrant is "empty" below this share of canvas foreground mass. Two
 * or more empty quadrants in a layout with meaningful foreground signal
 * an isolated-cluster problem.
 */
export const EMPTY_QUADRANT_SHARE = 0.03;

/**
 * The template must have at least this much foreground mass before the
 * empty-region rule can fire. Avoids false positives on intentionally
 * sparse templates (logo cards, minimalist posters).
 */
export const MIN_FOREGROUND_FOR_EMPTY_CHECK = 0.15;

/**
 * Structural pattern detection kicks in only when the plan has at least
 * this many foreground elements. Fewer than 3 elements don't form a
 * visually-detectable pattern, so we can't fail on "no pattern".
 */
export const MIN_ELEMENTS_FOR_STRUCTURE_CHECK = 3;

// ── Taxonomy helpers ─────────────────────────────────────────────────────────

const SUBSTRATE_TYPES: readonly AssetElementType[] = [
  "texture", "overlay", "background",
];

/** Mirror of visual-dominance's isForeground — primary always counts. */
function isForeground(el: ElementPlacement): boolean {
  if (el.primary) return true;
  if (el.role === "background") return false;
  if (SUBSTRATE_TYPES.includes(el.type)) return false;
  return true;
}

// ── Canvas quadrants ─────────────────────────────────────────────────────────
// Divide the canvas into four quadrants and map each anchor to the
// quadrant(s) it occupies. Anchors that legitimately span two or four
// quadrants (edge-top, center, full-bleed) distribute their coverage
// evenly across the affected quadrants.

export type Quadrant = "TL" | "TR" | "BL" | "BR";

const ANCHOR_QUADRANTS: Record<Anchor, Quadrant[]> = {
  "full-bleed":    ["TL", "TR", "BL", "BR"],
  "top-left":      ["TL"],
  "top-center":    ["TL", "TR"],
  "top-right":     ["TR"],
  "center-left":   ["TL", "BL"],
  "center":        ["TL", "TR", "BL", "BR"],
  "center-right":  ["TR", "BR"],
  "bottom-left":   ["BL"],
  "bottom-center": ["BL", "BR"],
  "bottom-right":  ["BR"],
  "edge-top":      ["TL", "TR"],
  "edge-bottom":   ["BL", "BR"],
};

export function anchorQuadrants(anchor: Anchor): Quadrant[] {
  return ANCHOR_QUADRANTS[anchor];
}

/**
 * Build a { TL, TR, BL, BR } → coverage-sum map from the foreground
 * elements of a plan. Each element's coverageHint is spread evenly across
 * the quadrants it touches (center → 0.25 per quadrant, top-left → 1.0
 * into TL, etc.).
 */
export function quadrantCoverage(
  elements: readonly ElementPlacement[],
): Record<Quadrant, number> {
  const out: Record<Quadrant, number> = { TL: 0, TR: 0, BL: 0, BR: 0 };
  for (const el of elements) {
    if (!isForeground(el)) continue;
    const quads = ANCHOR_QUADRANTS[el.anchor];
    const share = el.coverageHint / quads.length;
    for (const q of quads) out[q] += share;
  }
  return out;
}

// ── Canonical structure detection ────────────────────────────────────────────
// A composition is "canonical" when its anchors match one of the
// shipped-layout archetypes. Modes with an explicit primary declaration
// are canonical by construction. Stack / top-bottom / grid patterns
// emerge from anchor distribution when no primary mode is set.

export type StructuralPattern =
  | "full-bleed-hero"   // primary compositionMode = background-hero
  | "left-right-split"  // primary compositionMode = side-left / side-right
  | "framed-center"     // primary compositionMode = framed-center
  | "centered-stack"    // foreground elements stack along the vertical centerline
  | "top-bottom-split"  // foreground clusters in top-half + bottom-half, center light
  | "grid"              // ≥3 elements spread across ≥3 quadrants at similar coverage
  | "none";             // no canonical pattern — scatter

const TOP_ANCHORS:    readonly Anchor[] = ["top-left", "top-center", "top-right", "edge-top"];
const BOTTOM_ANCHORS: readonly Anchor[] = ["bottom-left", "bottom-center", "bottom-right", "edge-bottom"];
const CENTER_ANCHORS: readonly Anchor[] = ["top-center", "center", "bottom-center", "edge-top", "edge-bottom"];

/**
 * Classify a plan into a canonical structural pattern. Primary-mode
 * patterns win if present; otherwise we look at anchor distribution.
 */
export function detectStructure(plan: CompositionPlan): StructuralPattern {
  const primary = plan.elements.find(e => e.primary);
  switch (primary?.compositionMode) {
    case "background-hero": return "full-bleed-hero";
    case "side-left":
    case "side-right":      return "left-right-split";
    case "framed-center":   return "framed-center";
  }

  const foreground = plan.elements.filter(isForeground);
  if (foreground.length < MIN_ELEMENTS_FOR_STRUCTURE_CHECK) {
    // Trivial compositions read as a centered stack.
    return "centered-stack";
  }

  // Centered layouts: every foreground anchor sits on the vertical
  // centerline. Specialize into `top-bottom-split` when both halves are
  // populated with no element on the true center; otherwise a centered
  // stack. This keeps "headline + cta" compositions distinct from
  // "hero stack down the middle".
  const allCentered = foreground.every(e =>
    CENTER_ANCHORS.includes(e.anchor) || e.anchor === "full-bleed",
  );
  if (allCentered) {
    const hasCenter = foreground.some(e => e.anchor === "center" || e.anchor === "full-bleed");
    const hasTop    = foreground.some(e => TOP_ANCHORS.includes(e.anchor));
    const hasBottom = foreground.some(e => BOTTOM_ANCHORS.includes(e.anchor));
    if (!hasCenter && hasTop && hasBottom) return "top-bottom-split";
    return "centered-stack";
  }

  // Grid: ≥3 elements spread across ≥3 distinct quadrants with coverages
  // within a 2× band (max / min ≤ 2). Grids have a regular cell size.
  const quads = new Set<Quadrant>();
  const coverages: number[] = [];
  for (const el of foreground) {
    for (const q of ANCHOR_QUADRANTS[el.anchor]) quads.add(q);
    coverages.push(el.coverageHint);
  }
  const minCov = Math.min(...coverages);
  const maxCov = Math.max(...coverages);
  if (quads.size >= 3 && foreground.length >= 3 && minCov > 0 && maxCov / minCov <= 2) {
    return "grid";
  }

  return "none";
}

// ── Alignment-band analysis ──────────────────────────────────────────────────

type VerticalBand = "top" | "middle" | "bottom";

function bandForAnchor(a: Anchor): VerticalBand | null {
  if (TOP_ANCHORS.includes(a))    return "top";
  if (BOTTOM_ANCHORS.includes(a)) return "bottom";
  if (a === "center-left" || a === "center" || a === "center-right") return "middle";
  return null;  // full-bleed spans every band
}

// ── Violation shape ──────────────────────────────────────────────────────────

export interface StructureViolation {
  rule:
    | "quadrant_imbalance"       // one quadrant holds > MAX_QUADRANT_SHARE coverage
    | "empty_canvas_region"      // ≥2 empty quadrants with mass elsewhere
    | "unrecognized_structure"   // anchors don't match any canonical pattern
    | "alignment_drift";         // same-band elements disagree on alignment axis
  severity: "error" | "warning";
  message: string;
  metric?:  number;
  quadrant?: Quadrant;
  pattern?:  StructuralPattern;
}

// ── Validator ────────────────────────────────────────────────────────────────

/**
 * Enforce whole-canvas composition balance. Checks foreground quadrant
 * distribution, empty regions, canonical structure, and alignment
 * consistency. Returns every violation encountered; callers surface
 * errors as rejections and fold warnings into marketplace-gate scoring.
 */
export function validateCompositionStructure(
  plan: CompositionPlan,
): StructureViolation[] {
  const violations: StructureViolation[] = [];
  const primary = plan.elements.find(e => e.primary);
  const foreground = plan.elements.filter(isForeground);

  // ── 1. Quadrant imbalance ───────────────────────────────────────────────
  // Side-heroes and background-heroes are canonically lateralized — their
  // dominant quadrants are a feature, not a bug. Every other composition
  // must spread foreground mass more evenly.
  const quadrantsAllowedToTilt =
    primary?.compositionMode === "side-left"       ||
    primary?.compositionMode === "side-right"      ||
    primary?.compositionMode === "background-hero";

  const coverage = quadrantCoverage(foreground);
  const total = coverage.TL + coverage.TR + coverage.BL + coverage.BR;

  if (!quadrantsAllowedToTilt && total > 0) {
    for (const q of ["TL", "TR", "BL", "BR"] as Quadrant[]) {
      const share = coverage[q] / total;
      if (share > MAX_QUADRANT_SHARE) {
        violations.push({
          rule:     "quadrant_imbalance",
          severity: "error",
          metric:   share,
          quadrant: q,
          message:
            `Quadrant ${q} carries ${(share * 100).toFixed(0)}% of foreground ` +
            `mass — above the ${(MAX_QUADRANT_SHARE * 100).toFixed(0)}% cap. ` +
            `Distribute assets across the canvas or promote the composition ` +
            `to a side-left/side-right hero that justifies the tilt.`,
        });
        break;  // one violation is enough; don't duplicate for each quadrant
      }
    }
  }

  // ── 2. Empty canvas regions ─────────────────────────────────────────────
  // When total foreground is meaningful but ≥ 2 quadrants are essentially
  // empty, the visual weight clusters in one spot and leaves obvious
  // dead zones. Full-bleed and side heroes naturally distribute; skip
  // when they're in play.
  if (total >= MIN_FOREGROUND_FOR_EMPTY_CHECK) {
    const emptyQuads = (["TL", "TR", "BL", "BR"] as Quadrant[])
      .filter(q => coverage[q] / total < EMPTY_QUADRANT_SHARE);
    if (emptyQuads.length >= 2 && !quadrantsAllowedToTilt) {
      violations.push({
        rule:     "empty_canvas_region",
        severity: "warning",
        metric:   emptyQuads.length,
        message:
          `${emptyQuads.length} canvas quadrants (${emptyQuads.join(", ")}) carry ` +
          `less than ${(EMPTY_QUADRANT_SHARE * 100).toFixed(0)}% foreground mass ` +
          `each — composition feels isolated. Spread decorations into the dead ` +
          `regions or re-centre the cluster.`,
      });
    }
  }

  // ── 3. Unrecognized structure ───────────────────────────────────────────
  // Only fires on sufficiently dense compositions with no primary mode —
  // primary-mode compositions always match a canonical pattern.
  const pattern = detectStructure(plan);
  if (pattern === "none" && foreground.length >= MIN_ELEMENTS_FOR_STRUCTURE_CHECK) {
    violations.push({
      rule:     "unrecognized_structure",
      severity: "error",
      pattern,
      message:
        `Foreground elements don't match any canonical structure ` +
        `(centered-stack / top-bottom-split / grid / framed-center / ` +
        `left-right-split / full-bleed-hero). Re-anchor the roster onto a ` +
        `shared grid or promote one element to a primary with compositionMode.`,
    });
  }

  // ── 4. Alignment drift ──────────────────────────────────────────────────
  // Within any vertical band (top / middle / bottom), foreground elements
  // should agree on the alignment axis. A row where decorations swing
  // between left and right alignment without a centered spine reads as
  // random rhythm. The primary is exempt — it anchors the composition.
  const bandToAlignments = new Map<VerticalBand, Set<"left" | "center" | "right">>();
  for (const el of foreground) {
    if (el.primary) continue;
    const band = bandForAnchor(el.anchor);
    if (!band) continue;
    const bucket = bandToAlignments.get(band) ?? new Set();
    bucket.add(el.alignment);
    bandToAlignments.set(band, bucket);
  }
  for (const [band, aligns] of bandToAlignments) {
    // A band with 2+ elements and 2+ distinct alignment values drifts.
    // (A single element with one alignment is fine; center + center +
    // left is fine as long as the odd-one-out is the only deviation —
    // but with just three axes, any two distinct values is drift.)
    if (aligns.size >= 2) {
      const count = Array.from(foreground.filter(e =>
        !e.primary && bandForAnchor(e.anchor) === band,
      )).length;
      if (count >= 2) {
        violations.push({
          rule:     "alignment_drift",
          severity: "warning",
          metric:   aligns.size,
          message:
            `${count} foreground elements in the ${band} band disagree on ` +
            `alignment (${Array.from(aligns).join(" / ")}). Share an alignment ` +
            `axis so the row reads as an intentional rhythm, not a scatter.`,
        });
      }
    }
  }

  return violations;
}
