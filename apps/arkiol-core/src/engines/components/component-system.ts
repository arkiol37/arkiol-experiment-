// src/engines/components/component-system.ts
//
// REUSABLE COMPONENT SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
// Templates used to render as raw text floating on a background. That made
// outputs look amateur — no grouping, no visual structure, no signal of
// "this is a tip / this is step #2 / this is a quote". This module adds a
// component layer *between* decorations and text in the SVG z-order.
//
//   ComponentKind ∈ {
//     checklist_item | tip_card | step_block | quote_box |
//     content_card   | cta_button | badge    | labeled_section
//   }
//
// Each zone the composer populates is mapped to a component kind based on
// the current TemplateType. The component renderer then emits a backplate
// (rounded rect surface + optional icon / number / accent rail / quote
// glyph) positioned around the zone's bounding box. Text is rendered on
// top of these backplates by the existing text loop, so nothing about the
// text pipeline has to change — the components just give the text a
// visible container.
//
// The cta_button and badge kinds are *declared* components for coverage
// analytics, but their SVG surfaces are drawn by the existing
// `renderCtaZone` / `renderBadgeZone` helpers in the SVG builder. The
// component system does not double-paint them.
//
// Assignment rules (by TemplateType) — each type uses a different
// combination so checklist, tips, quote, step-by-step, list, promotional,
// educational and minimal all render with visibly distinct component mixes.

import type { Zone, ZoneId }   from "../layout/families";
import type { DesignTheme }    from "../render/design-themes";
import type { TemplateType }   from "../templates/template-types";

// ── Taxonomy ─────────────────────────────────────────────────────────────────

export type ComponentKind =
  | "checklist_item"
  | "tip_card"
  | "step_block"
  | "quote_box"
  | "content_card"
  | "cta_button"
  | "badge"
  | "labeled_section";

export interface ComponentAssignment {
  zoneId: string;
  kind:   ComponentKind;
  /** Sequence index for step_block / checklist_item (1-based). */
  index?: number;
}

/** Structured kinds that imply a visible container or icon — templates
 *  are considered "composed" only when at least one of these fires.
 *  cta_button and badge alone don't satisfy the rule because they're
 *  ubiquitous and don't organize body content. */
export const STRUCTURED_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
  "checklist_item", "tip_card", "step_block", "quote_box",
  "content_card",   "labeled_section",
]);

// ── Assignment rules ─────────────────────────────────────────────────────────
//
// Map of (templateType, zoneId) → ComponentKind. A zone not listed in the
// specific template's table falls through to DEFAULT_ASSIGNMENTS. Zones
// that never participate (image/background/accent/logo/legal) are excluded
// everywhere.

type PerZoneMap = Partial<Record<ZoneId, ComponentKind>>;

const NEVER_COMPONENT: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "image", "background", "accent", "logo", "legal", "contact", "company",
]);

/** Baseline mapping every template type inherits. */
const DEFAULT_ASSIGNMENTS: PerZoneMap = {
  headline:       "labeled_section",
  subhead:        "content_card",
  body:           "content_card",
  tagline:        "content_card",
  name:           "content_card",
  title:          "content_card",
  section_header: "labeled_section",
  bullet_1:       "content_card",
  bullet_2:       "content_card",
  bullet_3:       "content_card",
  cta:            "cta_button",
  price:          "content_card",
  badge:          "badge",
};

const TEMPLATE_COMPONENT_MAP: Record<TemplateType, PerZoneMap> = {
  checklist: {
    bullet_1: "checklist_item", bullet_2: "checklist_item", bullet_3: "checklist_item",
    body:     "content_card",   tagline:  "content_card",
    section_header: "labeled_section",
  },
  tips: {
    bullet_1: "tip_card",  bullet_2: "tip_card",  bullet_3: "tip_card",
    body:     "content_card",
    section_header: "labeled_section", headline: "labeled_section",
  },
  quote: {
    body:    "quote_box",    tagline: "quote_box",
    name:    "content_card", title:   "content_card",
  },
  step_by_step: {
    bullet_1: "step_block", bullet_2: "step_block", bullet_3: "step_block",
    body:     "content_card",
    section_header: "labeled_section",
  },
  list_based: {
    bullet_1: "content_card", bullet_2: "content_card", bullet_3: "content_card",
    section_header: "labeled_section",
  },
  promotional: {
    cta:      "cta_button",  price:    "content_card",
    body:     "content_card", tagline: "content_card",
    badge:    "badge",
  },
  educational: {
    section_header: "labeled_section", headline: "labeled_section",
    body:     "content_card",
    bullet_1: "tip_card", bullet_2: "tip_card", bullet_3: "tip_card",
  },
  minimal: {
    headline: "labeled_section",
    body:     "content_card",
  },
};

