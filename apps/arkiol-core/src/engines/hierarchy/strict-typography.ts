// src/engines/hierarchy/strict-typography.ts
//
// Strict typography hierarchy enforcer.
//
// Existing enforcer.ts validates per-zone weight + checks size ordering in a
// simple (headline > subhead > body > legal) chain. That guarantees ordering
// but doesn't guarantee *visual separation* — body and subhead can end up
// within a few pixels of each other and the result reads as flat.
//
// This module enforces a stronger hierarchy:
//
//   1. Role-minimum size *ratios* (headline ≥ 2.2× body, subhead ≥ 1.3× body,
//      headline ≥ 1.5× subhead, CTA between 1.05× body and 0.6× headline).
//   2. Role-minimum weight gaps (headline weight must be ≥ body weight + 200,
//      CTA weight ≥ 700, subhead ≥ 500, legal ≤ 400).
//   3. Role-specific letter-spacing (tight headlines, wider CTAs/badges) and
//      textTransform (CTA/badge/eyebrow read as uppercase micro-caps).
//
// Violations are corrected in place, bounded by each zone's minFontSize /
// maxFontSize. If a ratio can't be met because the zone caps forbid it, the
// smaller zone is scaled *down* instead of the larger one scaled *up*.

import type { Zone, ZoneId } from "../layout/families";

// ── Public shape ───────────────────────────────────────────────────────────

export interface TypographyItem {
  zoneId:         ZoneId | string;
  text:           string;
  fontSize:       number;
  weight:         number;
  color:          string;
  fontFamily:     string;
  letterSpacing?: number;            // as multiplier of fontSize (e.g. 0.04 = 4%)
  textTransform?: "uppercase" | "none";
}

export interface HierarchyAdjustment {
  zoneId: string;
  field:  "fontSize" | "weight" | "letterSpacing" | "textTransform";
  from:   string;
  to:     string;
  reason: string;
}

export interface StrictHierarchyResult {
  items:       TypographyItem[];
  adjustments: HierarchyAdjustment[];
}

// ── Role policy ────────────────────────────────────────────────────────────
//
// Each role maps to an "emphasis tier" that governs the size / weight /
// tracking bounds. Zones not listed here are treated as `supporting`.

type Tier = "display" | "sub_display" | "primary" | "support" | "action" | "micro";

const ZONE_TIER: Partial<Record<string, Tier>> = {
  headline:       "display",
  name:           "display",
  price:          "display",

  subhead:        "sub_display",
  tagline:        "sub_display",
  title:          "sub_display",

  body:           "primary",
  contact:        "primary",
  company:        "primary",
  bullet_1:       "primary",
  bullet_2:       "primary",
  bullet_3:       "primary",

  cta:            "action",
  badge:          "micro",
  eyebrow:        "micro",
  section_header: "micro",

  legal:          "support",
};

interface TierPolicy {
  minWeight:       number;
  maxWeight:       number;
  letterSpacing:   number;      // × fontSize
  textTransform:   "uppercase" | "none";
}

const TIER_POLICY: Record<Tier, TierPolicy> = {
  display:      { minWeight: 700, maxWeight: 900, letterSpacing: -0.010, textTransform: "none"      },
  sub_display:  { minWeight: 500, maxWeight: 650, letterSpacing:  0.000, textTransform: "none"      },
  primary:      { minWeight: 400, maxWeight: 500, letterSpacing:  0.000, textTransform: "none"      },
  support:      { minWeight: 300, maxWeight: 400, letterSpacing:  0.015, textTransform: "none"      },
  action:       { minWeight: 700, maxWeight: 800, letterSpacing:  0.055, textTransform: "uppercase" },
  micro:        { minWeight: 600, maxWeight: 700, letterSpacing:  0.080, textTransform: "uppercase" },
};

// ── Size-ratio policy ──────────────────────────────────────────────────────
//
// Ratios are evaluated against whichever zone is present. If body is absent,
// fall back to subhead as the reference. If neither subhead nor body exist,
// the ratio constraint is skipped.

const RATIO_HEADLINE_TO_BODY    = 2.2;
const RATIO_HEADLINE_TO_SUBHEAD = 1.5;
const RATIO_SUBHEAD_TO_BODY     = 1.3;
const RATIO_CTA_OVER_BODY       = 1.05;
const RATIO_CTA_UNDER_HEADLINE  = 0.60;

// ── Helpers ────────────────────────────────────────────────────────────────

