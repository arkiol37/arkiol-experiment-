// src/engines/layout/layout-constraints.ts
//
// Strict layout-constraint enforcement + gate.
//
// The adaptive pipeline already reflows zones for spacing, safe zones, and
// content length. This module runs *after* those passes to:
//   1. Actively resolve any remaining overlaps between non-background zones.
//   2. Re-test strict margin/alignment/balance/mechanical-placement rules.
//   3. Emit a `ConstraintReport` the pipeline can use as a hard quality gate.
//
// Violations are classified `critical` (must reject / retry) or `warning`
// (allowed but logged). The gate throws `LayoutConstraintError` in the
// render pipeline when any critical violation remains after auto-resolution.

import type { Zone, ZoneId } from "./families";
import type { FormatCategory, DensityProfile } from "./authority";

// ── Types ──────────────────────────────────────────────────────────────────

export type ConstraintCategory =
  | "overlap"
  | "margin"
  | "spacing"
  | "alignment"
  | "balance"
  | "mechanical";

export interface ConstraintViolation {
  category: ConstraintCategory;
  severity: "critical" | "warning";
  zoneIds:  ZoneId[];
  message:  string;
}

export interface ConstraintReport {
  violations: ConstraintViolation[];
  /** 0–1 coherence score (1 = clean, <0.5 = poor). */
  score:      number;
  /** True when at least one violation is `critical`. */
  blocking:   boolean;
}

// ── Configuration ──────────────────────────────────────────────────────────

interface StrictConfig {
  minGapPct:             number;  // vertical gap between stacked text zones
  marginTopBottom:       number;  // outer margin enforcement
  marginLeftRight:       number;
  maxOverlapPct:         number;  // fraction of smaller zone allowed to overlap
  balanceSkewCap:        number;  // max (|left weight - right weight| / total)
  balanceVerticalSkewCap:number;  // top vs bottom
  alignmentToleranceX:   number;  // zones within this % of each other should share a track
  mechanicalUniformityX: number;  // if X text zones all share same x/width, reject
}

const STRICT: Record<FormatCategory | "default", StrictConfig> = {
  instagram: { minGapPct: 2.0, marginTopBottom: 3.0, marginLeftRight: 4.0, maxOverlapPct: 0.12, balanceSkewCap: 0.72, balanceVerticalSkewCap: 0.78, alignmentToleranceX: 1.5, mechanicalUniformityX: 4 },
  story:     { minGapPct: 2.5, marginTopBottom: 10.0, marginLeftRight: 5.0, maxOverlapPct: 0.12, balanceSkewCap: 0.72, balanceVerticalSkewCap: 0.82, alignmentToleranceX: 1.5, mechanicalUniformityX: 4 },
  thumbnail: { minGapPct: 1.5, marginTopBottom: 2.0, marginLeftRight: 3.0, maxOverlapPct: 0.15, balanceSkewCap: 0.82, balanceVerticalSkewCap: 0.82, alignmentToleranceX: 2.0, mechanicalUniformityX: 4 },
  flyer:     { minGapPct: 1.8, marginTopBottom: 4.0, marginLeftRight: 4.0, maxOverlapPct: 0.10, balanceSkewCap: 0.70, balanceVerticalSkewCap: 0.78, alignmentToleranceX: 1.5, mechanicalUniformityX: 5 },
  poster:    { minGapPct: 1.8, marginTopBottom: 4.0, marginLeftRight: 4.0, maxOverlapPct: 0.10, balanceSkewCap: 0.72, balanceVerticalSkewCap: 0.78, alignmentToleranceX: 1.5, mechanicalUniformityX: 4 },
  slide:     { minGapPct: 1.6, marginTopBottom: 2.5, marginLeftRight: 3.5, maxOverlapPct: 0.10, balanceSkewCap: 0.74, balanceVerticalSkewCap: 0.78, alignmentToleranceX: 1.5, mechanicalUniformityX: 5 },
  card:      { minGapPct: 1.2, marginTopBottom: 5.0, marginLeftRight: 5.0, maxOverlapPct: 0.12, balanceSkewCap: 0.70, balanceVerticalSkewCap: 0.76, alignmentToleranceX: 1.5, mechanicalUniformityX: 4 },
  document:  { minGapPct: 1.2, marginTopBottom: 4.0, marginLeftRight: 4.0, maxOverlapPct: 0.08, balanceSkewCap: 0.75, balanceVerticalSkewCap: 0.85, alignmentToleranceX: 1.5, mechanicalUniformityX: 6 },
  logo:      { minGapPct: 2.0, marginTopBottom: 9.0, marginLeftRight: 9.0, maxOverlapPct: 0.10, balanceSkewCap: 0.70, balanceVerticalSkewCap: 0.80, alignmentToleranceX: 2.5, mechanicalUniformityX: 3 },
  unknown:   { minGapPct: 2.0, marginTopBottom: 4.0, marginLeftRight: 4.0, maxOverlapPct: 0.12, balanceSkewCap: 0.72, balanceVerticalSkewCap: 0.78, alignmentToleranceX: 1.5, mechanicalUniformityX: 4 },
  default:   { minGapPct: 2.0, marginTopBottom: 4.0, marginLeftRight: 4.0, maxOverlapPct: 0.12, balanceSkewCap: 0.72, balanceVerticalSkewCap: 0.78, alignmentToleranceX: 1.5, mechanicalUniformityX: 4 },
};

