// src/engines/layout/composition-analyzer.ts
//
// STEP 10 — Composition balance + visual hierarchy.
//
// What this module does
// ─────────────────────────────────────────────────────────────────────────────
// Given the resolved zones, the populated zone ids, and the optional real
// subject image that Step 9 selected, we analyse whether the finished
// template reads like an *intentional* composition:
//
//   • Focal hierarchy — is there a dominant element (headline, name, or a
//     properly-sized image subject) that visually anchors the page, plus
//     smaller supporting zones arranged around it?
//   • CTA presence — templates that should drive action ship with a
//     readable CTA (cta / badge), not just a headline-only card.
//   • Balance — total active area isn't overcrowded (>90%) and isn't sparse
//     (<30%). Zones aren't crammed into a single quadrant.
//   • Spacing — zones at the same z-index aren't touching (no negative
//     gutters), and no text zone sits flat on top of a lower-z-index image
//     zone without being explicitly overlaid.
//   • Pattern — the populated zone footprint matches a recognisable layout
//     pattern: full_bleed, left_right split, top_bottom sections, centered
//     stack, or grid. Random scatter is flagged.
//
// The module runs during SVG construction; the result is stamped on
// SvgContent as `_composition` and consumed by four rejection rules
// (`missing_focal_point`, `unbalanced_composition`, `poor_spacing`,
// `no_composition_pattern`) plus the admission audit.
//
// What this module does NOT do
// ─────────────────────────────────────────────────────────────────────────────
// It is a geometric analyser, not a pixel-level critic. It reads zone
// rects + z-indexes + "populated" flags and scores the layout against
// fixed thresholds. It does not re-render, does not measure text, and
// does not rewrite zones. A failed verdict is a *gate* — the candidate
// is rejected and another variation is generated, so the pipeline surfaces
// better-composed outputs.

import type { Zone } from "./families";
import type { TemplateType } from "../templates/template-types";
import type { SubjectImage } from "../assets/subject-image-selector";

// ── Types ────────────────────────────────────────────────────────────────────

export type CompositionPattern =
  | "full_bleed"      // one zone covers the whole canvas (hero visual or text-on-image)
  | "left_right"      // two columns, each ~half the canvas
  | "top_bottom"      // two horizontal bands, top and bottom
  | "centered_stack"  // all populated zones stacked on the vertical midline
  | "grid"            // ≥3 populated content zones distributed across rows and cols
  | "asymmetric"      // an identifiable focal zone + supporting cluster off-axis
  | "none";           // didn't match any known pattern

export interface CompositionFlags {
  /** The canvas lacks a clear dominant visual element. */
  noFocal:          boolean;
  /** Photo / hero visual is too small to act as the subject (<7% canvas). */
  subjectTooSmall:  boolean;
  /** Non-full-bleed subject covers ≥90% of the canvas and crowds out text. */
  subjectTooLarge:  boolean;
  /** ≥90% of the canvas is covered by populated zones — no breathing room. */
  overcrowded:      boolean;
  /** <28% of the canvas is covered — template reads as mostly empty. */
  sparse:           boolean;
  /** Two populated zones at the same z-index are touching (gap < 0.2%). */
  poorSpacing:      boolean;
  /** A text zone sits on top of the image zone at lower/equal z-index
   *  with ≥35% intersection — text would be unreadable over the photo. */
  textOverlapsSubject: boolean;
  /** Couldn't match the populated footprint to any known composition pattern. */
  noPattern:        boolean;
  /** Active zones are concentrated in a single canvas quadrant. */
  quadrantHeavy:    boolean;
  /** Template expected a CTA (or equivalent action role) but none was populated. */
  missingCta:       boolean;
}

export interface CompositionVerdict {
  templateType:   TemplateType | "unknown";
  pattern:        CompositionPattern;
  focalZoneId?:   string;
  focalArea:      number;         // % of canvas covered by the focal zone (0..100)
  supportCount:   number;         // count of supporting populated zones (non-focal, non-locked)
  coverage:       number;         // % of canvas covered by populated, non-locked zones
  quadrantSkew:   number;         // 0 (even) .. 1 (all in one quadrant)
  minGapPct:      number;         // smallest gap between same-z-index zones (% of canvas min side)
  subjectArea?:   number;         // % of canvas covered by subject image (if any)
  subjectZoneId?: string;
  overlapIssues:  Array<{ text: string; visual: string; overlapPct: number }>;
  flags:          CompositionFlags;
  /** One-line summary for admission logs. */
  auditSummary:   string;
}

export interface CompositionAnalysisInput {
  zones:             Zone[];
  populatedZoneIds:  string[];
  templateType:      TemplateType | "unknown";
  subject?:          SubjectImage | null;
}

