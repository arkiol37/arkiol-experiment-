// fast-composer.test.ts
//
// Pin the architectural contract:
//   • composes a layered SVG (background + hero shape + text layer
//     + CTA + decoration) — never a plain gradient or text-only
//   • produces all four layouts deterministically across vi=0..3
//   • headlines, subhead, CTA all land in the SVG body
//   • output shape includes the qualityVerdict fields the inline
//     admission code reads (rulesAccepted, subjectImageCategory,
//     templateType, etc.)
//   • single composeFastTemplate run finishes in <100ms even on
//     a slow CI runner

import { composeFastTemplate, composeFastGallery } from "../index";
import { pickLayoutForVariation } from "../templates";
import type { DesignBrainPlan } from "../../design-brain";

const FITNESS_PLAN: DesignBrainPlan = {
  domain:        "fitness",
  visualStyle:   "bold",
  palette:       { background: "#0A0A0F", primary: "#FF3B30", accent: "#FFD60A" },
  layout:        "hero",
  assetType:     "fitness_visuals",
  typography:    "bold_headline",
  composition:   { spacing: "tight", hierarchy: "single_focal", emphasis: "headline", whitespace: "minimal", contrast: "high" },
  ctaSuggestion: "JOIN NOW",
  templateCount: 4,
  confidence:    1.0,
  elapsedMs:     2,
};

const BRIEF = {
  intent:    "Promote fitness club memberships",
  audience:  "Active adults 25-45",
  tone:      "bold" as const,
  keywords:  ["fitness", "gym"],
  colorMood: "vibrant" as const,
  imageStyle:"none" as const,
  headline:  "Stronger Every Day",
  subhead:   "Train with our certified coaches and feel the difference in 30 days.",
  cta:       "JOIN NOW",
  badge:     "NEW",
  category:  "fitness" as const,
};

describe("composeFastTemplate", () => {
  it("produces a layered SVG with background + hero + text + CTA", () => {
    const out = composeFastTemplate({
      plan:           FITNESS_PLAN,
      brief:          BRIEF as any,
      format:         "instagram_post",
      variationIndex: 0,
      jobId:          "test-job-1",
      orgId:          "test-org",
    });

    expect(out.svgSource).toContain("<svg");
    expect(out.svgSource).toContain("</svg>");
    // Background layer
    expect(out.svgSource).toMatch(/<rect[^>]*fill="#0A0A0F"/);
    // Hero shape (fitness barbell uses class hero-fitness)
    expect(out.svgSource).toContain('class="hero-fitness"');
    // Text content lands in body (escaped)
    expect(out.svgSource).toContain("Stronger Every Day");
    // CTA
    expect(out.svgSource).toContain("JOIN NOW");
    // Width/height match instagram_post format
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1080);
    // Buffer is the SVG bytes
    expect(out.buffer.length).toBeGreaterThan(0);
    expect(out.fileSize).toBe(out.buffer.length);
  });

  it("returns a verdict that admission code accepts", () => {
    const out = composeFastTemplate({
      plan:           FITNESS_PLAN,
      brief:          BRIEF as any,
      format:         "instagram_post",
      variationIndex: 1,
      jobId:          "test-job-2",
      orgId:          "test-org",
    });

    expect(out.qualityVerdict.rulesAccepted).toBe(true);
    expect(out.qualityVerdict.subjectImageCategory).toBe("fitness");
    expect(out.qualityVerdict.templateType).toBeDefined();
    expect(out.qualityVerdict.sectionCount).toBeGreaterThan(0);
    expect(out.qualityVerdict.componentCount).toBeGreaterThan(0);
  });

  it("rotates through all 4 layouts across vi=0..3", () => {
    const layouts = [0, 1, 2, 3].map(vi => pickLayoutForVariation(vi));
    expect(new Set(layouts).size).toBe(4);
    expect(layouts).toContain("hero");
    expect(layouts).toContain("split");
    expect(layouts).toContain("card");
    expect(layouts).toContain("stack");
  });

  it("is deterministic for same inputs", () => {
    const a = composeFastTemplate({
      plan:           FITNESS_PLAN,
      brief:          BRIEF as any,
      format:         "instagram_post",
      variationIndex: 2,
      jobId:          "deterministic-job",
      orgId:          "test-org",
    });
    const b = composeFastTemplate({
      plan:           FITNESS_PLAN,
      brief:          BRIEF as any,
      format:         "instagram_post",
      variationIndex: 2,
      jobId:          "deterministic-job",
      orgId:          "test-org",
    });
    expect(a.svgSource).toBe(b.svgSource);
    expect(a.assetId).toBe(b.assetId);
  });

  it("falls back gracefully when subhead/cta missing", () => {
    const minimalBrief = {
      ...BRIEF,
      subhead: undefined,
      cta:     undefined,
      badge:   undefined,
    };
    const out = composeFastTemplate({
      plan:           FITNESS_PLAN,
      brief:          minimalBrief as any,
      format:         "instagram_post",
      variationIndex: 0,
      jobId:          "test-job-fb",
      orgId:          "test-org",
    });
    // Headline still renders
    expect(out.svgSource).toContain("Stronger Every Day");
    // CTA falls back to plan.ctaSuggestion
    expect(out.svgSource).toContain("JOIN NOW");
  });

  it("respects format dimensions for non-square canvases", () => {
    const out = composeFastTemplate({
      plan:           FITNESS_PLAN,
      brief:          BRIEF as any,
      format:         "instagram_story",
      variationIndex: 0,
      jobId:          "story-job",
      orgId:          "test-org",
    });
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
  });

  it("composeFastGallery returns N variations with distinct layouts", () => {
    const gallery = composeFastGallery({
      plan:   FITNESS_PLAN,
      brief:  BRIEF as any,
      format: "instagram_post",
      jobId:  "gallery-job",
      orgId:  "test-org",
    }, 4);
    expect(gallery).toHaveLength(4);
    const layouts = new Set(gallery.map(g => g.layoutFamily));
    expect(layouts.size).toBe(4);
  });

  it("a single composition finishes in under 100ms", () => {
    const t0 = Date.now();
    composeFastTemplate({
      plan:           FITNESS_PLAN,
      brief:          BRIEF as any,
      format:         "instagram_post",
      variationIndex: 0,
      jobId:          "perf-job",
      orgId:          "test-org",
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });

  it("uses the right hero shape for each domain", () => {
    const wellnessPlan = { ...FITNESS_PLAN, domain: "wellness" as const };
    const out = composeFastTemplate({
      plan:           wellnessPlan,
      brief:          BRIEF as any,
      format:         "instagram_post",
      variationIndex: 0,
      jobId:          "wellness-job",
      orgId:          "test-org",
    });
    expect(out.svgSource).toContain('class="hero-wellness"');
    expect(out.svgSource).not.toContain('class="hero-fitness"');
  });

  it("escapes HTML special chars in headline", () => {
    const briefWithSpecials = {
      ...BRIEF,
      headline: "Save <50%> & feel great",
    };
    const out = composeFastTemplate({
      plan:           FITNESS_PLAN,
      brief:          briefWithSpecials as any,
      format:         "instagram_post",
      variationIndex: 0,
      jobId:          "escape-job",
      orgId:          "test-org",
    });
    expect(out.svgSource).toContain("&lt;50%&gt;");
    expect(out.svgSource).toContain("&amp;");
  });
});