// Zones treated as structural surfaces — overlap with text is fine.
const SURFACE_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>(["background", "image", "accent"]);

const TEXT_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "headline", "subhead", "body", "cta", "badge", "tagline", "legal", "price",
  "name", "title", "company", "contact", "section_header",
  "bullet_1", "bullet_2", "bullet_3",
]);

// ── Geometry helpers ───────────────────────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number; }

function toRect(z: Zone): Rect {
  return { x: z.x, y: z.y, w: z.width, h: z.height };
}

function intersection(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

function area(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

// ── Overlap resolver ───────────────────────────────────────────────────────
//
// If two text zones overlap meaningfully, push the lower zone down until the
// overlap clears. If that would push it past the canvas floor, shrink the
// top zone's bottom edge instead.

export function resolveOverlaps(zones: Zone[], cfg: StrictConfig): { zones: Zone[]; fixed: number } {
  const out = zones.map(z => ({ ...z }));
  let fixed = 0;

  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (SURFACE_ZONES.has(a.id) || a.height <= 0) continue;
    for (let j = i + 1; j < out.length; j++) {
      const b = out[j];
      if (SURFACE_ZONES.has(b.id) || b.height <= 0) continue;

      const ra = toRect(a);
      const rb = toRect(b);
      const inter = intersection(ra, rb);
      if (inter <= 0) continue;

      const smaller = Math.min(area(ra), area(rb));
      if (smaller <= 0) continue;
      const frac = inter / smaller;
      if (frac <= cfg.maxOverlapPct) continue;

      // Decide which is "upper" (smaller y = upper in screen space)
      const upper = a.y <= b.y ? a : b;
      const lower = upper === a ? b : a;

      const desiredTop = upper.y + upper.height + cfg.minGapPct;
      const shift = desiredTop - lower.y;
      if (shift <= 0) continue;

      if (lower.y + shift + lower.height <= 98) {
        lower.y += shift;
      } else {
        // Can't push further — trim the upper zone's bottom
        const trim = Math.min(shift, Math.max(0, upper.height - 4));
        upper.height = Math.max(4, upper.height - trim);
      }
      fixed++;
    }
  }

  return { zones: out, fixed };
}

// ── Individual constraint checks ───────────────────────────────────────────

function checkMargins(zones: Zone[], cfg: StrictConfig): ConstraintViolation[] {
  const vs: ConstraintViolation[] = [];
  // Margin budget tolerates 1% slop; only a clear violation (>1% past the
  // safe-zone line) is a warning, and >2% past is critical. Authority-
  // locked zones and surface zones are exempt.
  const slopWarn     = 1.0;
  const slopCritical = 2.0;
  const push = (z: Zone, overshoot: number, edge: string) => {
    if (overshoot > slopCritical) {
      vs.push({
        category: "margin", severity: "critical", zoneIds: [z.id],
        message: `${z.id} ${edge} overshoots safe-zone by ${overshoot.toFixed(1)}%`,
      });
    } else if (overshoot > slopWarn) {
      vs.push({
        category: "margin", severity: "warning", zoneIds: [z.id],
        message: `${z.id} ${edge} overshoots safe-zone by ${overshoot.toFixed(1)}%`,
      });
    }
  };

  for (const z of zones) {
    if (SURFACE_ZONES.has(z.id) || z.height <= 0) continue;
    if (z.locked) continue;
    const leftOver   = cfg.marginLeftRight - z.x;
    const rightOver  = (z.x + z.width) - (100 - cfg.marginLeftRight);
    const topOver    = cfg.marginTopBottom - z.y;
    const bottomOver = (z.y + z.height) - (100 - cfg.marginTopBottom);
    if (leftOver   > 0) push(z, leftOver,   "left edge");
    if (rightOver  > 0) push(z, rightOver,  "right edge");
    if (topOver    > 0) push(z, topOver,    "top edge");
    if (bottomOver > 0) push(z, bottomOver, "bottom edge");
  }
  return vs;
}

function checkSpacing(zones: Zone[], cfg: StrictConfig): ConstraintViolation[] {
  const vs: ConstraintViolation[] = [];
  const textZones = zones
    .filter(z => TEXT_ZONES.has(z.id) && z.height > 0)
    .sort((a, b) => a.y - b.y);

  for (let i = 1; i < textZones.length; i++) {
    const prev = textZones[i - 1];
    const curr = textZones[i];
    // Skip if they overlap horizontally less than 20% of the narrower zone —
    // side-by-side zones don't need vertical gap enforcement
    const hOverlap = Math.max(0,
      Math.min(prev.x + prev.width, curr.x + curr.width) - Math.max(prev.x, curr.x));
    const minWidth = Math.min(prev.width, curr.width);
    if (hOverlap < minWidth * 0.2) continue;

    const gap = curr.y - (prev.y + prev.height);
    if (gap < cfg.minGapPct - 0.1) {
      vs.push({
        category: "spacing",
        severity: gap < 0 ? "critical" : "warning",
        zoneIds: [prev.id, curr.id],
        message: `gap between ${prev.id} and ${curr.id} = ${gap.toFixed(1)}% (min ${cfg.minGapPct}%)`,
      });
    }
  }
  return vs;
}

function checkOverlap(zones: Zone[], cfg: StrictConfig): ConstraintViolation[] {
  const vs: ConstraintViolation[] = [];
  for (let i = 0; i < zones.length; i++) {
    const a = zones[i];
    if (SURFACE_ZONES.has(a.id) || a.height <= 0) continue;
    for (let j = i + 1; j < zones.length; j++) {
      const b = zones[j];
      if (SURFACE_ZONES.has(b.id) || b.height <= 0) continue;
      const inter = intersection(toRect(a), toRect(b));
      if (inter <= 0) continue;
      const smaller = Math.min(area(toRect(a)), area(toRect(b)));
      if (smaller <= 0) continue;
      const frac = inter / smaller;
      if (frac > cfg.maxOverlapPct) {
        vs.push({
          category: "overlap",
          severity: frac > cfg.maxOverlapPct * 1.5 ? "critical" : "warning",
          zoneIds: [a.id, b.id],
          message: `${a.id} × ${b.id} overlap ${(frac * 100).toFixed(0)}% of smaller zone`,
        });
      }
    }
  }
  return vs;
}

function checkAlignment(zones: Zone[], cfg: StrictConfig): ConstraintViolation[] {
  const vs: ConstraintViolation[] = [];
  const leftAligned = zones.filter(z =>
    TEXT_ZONES.has(z.id) && z.height > 0 && z.alignH === "left",
  );
  if (leftAligned.length < 3) return vs;

  // Cluster x values into tracks with cfg.alignmentToleranceX
  const tracks: number[] = [];
  for (const z of leftAligned) {
    const match = tracks.find(t => Math.abs(t - z.x) <= cfg.alignmentToleranceX);
    if (match === undefined) tracks.push(z.x);
  }
  // More than 3 distinct left-edge tracks for 3+ zones = misalignment
  if (tracks.length > Math.ceil(leftAligned.length / 2)) {
    vs.push({
      category: "alignment",
      severity: "warning",
      zoneIds: leftAligned.map(z => z.id),
      message: `${tracks.length} distinct left-edge tracks for ${leftAligned.length} text zones`,
    });
  }
  // Truly chaotic — every zone has its own x
  if (tracks.length === leftAligned.length && leftAligned.length >= 4) {
    vs.push({
      category: "alignment",
      severity: "critical",
      zoneIds: leftAligned.map(z => z.id),
      message: `no shared left-edge track across ${leftAligned.length} left-aligned zones`,
    });
  }
  return vs;
}

function checkBalance(zones: Zone[], cfg: StrictConfig): ConstraintViolation[] {
  const vs: ConstraintViolation[] = [];
  // Weight = area × role multiplier. Image and accent count as visual mass
  // so that an asymmetric composition (image on one side, text on the other)
  // reads as balanced, not skewed.
  const roleWeight: Partial<Record<ZoneId, number>> = {
    image: 1.0, accent: 0.3,
    headline: 1.2, name: 1.2,
    subhead: 0.8, tagline: 0.8, title: 0.9,
    body: 0.7, contact: 0.7, company: 0.7, legal: 0.4, price: 0.8,
    cta: 1.0, badge: 0.7, section_header: 0.6,
    bullet_1: 0.6, bullet_2: 0.6, bullet_3: 0.6, logo: 0.7,
  };

  // Split each zone's weight proportionally across the midline instead
  // of dumping the full weight into one half based on a center-point
  // test. A zone that straddles x=50 (or a zone centered at 50) was
  // previously counted as 100% right-side, which caused balanced
  // center-aligned templates to register 100% skew and block at the
  // 72% cap. Proportional splitting makes a centered layout read as
  // ~0% skew, as intended.
  let leftW = 0, rightW = 0, topW = 0, botW = 0, total = 0;
  for (const z of zones) {
    if (z.id === "background" || z.height <= 0 || z.width <= 0) continue;
    const mul = roleWeight[z.id] ?? 0.5;
    const w = z.width * z.height * mul;
    total += w;

    // Fraction of the zone's width that lies left of x=50.
    const xLeft  = Math.max(0,   z.x);
    const xRight = Math.min(100, z.x + z.width);
    const xSpan  = Math.max(0.0001, xRight - xLeft);
    const xLeftHalf  = Math.max(0, Math.min(50,  xRight) - Math.max(0, xLeft));
    const leftFrac   = Math.max(0, Math.min(1, xLeftHalf / xSpan));
    leftW  += w * leftFrac;
    rightW += w * (1 - leftFrac);

    // Same idea for vertical.
    const yTop    = Math.max(0,   z.y);
    const yBottom = Math.min(100, z.y + z.height);
    const ySpan   = Math.max(0.0001, yBottom - yTop);
    const yTopHalf = Math.max(0, Math.min(50, yBottom) - Math.max(0, yTop));
    const topFrac  = Math.max(0, Math.min(1, yTopHalf / ySpan));
    topW += w * topFrac;
    botW += w * (1 - topFrac);
  }
  if (total <= 0) return vs;

  const hSkew = Math.abs(leftW - rightW) / total;
  const vSkew = Math.abs(topW - botW)   / total;
  if (hSkew > cfg.balanceSkewCap) {
    vs.push({
      category: "balance",
      severity: hSkew > cfg.balanceSkewCap + 0.12 ? "critical" : "warning",
      zoneIds: [],
      message: `horizontal weight skew ${(hSkew * 100).toFixed(0)}% exceeds cap ${(cfg.balanceSkewCap * 100).toFixed(0)}%`,
    });
  }
  if (vSkew > cfg.balanceVerticalSkewCap) {
    vs.push({
      category: "balance",
      severity: vSkew > cfg.balanceVerticalSkewCap + 0.12 ? "critical" : "warning",
      zoneIds: [],
      message: `vertical weight skew ${(vSkew * 100).toFixed(0)}% exceeds cap ${(cfg.balanceVerticalSkewCap * 100).toFixed(0)}%`,
    });
  }
  return vs;
}

function checkMechanical(zones: Zone[], cfg: StrictConfig): ConstraintViolation[] {
  const vs: ConstraintViolation[] = [];
  const tZones = zones.filter(z => TEXT_ZONES.has(z.id) && z.height > 0);
  if (tZones.length < cfg.mechanicalUniformityX) return vs;

  // Uniform-stamp detector: all zones share same x AND same width AND same
  // height (±1%). That's a telltale "spreadsheet row" layout.
  const first = tZones[0];
  const allSame = tZones.every(z =>
    Math.abs(z.x - first.x) < 0.5 &&
    Math.abs(z.width - first.width) < 0.5 &&
    Math.abs(z.height - first.height) < 1.0,
  );
  if (allSame) {
    vs.push({
      category: "mechanical",
      severity: "critical",
      zoneIds: tZones.map(z => z.id),
      message: `${tZones.length} text zones stamped at identical x/width/height — mechanically placed`,
    });
  }

  // Rigid uniform-spacing detector: all inter-zone vertical gaps equal to
  // each other AND widths identical → spreadsheet-style rhythm.
  const sorted = tZones.slice().sort((a, b) => a.y - b.y);
  if (sorted.length >= 4) {
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i].y - (sorted[i - 1].y + sorted[i - 1].height));
    }
    const gapStdev = stdev(gaps);
    const widthStdev = stdev(sorted.map(z => z.width));
    if (gapStdev < 0.25 && widthStdev < 0.5) {
      vs.push({
        category: "mechanical",
        severity: "warning",
        zoneIds: sorted.map(z => z.id),
        message: `uniform spacing σ=${gapStdev.toFixed(2)}% + uniform width σ=${widthStdev.toFixed(2)}% — risks mechanical look`,
      });
    }
  }

  return vs;
}