// ── Per-template CTA expectation ────────────────────────────────────────────
// Quote / minimal templates don't need a call-to-action. Everything else
// benefits from a CTA or badge so the viewer has a next step.

const CTA_ROLE_ZONES: readonly string[] = ["cta", "badge"];
const CTA_EXEMPT_TEMPLATES: ReadonlySet<string> = new Set([
  "quote",
  "minimal",
  // Business card / resume / logo are their own formats and don't use CTA zones.
]);

// ── Thresholds (percentage of canvas) ───────────────────────────────────────
// These are intentionally conservative: Step 10's charter is "unbalanced /
// cluttered / no-focus templates don't ship". Soft briefs can still fail
// admission and regenerate — that's the point.

const FOCAL_MIN_AREA         = 15;    // biggest content zone must cover ≥15%
const COVERAGE_OVERCROWDED   = 90;
const COVERAGE_SPARSE        = 28;
const SUBJECT_TOO_SMALL      = 7;
const SUBJECT_TOO_LARGE      = 90;    // unless pattern === "full_bleed"
const SAME_Z_GAP_MIN_PCT     = 0.2;
const TEXT_OVERLAP_PCT       = 35;
const QUADRANT_SKEW_MAX      = 0.70;  // >70% of mass in one quadrant = concentrated

// ── Public: analyse ─────────────────────────────────────────────────────────

