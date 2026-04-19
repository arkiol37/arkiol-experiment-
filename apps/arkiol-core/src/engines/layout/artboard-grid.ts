// src/engines/layout/artboard-grid.ts
//
// Artboard grid — a per-format column/row system used to place zones on
// intentional alignment tracks rather than at arbitrary percentages.
//
// Every format gets:
//   • outer margins (top/right/bottom/left, % of canvas dim)
//   • a column count with matching gutters (% of content width)
//   • a baseline row unit (% of canvas height)
//
// Zones are snapped so that x / width align to column boundaries, and y /
// height align to baseline row boundaries. The snapped zone is clamped to
// the grid's inner content box (inside the outer margins).
//
// This file owns grid math only — it does not decide which zone belongs in
// which track. Composition decisions live upstream (layout families,
// category layout profiles).

import type { Zone, ZoneId } from "./families";
import type { FormatCategory } from "./authority";

// ── Grid specification ──────────────────────────────────────────────────────

export interface ArtboardGrid {
  /** Outer margins as % of canvas dimension */
  margin:  { top: number; right: number; bottom: number; left: number };
  /** Number of equal vertical columns */
  columns: number;
  /** Gap between columns as % of canvas width */
  gutter:  number;
  /** Baseline row unit as % of canvas height */
  rowUnit: number;
}

const GRIDS: Record<FormatCategory | "default", ArtboardGrid> = {
  instagram: { margin: { top: 5,  right: 5,  bottom: 5,  left: 5  }, columns: 6,  gutter: 1.2, rowUnit: 2 },
  story:     { margin: { top: 12, right: 6,  bottom: 14, left: 6  }, columns: 4,  gutter: 1.4, rowUnit: 2 },
  thumbnail: { margin: { top: 4,  right: 4,  bottom: 10, left: 4  }, columns: 6,  gutter: 1.0, rowUnit: 2.5 },
  flyer:     { margin: { top: 6,  right: 6,  bottom: 6,  left: 6  }, columns: 12, gutter: 0.8, rowUnit: 1.6 },
  poster:    { margin: { top: 6,  right: 6,  bottom: 6,  left: 6  }, columns: 12, gutter: 0.8, rowUnit: 1.6 },
  slide:     { margin: { top: 5,  right: 5,  bottom: 5,  left: 5  }, columns: 12, gutter: 0.9, rowUnit: 2 },
  card:      { margin: { top: 7,  right: 7,  bottom: 7,  left: 7  }, columns: 8,  gutter: 1.0, rowUnit: 3 },
  document:  { margin: { top: 6,  right: 6,  bottom: 6,  left: 6  }, columns: 12, gutter: 0.7, rowUnit: 1.4 },
  logo:      { margin: { top: 12, right: 12, bottom: 12, left: 12 }, columns: 4,  gutter: 1.2, rowUnit: 3 },
  unknown:   { margin: { top: 5,  right: 5,  bottom: 5,  left: 5  }, columns: 6,  gutter: 1.2, rowUnit: 2 },
  default:   { margin: { top: 5,  right: 5,  bottom: 5,  left: 5  }, columns: 6,  gutter: 1.2, rowUnit: 2 },
};

export function getArtboardGrid(category: FormatCategory): ArtboardGrid {
  return GRIDS[category] ?? GRIDS.default;
}

// ── Derived geometry ────────────────────────────────────────────────────────

export interface GridGeometry {
  innerX:      number;  // left edge of the content box
  innerY:      number;  // top edge of the content box
  innerW:      number;  // content-box width
  innerH:      number;  // content-box height
  columnW:     number;  // width of one column (no gutter)
  trackStride: number;  // column width + gutter (advance from one column start to next)
  rowUnit:     number;
  grid:        ArtboardGrid;
}

export function computeGridGeometry(grid: ArtboardGrid): GridGeometry {
  const innerX = grid.margin.left;
  const innerY = grid.margin.top;
  const innerW = Math.max(1, 100 - grid.margin.left - grid.margin.right);
  const innerH = Math.max(1, 100 - grid.margin.top  - grid.margin.bottom);
  const totalGutter = grid.gutter * (grid.columns - 1);
  const columnW = Math.max(0.5, (innerW - totalGutter) / grid.columns);
  const trackStride = columnW + grid.gutter;
  return { innerX, innerY, innerW, innerH, columnW, trackStride, rowUnit: grid.rowUnit, grid };
}

// ── Snapping ────────────────────────────────────────────────────────────────
//
// x-snap rule: left edge lands on a column start; right edge lands on a
// column end. We choose the nearest column indices rather than forcing a
// specific span, so small zones still fit on a narrow track.
//
// y-snap rule: edges round to the nearest rowUnit multiple.