/** Map of (templateType, zoneId) → ComponentKind with fall-through to
 *  the default table. Unknown ids return undefined. */
function lookupComponentKind(
  templateType: TemplateType | undefined,
  zoneId:       ZoneId,
): ComponentKind | undefined {
  if (NEVER_COMPONENT.has(zoneId)) return undefined;
  const specific = templateType ? TEMPLATE_COMPONENT_MAP[templateType]?.[zoneId] : undefined;
  if (specific) return specific;
  return DEFAULT_ASSIGNMENTS[zoneId];
}

export function assignComponents(
  templateType:     TemplateType | undefined,
  populatedZoneIds: readonly string[],
): ComponentAssignment[] {
  const out: ComponentAssignment[] = [];
  let stepIdx      = 1;
  let checklistIdx = 1;
  for (const zId of populatedZoneIds) {
    const kind = lookupComponentKind(templateType, zId as ZoneId);
    if (!kind) continue;
    const assignment: ComponentAssignment = { zoneId: zId, kind };
    if (kind === "step_block")      assignment.index = stepIdx++;
    if (kind === "checklist_item")  assignment.index = checklistIdx++;
    out.push(assignment);
  }
  return out;
}

// ── Coverage analysis ────────────────────────────────────────────────────────

export interface ComponentCoverageReport {
  assignments:             ComponentAssignment[];
  componentCount:          number;
  distinctKinds:           ComponentKind[];
  /** Assignments divided by populated-zone count (0..1). */
  coverageRatio:           number;
  /** Has at least one structured component (not just cta/badge). */
  hasStructuredComponents: boolean;
  /** Structured-component count — used by the rejection rule. */
  structuredCount:         number;
}

export function analyzeComponents(
  assignments:      ComponentAssignment[],
  populatedZoneIds: readonly string[],
): ComponentCoverageReport {
  const populated     = populatedZoneIds.length;
  const distinctKinds = [...new Set(assignments.map(a => a.kind))];
  const structuredCount = assignments.filter(a => STRUCTURED_KINDS.has(a.kind)).length;
  return {
    assignments,
    componentCount:          assignments.length,
    distinctKinds,
    coverageRatio:           populated > 0 ? assignments.length / populated : 0,
    hasStructuredComponents: structuredCount > 0,
    structuredCount,
  };
}

/** Minimum structured components required for a template to qualify. */
export const MIN_STRUCTURED_COMPONENTS = 1;

// ── Backplate rendering ──────────────────────────────────────────────────────
//
// The renderer emits SVG markup that sits BEHIND the text layer. It does
// not touch the text itself — icons and numbers are placed in the zone's
// natural padding margin so they don't overlap rendered text.

interface RectPx { x: number; y: number; w: number; h: number; }

function zoneRect(z: Zone, width: number, height: number): RectPx {
  return {
    x: (z.x      / 100) * width,
    y: (z.y      / 100) * height,
    w: (z.width  / 100) * width,
    h: (z.height / 100) * height,
  };
}

/** Canvas-relative padding for a backplate, clamped so very small zones
 *  don't inflate out of bounds. */
function backplatePadding(r: RectPx, width: number, height: number): { padX: number; padY: number } {
  const minDim = Math.min(width, height);
  const padBase = Math.round(minDim * 0.012);     // ~1.2% of min canvas dim
  const padX = Math.min(padBase, Math.max(4, r.w * 0.08));
  const padY = Math.min(padBase, Math.max(4, r.h * 0.15));
  return { padX, padY };
}

function inflate(r: RectPx, padX: number, padY: number, width: number, height: number): RectPx {
  const x = Math.max(0, r.x - padX);
  const y = Math.max(0, r.y - padY);
  const w = Math.min(width  - x, r.w + padX * 2);
  const h = Math.min(height - y, r.h + padY * 2);
  return { x, y, w, h };
}

function fnum(n: number): string { return n.toFixed(1); }

/** Produce a hex color with alpha applied as an rgba fill string.
 *  Accepts 3/6-digit hex or returns the color unchanged for rgb/rgba/named. */