function clampFontSize(zone: Zone | undefined, size: number): number {
  const lo = zone?.minFontSize ?? 8;
  const hi = zone?.maxFontSize ?? 400;
  return Math.min(hi, Math.max(lo, Math.round(size)));
}

function clampWeight(weight: number, policy: TierPolicy, zoneAllowed?: number[]): number {
  let w = Math.min(policy.maxWeight, Math.max(policy.minWeight, weight));
  if (zoneAllowed?.length) {
    w = zoneAllowed.reduce((best, v) => Math.abs(v - w) < Math.abs(best - w) ? v : best, zoneAllowed[0]);
  }
  return w;
}

function zoneOfId(zones: Zone[], id: string): Zone | undefined {
  return zones.find(z => z.id === id);
}

function itemOfId(items: TypographyItem[], id: string): TypographyItem | undefined {
  return items.find(c => c.zoneId === id);
}

function record(
  adjustments: HierarchyAdjustment[],
  zoneId:      string,
  field:       HierarchyAdjustment["field"],
  from:        string | number,
  to:          string | number,
  reason:      string,
): void {
  if (String(from) === String(to)) return;
  adjustments.push({ zoneId, field, from: String(from), to: String(to), reason });
}

// ── Enforcement passes ─────────────────────────────────────────────────────

function enforceTierPolicy(
  items:        TypographyItem[],
  zones:        Zone[],
  adjustments:  HierarchyAdjustment[],
): void {
  for (const item of items) {
    const tier   = ZONE_TIER[item.zoneId] ?? "support";
    const policy = TIER_POLICY[tier];
    const zone   = zoneOfId(zones, item.zoneId);

    // Weight
    const clamped = clampWeight(item.weight, policy, zone?.constraints?.fontWeight);
    if (clamped !== item.weight) {
      record(adjustments, item.zoneId, "weight", item.weight, clamped, `tier=${tier}`);
      item.weight = clamped;
    }

    // Letter-spacing — only set if not already explicitly provided
    if (item.letterSpacing === undefined) {
      item.letterSpacing = policy.letterSpacing;
      record(adjustments, item.zoneId, "letterSpacing", "default", policy.letterSpacing, `tier=${tier}`);
    }

    // Text transform — only set when absent (don't clobber explicit values)
    if (!item.textTransform) {
      item.textTransform = policy.textTransform;
      if (policy.textTransform === "uppercase") {
        record(adjustments, item.zoneId, "textTransform", "none", "uppercase", `tier=${tier}`);
      }
    }
  }
}

/**
 * Enforce the weight gap between display and primary zones. Even if the
 * theme gave the headline weight 600, the display policy already clamped it
 * to ≥700 in `enforceTierPolicy`. This second pass guarantees a *gap* of at
 * least 200 between headline and body/CTA, so they never read as equivalent.
 */
function enforceWeightGap(
  items:       TypographyItem[],
  adjustments: HierarchyAdjustment[],
): void {
  const headline = itemOfId(items, "headline") ?? itemOfId(items, "name");
  const body     = itemOfId(items, "body") ?? itemOfId(items, "contact") ?? itemOfId(items, "bullet_1");
  if (!headline || !body) return;
  if (headline.weight - body.weight < 200) {
    const target = Math.min(900, body.weight + 200);
    if (target !== headline.weight) {
      record(adjustments, headline.zoneId, "weight", headline.weight, target,
        `weight gap headline−body < 200`);
      headline.weight = target;
    }
  }
}

/**
 * Enforce the minimum size ratios. If a ratio is violated, first try to raise
 * the larger zone (bounded by its maxFontSize), then lower the smaller zone
 * (bounded by its minFontSize) until the ratio is met or neither can move.
 */
