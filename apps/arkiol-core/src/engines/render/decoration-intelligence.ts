import { LayoutCandidate } from "./layout-intelligence";
import { DesignTheme, DecorShape } from "./design-themes";

export interface DecorationPlan {
  shapes: DecorShape[];
}

const MIN_DECORATIONS = 8;
const MIN_UNIQUE_KINDS = 5;

// Shapes that create visual structure and depth — used for enrichment
const STRUCTURAL_SHAPES: DecorShape[] = [
  { kind: "corner_bracket", x: 3, y: 3, size: 8, color: "currentColor", opacity: 0.18, strokeWidth: 1.5, corner: "tl" },
  { kind: "corner_bracket", x: 97, y: 97, size: 8, color: "currentColor", opacity: 0.18, strokeWidth: 1.5, corner: "br" },
  { kind: "accent_bar", x: 5, y: 92, w: 18, h: 0.6, color: "currentColor", rx: 1 },
  { kind: "dots_grid", x: 82, y: 6, cols: 4, rows: 4, gap: 3, r: 0.8, color: "currentColor", opacity: 0.12 },
  { kind: "section_divider", x: 15, y: 50, w: 70, color: "currentColor", opacity: 0.1, strokeWidth: 0.8, ornament: "dot" },
  { kind: "deco_ring", x: 90, y: 12, r: 14, color: "currentColor", opacity: 0.08, strokeWidth: 1.2 },
  { kind: "diagonal_stripe", x: 0, y: 0, w: 100, h: 100, color: "currentColor", opacity: 0.03 },
  { kind: "half_circle", x: 0, y: 65, r: 22, color: "currentColor", opacity: 0.06, rotation: 90 },
  { kind: "wave", x: 5, y: 88, w: 90, amplitude: 2.5, frequency: 3, color: "currentColor", opacity: 0.08, strokeWidth: 1 },
  { kind: "arc_stroke", x: 8, y: 8, r: 30, startAngle: 200, endAngle: 280, color: "currentColor", opacity: 0.07, strokeWidth: 1.2 },
];

export function buildDecorationPlan(layout: LayoutCandidate, theme: DesignTheme): DecorationPlan {
  const safe = layout.safeZone;
  const elements = layout.elements;

  const filtered = theme.decorations.filter(shape => {
    const box = approximateShapeBox(shape);
    return !intersectsText(box, elements);
  });

  const adapted = filtered.map(shape => adjustShape(shape, safe, layout.style.spacingDensity));

  const enriched = enrichDecorations(adapted, theme);

  return { shapes: enriched };
}

export function enrichDecorations(shapes: DecorShape[], theme: DesignTheme): DecorShape[] {
  const result = [...shapes];
  const existingKinds = new Set(result.map(s => s.kind));

  const accentColor = theme.palette.secondary ?? theme.palette.primary;

  // If too many decorations were culled, inject structural shapes to compensate
  if (result.length < MIN_DECORATIONS || existingKinds.size < MIN_UNIQUE_KINDS) {
    const needed = Math.max(MIN_DECORATIONS - result.length, MIN_UNIQUE_KINDS - existingKinds.size);
    let added = 0;

    for (const template of STRUCTURAL_SHAPES) {
      if (added >= needed) break;
      if (existingKinds.has(template.kind)) continue;

      const shape = resolveColor(template, accentColor);
      result.push(shape);
      existingKinds.add(shape.kind);
      added++;
    }
  }

  // Gradient-only compositions must get a noise overlay for texture
  if (!existingKinds.has("noise_overlay") && !existingKinds.has("texture_fill")) {
    result.push({ kind: "noise_overlay", opacity: 0.035 });
  }

  return result;
}

function resolveColor(shape: DecorShape, accentColor: string): DecorShape {
  const clone = { ...shape };
  if ("color" in clone && (clone as any).color === "currentColor") {
    (clone as any).color = accentColor;
  }
  return clone as DecorShape;
}

function approximateShapeBox(shape: DecorShape) {
  // Shapes that span the full canvas (texture, noise, starburst with large r) — skip collision
  if (shape.kind === "noise_overlay" || shape.kind === "diagonal_band") {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  if (shape.kind === "texture_fill") {
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  if (shape.kind === "checklist") {
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.items.length * (shape.lineHeight ?? shape.fontSize * 1.8) / 10 };
  }
  if ("x" in shape && "y" in shape) {
    return {
      x: shape.x,
      y: shape.y,
      w: "w" in shape ? shape.w : ("r" in shape ? shape.r : ("size" in shape ? shape.size : 10)),
      h: "h" in shape ? shape.h : ("r" in shape ? shape.r : ("size" in shape ? shape.size : 10)),
    };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function intersectsText(box: { x: number; y: number; w: number; h: number }, elements: LayoutCandidate["elements"]) {
  return elements.some(el => {
    const overlapX = Math.abs((box.x + box.w / 2) - (el.rect.x + el.rect.w / 2)) < (box.w + el.rect.w) / 2;
    const overlapY = Math.abs((box.y + box.h / 2) - (el.rect.y + el.rect.h / 2)) < (box.h + el.rect.h) / 2;
    return overlapX && overlapY;
  });
}

function adjustShape(shape: DecorShape, safe: LayoutCandidate["safeZone"], density: LayoutCandidate["style"]["spacingDensity"]): DecorShape {
  if (!("x" in shape && "y" in shape)) return shape;

  const marginBoost = density === "airy" ? 4 : density === "compact" ? -2 : 0;

  return {
    ...shape,
    x: clamp(shape.x, safe.left + marginBoost, 100 - safe.right - marginBoost),
    y: clamp(shape.y, safe.top + marginBoost, 100 - safe.bottom - marginBoost),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
