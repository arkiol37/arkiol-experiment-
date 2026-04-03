// src/__tests__/svg-builder.test.ts
import { renderSvg } from "../engines/render/svg-builder";
import { selectLayout, resolveZones } from "../engines/layout/families";
import { BriefAnalysis } from "../engines/ai/brief-analyzer";

const mockBrief: BriefAnalysis = {
  intent:     "Promote summer collection",
  audience:   "Millennials 25-35",
  tone:       "bold",
  keywords:   ["summer", "bold", "modern"],
  colorMood:  "vibrant",
  imageStyle: "photography",
  headline:   "Summer Is Here",
  subhead:    "Shop the new collection now",
  cta:        "Shop Now",
};

const mockContent = {
  backgroundColor:    "#1a1a2e",
  backgroundGradient: { type: "linear" as const, colors: ["#1a1a2e", "#16213e"], angle: 135 },
  textContents: [
    { zoneId: "headline", text: "Summer Is Here", fontSize: 40, weight: 800, color: "#ffffff", fontFamily: "Arial" as const },
    { zoneId: "subhead",  text: "Shop the collection", fontSize: 18, weight: 600, color: "#cccccc", fontFamily: "Arial" as const },
    { zoneId: "cta",      text: "Shop Now", fontSize: 14, weight: 700, color: "#ffffff", fontFamily: "Arial" as const },
  ],
  ctaStyle: {
    backgroundColor: "#4f6ef7",
    textColor:       "#ffffff",
    borderRadius:    8,
    paddingH:        20,
    paddingV:        10,
  },
  overlayOpacity: 0.4,
  overlayColor:   "#000000",
};

describe("renderSvg", () => {
  const sel   = selectLayout({ format: "instagram_post", stylePreset: "modern_minimal", variationIdx: 0, campaignId: "test" });
  const zones = resolveZones(sel);

  it("produces valid SVG string", () => {
    const svg = renderSvg(zones, mockContent, "instagram_post");
    expect(svg).toContain('<?xml version="1.0"');
    expect(svg).toContain("<svg ");
    expect(svg).toContain("</svg>");
  });

  it("sets correct dimensions for instagram_post", () => {
    const svg = renderSvg(zones, mockContent, "instagram_post");
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1080"');
    expect(svg).toContain('viewBox="0 0 1080 1080"');
  });

  it("sets correct dimensions for youtube_thumbnail", () => {
    const fbSel   = selectLayout({ format: "youtube_thumbnail", stylePreset: "modern_minimal", variationIdx: 0, campaignId: "test" });
    const fbZones = resolveZones(fbSel);
    const svg     = renderSvg(fbZones, mockContent, "youtube_thumbnail");
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="628"');
  });

  it("includes linearGradient when backgroundGradient is linear", () => {
    const svg = renderSvg(zones, mockContent, "instagram_post");
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('url(#bg)');
  });

  it("does not include gradient when type is none", () => {
    const noGradContent = {
      ...mockContent,
      backgroundGradient: { type: "none" as const, colors: [] },
    };
    const svg = renderSvg(zones, noGradContent, "instagram_post");
    expect(svg).not.toContain("<linearGradient");
  });

  it("escapes SVG special characters in text", () => {
    const dangerousContent = {
      ...mockContent,
      textContents: [
        { zoneId: "headline", text: 'Sale & "Savings" <Today>', fontSize: 40, weight: 800, color: "#ffffff", fontFamily: "Arial" as const },
      ],
    };
    const svg = renderSvg(zones, dangerousContent, "instagram_post");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&quot;");
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&gt;");
    expect(svg).not.toContain("<script");
  });

  it("renders CTA button with correct styles", () => {
    const svg = renderSvg(zones, mockContent, "instagram_post");
    expect(svg).toContain("Shop Now");
    // Should have a rect for the button background
    expect(svg).toContain("#4f6ef7");
  });

  it("renders overlay when overlayOpacity > 0", () => {
    const svg = renderSvg(zones, mockContent, "instagram_post");
    expect(svg).toContain('opacity="0.4"');
  });

  it("handles missing optional zones gracefully", () => {
    const minimalContent = {
      ...mockContent,
      textContents: [
        { zoneId: "headline", text: "Test", fontSize: 40, weight: 800, color: "#fff", fontFamily: "Arial" as const },
      ],
    };
    expect(() => renderSvg(zones, minimalContent, "instagram_post")).not.toThrow();
  });
});
