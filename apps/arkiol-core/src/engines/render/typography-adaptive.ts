import { LayoutCandidate } from "./layout-intelligence";

export function enhanceTypographyWeights(layout: LayoutCandidate) {
  const tone = layout.style.typographyMode;

  return layout.elements.map(el => {
    let weight = 400;

    if (el.id === "headline") {
      weight = tone === "display-heavy" ? 800 : 600;
    } else if (el.id === "cta") {
      weight = 700;
    } else if (el.id === "body") {
      weight = tone === "readability-first" ? 400 : 450;
    }

    return {
      ...el,
      adaptiveWeight: weight,
    };
  });
}
