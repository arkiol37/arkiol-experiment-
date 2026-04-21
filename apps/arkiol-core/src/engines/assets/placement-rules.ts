// src/engines/assets/placement-rules.ts
//
// Step 56: Structural placement rules.
//
// The existing asset-placement.ts gives every library kind a per-kind
// anchor / scale / layer rule. What was missing — and what templates
// repeatedly regressed on — is a *structural* contract for the whole
// composition: assets must land in one of a fixed set of canonical
// positions (hero, side-left, side-right, framed-center, background-
// field, top-marker, bottom-marker, corner-accent, inline-icon,
// horizontal-divider) and nowhere else. Random placements and anchor
// collisions that crushed readability are rejected here.
//
// This module pulls the slot taxonomy out of implicit anchor-by-anchor
// reasoning and makes it explicit:
//
//   PlacementSlot              canonical structural position
//   ANCHOR_TO_SLOT             Anchor → PlacementSlot map
//   SLOT_COMPATIBLE_MODES      which primary compositionModes each slot
//                              is allowed to serve as hero
//   SLOT_MIN_EDGE_MARGIN       per-slot safe-area margin (grid-aligned)
//   validatePlacementStructure single entry point used by the pipeline
//
// The validator is declarative — it only inspects the plan we already
// build (ElementPlacement carries zone / role / anchor / alignment /
// coverageHint / primary / compositionMode). It does not require x/y
// coordinates: collision detection works on {zone, anchor} slot
// occupancy and the ANCHOR_TO_SLOT taxonomy.

import type { ZoneId } from "../layout/families";
import type {
  Anchor,
  CompositionMode,
  CompositionPlan,
  ElementPlacement,
} from "./asset-selector";

// ── Canonical slots ──────────────────────────────────────────────────────────
// Every structurally-valid asset lives in exactly one of these. A
// template composes assets slot-by-slot, not anchor-by-anchor, so "two
// stickers at top-right" collapses into one slot and collides.

export type PlacementSlot =
  | "background-field"      // full-bleed backdrop (bg fill / texture)
  | "hero-frame"            // framed-center hero
  | "hero-side-left"        // left-half hero column
  | "hero-side-right"       // right-half hero column
  | "hero-background"       // background-hero full-bleed subject
  | "top-marker"            // title ribbon / banner at top edge
  | "bottom-marker"         // footer ribbon / banner at bottom edge
  | "horizontal-divider"    // full-width rule between blocks
  | "corner-accent-tl"      // small accent pinned to top-left corner
  | "corner-accent-tr"      // small accent pinned to top-right corner
  | "corner-accent-bl"      // small accent pinned to bottom-left corner
  | "corner-accent-br"      // small accent pinned to bottom-right corner
  | "inline-icon-left"      // icon-group inline with left-aligned text
  | "inline-icon-right";    // icon-group inline with right-aligned text

// ── Anchor → slot taxonomy ───────────────────────────────────────────────────
// The slot an element occupies is determined jointly by its anchor and
// role. Corners are accent slots; edges are markers; center is hero.

const CORNER_ANCHOR_TO_SLOT: Record<Anchor, PlacementSlot | null> = {
  "full-bleed":   "background-field",
  "top-left":     "corner-accent-tl",
  "top-center":   "top-marker",
  "top-right":    "corner-accent-tr",
  "center-left":  "hero-side-left",
  "center":       "hero-frame",
  "center-right": "hero-side-right",
  "bottom-left":  "corner-accent-bl",
  "bottom-center":"bottom-marker",
  "bottom-right": "corner-accent-br",
  "edge-top":     "top-marker",
  "edge-bottom":  "bottom-marker",
};

/**
 * Resolve the structural slot an element occupies. Primary visuals and
 * dividers / icons refine the anchor-only map:
 *
 *   - a primary at center becomes `hero-frame` or `hero-background`
 *     depending on compositionMode
 *   - a primary at center-left/right becomes `hero-side-left/right`
 *   - a divider-role element at center collapses to `horizontal-divider`
 *   - an icon-group aligns based on its alignment field, not anchor
 */
