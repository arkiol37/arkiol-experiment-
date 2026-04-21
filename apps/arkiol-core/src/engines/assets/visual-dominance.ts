// src/engines/assets/visual-dominance.ts
//
// Step 58: Visual-dominance enforcement.
//
// Earlier steps made sure a primary visual EXISTS (Step 8: presence) and
// that it LANDS in a structural slot (Step 9: placement). What they
// don't enforce is that the primary actually DOMINATES — that it's the
// one thing the eye reads first, with decorations and text arranged
// around it rather than competing with it.
//
// A template fails visual dominance when any of the following are true:
//
//   1. A non-primary asset is large enough to compete with the hero.
//      Every decoration should read as secondary — a sticker that covers
//      almost as much area as the hero dilutes the focal point.
//
//   2. The sum of foreground (non-background) coverage is small enough
//      that the template is visually dominated by gradient / solid-fill
//      background. "Gradient + tiny sticker" is a dead layout.
//
//   3. Multiple non-primary visuals claim focal weight — two or more
//      decorations near the hero's coverage threshold split the viewer's
//      attention across "what is this template about?"
//
//   4. The primary is buried on a low depth tier (surface / ground) where
//      textures and gradients also live. A hero must sit on `mid` or
//      above so shadowing and z-order lift it off the canvas.
//
// These rules fire in addition to the Step 8 presence checks and Step 37
// hero-composition checks. Step 8 catches "primary is missing / abstract
// / below 15% coverage"; Step 37 catches "primary has no compositionMode
// / hero overlaps text"; this module catches "primary exists but doesn't
// dominate".

import type {
  ElementPlacement,
  CompositionPlan,
} from "./asset-selector";
import type { AssetElementType } from "./contract";
import { tierForKind, tierForRole, type DepthTier } from "./depth-layering";

// ── Thresholds ───────────────────────────────────────────────────────────────

/**
 * Primary coverage must be at least this multiple of the next-largest
 * foreground element. Below this ratio, the hero doesn't read as a
 * clear focal point — decorations start competing. Tuned conservatively:
 * 1.5× lets a single large supporting illustration coexist, but blocks
 * "primary 20% + sticker 18%" compositions where both read as heroes.
 */
export const MIN_DOMINANCE_RATIO = 1.5;

/**
 * Minimum combined coverage of non-background foreground elements. When
 * the primary + decorations together fill less than this, the template
 * is visually carried by whatever's behind them (gradient, solid fill,
 * ambient texture) and lacks a strong visual identity.
 */
export const MIN_FOREGROUND_COVERAGE = 0.25;

/**
 * A non-primary foreground element whose coverage is at least this
 * fraction of the primary's is flagged as a competing focal point.
 * Tighter than MIN_DOMINANCE_RATIO's implicit threshold (1/1.5 ≈ 0.67)
 * — this is the warning band that catches multi-hero layouts that
 * scrape past the hard ratio check.
 */
export const COMPETING_FOCAL_RATIO = 0.70;

// ── Taxonomy helpers ─────────────────────────────────────────────────────────

/**
 * Types that are always substrate, not subject — textures, overlays, and
 * full-canvas background fills. A non-primary element of one of these
 * types is treated as background.
 */
const SUBSTRATE_TYPES: readonly AssetElementType[] = [
  "texture", "overlay", "background",
];

/**
 * Is this element part of the foreground stack for dominance analysis?
 *
 *   - The primary is ALWAYS foreground, even when its compositionMode is
 *     background-hero (type="background"): it's still the focal subject.
 *   - A non-primary element with role="background" is always bg.
 *   - A non-primary element whose type is a substrate type (texture /
 *     overlay / background) is bg.
 *   - Everything else — illustrations, objects, stickers, badges, frames,
 *     ribbons, icons, atmospheric elements — counts as foreground.
 */
function isForeground(el: ElementPlacement): boolean {
  if (el.primary) return true;
  if (el.role === "background") return false;
  if (SUBSTRATE_TYPES.includes(el.type)) return false;
  return true;
}

/** Tiers that a hero is allowed to inhabit — mid or above. */
const HERO_ALLOWED_TIERS: ReadonlySet<DepthTier> = new Set<DepthTier>([
  "mid", "raised", "elevated", "floating",
]);

// ── Violation shape ──────────────────────────────────────────────────────────

export interface DominanceViolation {
  rule:
    | "primary_not_dominant"       // primary / next-largest < MIN_DOMINANCE_RATIO
    | "foreground_too_sparse"      // sum(foreground coverage) < MIN_FOREGROUND_COVERAGE
    | "competing_focal_points"     // 2+ non-primary elements near hero coverage
    | "primary_on_weak_tier";      // primary sits on surface / ground depth tier
  severity: "error" | "warning";
  message:  string;
  metric?:  number;   // numeric value that triggered the violation (ratio / sum)
  element?: { type: string; zone: string };
}

// ── Validator ────────────────────────────────────────────────────────────────

