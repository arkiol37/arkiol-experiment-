// src/__tests__/hierarchy-enforcer.test.ts
import { enforceHierarchy, TextContent } from "../engines/hierarchy/enforcer";
import { Zone } from "../engines/layout/families";

const baseZones: Zone[] = [
  { id: "headline", x: 5, y: 55, width: 90, height: 20, required: true,  zIndex: 2, alignH: "left", alignV: "top", minFontSize: 28, maxFontSize: 52, constraints: { maxChars: 60, fontWeight: [700, 800] } },
  { id: "subhead",  x: 5, y: 76, width: 90, height: 9,  required: false, zIndex: 2, alignH: "left", alignV: "top", minFontSize: 14, maxFontSize: 22, constraints: { maxChars: 100 } },
  { id: "cta",      x: 5, y: 87, width: 42, height: 8,  required: false, zIndex: 3, alignH: "center", alignV: "middle", minFontSize: 12, maxFontSize: 16 },
];

describe("enforceHierarchy", () => {
  it("returns valid: true when no violations exist", () => {
    const contents: TextContent[] = [
      { zoneId: "headline", text: "Big Launch Today", fontSize: 40, weight: 800, color: "#ffffff", fontFamily: "Arial" },
      { zoneId: "subhead",  text: "Supporting details here", fontSize: 18, weight: 600, color: "#cccccc", fontFamily: "Arial" },
    ];
    const result = enforceHierarchy(baseZones, contents);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("clamps fontSize below minimum", () => {
    const contents: TextContent[] = [
      { zoneId: "headline", text: "Small text", fontSize: 10, weight: 800, color: "#ffffff", fontFamily: "Arial" },
    ];
    const result = enforceHierarchy(baseZones, contents);
    expect(result.contents[0].fontSize).toBe(28); // minFontSize
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("clamps fontSize above maximum", () => {
    const contents: TextContent[] = [
      { zoneId: "headline", text: "Huge text", fontSize: 200, weight: 800, color: "#ffffff", fontFamily: "Arial" },
    ];
    const result = enforceHierarchy(baseZones, contents);
    expect(result.contents[0].fontSize).toBe(52); // maxFontSize
  });

  it("truncates text exceeding maxChars", () => {
    const longText = "A".repeat(80);
    const contents: TextContent[] = [
      { zoneId: "headline", text: longText, fontSize: 40, weight: 800, color: "#ffffff", fontFamily: "Arial" },
    ];
    const result = enforceHierarchy(baseZones, contents);
    expect(result.contents[0].text.length).toBe(60); // maxChars = 60, last char = ellipsis
    expect(result.contents[0].text.endsWith("…")).toBe(true);
  });

  it("enforces correct font weight for headline", () => {
    const contents: TextContent[] = [
      { zoneId: "headline", text: "Test", fontSize: 40, weight: 400, color: "#ffffff", fontFamily: "Arial" },
    ];
    const result = enforceHierarchy(baseZones, contents);
    expect(result.contents[0].weight).toBe(800); // headline role weight
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("sanitizes HTML injection in text", () => {
    const contents: TextContent[] = [
      { zoneId: "headline", text: "<script>alert('xss')</script>", fontSize: 40, weight: 800, color: "#ffffff", fontFamily: "Arial" },
    ];
    const result = enforceHierarchy(baseZones, contents);
    expect(result.contents[0].text).not.toContain("<");
    expect(result.contents[0].text).not.toContain(">");
  });

  it("resets invalid hex color", () => {
    const contents: TextContent[] = [
      { zoneId: "headline", text: "Test", fontSize: 40, weight: 800, color: "not-a-color", fontFamily: "Arial" },
    ];
    const result = enforceHierarchy(baseZones, contents);
    expect(result.contents[0].color).toBe("#ffffff");
  });

  it("enforces hierarchy: headline must be larger than subhead", () => {
    const contents: TextContent[] = [
      { zoneId: "headline", text: "Headline", fontSize: 18, weight: 800, color: "#fff", fontFamily: "Arial" },
      { zoneId: "subhead",  text: "Subhead",  fontSize: 20, weight: 600, color: "#ccc", fontFamily: "Arial" },
    ];
    const result = enforceHierarchy(baseZones, contents);
    const headline = result.contents.find(c => c.zoneId === "headline")!;
    const subhead  = result.contents.find(c => c.zoneId === "subhead")!;
    expect(headline.fontSize).toBeGreaterThan(subhead.fontSize);
  });

  it("handles empty content array gracefully", () => {
    const result = enforceHierarchy(baseZones, []);
    expect(result.valid).toBe(true);
    expect(result.contents).toHaveLength(0);
  });
});