export function slotForPlacement(el: ElementPlacement): PlacementSlot {
  if (el.role === "background") return "background-field";

  // Icon groups sit inline with a text block; alignment, not anchor,
  // decides which side.
  if (el.role === "icon-group") {
    return el.alignment === "right" ? "inline-icon-right" : "inline-icon-left";
  }

  // Dividers that span full-width collapse to horizontal-divider
  // regardless of center / edge-top / edge-bottom anchor.
  if (el.role === "divider") {
    if (el.anchor === "edge-top" || el.anchor === "top-center")    return "top-marker";
    if (el.anchor === "edge-bottom" || el.anchor === "bottom-center") return "bottom-marker";
    return "horizontal-divider";
  }

  // Primary placement is hero — refine by compositionMode when present.
  if (el.primary) {
    switch (el.compositionMode) {
      case "background-hero": return "hero-background";
      case "side-left":       return "hero-side-left";
      case "side-right":      return "hero-side-right";
      case "framed-center":   return "hero-frame";
      default:
        // fall through to anchor-based resolution
        break;
    }
  }

  // Non-primary / unspecified — fall back to the coarse anchor map.
  return CORNER_ANCHOR_TO_SLOT[el.anchor] ?? "hero-frame";
}

// ── Slot ↔ compositionMode compatibility ─────────────────────────────────────
// The hero's slot and its compositionMode must agree. A primary flagged
// background-hero that anchors at center-right is inconsistent and
// indicates the selector picked the wrong slot for the chosen mode.

export const SLOT_COMPATIBLE_MODES: Record<PlacementSlot, CompositionMode[]> = {
  "background-field":    [],
  "hero-frame":          ["framed-center"],
  "hero-side-left":      ["side-left"],
  "hero-side-right":     ["side-right"],
  "hero-background":     ["background-hero"],
  "top-marker":          [],
  "bottom-marker":       [],
  "horizontal-divider":  [],
  "corner-accent-tl":    [],
  "corner-accent-tr":    [],
  "corner-accent-bl":    [],
  "corner-accent-br":    [],
  "inline-icon-left":    [],
  "inline-icon-right":   [],
};

// ── Grid & spacing ───────────────────────────────────────────────────────────
// The platform design grid is 12 columns with a 4% gutter. Every
// structural slot declares the minimum safe-area margin (as a fraction
// of the shorter canvas axis) its element must respect. Accents pinned
// to corners may sit tighter than hero artwork, but never closer than
// the minimum — crashing into the bleed erases the grid.

export const PLACEMENT_GRID_COLUMNS = 12;

export const SLOT_MIN_EDGE_MARGIN: Record<PlacementSlot, number> = {
  "background-field":    0,     // full-bleed — margin rule doesn't apply
  "hero-background":     0,     // same — full-bleed subject
  "hero-frame":          0.04,  // inset frame needs breathing room
  "hero-side-left":      0.04,
  "hero-side-right":     0.04,
  "top-marker":          0.02,  // ribbons hug the top edge tightly
  "bottom-marker":       0.02,
  "horizontal-divider":  0.04,  // centered rules keep the 4% gutter
  "corner-accent-tl":    0.03,  // corner accents stay ≥ 3% off both edges
  "corner-accent-tr":    0.03,
  "corner-accent-bl":    0.03,
  "corner-accent-br":    0.03,
  "inline-icon-left":    0.03,
  "inline-icon-right":   0.03,
};

// ── Text-zone adjacency ──────────────────────────────────────────────────────
// A side-composition hero that anchors the same side as an active text
// block will crush readability. Track active text zones and which side
// they naturally sit on so the validator can flag conflicts.

const TEXT_ZONE_SIDE: Partial<Record<ZoneId, "left" | "center" | "right">> = {
  // Layout families place most copy centered; only the bullet column
  // sits on a side. Keeping this map narrow avoids false positives.
  bullet_1: "left",
};

function zoneSide(zone: ZoneId): "left" | "center" | "right" {
  return TEXT_ZONE_SIDE[zone] ?? "center";
}

// ── Violation type ───────────────────────────────────────────────────────────

export interface PlacementStructureViolation {
  rule:
    | "unknown_slot"            // element lands somewhere not in the slot map
    | "slot_collision"          // two meaningful elements share the same slot
    | "hero_slot_mode_mismatch" // primary's slot ≠ compositionMode's slot
    | "anchor_outside_grid"     // element below its slot's min edge margin
    | "hero_overlaps_text_zone" // side hero crashes into an active text zone
    | "too_many_corner_accents" // >2 corner accents overcrowd the composition
    | "divider_stack";          // two horizontal-dividers compressed into one band
  severity: "error" | "warning";
  message: string;
  slot?:    PlacementSlot;
  element?: { type: string; zone: string; anchor: Anchor };
}

