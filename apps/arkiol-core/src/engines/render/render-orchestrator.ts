import { LayoutEngineOptions, pickBestLayout } from "./layout-intelligence";
import { buildTypographyPlan } from "./typography-intelligence";
import { buildDecorationPlan } from "./decoration-intelligence";
import { BriefAnalysis } from "../ai/brief-analyzer";

export interface RenderPayload {
  layout: ReturnType<typeof pickBestLayout>;
  typography: ReturnType<typeof buildTypographyPlan>;
  decorations: ReturnType<typeof buildDecorationPlan>;
  debug?: any;
}

export function generateRenderPayload(
  brief: BriefAnalysis,
  options: Omit<LayoutEngineOptions, "brief"> = {},
  copyOverride?: { headline?: string; subhead?: string; body?: string; cta?: string }
): RenderPayload {
  const layout = pickBestLayout({ ...options, brief });

  const typography = buildTypographyPlan(layout, {
    headline: copyOverride?.headline ?? brief.headline,
    subhead: copyOverride?.subhead ?? brief.subhead,
    body: copyOverride?.body ?? brief.body,
    cta: copyOverride?.cta ?? brief.cta,
  });

  const decorations = buildDecorationPlan(layout, layout.theme);

  return {
    layout,
    typography,
    decorations,
    debug: {
      score: layout.score,
      pattern: layout.pattern.id,
    },
  };
}
