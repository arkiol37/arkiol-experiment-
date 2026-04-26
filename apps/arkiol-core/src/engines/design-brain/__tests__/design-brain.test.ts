// design-brain.test.ts
//
// Smoke tests for the deterministic Design Brain stage. We don't unit-test
// every domain profile here — that's static config — but we do pin the
// invariants the strict-quality contract depends on:
//
//   • a fitness brief produces a fitness plan with bold style + JOIN-style CTA
//   • a generic brief never falls through to a weak pastel default
//   • templateCount is always clamped into the 3-4 range
//   • isDomainMatch rejects an off-domain subject for a real domain plan,
//     and stays permissive when the plan or the subject is unspecified

import {
  buildDesignBrain,
  isDomainMatch,
  DESIGN_BRAIN_MIN_TEMPLATE_COUNT,
  DESIGN_BRAIN_TEMPLATE_COUNT,
} from "../index";

describe("buildDesignBrain", () => {
  it("infers fitness domain and produces bold high-contrast direction", () => {
    const plan = buildDesignBrain({
      prompt: "promotional poster for fitness clubs and gym workouts",
    });
    expect(plan.domain).toBe("fitness");
    expect(plan.visualStyle).toBe("bold");
    expect(plan.assetType).toBe("fitness_visuals");
    expect(plan.composition.contrast).toBe("high");
    expect(plan.ctaSuggestion).toMatch(/JOIN|TRAIN|TRANSFORM|NOW/i);
    expect(plan.confidence).toBeGreaterThan(0.8);
  });

  it("falls back to general modern profile when no keyword matches", () => {
    const plan = buildDesignBrain({
      prompt: "qwerty asdf xyz123",
    });
    expect(plan.domain).toBe("general");
    expect(plan.assetType).toBe("generic_modern");
    expect(plan.composition.contrast).toBe("high");
    expect(plan.confidence).toBe(0.0);
  });

  it("uses briefCategory when supplied with full confidence", () => {
    const plan = buildDesignBrain({
      prompt: "anything goes here",
      briefCategory: "wellness",
    });
    expect(plan.domain).toBe("wellness");
    expect(plan.assetType).toBe("wellness_visuals");
    expect(plan.confidence).toBe(1.0);
  });

  it("clamps templateCount to the strict 3-4 range", () => {
    const tooMany = buildDesignBrain({
      prompt: "fitness brief",
      requestedCount: 12,
    });
    const tooFew = buildDesignBrain({
      prompt: "fitness brief",
      requestedCount: 1,
    });
    expect(tooMany.templateCount).toBeLessThanOrEqual(DESIGN_BRAIN_TEMPLATE_COUNT);
    expect(tooFew.templateCount).toBeGreaterThanOrEqual(DESIGN_BRAIN_MIN_TEMPLATE_COUNT);
  });

  it("returns a deterministic plan for the same prompt", () => {
    const a = buildDesignBrain({ prompt: "luxury skincare launch with rose gold tones" });
    const b = buildDesignBrain({ prompt: "luxury skincare launch with rose gold tones" });
    // elapsedMs may differ — strip it before equality check.
    const stripA = { ...a, elapsedMs: 0 };
    const stripB = { ...b, elapsedMs: 0 };
    expect(stripA).toEqual(stripB);
  });
});

describe("isDomainMatch", () => {
  it("rejects an off-domain subject for a pinned domain plan", () => {
    const plan = { domain: "fitness" as const };
    expect(isDomainMatch(plan, "wellness")).toBe(false);
    expect(isDomainMatch(plan, "Beauty")).toBe(false);
  });

  it("accepts the matching domain regardless of casing", () => {
    const plan = { domain: "fitness" as const };
    expect(isDomainMatch(plan, "fitness")).toBe(true);
    expect(isDomainMatch(plan, "FITNESS")).toBe(true);
  });

  it("stays permissive when the plan is general", () => {
    const plan = { domain: "general" as const };
    expect(isDomainMatch(plan, "wellness")).toBe(true);
    expect(isDomainMatch(plan, "")).toBe(true);
  });

  it("stays permissive when the candidate has no subject category", () => {
    const plan = { domain: "fitness" as const };
    expect(isDomainMatch(plan, "")).toBe(true);
    expect(isDomainMatch(plan, null)).toBe(true);
    expect(isDomainMatch(plan, undefined)).toBe(true);
  });
});
