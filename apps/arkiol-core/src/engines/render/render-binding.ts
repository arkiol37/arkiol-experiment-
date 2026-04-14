import { RenderPayload } from "./render-orchestrator";
import { DecorShape } from "./design-themes";

export interface BoundRenderNode {
  id: string;
  kind: "text" | "shape" | "media";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string[];
  style?: Record<string, string | number | boolean>;
}

export interface BoundRenderScene {
  width: number;
  height: number;
  background: Record<string, unknown>;
  nodes: BoundRenderNode[];
}

const CANVAS_SIZE = 1080;

export function bindRenderPayloadToScene(payload: RenderPayload): BoundRenderScene {
  const textNodes = payload.layout.elements.map((element) => {
    const typography = payload.typography[element.id as keyof typeof payload.typography];
    const themeTypography = resolveThemeTypography(payload.layout.theme.typography, element.id);

    return {
      id: element.id,
      kind: element.id === "media" ? "media" : "text",
      x: percentToPx(element.rect.x),
      y: percentToPx(element.rect.y),
      width: percentToPx(element.rect.w),
      height: percentToPx(element.rect.h),
      text: typography?.lines,
      style: {
        align: element.align,
        fontFamily: themeTypography.fontFamily,
        fontWeight: themeTypography.fontWeight,
        fontSize: typography?.fontSize ?? 16,
        lineHeight: typography?.lineHeight ?? 20,
        letterSpacing: typography?.tracking ?? 0,
        color: themeTypography.color,
        textTransform: themeTypography.textTransform ?? "none",
      },
    } satisfies BoundRenderNode;
  });

  const shapeNodes = payload.decorations.shapes.map((shape, index) => bindShape(shape, index));

  return {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    background: payload.layout.theme.background,
    nodes: [...shapeNodes, ...textNodes],
  };
}

function bindShape(shape: DecorShape, index: number): BoundRenderNode {
  const x = "x" in shape ? percentToPx(shape.x) : 0;
  const y = "y" in shape ? percentToPx(shape.y) : 0;
  const width = "w" in shape ? percentToPx(shape.w) : ("r" in shape ? percentToPx(shape.r * 2) : CANVAS_SIZE);
  const height = "h" in shape ? percentToPx(shape.h) : ("r" in shape ? percentToPx(shape.r * 2) : CANVAS_SIZE);

  return {
    id: `shape_${index}`,
    kind: "shape",
    x,
    y,
    width,
    height,
    style: {
      shape: shape.kind,
      opacity: "opacity" in shape ? shape.opacity : 1,
      color: "color" in shape ? shape.color : "transparent",
    },
  };
}

function percentToPx(value: number): number {
  return (value / 100) * CANVAS_SIZE;
}

function resolveThemeTypography(themeTypography: any, id: string) {
  if (id === "headline") return themeTypography.headline;
  if (id === "subhead") return themeTypography.subhead;
  if (id === "body") return themeTypography.body_text;
  if (id === "cta") return themeTypography.cta;
  return themeTypography.body_text;
}