function withAlpha(color: string, alpha: number): string {
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return color;
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/** Soft, neutral surface tint derived from the theme so cards read as
 *  real surfaces without clashing with the background. */
function surfaceFill(theme: DesignTheme): string {
  // Prefer explicit surface if it's usefully distinct from background,
  // otherwise a gentle tint of primary at low alpha.
  const { surface, background, primary } = theme.palette;
  if (surface && surface.toLowerCase() !== background.toLowerCase()) return surface;
  return withAlpha(primary, 0.08);
}

function surfaceStroke(theme: DesignTheme): string {
  return withAlpha(theme.palette.primary, 0.18);
}

function accentColor(theme: DesignTheme): string { return theme.palette.primary; }
function iconTextColor(theme: DesignTheme): string {
  return theme.palette.surface?.startsWith("rgba(255") ? theme.palette.primary : theme.palette.background;
}

// ── Per-kind backplate renderers ─────────────────────────────────────────────

function renderContentCard(r: RectPx, theme: DesignTheme, width: number, height: number): string {
  const { padX, padY } = backplatePadding(r, width, height);
  const b  = inflate(r, padX, padY, width, height);
  const rx = Math.max(8, Math.min(24, b.h * 0.18));
  return (
    `<rect x="${fnum(b.x)}" y="${fnum(b.y)}" width="${fnum(b.w)}" height="${fnum(b.h)}" ` +
    `rx="${rx.toFixed(1)}" fill="${surfaceFill(theme)}" stroke="${surfaceStroke(theme)}" stroke-width="1"/>`
  );
}

function renderTipCard(r: RectPx, theme: DesignTheme, width: number, height: number): string {
  const { padX, padY } = backplatePadding(r, width, height);
  const b  = inflate(r, padX, padY, width, height);
  const rx = Math.max(10, Math.min(26, b.h * 0.2));
  // Left accent rail for a visible "tip" signal.
  const railW = Math.max(3, Math.round(width * 0.004));
  return (
    `<rect x="${fnum(b.x)}" y="${fnum(b.y)}" width="${fnum(b.w)}" height="${fnum(b.h)}" ` +
      `rx="${rx.toFixed(1)}" fill="${surfaceFill(theme)}" stroke="${surfaceStroke(theme)}" stroke-width="1"/>` +
    `<rect x="${fnum(b.x)}" y="${fnum(b.y + b.h * 0.15)}" width="${railW}" height="${fnum(b.h * 0.7)}" ` +
      `rx="${(railW / 2).toFixed(1)}" fill="${accentColor(theme)}"/>`
  );
}

function renderChecklistItem(r: RectPx, theme: DesignTheme, width: number, height: number): string {
  const { padX, padY } = backplatePadding(r, width, height);
  const b   = inflate(r, padX, padY, width, height);
  const rx  = Math.max(8, Math.min(22, b.h * 0.22));
  const ic  = Math.max(18, Math.min(34, Math.round(b.h * 0.55)));
  const icX = b.x + padX * 0.4;
  const icY = b.y + (b.h - ic) / 2;
  // Checkmark path sized to icon radius.
  const cx = icX + ic / 2;
  const cy = icY + ic / 2;
  const s  = ic * 0.28;
  const pathD = `M ${fnum(cx - s)} ${fnum(cy)} L ${fnum(cx - s * 0.15)} ${fnum(cy + s * 0.75)} L ${fnum(cx + s)} ${fnum(cy - s * 0.7)}`;
  return (
    `<rect x="${fnum(b.x)}" y="${fnum(b.y)}" width="${fnum(b.w)}" height="${fnum(b.h)}" ` +
      `rx="${rx.toFixed(1)}" fill="${surfaceFill(theme)}" stroke="${surfaceStroke(theme)}" stroke-width="1"/>` +
    `<circle cx="${fnum(cx)}" cy="${fnum(cy)}" r="${fnum(ic / 2)}" fill="${accentColor(theme)}"/>` +
    `<path d="${pathD}" stroke="${iconTextColor(theme)}" stroke-width="${(ic * 0.11).toFixed(1)}" ` +
      `stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
  );
}

function renderStepBlock(
  r: RectPx, index: number, theme: DesignTheme, width: number, height: number,
): string {
  const { padX, padY } = backplatePadding(r, width, height);
  const b   = inflate(r, padX, padY, width, height);
  const rx  = Math.max(8, Math.min(22, b.h * 0.22));
  const d   = Math.max(26, Math.min(46, Math.round(Math.min(b.w, b.h) * 0.35)));
  const nX  = b.x + padX * 0.4;
  const nY  = b.y - d * 0.35;                         // protrude slightly above card
  const ncX = Math.max(d * 0.6, nX + d / 2);
  const ncY = Math.max(d * 0.6, nY + d / 2);
  const label = String(index ?? 1);
  return (
    `<rect x="${fnum(b.x)}" y="${fnum(b.y)}" width="${fnum(b.w)}" height="${fnum(b.h)}" ` +
      `rx="${rx.toFixed(1)}" fill="${surfaceFill(theme)}" stroke="${surfaceStroke(theme)}" stroke-width="1"/>` +
    `<circle cx="${fnum(ncX)}" cy="${fnum(ncY)}" r="${fnum(d / 2)}" fill="${accentColor(theme)}"/>` +
    `<text x="${fnum(ncX)}" y="${fnum(ncY + d * 0.08)}" font-size="${fnum(d * 0.58)}" ` +
      `font-weight="700" fill="${iconTextColor(theme)}" text-anchor="middle" ` +
      `dominant-baseline="middle" font-family="system-ui,-apple-system,sans-serif">${label}</text>`
  );
}

function renderQuoteBox(r: RectPx, theme: DesignTheme, width: number, height: number): string {
  const { padX, padY } = backplatePadding(r, width, height);
  const b   = inflate(r, padX, padY, width, height);
  const rx  = Math.max(12, Math.min(28, b.h * 0.12));
  const qs  = Math.max(42, Math.min(140, Math.round(b.h * 0.48)));
  const qx  = b.x + Math.max(padX * 1.2, 14);
  const qy  = b.y + qs * 0.85;
  return (
    `<rect x="${fnum(b.x)}" y="${fnum(b.y)}" width="${fnum(b.w)}" height="${fnum(b.h)}" ` +
      `rx="${rx.toFixed(1)}" fill="${surfaceFill(theme)}" stroke="${surfaceStroke(theme)}" stroke-width="1"/>` +
    `<text x="${fnum(qx)}" y="${fnum(qy)}" font-size="${fnum(qs)}" ` +
      `font-weight="900" fill="${withAlpha(accentColor(theme), 0.42)}" ` +
      `font-family="Georgia,'Times New Roman',serif">&#8220;</text>`
  );
}

function renderLabeledSection(r: RectPx, theme: DesignTheme, width: number, height: number): string {
  // A thin accent rail above the zone instead of a full card — signals
  // a section header without boxing the type.
  const barW = Math.min(r.w * 0.32, Math.max(48, width * 0.08));
  const barH = Math.max(3, Math.round(height * 0.005));
  const y    = Math.max(0, r.y - barH - 6);
  return (
    `<rect x="${fnum(r.x)}" y="${fnum(y)}" width="${fnum(barW)}" height="${barH}" ` +
    `rx="${(barH / 2).toFixed(1)}" fill="${accentColor(theme)}"/>`
  );
}

// ── Public renderer ──────────────────────────────────────────────────────────

export function renderComponentBackplates(
  assignments: ComponentAssignment[],
  zones:       Zone[],
  theme:       DesignTheme,
  width:       number,
  height:      number,
): string {
  if (assignments.length === 0) return "";
  const zoneMap = new Map(zones.map(z => [z.id, z]));
  const parts: string[] = [];
  for (const a of assignments) {
    // cta_button and badge are drawn by their dedicated renderers. The
    // component system records them for coverage but doesn't double-paint.
    if (a.kind === "cta_button" || a.kind === "badge") continue;
    const z = zoneMap.get(a.zoneId as ZoneId);
    if (!z) continue;
    // Zero-area zones (collapsed image slot, etc.) produce no backplate.
    if (z.width <= 0.5 || z.height <= 0.5) continue;
    const r = zoneRect(z, width, height);
    switch (a.kind) {
      case "content_card":     parts.push(renderContentCard(r, theme, width, height)); break;
      case "tip_card":         parts.push(renderTipCard(r, theme, width, height));     break;
      case "checklist_item":   parts.push(renderChecklistItem(r, theme, width, height)); break;
      case "step_block":       parts.push(renderStepBlock(r, a.index ?? 1, theme, width, height)); break;
      case "quote_box":        parts.push(renderQuoteBox(r, theme, width, height));    break;
      case "labeled_section":  parts.push(renderLabeledSection(r, theme, width, height)); break;
    }
  }
  return parts.join("\n    ");
}

// ── Audit helper ─────────────────────────────────────────────────────────────

export function componentCoverageSummary(rep: ComponentCoverageReport): string {
  const kindSummary = rep.distinctKinds.join(",");
  return `[${kindSummary}] count=${rep.componentCount} structured=${rep.structuredCount} cov=${rep.coverageRatio.toFixed(2)}`;
}