export function analyzeComposition(input: CompositionAnalysisInput): CompositionVerdict {
  const { zones, populatedZoneIds, templateType, subject } = input;

  const populated = new Set(populatedZoneIds);
  const activeZones = zones.filter(z => {
    if (z.locked) return false;                          // background / accent bar
    if (z.id === "background") return false;
    if (z.width <= 0 || z.height <= 0) return false;
    if (populated.has(z.id)) return true;
    // Image zone is "active" if a subject was placed there.
    if (z.id === "image" && subject && subject.zoneId === z.id) return true;
    return false;
  });

  // Coverage (union area, but we approximate with sum clamped to 100 since
  // zones generally don't overlap by design; overlap check below catches
  // the rare violations).
  const coverageRaw = activeZones.reduce((acc, z) => acc + (z.width * z.height) / 100, 0);
  const coverage    = Math.min(100, coverageRaw);

  // Focal zone = the largest active zone, with a tiebreak preferring
  // headline / name / image for semantic clarity.
  const focalPref = new Set<string>(["headline", "name", "image"]);
  const sortedByArea = [...activeZones].sort((a, b) => {
    const aa = a.width * a.height;
    const ba = b.width * b.height;
    if (ba !== aa) return ba - aa;
    const ap = focalPref.has(a.id) ? 1 : 0;
    const bp = focalPref.has(b.id) ? 1 : 0;
    return bp - ap;
  });
  const focal = sortedByArea[0];
  const focalArea = focal ? (focal.width * focal.height) / 100 : 0;

  // Subject sizing (full-bleed logo covers need to be exempted from
  // "too large"; the subject-image-selector already marks those).
  const subjectArea = subject
    ? (() => {
        const sz = zones.find(z => z.id === subject.zoneId);
        if (!sz) return 0;
        return (sz.width * sz.height) / 100;
      })()
    : undefined;

  // Pattern detection — see helper below.
  const pattern = detectPattern(activeZones);

  // Quadrant skew — 0 (even) .. 1 (mass concentrated in one quadrant).
  const quadrantSkew = computeQuadrantSkew(activeZones);

  // Same-z-index spacing check.
  const minGapPct = computeMinSameZGap(activeZones);

  // Text zones overlapping the image zone with lower or equal z-index and
  // ≥35% intersection. Overlay templates (headline zIndex>image zIndex)
  // are exempt because overlay is the intent.
  const overlapIssues = findTextOverImageOverlaps(zones, populatedZoneIds, subject);

  // ── Flags ──────────────────────────────────────────────────────────────
  const flags: CompositionFlags = {
    noFocal:          !focal || focalArea < FOCAL_MIN_AREA,
    subjectTooSmall:  typeof subjectArea === "number" && subjectArea > 0 && subjectArea < SUBJECT_TOO_SMALL,
    subjectTooLarge:  typeof subjectArea === "number"
                       && subjectArea >= SUBJECT_TOO_LARGE
                       && pattern !== "full_bleed"
                       && subject?.placement !== "full_bleed",
    overcrowded:      coverage > COVERAGE_OVERCROWDED,
    sparse:           coverage < COVERAGE_SPARSE,
    poorSpacing:      minGapPct < SAME_Z_GAP_MIN_PCT,
    textOverlapsSubject: overlapIssues.length > 0,
    noPattern:        pattern === "none",
    quadrantHeavy:    quadrantSkew > QUADRANT_SKEW_MAX,
    missingCta:       missingCtaFor(templateType, zones, populatedZoneIds),
  };

  const supportCount = Math.max(0, activeZones.length - 1);

  const auditSummary = [
    `pattern=${pattern}`,
    `focal=${focal?.id ?? "none"}(${focalArea.toFixed(1)}%)`,
    `coverage=${coverage.toFixed(1)}%`,
    `subject=${typeof subjectArea === "number" ? subjectArea.toFixed(1) + "%" : "none"}`,
    `support=${supportCount}`,
    `minGap=${minGapPct.toFixed(2)}%`,
    `skew=${quadrantSkew.toFixed(2)}`,
    `flags=[${flagLabels(flags).join(",") || "ok"}]`,
  ].join(" ");

  return {
    templateType,
    pattern,
    focalZoneId:   focal?.id,
    focalArea,
    supportCount,
    coverage,
    quadrantSkew,
    minGapPct,
    subjectArea,
    subjectZoneId: subject?.zoneId,
    overlapIssues,
    flags,
    auditSummary,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function flagLabels(f: CompositionFlags): string[] {
  const out: string[] = [];
  if (f.noFocal)             out.push("no_focal");
  if (f.subjectTooSmall)     out.push("subject_tiny");
  if (f.subjectTooLarge)     out.push("subject_huge");
  if (f.overcrowded)         out.push("overcrowded");
  if (f.sparse)              out.push("sparse");
  if (f.poorSpacing)         out.push("poor_spacing");
  if (f.textOverlapsSubject) out.push("text_overlap");
  if (f.noPattern)           out.push("no_pattern");
  if (f.quadrantHeavy)       out.push("quadrant_heavy");
  if (f.missingCta)          out.push("missing_cta");
  return out;
}

function missingCtaFor(
  templateType: TemplateType | "unknown",
  zones:        Zone[],
  populated:    string[],
): boolean {
  if (CTA_EXEMPT_TEMPLATES.has(templateType)) return false;
  // If the layout family has no CTA/badge zone at all (biz card, resume,
  // logo, plain slide, yt_thumb-with-no-badge), there is no way to ship
  // a CTA and the rule must not fire — the absence is by design.
  const hasCtaZone = zones.some(z =>
    CTA_ROLE_ZONES.includes(z.id) && z.width > 0 && z.height > 0,
  );
  if (!hasCtaZone) return false;
  return !populated.some(id => CTA_ROLE_ZONES.includes(id));
}

/**
 * Detect which composition pattern the active zone footprint matches.
 * The heuristics favour the most intentional-looking arrangement that
 * still honours the zone geometry — so "full_bleed" wins over
 * "left_right" when one zone spans the whole canvas.
 */
function detectPattern(active: Zone[]): CompositionPattern {
  if (active.length === 0) return "none";

  // Full bleed: any zone >= 90% canvas area.
  const bleed = active.find(z => (z.width * z.height) / 100 >= 90);
  if (bleed) return "full_bleed";

  const cx = (z: Zone) => z.x + z.width / 2;
  const cy = (z: Zone) => z.y + z.height / 2;

  // Left-right split: a "left" group sits in x≤60% and a "right" group in
  // x≥40%, with the combined footprint tiling the canvas (gap ≤ 18%).
  const leftZones  = active.filter(z => z.x + z.width <= 60);
  const rightZones = active.filter(z => z.x >= 40);
  if (leftZones.length >= 1 && rightZones.length >= 1) {
    const spanL = Math.max(...leftZones.map(z => z.x + z.width));
    const spanR = Math.min(...rightZones.map(z => z.x));
    if (spanR - spanL <= 18 && spanL >= 22 && spanR <= 78) {
      return "left_right";
    }
  }

  // Top-bottom split: same heuristic on the y axis.
  const topZones = active.filter(z => z.y + z.height <= 60);
  const botZones = active.filter(z => z.y >= 40);
  if (topZones.length >= 1 && botZones.length >= 1) {
    const spanT = Math.max(...topZones.map(z => z.y + z.height));
    const spanB = Math.min(...botZones.map(z => z.y));
    if (spanB - spanT <= 18 && spanT >= 22 && spanB <= 78) {
      return "top_bottom";
    }
  }

  // Centered stack: all active zones' horizontal midpoints sit within
  // ±15% of canvas center. Typical for Instagram post v4_centered,
  // flyer centered, wordmark logo, etc.
  const centered = active.every(z => Math.abs(cx(z) - 50) <= 15);
  if (centered && active.length >= 2) return "centered_stack";

  // Grid: ≥3 zones distributed across at least 2 distinct horizontal
  // bands AND at least 2 distinct vertical columns, with roughly even
  // sizing (standard deviation of area < mean area * 0.6).
  if (active.length >= 3) {
    const bandsY = new Set(active.map(z => Math.floor(cy(z) / 25))); // 4 bands
    const bandsX = new Set(active.map(z => Math.floor(cx(z) / 25)));
    if (bandsY.size >= 2 && bandsX.size >= 2) {
      const areas = active.map(z => z.width * z.height);
      const mean  = areas.reduce((a, b) => a + b, 0) / areas.length;
      const sd    = Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length);
      if (mean > 0 && sd / mean < 0.7) return "grid";
    }
  }

  // Asymmetric: one clear focal zone (>=25% canvas) with ≥1 supporting
  // zone off the same axis. We treat this as intentional composition.
  const focal = [...active].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (focal) {
    const focalAreaPct = (focal.width * focal.height) / 100;
    if (focalAreaPct >= 25 && active.length >= 2) return "asymmetric";
  }

  return "none";
}

/** 0 (even) .. 1 (all mass in one quadrant). */
function computeQuadrantSkew(active: Zone[]): number {
  if (active.length === 0) return 0;
  const q = [0, 0, 0, 0]; // TL, TR, BL, BR
  for (const z of active) {
    const cx = z.x + z.width / 2;
    const cy = z.y + z.height / 2;
    const area = z.width * z.height;
    const idx = (cy < 50 ? 0 : 2) + (cx >= 50 ? 1 : 0);
    q[idx] += area;
  }
  const total = q.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return Math.max(...q) / total;
}

/** Smallest separating gap between two populated zones at the same z-index. */
function computeMinSameZGap(active: Zone[]): number {
  let min = 100;
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (a.zIndex !== b.zIndex) continue;
      const gap = rectGapPct(a, b);
      if (gap === null) continue; // overlap; handled elsewhere
      if (gap < min) min = gap;
    }
  }
  return active.length < 2 ? 100 : min;
}