/**
 * Check visual dominance for a composition plan. Returns every violation
 * encountered — callers treat "error" rows as hard rejections and pipe
 * "warning" rows into the marketplace-gate scoring layer alongside
 * layered / gridAligned / assetRich metrics.
 *
 * This function is purely declarative: it reads `coverageHint`, `role`,
 * `type`, `primary`, `depthTier` / derived tier from ElementPlacement.
 * It does NOT re-pick assets or mutate the plan.
 */
export function validateVisualDominance(
  plan: CompositionPlan,
): DominanceViolation[] {
  const violations: DominanceViolation[] = [];

  const foreground = plan.elements.filter(isForeground);
  const primary    = plan.elements.find(e => e.primary);

  // Dominance rules only apply when a primary exists. If none exists,
  // Step 8 (primary_visual_missing) and Step 37 (hero_missing) already
  // own that error — we silently no-op here to avoid duplicate noise.
  if (!primary) return violations;

  const others = foreground.filter(e => e !== primary);

  // ── 1. Primary not dominant ────────────────────────────────────────────
  // Ratio of primary coverage to the single largest non-primary
  // foreground element. Below MIN_DOMINANCE_RATIO the hero gets
  // visually matched by a decoration.
  const maxOther = others.reduce((m, e) => Math.max(m, e.coverageHint), 0);
  if (maxOther > 0) {
    const ratio = primary.coverageHint / maxOther;
    if (ratio < MIN_DOMINANCE_RATIO) {
      violations.push({
        rule:     "primary_not_dominant",
        severity: "error",
        metric:   ratio,
        element:  { type: primary.type, zone: primary.zone },
        message:
          `Primary visual coverage ${(primary.coverageHint * 100).toFixed(1)}% is only ` +
          `${ratio.toFixed(2)}× the next-largest foreground element ` +
          `(${(maxOther * 100).toFixed(1)}%) — below the ${MIN_DOMINANCE_RATIO}× ` +
          `dominance floor. Scale the primary up, shrink the competing decoration, ` +
          `or demote one of them.`,
      });
    }
  }

  // ── 2. Foreground too sparse ──────────────────────────────────────────
  // Total non-background coverage. When this is small the viewer's eye
  // falls onto the gradient / solid bg and the template reads empty.
  const foregroundSum = foreground.reduce((s, e) => s + e.coverageHint, 0);
  if (foregroundSum < MIN_FOREGROUND_COVERAGE) {
    violations.push({
      rule:     "foreground_too_sparse",
      severity: "error",
      metric:   foregroundSum,
      message:
        `Foreground covers only ${(foregroundSum * 100).toFixed(1)}% of the canvas — below ` +
        `the ${(MIN_FOREGROUND_COVERAGE * 100).toFixed(0)}% floor. The template is ` +
        `dominated by gradient / empty space. Add decoration mass or scale the primary up.`,
    });
  }

  // ── 3. Competing focal points ─────────────────────────────────────────
  // Non-primary foreground elements whose coverage is within
  // COMPETING_FOCAL_RATIO of the primary compete for the eye.
  const focalThreshold = primary.coverageHint * COMPETING_FOCAL_RATIO;
  const competitors = others.filter(e => e.coverageHint >= focalThreshold);
  if (competitors.length > 0) {
    violations.push({
      rule:     "competing_focal_points",
      severity: "warning",
      metric:   competitors.length,
      message:
        `${competitors.length} non-primary element(s) (${competitors.map(c => c.type).join(", ")}) ` +
        `reach ≥${(COMPETING_FOCAL_RATIO * 100).toFixed(0)}% of the primary's coverage — ` +
        `they'll split the viewer's attention. Shrink or demote them so the hero stays the focal point.`,
    });
  }

  // ── 4. Primary on weak tier ───────────────────────────────────────────
  // The primary must live on `mid` or higher — surface / ground tiers
  // are where background fills and textures sit. A hero on surface
  // reads as background art instead of a focal subject.
  const primaryTier = resolveTier(primary);
  if (!HERO_ALLOWED_TIERS.has(primaryTier)) {
    violations.push({
      rule:     "primary_on_weak_tier",
      severity: "warning",
      element:  { type: primary.type, zone: primary.zone },
      message:
        `Primary visual sits on depth tier "${primaryTier}" — heroes must live on ` +
        `mid / raised / elevated / floating so z-order + shadowing lift them off the ` +
        `canvas. Promote the tier or switch the asset kind.`,
    });
  }

  return violations;
}

// ── Tier resolution ──────────────────────────────────────────────────────────
// ElementPlacement doesn't always carry an explicit depthTier field — the
// renderer derives it from kind / role at paint time. We mirror that
// derivation here so validation runs without requiring the optional tier
// to be pre-stamped on every element.

function resolveTier(el: ElementPlacement): DepthTier {
  const explicit = (el as { depthTier?: DepthTier }).depthTier;
  if (explicit) return explicit;
  // No kind exposed on ElementPlacement — fall back to role-based tier.
  // (Kind-based tier resolution happens during plan construction via
  // resolveLayerForKind; by the time this validator runs, layer is
  // baked in but kind isn't. Role is the stable signal.)
  return tierForRole(el.role);
}

// Also expose tierForKind for callers that want to sanity-check a kind
// before building a placement.
export { tierForKind };
