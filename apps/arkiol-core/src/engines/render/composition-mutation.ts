import { LayoutCandidate } from "./layout-intelligence";

export function mutateLayout(candidate: LayoutCandidate): LayoutCandidate {
  const mutated = JSON.parse(JSON.stringify(candidate));

  mutated.elements = mutated.elements.map((el: any) => {
    if (el.id === "headline") {
      el.rect.w += Math.random() * 6 - 3;
      el.rect.y += Math.random() * 4 - 2;
    }

    if (el.id === "cta") {
      el.rect.x += Math.random() * 6 - 3;
    }

    return el;
  });

  mutated.score.total *= 0.98 + Math.random() * 0.04;

  return mutated;
}
