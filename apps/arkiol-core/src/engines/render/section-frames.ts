// src/engines/render/section-frames.ts
//
// Structured section frames — turns a template from "text floating on a
// background" into an intentionally composed surface with visible regions:
// header, content, visual, list, and CTA.
//
// Frames are computed from the resolved zones (which belong to roles) and
// rendered as a dedicated SVG layer *above* decorations and *below* text,
// so the reader perceives distinct areas rather than isolated pieces of
// text.
//
// This module does NOT introduce decorative assets. It renders surface-level
// primitives (rounded rects, a hairline, an accent rail) whose fills and
// strokes come from the current theme's palette. Step 4 will layer more
// decorative content on top.

import type { Zone, ZoneId } from "../layout/families";
import type { DesignTheme } from "./design-themes";
import { FORMAT_DIMS }      from "../../lib/types";

// ── Roles ────────────────────────────────────────────────────────────────────

export type SectionRole = "header" | "content" | "visual" | "list" | "cta";

const ZONE_ROLE: Partial<Record<ZoneId, SectionRole>> = {
  // Header — identity, tagline, eyebrow, section label, logo, badge
  logo:           "header",
  badge:          "header",
  section_header: "header",

  // Content — primary type hierarchy
  headline:  "content",
  subhead:   "content",
  body:      "content",
  name:      "content",
  title:     "content",
  tagline:   "content",
  company:   "content",
  contact:   "content",
  price:     "content",
  legal:     "content",

  // Visual — imagery
  image:     "visual",

  // List — enumerated items / bullet areas
  bullet_1:  "list",
  bullet_2:  "list",
  bullet_3:  "list",

  // CTA — primary action zone
  cta:       "cta",
};

// Zones that must never trigger a frame regardless of role.
const SKIP_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>(["background", "accent"]);

// ── Rect math ────────────────────────────────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number; }

function zoneRect(z: Zone, W: number, H: number): Rect {
  return {
    x: (z.x      / 100) * W,
    y: (z.y      / 100) * H,
    w: (z.width  / 100) * W,
    h: (z.height / 100) * H,
  };
}

function unionRect(a: Rect, b: Rect): Rect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function expandRect(r: Rect, padX: number, padY: number, maxW: number, maxH: number): Rect {
  const x = Math.max(0, r.x - padX);
  const y = Math.max(0, r.y - padY);
  const w = Math.min(maxW - x, r.w + padX * 2);
  const h = Math.min(maxH - y, r.h + padY * 2);
  return { x, y, w, h };
}

// ── Colour helpers ───────────────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!HEX_RE.test(hex)) return null;
  const raw = hex.length === 4
    ? hex.slice(1).split("").map(c => c + c).join("")
    : hex.slice(1);
  const n = parseInt(raw, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex; // fall through for non-hex inputs
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a.toFixed(3)})`;
}

function perceivedLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  // Rec. 709 luma — good enough for light/dark classification
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

// ── Frame styling per role ───────────────────────────────────────────────────

interface FrameStyle {
  fill:          string;       // solid or rgba
  stroke?:       string;       // optional stroke color
  strokeWidth?:  number;       // only used if stroke is set
  rx:            number;       // corner radius
  accentRail?:   {             // optional left-side accent rail
    color: string;
    width: number;
  };
  underline?:    {             // optional bottom hairline
    color: string;
    width: number;
  };
}

function styleForRole(role: SectionRole, theme: DesignTheme): FrameStyle {
  const pal       = theme.palette;
  const isDarkBg  = perceivedLuminance(pal.background) < 0.5;
  const neutral   = isDarkBg ? "#ffffff" : "#000000";
  const primary   = pal.primary;
  const secondary = pal.secondary ?? pal.highlight ?? primary;

  switch (role) {
    case "header":
      // A wide tinted band. Very subtle — establishes a visual anchor for
      // identity/eyebrow content without competing with the headline below.
      return {
        fill:        rgba(primary, isDarkBg ? 0.14 : 0.07),
        rx:          6,
        underline:   { color: rgba(primary, 0.35), width: 1.5 },
      };

    case "content":
      // Rounded surface card. Uses the theme's surface tint (already tuned
      // for contrast with the background) plus a hairline border.
      return {
        fill:        pal.surface,
        stroke:      rgba(neutral, isDarkBg ? 0.16 : 0.10),
        strokeWidth: 1,
        rx:          14,
      };

    case "visual":
      // Outlined neutral frame — marks the image area even when no image is
      // resolved yet, so the composition reads as "visual area here" instead
      // of dead space.
      return {
        fill:        rgba(neutral, isDarkBg ? 0.06 : 0.04),
        stroke:      rgba(neutral, isDarkBg ? 0.22 : 0.14),
        strokeWidth: 1.5,
        rx:          10,
      };

    case "list":
      // Tinted panel with a bold left accent rail — reads as a bullet / list
      // region without drawing the bullets themselves yet.
      return {
        fill:        rgba(secondary, isDarkBg ? 0.12 : 0.07),
        rx:          10,
        accentRail:  { color: secondary, width: 5 },
      };

    case "cta":
      // Surround frame for the CTA button — a rounded outline that makes the
      // action region feel anchored rather than floating.
      return {
        fill:        "transparent",
        stroke:      rgba(primary, 0.55),
        strokeWidth: 2,
        rx:          999, // pill-style, capped by geometry
      };
  }
}

// ── Role grouping ────────────────────────────────────────────────────────────

function groupZonesByRole(zones: Zone[]): Map<SectionRole, Zone[]> {
  const groups = new Map<SectionRole, Zone[]>();
  for (const zone of zones) {
    if (SKIP_ZONES.has(zone.id)) continue;
    if (zone.height <= 0 || zone.width <= 0) continue;
    const role = ZONE_ROLE[zone.id];
    if (!role) continue;
    const arr = groups.get(role) ?? [];
    arr.push(zone);
    groups.set(role, arr);
  }
  return groups;
}

// ── Per-role frame geometry ─────────────────────────────────────────────────

function buildRoleRect(
  role:  SectionRole,
  zones: Zone[],
  W:     number,
  H:     number,
): Rect | null {
  if (!zones.length) return null;

  const rects = zones.map(z => zoneRect(z, W, H));
  let bounds = rects.reduce((acc, r) => unionRect(acc, r), rects[0]);

  // Per-role padding — tuned by canvas size so frames feel proportional.
  const unit  = Math.min(W, H) / 100;
  const padX  = 2.8 * unit;
  const padY  = 2.2 * unit;

  switch (role) {
    case "header":
      // Slim tint band spanning the header zones — keep pad tighter vertically
      bounds = expandRect(bounds, padX * 0.7, padY * 0.45, W, H);
      break;

    case "content":
      bounds = expandRect(bounds, padX, padY, W, H);
      break;

    case "visual":
      // Visual frame hugs the image bounds closely
      bounds = expandRect(bounds, unit * 0.6, unit * 0.6, W, H);
      break;

    case "list":
      bounds = expandRect(bounds, padX, padY * 0.8, W, H);
      break;

    case "cta": {
      // Surround frame is tighter — uses button-ish pill proportions
      const padButtonX = padX * 0.5;
      const padButtonY = padY * 0.4;
      bounds = expandRect(bounds, padButtonX, padButtonY, W, H);
      // Cap pill radius by geometry (prevents overshoot on wide zones)
      break;
    }
  }

  // Guard against degenerate rects
  if (bounds.w < 12 || bounds.h < 12) return null;
  return bounds;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function fmt(n: number): string { return n.toFixed(1); }

function renderFrame(role: SectionRole, rect: Rect, style: FrameStyle): string {
  const { x, y, w, h } = rect;
  const rx = Math.min(style.rx, Math.min(w, h) / 2);

  const strokeAttrs = style.stroke
    ? ` stroke="${style.stroke}" stroke-width="${style.strokeWidth ?? 1}"`
    : "";

  let svg = `<rect class="section-${role}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(rx)}" fill="${style.fill}"${strokeAttrs}/>`;

  if (style.accentRail) {
    const rail = style.accentRail;
    svg += `<rect class="section-${role}-rail" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(rail.width)}" height="${fmt(h)}" rx="${fmt(Math.min(rail.width / 2, rx))}" fill="${rail.color}"/>`;
  }

  if (style.underline) {
    const u = style.underline;
    const inset = Math.min(12, w * 0.08);
    const ux1 = x + inset;
    const ux2 = x + w - inset;
    const uy  = y + h - u.width / 2;
    svg += `<line class="section-${role}-underline" x1="${fmt(ux1)}" y1="${fmt(uy)}" x2="${fmt(ux2)}" y2="${fmt(uy)}" stroke="${u.color}" stroke-width="${u.width}"/>`;
  }

  return svg;
}