function roundToStep(value: number, step: number, min: number, max: number): number {
  if (step <= 0) return clamp(value, min, max);
  const rounded = Math.round((value - min) / step) * step + min;
  return clamp(rounded, min, max);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Column start in % given a column index (0-based). */
function columnStart(i: number, geo: GridGeometry): number {
  return geo.innerX + i * geo.trackStride;
}

/** Column end (right edge, including column width) in % given column index. */
function columnEnd(i: number, geo: GridGeometry): number {
  return columnStart(i, geo) + geo.columnW;
}

function nearestColumnStart(x: number, geo: GridGeometry): number {
  const idx = clamp(Math.round((x - geo.innerX) / geo.trackStride), 0, geo.grid.columns - 1);
  return columnStart(idx, geo);
}

function nearestColumnEnd(rightX: number, geo: GridGeometry): number {
  const idx = clamp(Math.round((rightX - geo.innerX) / geo.trackStride), 0, geo.grid.columns - 1);
  return columnEnd(idx, geo);
}

// Zones that should NOT be column-snapped (background & full-bleed artwork).
const NO_COLUMN_SNAP: ReadonlySet<ZoneId> = new Set<ZoneId>(["background", "image", "accent"]);

// Zones that should snap but can span the full content box (visual anchors).
const ALLOW_FULL_SPAN: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "headline", "image", "cta", "section_header",
]);

export interface GridSnapOptions {
  /** Minimum column span for multi-track zones. Defaults to 1. */
  minColumns?: number;
}

/**
 * Snap one zone to the artboard grid. Returns a new zone; original is not mutated.
 * Collapsed zones (height === 0) are returned unchanged so downstream passes
 * can still detect them.
 */
export function snapZoneToGrid(
  zone: Zone,
  geo:  GridGeometry,
  opts: GridSnapOptions = {},
): Zone {
  if (zone.height <= 0 || zone.width <= 0) return zone;
  if (NO_COLUMN_SNAP.has(zone.id)) {
    // Still snap vertical edges so full-bleed art aligns to the baseline grid
    const y2 = zone.y + zone.height;
    const snappedY  = roundToStep(zone.y, geo.rowUnit, 0, 100);
    const snappedY2 = roundToStep(y2,     geo.rowUnit, 0, 100);
    const newH = Math.max(geo.rowUnit, snappedY2 - snappedY);
    return { ...zone, y: snappedY, height: newH };
  }

  const minColumns = Math.max(1, opts.minColumns ?? 1);
  const rightX = zone.x + zone.width;

  let startIdx = clamp(
    Math.round((zone.x - geo.innerX) / geo.trackStride),
    0,
    geo.grid.columns - 1,
  );
  let endIdx = clamp(
    Math.round((rightX - geo.innerX) / geo.trackStride),
    0,
    geo.grid.columns - 1,
  );
  if (endIdx < startIdx) endIdx = startIdx;

  // Ensure minimum column span
  if (endIdx - startIdx + 1 < minColumns) {
    endIdx = Math.min(geo.grid.columns - 1, startIdx + minColumns - 1);
    if (endIdx - startIdx + 1 < minColumns) {
      startIdx = Math.max(0, endIdx - minColumns + 1);
    }
  }

  // Allow full-span zones to round outward when they were already near-edge
  if (ALLOW_FULL_SPAN.has(zone.id)) {
    if (zone.x <= geo.innerX + geo.trackStride * 0.5) startIdx = 0;
    if (rightX >= geo.innerX + geo.innerW - geo.trackStride * 0.5) endIdx = geo.grid.columns - 1;
  }

  const newX  = columnStart(startIdx, geo);
  const newW  = Math.max(geo.columnW, columnEnd(endIdx, geo) - newX);

  // Vertical edges snap to baseline rows
  const y2 = zone.y + zone.height;
  const snappedY  = roundToStep(zone.y, geo.rowUnit, geo.innerY, geo.innerY + geo.innerH);
  const snappedY2 = roundToStep(y2,     geo.rowUnit, geo.innerY, geo.innerY + geo.innerH);
  const newH = Math.max(geo.rowUnit, snappedY2 - snappedY);

  return {
    ...zone,
    x:      newX,
    y:      snappedY,
    width:  Math.min(newW, 100 - newX),
    height: Math.min(newH, 100 - snappedY),
  };
}

/**
 * Snap every zone in a batch. Returns the new zone array plus a count of
 * zones that actually moved, for adjustment logging upstream.
 */
export function snapZonesToGrid(
  zones: Zone[],
  category: FormatCategory,
): { zones: Zone[]; moved: number; grid: ArtboardGrid } {
  const grid = getArtboardGrid(category);
  const geo  = computeGridGeometry(grid);
  let moved = 0;
  const out = zones.map(z => {
    const snapped = snapZoneToGrid(z, geo);
    if (
      Math.abs(snapped.x - z.x) > 0.01 ||
      Math.abs(snapped.y - z.y) > 0.01 ||
      Math.abs(snapped.width  - z.width)  > 0.01 ||
      Math.abs(snapped.height - z.height) > 0.01
    ) {
      moved++;
    }
    return snapped;
  });
  return { zones: out, moved, grid };
}