function stdev(xs: number[]): number {
  if (!xs.length) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

// ── Scoring ────────────────────────────────────────────────────────────────

function computeScore(violations: ConstraintViolation[]): number {
  let score = 1;
  for (const v of violations) {
    score -= v.severity === "critical" ? 0.22 : 0.07;
  }
  return Math.max(0, Math.min(1, score));
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface EvaluateConstraintsOptions {
  /** When true, perform in-place overlap resolution before scoring. */
  autoResolveOverlaps?: boolean;
}

export interface EvaluateConstraintsResult extends ConstraintReport {
  zones:         Zone[];
  resolvedCount: number;
}

export function evaluateConstraints(
  zones:          Zone[],
  formatCategory: FormatCategory,
  _density:       DensityProfile,
  opts:           EvaluateConstraintsOptions = {},
): EvaluateConstraintsResult {
  const cfg = STRICT[formatCategory] ?? STRICT.default;

  let working = zones;
  let resolvedCount = 0;
  if (opts.autoResolveOverlaps !== false) {
    const r = resolveOverlaps(working, cfg);
    working = r.zones;
    resolvedCount = r.fixed;
  }

  const violations: ConstraintViolation[] = [
    ...checkMargins(working, cfg),
    ...checkSpacing(working, cfg),
    ...checkOverlap(working, cfg),
    ...checkAlignment(working, cfg),
    ...checkBalance(working, cfg),
    ...checkMechanical(working, cfg),
  ];

  const score    = computeScore(violations);
  const blocking = violations.some(v => v.severity === "critical");

  return { zones: working, violations, score, blocking, resolvedCount };
}

// ── Rejection error ────────────────────────────────────────────────────────

export class LayoutConstraintError extends Error {
  readonly violations: ConstraintViolation[];
  readonly score:      number;
  readonly format:     string;
  constructor(format: string, violations: ConstraintViolation[], score: number) {
    const summary = violations
      .filter(v => v.severity === "critical")
      .map(v => `${v.category}: ${v.message}`)
      .join(" | ");
    super(`Template blocked by strict layout gate (score=${score.toFixed(2)}): ${summary}`);
    this.violations = violations;
    this.score      = score;
    this.format     = format;
    this.name       = "LayoutConstraintError";
  }
}
