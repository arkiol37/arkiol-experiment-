// src/__tests__/engines.test.ts
// Tests for: Layout Authority, Density Engine, AssetContract, Style Enforcer

import { resolveLayoutSpec, validateZoneGeometry } from "../engines/layout/authority";
import { analyzeDensity, modularScale }            from "../engines/layout/density";
import { contrastRatio, meetsWcag, enforceStyle }  from "../engines/layout/style-enforcer";
import {
  ASSET_CONTRACTS, validatePlacement, remapToAllowedZone,
  buildZoneOwnershipMap, totalDensityScore, motionCompatibleElements,
} from "../engines/assets/contract";
import { LAYOUT_FAMILIES } from "../engines/layout/families";

// ── Shared test brief ─────────────────────────────────────────────────────────
const BRIEF = {
  intent:     "Product launch",
  audience:   "Millennials",
  tone:       "professional" as const,
  keywords:   ["launch", "premium"],
  colorMood:  "vibrant" as const,
  imageStyle: "photography" as const,
  headline:   "Introducing Pro+",
  subhead:    "The next generation of performance",
  cta:        "Shop Now",
};

// ── Layout Authority ──────────────────────────────────────────────────────────
describe("resolveLayoutSpec", () => {
  it("produces identical output for same inputs (deterministic)", () => {
    const ctx = { format: "instagram_post", stylePreset: "modern_minimal", variationIdx: 0, campaignId: "c1" };
    const a   = resolveLayoutSpec(ctx);
    const b   = resolveLayoutSpec(ctx);
    expect(a.seed).toBe(b.seed);
    expect(a.family.id).toBe(b.family.id);
    expect(a.variation.id).toBe(b.variation.id);
    expect(a.zones.length).toBe(b.zones.length);
  });

  it("produces different output for different variationIdx", () => {
    const base = { format: "instagram_post", stylePreset: "modern_minimal", campaignId: "c1" };
    const results = [0, 1, 2, 3, 4].map(vi => resolveLayoutSpec({ ...base, variationIdx: vi }));
    const seeds   = results.map(r => r.seed);
    // All seeds must be unique
    expect(new Set(seeds).size).toBe(5);
  });

  it("falls back gracefully for unknown format", () => {
    const spec = resolveLayoutSpec({ format: "unknown_xyz", stylePreset: "minimal", variationIdx: 0, campaignId: "c99" });
    expect(spec.family).toBeDefined();
    expect(spec.zones.length).toBeGreaterThan(0);
  });

  it("all zones pass geometry validation", () => {
    for (const family of LAYOUT_FAMILIES) {
      for (let vi = 0; vi < family.variations.length; vi++) {
        const spec = resolveLayoutSpec({
          format:       family.formats[0],
          stylePreset:  "modern_minimal",
          variationIdx: vi,
          campaignId:   "test",
        });
        const violations = validateZoneGeometry(spec.zones);
        expect(violations).toHaveLength(0);
      }
    }
  });

  it("active zones do not exceed density.maxTextZones for short briefs", () => {
    const spec = resolveLayoutSpec({
      format: "instagram_post", stylePreset: "modern_minimal",
      variationIdx: 0, campaignId: "c1", briefLength: "short",
    });
    const textZones = spec.activeZoneIds.filter(z =>
      ["headline", "subhead", "body", "cta", "badge", "tagline"].includes(z)
    );
    expect(textZones.length).toBeLessThanOrEqual(spec.density.maxTextZones);
  });

  it("includes background and headline in every spec", () => {
    const spec = resolveLayoutSpec({ format: "instagram_post", stylePreset: "minimal", variationIdx: 0, campaignId: "x" });
    expect(spec.zones.find(z => z.id === "background")).toBeDefined();
    expect(spec.zones.find(z => z.id === "headline")).toBeDefined();
  });
});

// ── Density Engine ────────────────────────────────────────────────────────────
describe("analyzeDensity", () => {
  it("returns density specs for all active zones", () => {
    const spec     = resolveLayoutSpec({ format: "instagram_post", stylePreset: "modern_minimal", variationIdx: 0, campaignId: "d1" });
    const analysis = analyzeDensity(spec, { headline: BRIEF.headline });
    expect(analysis.zones.length).toBeGreaterThan(0);
    expect(analysis.canvasWidth).toBeGreaterThan(0);
    expect(analysis.canvasHeight).toBeGreaterThan(0);
  });

  it("charBudget matches zone maxChars constraint when constraint is tighter", () => {
    const spec     = resolveLayoutSpec({ format: "instagram_post", stylePreset: "modern_minimal", variationIdx: 0, campaignId: "d2" });
    const analysis = analyzeDensity(spec);
    const headline = analysis.zones.find(z => z.zoneId === "headline");
    if (headline) {
      // charBudget must respect zone maxChars if it exists
      const zone = spec.zones.find(z => z.id === "headline");
      if (zone?.constraints?.maxChars) {
        expect(headline.charBudget).toBeLessThanOrEqual(zone.constraints.maxChars);
      }
    }
  });

  it("modularScale grows consistently", () => {
    const base = 16;
    expect(modularScale(base, 0)).toBe(16);
    expect(modularScale(base, 1)).toBeGreaterThan(16);
    expect(modularScale(base, 2)).toBeGreaterThan(modularScale(base, 1));
    expect(modularScale(base, -1)).toBeLessThan(16);
  });

  it("totalDensityScore is not overloaded for balanced display ad", () => {
    const spec = resolveLayoutSpec({ format: "flyer", stylePreset: "clean_product", variationIdx: 0, campaignId: "d3" });
    const analysis = analyzeDensity(spec);
    // Should not be overloaded for a contained display ad
    expect(analysis.totalDensityScore).toBeLessThan(400);
  });
});