/** Returns min axis-aligned separation (percent of canvas side), or null if rects overlap. */
function rectGapPct(a: Zone, b: Zone): number | null {
  const ax1 = a.x, ax2 = a.x + a.width;
  const ay1 = a.y, ay2 = a.y + a.height;
  const bx1 = b.x, bx2 = b.x + b.width;
  const by1 = b.y, by2 = b.y + b.height;

  const dx = bx1 >= ax2 ? bx1 - ax2 : ax1 >= bx2 ? ax1 - bx2 : 0;
  const dy = by1 >= ay2 ? by1 - ay2 : ay1 >= by2 ? ay1 - by2 : 0;
  if (dx === 0 && dy === 0) return null; // overlap
  // Use the smaller non-zero axis separation — that's the "nearest edge gap".
  if (dx > 0 && dy > 0) return Math.min(dx, dy);
  return dx + dy;
}

/** Find text zones that intersect the image zone at the same or lower z-index. */
function findTextOverImageOverlaps(
  allZones:         Zone[],
  populatedZoneIds: string[],
  subject:          SubjectImage | null | undefined,
): Array<{ text: string; visual: string; overlapPct: number }> {
  if (!subject) return [];
  const imageZone = allZones.find(z => z.id === subject.zoneId);
  if (!imageZone) return [];

  const textRoles = new Set<string>([
    "body", "subhead", "tagline", "legal", "contact", "bullet_1", "bullet_2", "bullet_3",
  ]);
  const out: Array<{ text: string; visual: string; overlapPct: number }> = [];

  for (const id of populatedZoneIds) {
    if (!textRoles.has(id)) continue;
    const tz = allZones.find(z => z.id === id);
    if (!tz) continue;
    if (tz.zIndex > imageZone.zIndex) continue; // explicit overlay; intended
    const inter = rectIntersectionPct(tz, imageZone);
    if (inter >= TEXT_OVERLAP_PCT) {
      out.push({ text: id, visual: imageZone.id, overlapPct: inter });
    }
  }
  return out;
}

/** Intersection as percent of the first rect's area. */
function rectIntersectionPct(a: Zone, b: Zone): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width,  b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const areaA = a.width * a.height;
  if (areaA === 0) return 0;
  return (inter / areaA) * 100;
}

// ── Audit / describe helpers ────────────────────────────────────────────────

export function describeComposition(v: CompositionVerdict | null | undefined): string {
  if (!v) return "composition=none";
  return `composition=${v.pattern} ${v.auditSummary}`;
}

/**
 * True if the verdict has ANY hard composition problem. Used by the
 * rejection rules for a single-line guard before inspecting specific flags.
 */
export function hasCompositionProblem(v: CompositionVerdict | null | undefined): boolean {
  if (!v) return false;
  const f = v.flags;
  return (
    f.noFocal ||
    f.subjectTooSmall ||
    f.subjectTooLarge ||
    f.overcrowded ||
    f.sparse ||
    f.poorSpacing ||
    f.textOverlapsSubject ||
    f.noPattern ||
    f.quadrantHeavy ||
    f.missingCta
  );
}
