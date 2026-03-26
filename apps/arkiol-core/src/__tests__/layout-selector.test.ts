// src/__tests__/layout-selector.test.ts
import { selectLayout, resolveZones, FAMILIES_BY_FORMAT, LAYOUT_FAMILIES } from "../engines/layout/families";
import { ARKIOL_CATEGORIES } from "../lib/types";

describe("selectLayout", () => {
  const baseCtx = {
    format:       "instagram_post",
    stylePreset:  "modern_minimal",
    variationIdx: 0,
    campaignId:   "test-campaign-123",
  };

  it("returns a valid family and variation", () => {
    const sel = selectLayout(baseCtx);
    expect(sel.family).toBeDefined();
    expect(sel.variation).toBeDefined();
    expect(sel.family.formats).toContain("instagram_post");
  });

  it("is deterministic — same inputs produce same output", () => {
    const sel1 = selectLayout(baseCtx);
    const sel2 = selectLayout(baseCtx);
    expect(sel1.family.id).toBe(sel2.family.id);
    expect(sel1.variation.id).toBe(sel2.variation.id);
    expect(sel1.seed).toBe(sel2.seed);
  });

  it("produces different seeds for different variation indices", () => {
    const sel0 = selectLayout({ ...baseCtx, variationIdx: 0 });
    const sel4 = selectLayout({ ...baseCtx, variationIdx: 4 });
    expect(sel0.seed).not.toBe(sel4.seed);
  });

  it("falls back gracefully for unknown format", () => {
    const sel = selectLayout({ ...baseCtx, format: "unknown_format_xyz" });
    expect(sel.family).toBeDefined();
    expect(sel.variation).toBeDefined();
  });

  it("covers all 9 Arkiol categories", () => {
    for (const format of ARKIOL_CATEGORIES) {
      const sel = selectLayout({ ...baseCtx, format });
      expect(sel.family).toBeDefined();
      expect(sel.family.formats).toContain(format);
    }
  });

  it("all registered formats resolve to a family", () => {
    for (const format of Object.keys(FAMILIES_BY_FORMAT)) {
      const sel = selectLayout({ ...baseCtx, format });
      expect(sel.family).toBeDefined();
    }
  });

  it("layout registry covers all 9 Arkiol categories exactly", () => {
    const registeredFormats = new Set<string>();
    for (const f of LAYOUT_FAMILIES) {
      for (const fmt of f.formats) registeredFormats.add(fmt);
    }
    for (const cat of ARKIOL_CATEGORIES) {
      expect(registeredFormats.has(cat)).toBe(true);
    }
  });
});

describe("resolveZones", () => {
  it("applies variation overrides to base zones", () => {
    for (const format of ARKIOL_CATEGORIES) {
      const sel   = selectLayout({ format, stylePreset: "modern_minimal", variationIdx: 0, campaignId: "test" });
      const zones = resolveZones(sel);
      expect(zones.length).toBeGreaterThan(0);
      for (const zone of zones) {
        expect(zone.id).toBeDefined();
        expect(typeof zone.x).toBe("number");
        expect(typeof zone.y).toBe("number");
        expect(typeof zone.width).toBe("number");
        expect(typeof zone.height).toBe("number");
        expect(typeof zone.required).toBe("boolean");
        expect(typeof zone.zIndex).toBe("number");
      }
    }
  });

  it("all zones have x + width <= 101 (rounding tolerance)", () => {
    for (const format of ARKIOL_CATEGORIES) {
      const sel   = selectLayout({ format, stylePreset: "modern_minimal", variationIdx: 0, campaignId: "t" });
      const zones = resolveZones(sel);
      for (const zone of zones) {
        if (zone.width > 0) {
          expect(zone.x + zone.width).toBeLessThanOrEqual(101);
        }
      }
    }
  });
});