// ── Style Enforcer ────────────────────────────────────────────────────────────
describe("contrastRatio", () => {
  it("white on black is ~21:1", () => {
    const ratio = contrastRatio("#ffffff", "#000000");
    expect(ratio).toBeCloseTo(21, 0);
  });

  it("black on white is ~21:1", () => {
    const ratio = contrastRatio("#000000", "#ffffff");
    expect(ratio).toBeCloseTo(21, 0);
  });

  it("same color is 1:1", () => {
    expect(contrastRatio("#ff0000", "#ff0000")).toBeCloseTo(1, 1);
  });

  it("meetsWcag correctly classifies ratios", () => {
    expect(meetsWcag(4.5, false)).toBe(true);
    expect(meetsWcag(4.4, false)).toBe(false);
    expect(meetsWcag(3.0, true)).toBe(true);
    expect(meetsWcag(2.9, true)).toBe(false);
  });
});

describe("enforceStyle", () => {
  it("corrects low-contrast text color", () => {
    const contents = [{ zoneId: "headline", text: "Hello", fontSize: 48, weight: 800, color: "#cccccc" }];
    const result   = enforceStyle(contents, "#cccccc"); // same color = 1:1 contrast
    const violation = result.violations.find(v => v.zoneId === "headline");
    expect(violation).toBeDefined();
    expect(result.contents[0].color).not.toBe("#cccccc"); // corrected
  });

  it("does not modify already-compliant text", () => {
    const contents = [{ zoneId: "headline", text: "Hello", fontSize: 48, weight: 800, color: "#ffffff" }];
    const result   = enforceStyle(contents, "#000000");
    expect(result.violations.filter(v => v.zoneId === "headline" && v.issue.includes("contrast"))).toHaveLength(0);
    expect(result.contents[0].color).toBe("#ffffff");
  });

  it("falls back to white or black as last resort", () => {
    // Very dark text on dark background — should be corrected to white
    const contents = [{ zoneId: "body", text: "...", fontSize: 14, weight: 400, color: "#111111" }];
    const result   = enforceStyle(contents, "#0a0a0a");
    const corrected = result.contents[0].color;
    const ratio     = contrastRatio(corrected, "#0a0a0a");
    expect(ratio).toBeGreaterThanOrEqual(3.0); // at least WCAG large-text threshold
  });

  it("returns brandScore 80 when no brand provided", () => {
    const contents = [{ zoneId: "headline", text: "Hi", fontSize: 40, weight: 700, color: "#ffffff" }];
    const result   = enforceStyle(contents, "#000000");
    expect(result.brandScore).toBe(80);
  });
});

// ── AssetContract ─────────────────────────────────────────────────────────────
describe("AssetContract", () => {
  it("every asset type has a defined contract", () => {
    const types = ["human", "object", "atmospheric", "texture", "background", "logo", "badge", "icon", "overlay"] as const;
    for (const t of types) {
      expect(ASSET_CONTRACTS[t]).toBeDefined();
      expect(ASSET_CONTRACTS[t].allowedZones.length).toBeGreaterThan(0);
    }
  });

  it("background contract covers 100% area and is always present", () => {
    const c = ASSET_CONTRACTS.background;
    expect(c.maxAreaCoverage).toBe(1.0);
    expect(c.minAreaCoverage).toBe(1.0);
    expect(c.hierarchyWeight).toBe(0);
  });

  it("logo stays within 15% area", () => {
    expect(ASSET_CONTRACTS.logo.maxAreaCoverage).toBeLessThanOrEqual(0.15);
  });

  it("validatePlacement catches zone mismatch", () => {
    const violations = validatePlacement("human", "logo", "instagram_post", 0.3);
    expect(violations.some(v => v.severity === "error")).toBe(true);
  });

  it("validatePlacement passes for correct zone", () => {
    const violations = validatePlacement("human", "image", "instagram_post", 0.5);
    expect(violations.some(v => v.severity === "error")).toBe(false);
  });

  it("validatePlacement catches format restriction for texture", () => {
    const violations = validatePlacement("texture", "background", "instagram_post", 0.8);
    expect(violations.some(v => v.severity === "error")).toBe(true);
  });

  it("remapToAllowedZone finds a valid zone", () => {
    const remapped = remapToAllowedZone("human", ["image", "background", "headline"]);
    expect(["image", "background"]).toContain(remapped);
  });

  it("remapToAllowedZone returns null when no zone available", () => {
    const remapped = remapToAllowedZone("logo", ["headline", "cta"]);
    expect(remapped).toBeNull();
  });

  it("buildZoneOwnershipMap detects conflicts", () => {
    const { conflicts } = buildZoneOwnershipMap([
      { type: "human",  zone: "image" as any },
      { type: "object", zone: "image" as any },
    ]);
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it("buildZoneOwnershipMap has no conflict for compatible elements", () => {
    const { conflicts } = buildZoneOwnershipMap([
      { type: "background", zone: "background" as any },
      { type: "human",      zone: "image" as any },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("totalDensityScore sums correctly", () => {
    const score = totalDensityScore(["background", "human", "overlay"]);
    expect(score).toBe(
      ASSET_CONTRACTS.background.densityLimit +
      ASSET_CONTRACTS.human.densityLimit +
      ASSET_CONTRACTS.overlay.densityLimit
    );
  });

  it("motionCompatibleElements filters correctly", () => {
    const filtered = motionCompatibleElements(["human", "texture", "background", "logo"]);
    expect(filtered).toContain("human");
    expect(filtered).toContain("background");
    expect(filtered).not.toContain("texture");
    expect(filtered).not.toContain("logo");
  });
});