// ── Validator ────────────────────────────────────────────────────────────────

// Inspect a composition plan and flag structural-placement violations.
// Callers should raise errors as hard rejections and pipe warnings
// into the marketplace-gate scoring layer.
export function validatePlacementStructure(
  plan:        CompositionPlan,
  activeZones: readonly ZoneId[] = [],
): PlacementStructureViolation[] {
  const violations: PlacementStructureViolation[] = [];

  // ── 1. Slot occupancy & collision ──────────────────────────────────────
  const slotOccupants = new Map<PlacementSlot, ElementPlacement[]>();
  for (const el of plan.elements) {
    const slot = slotForPlacement(el);
    const bucket = slotOccupants.get(slot) ?? [];
    bucket.push(el);
    slotOccupants.set(slot, bucket);
  }

  // Slots that allow multiple occupants. Backgrounds rarely stack but
  // treatments do layer textures + gradients; corner accents and
  // inline-icons are explicitly singletons.
  const multiOccupantSlots: ReadonlySet<PlacementSlot> = new Set<PlacementSlot>([
    "background-field",
  ]);

  for (const [slot, occupants] of slotOccupants) {
    if (occupants.length > 1 && !multiOccupantSlots.has(slot)) {
      violations.push({
        rule: "slot_collision",
        severity: "error",
        slot,
        message:
          `Slot "${slot}" is occupied by ${occupants.length} elements ` +
          `(${occupants.map(o => o.type).join(", ")}). Each structural slot ` +
          `holds at most one meaningful asset — split the picks across ` +
          `different slots (corners, dividers, frame) or drop the duplicate.`,
      });
    }
  }

  // ── 2. Hero slot ↔ compositionMode agreement ────────────────────────────
  // Resolve the slot two ways: (a) from the anchor alone, and (b) from
  // the compositionMode alone. A well-formed primary has them agree.
  // When they disagree, the selector picked an anchor that contradicts
  // the chosen mode — random-looking placement that must be rejected.
  const MODE_EXPECTED_SLOT: Record<CompositionMode, PlacementSlot> = {
    "background-hero": "hero-background",
    "side-left":       "hero-side-left",
    "side-right":      "hero-side-right",
    "framed-center":   "hero-frame",
  };
  const primary = plan.elements.find(e => e.primary);
  if (primary && primary.compositionMode) {
    const anchorSlot = CORNER_ANCHOR_TO_SLOT[primary.anchor];
    const expectedSlot = MODE_EXPECTED_SLOT[primary.compositionMode];
    if (anchorSlot && expectedSlot && anchorSlot !== expectedSlot) {
      violations.push({
        rule: "hero_slot_mode_mismatch",
        severity: "error",
        slot: anchorSlot,
        element: { type: primary.type, zone: primary.zone, anchor: primary.anchor },
        message:
          `Primary visual anchored "${primary.anchor}" (slot "${anchorSlot}") ` +
          `contradicts compositionMode "${primary.compositionMode}" ` +
          `(expects slot "${expectedSlot}"). Align the anchor to the chosen ` +
          `mode or switch the mode to match the anchor.`,
      });
    }
  }

  // ── 3. Side-hero × text-zone overlap ────────────────────────────────────
  if (primary &&
      (primary.compositionMode === "side-left" || primary.compositionMode === "side-right")) {
    const heroSide = primary.compositionMode === "side-left" ? "left" : "right";
    const clashingZones = activeZones
      .filter(z => zoneSide(z) === heroSide)
      .map(z => String(z));
    if (clashingZones.length > 0) {
      violations.push({
        rule: "hero_overlaps_text_zone",
        severity: "error",
        slot: slotForPlacement(primary),
        element: { type: primary.type, zone: primary.zone, anchor: primary.anchor },
        message:
          `Side-${heroSide} hero would overlap text zones on the same side ` +
          `(${clashingZones.join(", ")}). Swap the hero to the opposite side or ` +
          `move the text column — assets must not collide with readable text.`,
      });
    }
  }

  // ── 4. Corner-accent crowding ───────────────────────────────────────────
  // Four corners are available; letting three or four all hold accents
  // crushes the grid and fights the hero for attention. The soft cap is
  // two, applied as a warning so layouts that need a third can still
  // ship but surface the cost.
  const cornerSlots: PlacementSlot[] = [
    "corner-accent-tl", "corner-accent-tr",
    "corner-accent-bl", "corner-accent-br",
  ];
  const occupiedCorners = cornerSlots.filter(s => (slotOccupants.get(s)?.length ?? 0) > 0);
  if (occupiedCorners.length > 2) {
    violations.push({
      rule: "too_many_corner_accents",
      severity: "warning",
      message:
        `${occupiedCorners.length} corners carry accents — cap is 2 before ` +
        `corner decorations start fighting the hero. Drop one accent or ` +
        `reassign it to a side or divider slot.`,
    });
  }

  // ── 5. Divider stacking ─────────────────────────────────────────────────
  const hDividers = slotOccupants.get("horizontal-divider")?.length ?? 0;
  const topMarkers = slotOccupants.get("top-marker")?.length ?? 0;
  const botMarkers = slotOccupants.get("bottom-marker")?.length ?? 0;
  if (hDividers + topMarkers + botMarkers > 2) {
    violations.push({
      rule: "divider_stack",
      severity: "warning",
      message:
        `${hDividers + topMarkers + botMarkers} horizontal separators (dividers / ribbons / banners) ` +
        `in one composition — more than 2 compress the vertical rhythm. ` +
        `Keep one section marker + one divider at most.`,
    });
  }

  // ── 6. Grid / edge-margin alignment ─────────────────────────────────────
  // The ElementPlacement type doesn't carry explicit margins, but the
  // scale is bounded [0, 1] of the shorter axis and anchors pin the
  // element. We flag any meaningful element whose coverageHint is so
  // large for its slot that it would have to punch past the slot's safe-
  // area margin (coverage + margin > 1.0 means the element needs more
  // room than the slot allows).
  for (const el of plan.elements) {
    const slot = slotForPlacement(el);
    const minMargin = SLOT_MIN_EDGE_MARGIN[slot];
    if (minMargin === 0) continue;                     // full-bleed slots
    if (el.role === "background") continue;            // bg ignores margin
    // Accent & icon-group slots are small by construction — if a badge
    // got scaled past 0.9 it's effectively full-bleed, which means the
    // slot was mis-assigned or the scale clamp failed.
    const slotMaxExtent = 1 - 2 * minMargin;
    if (el.coverageHint > slotMaxExtent + 0.02) {
      violations.push({
        rule: "anchor_outside_grid",
        severity: "warning",
        slot,
        element: { type: el.type, zone: el.zone, anchor: el.anchor },
        message:
          `Element (${el.type}, anchor=${el.anchor}) has coverage ` +
          `${(el.coverageHint * 100).toFixed(0)}% but slot "${slot}" keeps a ` +
          `${(minMargin * 100).toFixed(0)}% edge margin — element will crash ` +
          `past the grid. Clamp its scale or promote it to a full-bleed slot.`,
      });
    }
  }

  // ── 7. Unknown-slot fallback ────────────────────────────────────────────
  // ANCHOR_TO_SLOT is total over the Anchor union — this branch catches
  // forward-compat regressions where a new anchor value lands in the
  // plan without a slot mapping.
  for (const el of plan.elements) {
    if (CORNER_ANCHOR_TO_SLOT[el.anchor] === null) {
      violations.push({
        rule: "unknown_slot",
        severity: "error",
        element: { type: el.type, zone: el.zone, anchor: el.anchor },
        message:
          `Element (${el.type}) uses anchor "${el.anchor}" which has no ` +
          `structural slot. Placement would be random — add the anchor to ` +
          `ANCHOR_TO_SLOT or route the element through a known anchor.`,
      });
    }
  }

  return violations;
}

// ── Helpers surfaced for callers / tests ─────────────────────────────────────

/** Reverse lookup — every slot with at least one occupant in the plan. */
export function occupiedSlots(plan: CompositionPlan): PlacementSlot[] {
  const seen = new Set<PlacementSlot>();
  for (const el of plan.elements) seen.add(slotForPlacement(el));
  return [...seen];
}

/** Convenience: the anchors that correspond to a given slot. */
export function anchorsForSlot(slot: PlacementSlot): Anchor[] {
  const out: Anchor[] = [];
  for (const [anchor, s] of Object.entries(CORNER_ANCHOR_TO_SLOT) as [Anchor, PlacementSlot | null][]) {
    if (s === slot) out.push(anchor);
  }
  return out;
}