// ── Overlap pruning ─────────────────────────────────────────────────────────
//
// If two role rects overlap heavily (e.g. when a content card and a visual
// frame share the same region on a small canvas), keep the one further down
// the priority chain. Priority is roughly: visual → content → list → header
// → cta (visual is the structural anchor, cta is the smallest accent).

const ROLE_PRIORITY: SectionRole[] = ["visual", "content", "list", "header", "cta"];

function intersectionArea(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

function pruneOverlaps(entries: Array<{ role: SectionRole; rect: Rect }>): Array<{ role: SectionRole; rect: Rect }> {
  const ordered = entries
    .slice()
    .sort((a, b) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));

  const kept: Array<{ role: SectionRole; rect: Rect }> = [];
  for (const entry of ordered) {
    const area = entry.rect.w * entry.rect.h;
    if (area <= 0) continue;
    const heavyOverlap = kept.some(k =>
      intersectionArea(k.rect, entry.rect) / area > 0.75
    );
    if (!heavyOverlap) kept.push(entry);
  }
  return kept;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface SectionFramesOptions {
  /**
   * When an image zone covers the full canvas (full-bleed image), the visual
   * frame is suppressed so it doesn't double-outline the photo.
   */
  suppressVisualFullBleed?: boolean;
}

export function buildSectionFrames(
  zones:  Zone[],
  theme:  DesignTheme,
  format: string,
  opts:   SectionFramesOptions = {},
): string {
  const { width: W, height: H } = FORMAT_DIMS[format] ?? { width: 1080, height: 1080 };
  const suppress = opts.suppressVisualFullBleed ?? true;

  // Detect full-bleed image to optionally skip the visual frame
  const imageZone = zones.find(z => z.id === "image");
  const imageIsFullBleed = imageZone
    ? imageZone.width >= 98 && imageZone.height >= 98
    : false;

  const grouped = groupZonesByRole(zones);
  const entries: Array<{ role: SectionRole; rect: Rect }> = [];

  for (const role of ROLE_PRIORITY) {
    if (role === "visual" && suppress && imageIsFullBleed) continue;
    const roleZones = grouped.get(role);
    if (!roleZones?.length) continue;
    const rect = buildRoleRect(role, roleZones, W, H);
    if (!rect) continue;
    entries.push({ role, rect });
  }

  const kept = pruneOverlaps(entries);
  if (!kept.length) return "";

  // Render in priority order so the content card sits above the visual frame
  // when they touch.
  kept.sort((a, b) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));

  const parts: string[] = [];
  for (const { role, rect } of kept) {
    const style = styleForRole(role, theme);
    parts.push(renderFrame(role, rect, style));
  }
  return parts.join("\n    ");
}
