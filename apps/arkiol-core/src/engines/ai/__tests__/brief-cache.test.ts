// brief-cache.test.ts
//
// Pin the cache contract: same key → cache hit, different key → miss.
// We mock the underlying analyzeBrief module so the test never hits
// OpenAI; the cache wrapper is the only thing under test here.

jest.mock("../brief-analyzer", () => ({
  analyzeBrief: jest.fn(),
}));

import { analyzeBriefCached, briefCacheStats, _resetBriefCacheForTests } from "../brief-cache";
import { analyzeBrief } from "../brief-analyzer";

const mockedAnalyzeBrief = analyzeBrief as jest.MockedFunction<typeof analyzeBrief>;

const FAKE_BRIEF = {
  intent:    "Test intent",
  audience:  "Test audience",
  tone:      "bold" as const,
  keywords:  ["test"],
  colorMood: "vibrant" as const,
  imageStyle:"photography" as const,
  headline:  "Test headline",
  category:  "fitness" as const,
};

describe("analyzeBriefCached", () => {
  beforeEach(() => {
    _resetBriefCacheForTests();
    mockedAnalyzeBrief.mockReset();
    mockedAnalyzeBrief.mockResolvedValue(FAKE_BRIEF as any);
  });

  it("calls analyzeBrief once per unique key, then serves from cache", async () => {
    const opts = {
      prompt:      "fitness clubs in toronto",
      stylePreset: "auto",
      format:      "instagram_post",
      locale:      "en",
    };

    const first = await analyzeBriefCached(opts);
    expect(first.cached).toBe(false);
    expect(first.brief).toEqual(FAKE_BRIEF);
    expect(mockedAnalyzeBrief).toHaveBeenCalledTimes(1);

    const second = await analyzeBriefCached(opts);
    expect(second.cached).toBe(true);
    expect(second.brief).toEqual(FAKE_BRIEF);
    expect(second.briefMs).toBe(0);
    expect(mockedAnalyzeBrief).toHaveBeenCalledTimes(1); // not re-called
  });

  it("treats different prompts as different keys", async () => {
    await analyzeBriefCached({ prompt: "fitness", stylePreset: "auto", format: "instagram_post" });
    await analyzeBriefCached({ prompt: "wellness", stylePreset: "auto", format: "instagram_post" });
    expect(mockedAnalyzeBrief).toHaveBeenCalledTimes(2);
    const stats = briefCacheStats();
    expect(stats.size).toBe(2);
  });

  it("treats different formats as different keys", async () => {
    await analyzeBriefCached({ prompt: "fitness", stylePreset: "auto", format: "instagram_post" });
    await analyzeBriefCached({ prompt: "fitness", stylePreset: "auto", format: "poster" });
    expect(mockedAnalyzeBrief).toHaveBeenCalledTimes(2);
  });

  it("treats different brand colors as different keys", async () => {
    const baseBrand = {
      primaryColor:   "#FF0000",
      secondaryColor: "#00FF00",
      voiceAttribs:   {},
      fontDisplay:    "Inter",
    };
    await analyzeBriefCached({
      prompt: "fitness",
      stylePreset: "auto",
      format: "instagram_post",
      brand: baseBrand,
    });
    await analyzeBriefCached({
      prompt: "fitness",
      stylePreset: "auto",
      format: "instagram_post",
      brand: { ...baseBrand, primaryColor: "#0000FF" },
    });
    expect(mockedAnalyzeBrief).toHaveBeenCalledTimes(2);
  });

  it("tracks hits and misses in stats", async () => {
    await analyzeBriefCached({ prompt: "x", stylePreset: "auto", format: "instagram_post" });
    await analyzeBriefCached({ prompt: "x", stylePreset: "auto", format: "instagram_post" });
    await analyzeBriefCached({ prompt: "x", stylePreset: "auto", format: "instagram_post" });
    const stats = briefCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(2);
    expect(stats.size).toBe(1);
  });
});