function enforceSizeRatios(
  items:        TypographyItem[],
  zones:        Zone[],
  adjustments:  HierarchyAdjustment[],
): void {
  const pairs: Array<{ bigId: string; smallId: string; ratio: number; reason: string }> = [
    { bigId: "headline", smallId: "body",    ratio: RATIO_HEADLINE_TO_BODY,    reason: "headline must be ≥2.2× body" },
    { bigId: "headline", smallId: "subhead", ratio: RATIO_HEADLINE_TO_SUBHEAD, reason: "headline must be ≥1.5× subhead" },
    { bigId: "subhead",  smallId: "body",    ratio: RATIO_SUBHEAD_TO_BODY,    reason: "subhead must be ≥1.3× body" },
    // name parallels headline for business_card/logo contexts
    { bigId: "name",     smallId: "title",   ratio: 1.5,                       reason: "name must be ≥1.5× title" },
    { bigId: "name",     smallId: "contact", ratio: RATIO_HEADLINE_TO_BODY,    reason: "name must be ≥2.2× contact" },
  ];

  for (const p of pairs) {
    const big   = itemOfId(items, p.bigId);
    const small = itemOfId(items, p.smallId);
    if (!big || !small) continue;
    const bigZone   = zoneOfId(zones, p.bigId);
    const smallZone = zoneOfId(zones, p.smallId);
    if (big.fontSize >= small.fontSize * p.ratio) continue;

    const target = small.fontSize * p.ratio;
    const raised = clampFontSize(bigZone, target);
    if (raised !== big.fontSize) {
      record(adjustments, big.zoneId, "fontSize", big.fontSize, raised, p.reason);
      big.fontSize = raised;
    }

    if (big.fontSize < small.fontSize * p.ratio) {
      // Still short — shrink the small zone
      const lowered = clampFontSize(smallZone, big.fontSize / p.ratio);
      if (lowered !== small.fontSize) {
        record(adjustments, small.zoneId, "fontSize", small.fontSize, lowered, p.reason + " (shrinking smaller)");
        small.fontSize = lowered;
      }
    }
  }
}

/**
 * Enforce CTA size: between body × 1.05 and headline × 0.6. A CTA that's the
 * same size as body reads as body; one that rivals the headline dilutes the
 * focal element.
 */
function enforceCtaSize(
  items:       TypographyItem[],
  zones:       Zone[],
  adjustments: HierarchyAdjustment[],
): void {
  const cta      = itemOfId(items, "cta");
  if (!cta) return;
  const body     = itemOfId(items, "body") ?? itemOfId(items, "contact");
  const headline = itemOfId(items, "headline") ?? itemOfId(items, "name");
  const ctaZone  = zoneOfId(zones, "cta");

  if (body && cta.fontSize < body.fontSize * RATIO_CTA_OVER_BODY) {
    const raised = clampFontSize(ctaZone, body.fontSize * RATIO_CTA_OVER_BODY);
    if (raised !== cta.fontSize) {
      record(adjustments, "cta", "fontSize", cta.fontSize, raised, `CTA must be ≥1.05× body`);
      cta.fontSize = raised;
    }
  }
  if (headline && cta.fontSize > headline.fontSize * RATIO_CTA_UNDER_HEADLINE) {
    const lowered = clampFontSize(ctaZone, headline.fontSize * RATIO_CTA_UNDER_HEADLINE);
    if (lowered !== cta.fontSize) {
      record(adjustments, "cta", "fontSize", cta.fontSize, lowered, `CTA must be ≤0.6× headline`);
      cta.fontSize = lowered;
    }
  }
}

/**
 * Enforce that supporting zones (bullets, contact lines) don't exceed the
 * body zone's size — they should read as body-tier, not sub-headline.
 */
function enforceSupportingCap(
  items:       TypographyItem[],
  zones:       Zone[],
  adjustments: HierarchyAdjustment[],
): void {
  const body = itemOfId(items, "body");
  if (!body) return;
  const supportingIds = ["bullet_1", "bullet_2", "bullet_3", "contact", "company", "legal"];
  for (const id of supportingIds) {
    const item = itemOfId(items, id);
    if (!item) continue;
    if (item.fontSize > body.fontSize) {
      const capped = clampFontSize(zoneOfId(zones, id), body.fontSize);
      if (capped !== item.fontSize) {
        record(adjustments, id, "fontSize", item.fontSize, capped, `${id} must not exceed body`);
        item.fontSize = capped;
      }
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export function enforceStrictTypographyHierarchy(
  items: TypographyItem[],
  zones: Zone[],
): StrictHierarchyResult {
  const working: TypographyItem[] = items.map(i => ({ ...i }));
  const adjustments: HierarchyAdjustment[] = [];

  // Pass 1: per-zone tier policy (weight, letter-spacing, transform)
  enforceTierPolicy(working, zones, adjustments);

  // Pass 2: weight gap between display + primary
  enforceWeightGap(working, adjustments);

  // Pass 3: size ratios between hierarchy tiers
  enforceSizeRatios(working, zones, adjustments);

  // Pass 4: CTA sizing bounded between body and headline
  enforceCtaSize(working, zones, adjustments);

  // Pass 5: cap supporting zones to body size
  enforceSupportingCap(working, zones, adjustments);

  return { items: working, adjustments };
}

/** Explicit tier lookup for consumers that need it outside the enforcer. */
export function getZoneTier(zoneId: string): Tier {
  return ZONE_TIER[zoneId] ?? "support";
}
