import { LayoutCandidate } from "./layout-intelligence";
import { DesignTheme, DecorShape } from "./design-themes";

export interface DecorationPlan {
  shapes: DecorShape[];
}

export function buildDecorationPlan(layout: LayoutCandidate, theme: DesignTheme): DecorationPlan {
  const safe = layout.safeZone;
  const elements = layout.elements;

  const filtered = theme.decorations.filter(shape => {
    const box = approximateShapeBox(shape);
    return !intersectsText(box, elements);
  });

  const adapted = filtered.map(shape => adjustShape(shape, safe, layout.style.spacingDensity));

  return { shapes: adapted };
}

function approximateShapeBox(shape: DecorShape) {
  if ("x" in shape && "y" in shape) {
    return {
      x: shape.x,
      y: shape.y,
      w: "w" in shape ? shape.w : ("r" in shape ? shape.r : 10),
      h: "h" in shape ? shape.h : ("r" in shape ? shape.r : 10),
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
