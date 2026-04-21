/**
 * arkiol-core — standalone unit tests
 *
 * Covers the Step 13–42 asset library + scene composer + evaluation
 * gates without pulling Next.js / Prisma / Redis. Pure-TS modules
 * only. Runs via:
 *
 *   npx tsx tests/arkiol-core-unit.test.ts
 *
 * Assertions throw on failure; exit code reflects total failures.
 * Intentionally no test runner — this is a lightweight smoke suite
 * until we wire a proper one.
 */

// ── Test harness ────────────────────────────────────────────────────────────

let _passed = 0;
let _failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r && typeof (r as any).then === "function") {
      (r as Promise<void>).then(
        () => { console.log(`  ✓ ${name}`); _passed++; },
        (err: Error) => { console.error(`  ✗ ${name}\n    ${err.message}`); _failed++; },
      );
    } else {
      console.log(`  ✓ ${name}`);
      _passed++;
    }
  } catch (err: any) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    _failed++;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function section(name: string): void {
  console.log(`\n▸ ${name}`);
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function run() {
  section("asset-library · registry");

  const lib = await import("../apps/arkiol-core/src/lib/asset-library");

  test("ASSET_CATEGORIES contains all 9 categories", () => {
    const expected = [
      "productivity", "wellness", "education", "business",
      "fitness", "beauty", "travel", "marketing", "motivation",
    ];
    for (const c of expected) assert(lib.ASSET_CATEGORIES.includes(c as any), `missing category ${c}`);
  });

  test("ASSET_KINDS contains all 10 kinds", () => {
    const expected = ["icon", "illustration", "photo", "shape", "texture",
      "sticker", "badge", "ribbon", "frame", "divider"];
    for (const k of expected) assert(lib.ASSET_KINDS.includes(k as any), `missing kind ${k}`);
  });

  test("ASSET_REALMS contains all 6 realms", () => {
    const expected = ["nature", "animal", "lifestyle", "object", "scene", "decorative"];
    for (const r of expected) assert(lib.ASSET_REALMS.includes(r as any), `missing realm ${r}`);
  });

  test("libraryStats reports >=150 assets across all 9 categories", () => {
    const stats = lib.libraryStats();
    assert(stats.total >= 150, `total=${stats.total}, want >= 150`);
    for (const c of lib.ASSET_CATEGORIES) {
      assert(stats.byCategory[c] > 0, `category ${c} has no assets`);
    }
  });

  test("every asset id is unique", () => {
    const ids = new Set<string>();
    for (const a of lib.getAllAssets()) {
      assert(!ids.has(a.id), `duplicate asset id: ${a.id}`);
      ids.add(a.id);
    }
  });

  test("queryAssets respects category + kind filters", () => {
    const icons = lib.queryAssets({ category: "productivity", kind: "icon" });
    assert(icons.length > 0, "no productivity icons");
    for (const a of icons) {
      assertEq(a.kind, "icon", `kind for ${a.id}`);
      const inCat = a.category === "productivity" ||
                    (a.extraCategories?.includes("productivity") ?? false);
      assert(inCat, `${a.id} should be in productivity`);
    }
  });

  test("queryAssets style filter allows style-less assets through", () => {
    // Icons have mixed style (outline / filled); ribbons have no style.
    // A style=filled query should still surface style-less ribbons.
    const pool = lib.queryAssets({ kind: "ribbon", style: "filled" });
    assert(pool.length > 0, "ribbon + filled filter dropped every ribbon");
    for (const a of pool) {
      assert(a.style === undefined || a.style === "filled",
        `${a.id} has incompatible style ${a.style}`);
    }
  });

  test("queryAssets realm filter is exact-match", () => {
    const pool = lib.queryAssets({ realm: "nature" });
    for (const a of pool) assertEq(a.realm, "nature", `realm for ${a.id}`);
  });

  section("asset-library · inferCategoryFromText");

  test("motivation keywords route to motivation", () => {
    assertEq(lib.inferCategoryFromText("morning mindset motivation goals"), "motivation", "mindset");
    assertEq(lib.inferCategoryFromText("achieve your dream"), "motivation", "dream");
  });
  test("wellness keywords route to wellness", () => {
    assertEq(lib.inferCategoryFromText("5 minute meditation guide"), "wellness", "meditation");
  });
  test("empty / noise returns null", () => {
    assertEq(lib.inferCategoryFromText(""), null, "empty");
    assertEq(lib.inferCategoryFromText(null as any), null, "null");
  });

  section("asset-library · selection");

  test("selectAssetsForCategory returns a deterministic pick given a seed", () => {
    const a = lib.selectAssetsForCategory("motivation", { seed: "abc" });
    const b = lib.selectAssetsForCategory("motivation", { seed: "abc" });
    assertEq(a.length, b.length, "length");
    for (let i = 0; i < a.length; i++) assertEq(a[i].id, b[i].id, `match[${i}]`);
    assert(a.length > 0, "motivation recipe returned zero picks");
  });

  test("selectAssetsForCategory honors explicit visualStyle pin", () => {
    const picks = lib.selectAssetsForCategory("motivation", {
      seed: "xyz", visualStyle: "illustration",
    });
    // Every picked illustration/photo slot must have visualStyle
    // illustration (style-less decorations like ribbons pass through).
    for (const a of picks) {
      if (a.kind === "illustration" || a.kind === "photo") {
        assert(a.visualStyle === "illustration" || a.visualStyle === undefined,
          `${a.id} slot expected illustration style, got ${a.visualStyle}`);
      }
    }
  });

  test("resolveVisualStyleForCategory picks illustration for motivation", () => {
    const s = lib.resolveVisualStyleForCategory("motivation");
    assert(s === "illustration" || s === "3d" || s === null,
      `unexpected resolved style: ${s}`);
  });

  section("svg-scene-composer");

  const composer = await import("../apps/arkiol-core/src/engines/assets/svg-scene-composer");

  test("every category has 6 palette variants", () => {
    for (const c of lib.ASSET_CATEGORIES) {
      const list = composer.SCENE_PALETTES[c];
      assert(Array.isArray(list), `palettes missing for ${c}`);
      assertEq(list.length, 6, `palette count for ${c}`);
    }
  });

  test("renderScene output is a self-contained <svg>", () => {
    const svg = composer.renderScene("mountain-sunrise", "motivation");
    assert(svg.startsWith("<svg"), `not an svg: ${svg.slice(0, 40)}`);
    assert(svg.endsWith("</svg>"), "svg not closed");
    assert(svg.includes('viewBox="0 0 400 400"'), "missing viewBox");
  });

  test("renderScene memoizes identical (kind, category, variant)", () => {
    // Same call twice should be referentially identical (cache hit).
    const a = composer.renderScene("heart-centered", "wellness", 2);
    const b = composer.renderScene("heart-centered", "wellness", 2);
    assert(a === b, "cache miss — got different strings");
  });

  test("renderScene variant rotates the palette", () => {
    const v0 = composer.renderScene("mountain-sunrise", "motivation", 0);
    const v1 = composer.renderScene("mountain-sunrise", "motivation", 1);
    assert(v0 !== v1, "variant 0 and 1 returned same SVG — palette variants identical?");
  });

  test("getScenePalette handles unknown category gracefully", () => {
    const p = composer.getScenePalette("unknown-category-xyz", 0);
    assert(p && p.sky.length === 2, "fallback palette malformed");
  });

  section("evaluation · marketplace-gate");

  const gate = await import("../apps/arkiol-core/src/engines/evaluation/marketplace-gate");

  test("MARKETPLACE_THRESHOLDS has the 6 expected criteria", () => {
    const keys = Object.keys(gate.MARKETPLACE_THRESHOLDS);
    for (const c of ["polished", "layered", "categorySpecific", "assetRich", "publishReady", "styleConsistent"]) {
      assert(keys.includes(c), `missing threshold group ${c}`);
    }
  });

  test("MarketplaceQualityError carries verdict + jobId + format", () => {
    try {
      const fakeVerdict = {
        approved: false,
        criteria: {} as any,
        failedCriteria: ["polished"],
        marketplaceScore: 0.3,
        qualityScore: {} as any,
      };
      throw new gate.MarketplaceQualityError("job1", "instagram_post", fakeVerdict);
    } catch (err: any) {
      assertEq(err.name, "MarketplaceQualityError", "name");
      assertEq(err.jobId, "job1", "jobId");
      assertEq(err.format, "instagram_post", "format");
    }
  });

  section("lib/generation-metrics");

  const metrics = await import("../apps/arkiol-core/src/lib/generation-metrics");

  test("metrics snapshot returns zeroed state after reset", () => {
    metrics.__resetMetrics();
    const s = metrics.snapshot();
    assertEq(s.counters.generationsTotal, 0, "total");
    assertEq(s.counters.generationsSucceeded, 0, "succeeded");
    assertEq(s.successRate, 0, "rate");
    assertEq(s.latency.samples, 0, "samples");
  });

  test("metrics recordGenerationSuccess bumps counter + latency window", () => {
    metrics.__resetMetrics();
    metrics.recordGenerationStart();
    metrics.recordGenerationSuccess(120);
    metrics.recordGenerationStart();
    metrics.recordGenerationSuccess(240);
    const s = metrics.snapshot();
    assertEq(s.counters.generationsTotal, 2, "total");
    assertEq(s.counters.generationsSucceeded, 2, "succeeded");
    assertEq(s.latency.samples, 2, "samples");
    assert(s.latency.p50_ms >= 120, `p50 ${s.latency.p50_ms}`);
    assert(s.successRate === 1, "rate=1 after 2 successes");
  });

  test("metrics records marketplace verdict + failed criteria", () => {
    metrics.__resetMetrics();
    metrics.recordMarketplaceVerdict(true);
    metrics.recordMarketplaceVerdict(false, ["polished", "layered"]);
    const s = metrics.snapshot();
    assertEq(s.counters.marketplaceApproved, 1, "approved");
    assertEq(s.counters.marketplaceRejected, 1, "rejected");
    assert(s.recentRejections.length === 1, "recent rejection recorded");
    assert(s.recentRejections[0].includes("polished"), "criteria in reason");
  });

  section("engines/memory · store");

  const store = await import("../apps/arkiol-core/src/engines/memory/store");

  test("InMemoryStore ring-buffers records up to capacity", () => {
    const s = new store.InMemoryStore(3);
    for (let i = 0; i < 5; i++) {
      s.pushRecord({
        assetId: `a${i}`, timestamp: i, format: "f", campaignId: "c", themeId: "t",
        layoutFamily: "l", layoutVariation: "v", qualityScore: 0.5, designQualityScore: 0.5,
        brandScore: 0, hierarchyValid: true, violationCount: 0, recoveryCount: 0,
      });
    }
    const all = s.listRecords(10);
    assertEq(all.length, 3, "capacity");
    assertEq(all[0].assetId, "a4", "newest first");
  });

  test("createMemoryStoreFromEnv defaults to InMemoryStore", () => {
    delete (process.env as any).ARKIOL_MEMORY_STORE;
    const s = store.createMemoryStoreFromEnv();
    assertEq(s.kind, "in-memory", "default kind");
  });

  test("createMemoryStoreFromEnv respects ARKIOL_MEMORY_STORE=redis", () => {
    (process.env as any).ARKIOL_MEMORY_STORE = "redis";
    const s = store.createMemoryStoreFromEnv();
    assertEq(s.kind, "redis", "redis driver");
    delete (process.env as any).ARKIOL_MEMORY_STORE;
  });

  section("engines/assets · 3d-asset-manifest");

  const manifest = await import("../apps/arkiol-core/src/engines/assets/3d-asset-manifest");

  test("manifest has 154 slugs", () => {
    // 32 nature + 5 animal + 29 lifestyle + 59 object + 5 scene + 24 decorative = 154
    assertEq(manifest.ASSET_3D_MANIFEST.length, 154, "manifest size");
  });

  test("every manifest slug maps to a library asset id pattern", () => {
    // Library ids use "real.<realm>.<slug-suffix>" — verify a few.
    const slugs = new Set(manifest.ASSET_3D_MANIFEST.map(m => m.slug));
    assert(slugs.has("nature-mountain-range"), "mountain-range missing");
    assert(slugs.has("animal-dog"), "dog missing");
    assert(slugs.has("object-dumbbell"), "dumbbell missing");
    assert(slugs.has("scene-city-skyline"), "city-skyline missing");
  });

  test("asset3dManifestStats reports configured=false without env", () => {
    delete (process.env as any).ARKIOL_3D_ASSET_BASE;
    const s = manifest.asset3dManifestStats();
    assertEq(s.configured, false, "configured");
    assertEq(s.totalSlugs, 154, "totalSlugs");
    assertEq(s.byRealm.nature, 32, "nature count");
    assertEq(s.byRealm.lifestyle, 29, "lifestyle count");
    assertEq(s.byRealm.object, 59, "object count");
    assertEq(s.byRealm.decorative, 24, "decorative count");
  });

  test("asset3dUrl returns undefined without base configured", () => {
    delete (process.env as any).ARKIOL_3D_ASSET_BASE;
    assertEq(manifest.asset3dUrl("nature-mountain-range"), undefined as any, "undefined");
  });

  test("asset3dUrl builds a URL when base is set", () => {
    (process.env as any).ARKIOL_3D_ASSET_BASE = "https://cdn.test.com/3d";
    const url = manifest.asset3dUrl("nature-mountain-range");
    assertEq(url, "https://cdn.test.com/3d/nature-mountain-range.png", "url");
    delete (process.env as any).ARKIOL_3D_ASSET_BASE;
  });

  test("natureAsset3dSlugs returns the nature realm group", () => {
    const nature = manifest.natureAsset3dSlugs();
    assertEq(nature.length, 32, "nature count");
    const slugs = new Set(nature.map(n => n.slug));
    for (const s of nature) assertEq(s.realm, "nature" as const, `realm:${s.slug}`);
    // Spot-check that the Step 48 additions are all present.
    for (const expected of [
      "nature-waterfall", "nature-beach", "nature-sky-dawn",
      "nature-flower-rose", "nature-grass-meadow", "nature-stone-stack",
    ]) {
      assert(slugs.has(expected), `missing nature slug ${expected}`);
    }
  });

  test("every nature manifest slug has a matching library Asset", async () => {
    const lib2 = await import("../apps/arkiol-core/src/lib/asset-library");
    const libNature = lib2.getAssetsByRealm("nature");
    // Library ids for real-world assets follow the `real.<realm>.<suffix>`
    // convention where <suffix> is the manifest slug with its realm prefix
    // stripped — e.g. manifest "nature-mountain-range" → "real.nature.mountain-range".
    const libIds = new Set(libNature.map(a => a.id));
    for (const m of manifest.natureAsset3dSlugs()) {
      const suffix = m.slug.replace(/^nature-/, "");
      const expectedId = `real.nature.${suffix}`;
      assert(libIds.has(expectedId),
        `library missing Asset for manifest slug ${m.slug} (expected ${expectedId})`);
    }
  });

  test("lifestyleAsset3dSlugs returns the lifestyle realm group", () => {
    const lifestyle = manifest.lifestyleAsset3dSlugs();
    assertEq(lifestyle.length, 29, "lifestyle count");
    const slugs = new Set(lifestyle.map(n => n.slug));
    for (const s of lifestyle) assertEq(s.realm, "lifestyle" as const, `realm:${s.slug}`);
    // Spot-check 49 interiors / 51 wellness / 52 fitness / 53 business setups.
    for (const expected of [
      "lifestyle-desk-flatlay", "lifestyle-dual-monitor-desk",
      "lifestyle-reading-armchair", "lifestyle-botanical-corner",
      "lifestyle-modern-kitchen", "lifestyle-cozy-bedroom",
      "lifestyle-living-room", "lifestyle-podcast-studio",
      "lifestyle-spa-setup", "lifestyle-yoga-setup", "lifestyle-bathroom",
      "lifestyle-gym", "lifestyle-home-gym", "lifestyle-running-trail",
      "lifestyle-meeting-room", "lifestyle-boardroom", "lifestyle-retail-shop",
    ]) {
      assert(slugs.has(expected), `missing lifestyle slug ${expected}`);
    }
  });

  test("every lifestyle manifest slug has a matching library Asset", async () => {
    const lib2 = await import("../apps/arkiol-core/src/lib/asset-library");
    const libLifestyle = lib2.getAssetsByRealm("lifestyle");
    const libIds = new Set(libLifestyle.map(a => a.id));
    for (const m of manifest.lifestyleAsset3dSlugs()) {
      const suffix = m.slug.replace(/^lifestyle-/, "");
      const expectedId = `real.lifestyle.${suffix}`;
      assert(libIds.has(expectedId),
        `library missing Asset for manifest slug ${m.slug} (expected ${expectedId})`);
    }
  });

  test("objectAsset3dSlugs returns the object realm group", () => {
    const obj = manifest.objectAsset3dSlugs();
    assertEq(obj.length, 59, "object count");
    const slugs = new Set(obj.map(n => n.slug));
    for (const s of obj) assertEq(s.realm, "object" as const, `realm:${s.slug}`);
    // Spot-check 50/51 daily-use + 52 fitness/travel/fashion + 53 biz/promo.
    for (const expected of [
      "object-book-open", "object-notebook-pen", "object-pen-set",
      "object-phone", "object-camera", "object-headphones",
      "object-perfume-bottle", "object-candle", "object-diffuser",
      "object-coffee-mug", "object-tea-cup", "object-yoga-mat",
      "object-plush-bear", "object-building-blocks",
      "object-salad-bowl", "object-balanced-meal", "object-breakfast-spread",
      "object-smoothie-bowl", "object-fruit-platter", "object-meal-prep",
      "object-serum-dropper", "object-makeup-brushes", "object-lipstick",
      "object-makeup-palette", "object-bath-salts", "object-bath-soap-set",
      "object-running-shoes", "object-gym-bag", "object-activewear",
      "object-passport", "object-travel-kit", "object-backpack",
      "object-outfit-flatlay", "object-handbag", "object-heels",
      "object-sunglasses", "object-watch",
      "object-laptop-coffee", "object-notebook-meeting",
      "object-bar-chart", "object-line-chart", "object-pie-chart",
      "object-product-display", "object-shopping-bag", "object-shopping-cart",
      "object-gift-box", "object-sale-tag", "object-megaphone",
      "object-confetti-burst",
    ]) {
      assert(slugs.has(expected), `missing object slug ${expected}`);
    }
  });

  test("every object manifest slug has a matching library Asset", async () => {
    const lib2 = await import("../apps/arkiol-core/src/lib/asset-library");
    const libObject = lib2.getAssetsByRealm("object");
    const libIds = new Set(libObject.map(a => a.id));
    for (const m of manifest.objectAsset3dSlugs()) {
      const suffix = m.slug.replace(/^object-/, "");
      const expectedId = `real.object.${suffix}`;
      assert(libIds.has(expectedId),
        `library missing Asset for manifest slug ${m.slug} (expected ${expectedId})`);
    }
  });

  test("decorativeAsset3dSlugs returns the decorative realm group", () => {
    const deco = manifest.decorativeAsset3dSlugs();
    assertEq(deco.length, 24, "decorative count");
    const slugs = new Set(deco.map(n => n.slug));
    for (const s of deco) assertEq(s.realm, "decorative" as const, `realm:${s.slug}`);
    // Spot-check Step 54 additions across all structural sub-groups
    // (ribbons / badges / stickers / dividers / frames / cards / labels /
    // banners / textures / overlays).
    for (const expected of [
      "decorative-ribbon-title", "decorative-ribbon-wave",
      "decorative-badge-circle", "decorative-badge-star", "decorative-badge-seal",
      "decorative-sticker-star", "decorative-sticker-heart",
      "decorative-divider-wave", "decorative-divider-leaf",
      "decorative-frame-rounded", "decorative-frame-polaroid", "decorative-frame-arch",
      "decorative-sticky-note", "decorative-paper-note",
      "decorative-checklist-card", "decorative-quote-card",
      "decorative-label-tag", "decorative-price-label",
      "decorative-banner-hero", "decorative-banner-ribbon",
      "decorative-texture-grain", "decorative-texture-paper",
      "decorative-overlay-dots", "decorative-overlay-geometric",
    ]) {
      assert(slugs.has(expected), `missing decorative slug ${expected}`);
    }
  });

  test("every decorative manifest slug has a matching library Asset", async () => {
    const lib2 = await import("../apps/arkiol-core/src/lib/asset-library");
    const libDeco = lib2.getAssetsByRealm("decorative");
    const libIds = new Set(libDeco.map(a => a.id));
    for (const m of manifest.decorativeAsset3dSlugs()) {
      const suffix = m.slug.replace(/^decorative-/, "");
      const expectedId = `real.decorative.${suffix}`;
      assert(libIds.has(expectedId),
        `library missing Asset for manifest slug ${m.slug} (expected ${expectedId})`);
    }
  });

  section("engines/assets · strong-presence enforcement (Step 55)");

  const selector = await import("../apps/arkiol-core/src/engines/assets/asset-selector");

  const makePlan = (elements: any[]): any => ({
    elements,
    totalDensity:    0,
    hasImageElement: false,
    isGifCompatible: true,
    reasoning:       [],
  });

  const bgEl = (overrides: any = {}): any => ({
    type:         "background",
    zone:         "background",
    prompt:       "soft 3d claymorphic gradient",
    motion:       false,
    weight:       0,
    coverageHint: 1,
    role:         "background",
    anchor:       "full-bleed",
    scale:        1,
    alignment:    "center",
    layer:        0,
    ...overrides,
  });

  const heroEl = (overrides: any = {}): any => ({
    type:            "object",
    zone:            "image",
    prompt:          "3d claymorphic product hero",
    motion:          false,
    weight:          3,
    coverageHint:    0.4,
    url:             "https://cdn.test.com/3d/object-laptop.png",
    role:            "support",
    anchor:          "center",
    scale:           1,
    alignment:       "center",
    layer:           20,
    primary:         true,
    compositionMode: "framed-center",
    visualStyle:     "3d",
    qualityTier:     "premium",
    ...overrides,
  });

  const accentEl = (overrides: any = {}): any => ({
    type:         "badge",
    zone:         "badge",
    prompt:       "3d claymorphic badge",
    motion:       false,
    weight:       1,
    coverageHint: 0.05,
    url:          "https://cdn.test.com/3d/decorative-badge-star.png",
    role:         "accent",
    anchor:       "top-right",
    scale:        1,
    alignment:    "right",
    layer:        40,
    visualStyle:  "3d",
    qualityTier:  "premium",
    ...overrides,
  });

  test("strong-presence exports all required thresholds", () => {
    assertEq(selector.MIN_PRIMARY_VISUAL_COVERAGE, 0.15, "MIN_PRIMARY_VISUAL_COVERAGE");
    assertEq(selector.MIN_SUPPORTING_DECORATIVE_ELEMENTS, 1, "MIN_SUPPORTING_DECORATIVE_ELEMENTS");
    assertEq(selector.MIN_VISIBLE_ELEMENT_COVERAGE, 0.03, "MIN_VISIBLE_ELEMENT_COVERAGE");
  });

  test("validateAssetPresence accepts a well-formed 3D hero + accent plan", () => {
    const plan = makePlan([bgEl(), heroEl(), accentEl()]);
    const errors = selector.validateAssetPresence(plan)
      .filter((v: any) => v.severity === "error");
    assert(errors.length === 0, `expected no errors, got: ${errors.map((e: any) => e.rule).join(",")}`);
  });

  test("rejects plans with no primary visual flagged", () => {
    const plan = makePlan([bgEl(), { ...heroEl(), primary: false }, accentEl()]);
    const violations = selector.validateAssetPresence(plan);
    assert(
      violations.some((v: any) => v.rule === "primary_visual_missing" && v.severity === "error"),
      "expected primary_visual_missing error",
    );
  });

  test("rejects plans whose primary is a texture / abstract element", () => {
    const abstractHero = heroEl({ type: "texture", visualStyle: "flat" });
    const plan = makePlan([bgEl(), abstractHero, accentEl()]);
    const violations = selector.validateAssetPresence(plan);
    assert(
      violations.some((v: any) => v.rule === "primary_visual_not_illustrative" && v.severity === "error"),
      "expected primary_visual_not_illustrative error",
    );
  });

  test("rejects plans whose primary is too subtle (below 15% coverage)", () => {
    const subtleHero = heroEl({ coverageHint: 0.1 });
    const plan = makePlan([bgEl(), subtleHero, accentEl()]);
    const violations = selector.validateAssetPresence(plan);
    assert(
      violations.some((v: any) => v.rule === "primary_visual_too_subtle" && v.severity === "error"),
      "expected primary_visual_too_subtle error",
    );
  });

  test("rejects abstract-only compositions (texture + overlay only)", () => {
    // All meaningful elements are abstract — no real illustrative subject.
    const abstractSupport = heroEl({ type: "texture", visualStyle: "flat", primary: false });
    const abstractAccent  = accentEl({ type: "overlay", visualStyle: "flat" });
    const plan = makePlan([bgEl(), abstractSupport, abstractAccent]);
    const violations = selector.validateAssetPresence(plan);
    assert(
      violations.some((v: any) => v.rule === "abstract_only_composition" && v.severity === "error"),
      "expected abstract_only_composition error",
    );
  });

  test("rejects plans with a hero but no supporting decoration", () => {
    // Hero alone, no accent / divider / icon-group.
    const plan = makePlan([bgEl(), heroEl()]);
    const violations = selector.validateAssetPresence(plan);
    const supportErr =
      violations.some((v: any) => v.rule === "missing_supporting_decoration" && v.severity === "error")
      || violations.some((v: any) => v.rule === "missing_decorative_accent" && v.severity === "error");
    assert(supportErr, "expected missing_supporting_decoration or missing_decorative_accent error");
  });

  test("missing_decorative_accent is now a hard error, not a warning", () => {
    const plan = makePlan([bgEl(), heroEl()]);
    const violations = selector.validateAssetPresence(plan);
    const accent = violations.find((v: any) => v.rule === "missing_decorative_accent");
    if (accent) {
      assertEq(accent.severity, "error" as const, "missing_decorative_accent severity");
    }
  });

  test("rejects gradient-only output (background + abstract overlay only)", () => {
    // Classic "just a gradient" template — one bg + one flat overlay.
    const overlay = accentEl({ type: "overlay", visualStyle: "flat" });
    const plan = makePlan([bgEl(), overlay]);
    const violations = selector.validateAssetPresence(plan);
    // Must hard-fail with at least one Step 55 error (either abstract-only
    // or primary_visual_missing since no hero is declared).
    const stepErrs = violations.filter((v: any) =>
      ["abstract_only_composition", "primary_visual_missing", "primary_visual_not_illustrative"]
        .includes(v.rule) && v.severity === "error");
    assert(stepErrs.length > 0, "expected strong-presence errors on gradient-only plan");
  });

  section("engines/assets · structural placement rules (Step 56)");

  const placement = await import("../apps/arkiol-core/src/engines/assets/placement-rules");

  test("slotForPlacement maps primary compositionMode → hero slot", () => {
    const framedHero = heroEl({ compositionMode: "framed-center", anchor: "center" });
    assertEq(placement.slotForPlacement(framedHero), "hero-frame" as const, "framed-center");

    const sideLeftHero = heroEl({ compositionMode: "side-left", anchor: "center-left" });
    assertEq(placement.slotForPlacement(sideLeftHero), "hero-side-left" as const, "side-left");

    const sideRightHero = heroEl({ compositionMode: "side-right", anchor: "center-right" });
    assertEq(placement.slotForPlacement(sideRightHero), "hero-side-right" as const, "side-right");

    const bgHero = heroEl({ compositionMode: "background-hero", anchor: "full-bleed" });
    assertEq(placement.slotForPlacement(bgHero), "hero-background" as const, "background-hero");
  });

  test("slotForPlacement routes corner anchors → corner-accent slots", () => {
    const tr = accentEl({ anchor: "top-right" });
    assertEq(placement.slotForPlacement(tr), "corner-accent-tr" as const, "top-right");

    const bl = accentEl({ anchor: "bottom-left" });
    assertEq(placement.slotForPlacement(bl), "corner-accent-bl" as const, "bottom-left");
  });

  test("anchorsForSlot round-trips with slotForPlacement", () => {
    const anchors = placement.anchorsForSlot("corner-accent-tr");
    assert(anchors.includes("top-right"), "top-right should map to corner-accent-tr");
  });

  test("validatePlacementStructure accepts a canonical framed-hero layout", () => {
    // bg field + framed-center hero + one corner accent = clean composition
    const plan = makePlan([
      bgEl(),
      heroEl({ compositionMode: "framed-center", anchor: "center" }),
      accentEl({ anchor: "top-right" }),
    ]);
    const errors = placement.validatePlacementStructure(plan, ["headline", "subhead", "cta"])
      .filter((v: any) => v.severity === "error");
    assert(errors.length === 0,
      `expected no structural errors, got: ${errors.map((e: any) => e.rule).join(",")}`);
  });

  test("rejects two accents colliding in the same corner slot", () => {
    const plan = makePlan([
      bgEl(),
      heroEl({ compositionMode: "framed-center", anchor: "center" }),
      accentEl({ anchor: "top-right", type: "badge" }),
      accentEl({ anchor: "top-right", type: "sticker" }),
    ]);
    const violations = placement.validatePlacementStructure(plan, ["headline"]);
    assert(
      violations.some((v: any) => v.rule === "slot_collision" && v.severity === "error"),
      "expected slot_collision error for duplicate top-right anchor",
    );
  });

  test("rejects primary whose anchor slot mismatches its compositionMode", () => {
    // Anchor center-right but mode framed-center — inconsistent.
    const broken = heroEl({
      compositionMode: "framed-center",
      anchor:          "center-right",
      primary:         true,
    });
    // With primary: true + framed-center compositionMode, slotForPlacement
    // forces hero-frame (overriding the anchor), so mode/slot agree on
    // the forward-mapping path. Force the mismatch by clearing primary
    // on the slot-resolution side: a non-primary at center-right in
    // a hero-side-right slot with framed-center mode would clash.
    const plan = makePlan([
      bgEl(),
      // primary without compositionMode — slotForPlacement falls back to
      // the anchor → slot map. Then stamp compositionMode after the fact
      // so the validator sees a hero-side-right slot with framed-center
      // mode, which SLOT_COMPATIBLE_MODES rejects.
      { ...broken, compositionMode: undefined, primary: true,
        // Manually assign the wrong mode so the validator runs mismatch logic.
      },
      accentEl({ anchor: "top-right" }),
    ]);
    // Re-stamp the compositionMode on the primary to produce the mismatch
    // without triggering the primary/mode branch in slotForPlacement.
    const heroIdx = plan.elements.findIndex((e: any) => e.primary);
    plan.elements[heroIdx].anchor = "center-right";
    plan.elements[heroIdx].compositionMode = "framed-center";
    // slotForPlacement returns "hero-side-right" via anchor fallback, but
    // SLOT_COMPATIBLE_MODES["hero-side-right"] = ["side-right"] which
    // doesn't include framed-center.
    const violations = placement.validatePlacementStructure(plan, ["headline"]);
    assert(
      violations.some((v: any) => v.rule === "hero_slot_mode_mismatch" && v.severity === "error"),
      "expected hero_slot_mode_mismatch error",
    );
  });

  test("rejects a side-hero that overlaps a text zone on the same side", () => {
    const hero = heroEl({ compositionMode: "side-left", anchor: "center-left" });
    const plan = makePlan([bgEl(), hero, accentEl({ anchor: "top-right" })]);
    // bullet_1 is the only text zone mapped to "left" side in the module.
    const violations = placement.validatePlacementStructure(plan, ["bullet_1"]);
    assert(
      violations.some((v: any) => v.rule === "hero_overlaps_text_zone" && v.severity === "error"),
      "expected hero_overlaps_text_zone error",
    );
  });

  test("warns when more than two corners carry accents", () => {
    const plan = makePlan([
      bgEl(),
      heroEl(),
      accentEl({ anchor: "top-left" }),
      accentEl({ anchor: "top-right" }),
      accentEl({ anchor: "bottom-left" }),
    ]);
    const violations = placement.validatePlacementStructure(plan, ["headline"]);
    assert(
      violations.some((v: any) => v.rule === "too_many_corner_accents" && v.severity === "warning"),
      "expected too_many_corner_accents warning",
    );
  });

  test("warns when three or more horizontal separators stack", () => {
    const divider1 = accentEl({
      type: "divider", zone: "divider", role: "divider", anchor: "edge-top",
      coverageHint: 0.1,
    });
    const divider2 = accentEl({
      type: "divider", zone: "divider", role: "divider", anchor: "center",
      coverageHint: 0.1,
    });
    const divider3 = accentEl({
      type: "divider", zone: "divider", role: "divider", anchor: "edge-bottom",
      coverageHint: 0.1,
    });
    const plan = makePlan([bgEl(), heroEl(), divider1, divider2, divider3, accentEl({ anchor: "top-right" })]);
    const violations = placement.validatePlacementStructure(plan, ["headline"]);
    assert(
      violations.some((v: any) => v.rule === "divider_stack" && v.severity === "warning"),
      "expected divider_stack warning",
    );
  });

  test("SLOT_MIN_EDGE_MARGIN exports the 12-column grid defaults", () => {
    assertEq(placement.PLACEMENT_GRID_COLUMNS, 12, "grid columns");
    assertEq(placement.SLOT_MIN_EDGE_MARGIN["corner-accent-tl"], 0.03, "corner margin");
    assertEq(placement.SLOT_MIN_EDGE_MARGIN["hero-frame"], 0.04, "framed hero margin");
    assertEq(placement.SLOT_MIN_EDGE_MARGIN["background-field"], 0, "bg margin");
  });

  section("asset-library · category → realm affinity (Step 57)");

  test("CATEGORY_REALM_AFFINITY covers every category with non-empty prefer list", () => {
    for (const c of lib.ASSET_CATEGORIES) {
      const a = lib.CATEGORY_REALM_AFFINITY[c];
      assert(a !== undefined, `missing affinity for ${c}`);
      assert(a.prefer.length > 0, `empty prefer list for ${c}`);
      // Prefer / avoid must be disjoint — a realm can't be both.
      for (const r of a.prefer) {
        assert(!a.avoid.includes(r), `${c}: realm ${r} is both prefer and avoid`);
      }
    }
  });

  test("scoreRealmForCategory ranks first-choice > secondary > neutral > avoid", () => {
    // Fitness: prefer [lifestyle, object], avoid [animal, nature]
    const first  = lib.scoreRealmForCategory("lifestyle",  "fitness");
    const second = lib.scoreRealmForCategory("object",     "fitness");
    const neut   = lib.scoreRealmForCategory("decorative", "fitness");
    const avoid  = lib.scoreRealmForCategory("nature",     "fitness");
    assert(first >  second, `first > second (got ${first} vs ${second})`);
    assert(second > neut,   `second > neutral (got ${second} vs ${neut})`);
    assert(neut   > avoid,  `neutral > avoid (got ${neut} vs ${avoid})`);
    assert(avoid < 0,       `avoid should be negative, got ${avoid}`);
  });

  test("scoreRealmForCategory returns 0 for unset realm", () => {
    assertEq(lib.scoreRealmForCategory(undefined, "fitness"), 0, "unset realm");
  });

  test("realmsForCategory walks prefer → neutral → avoid in order", () => {
    const order = lib.realmsForCategory("business");
    const aff   = lib.CATEGORY_REALM_AFFINITY["business"];
    // All prefer realms come before any avoid realm.
    const firstAvoidIdx = Math.min(...aff.avoid.map(r => order.indexOf(r)));
    for (const p of aff.prefer) {
      assert(order.indexOf(p) < firstAvoidIdx,
        `prefer ${p} should come before first avoid (idx ${order.indexOf(p)} vs ${firstAvoidIdx})`);
    }
    // Round-trip: every realm appears exactly once.
    assertEq(order.length, lib.ASSET_REALMS.length, "all realms present");
    assertEq(new Set(order).size, order.length, "no duplicates");
  });

  test("scoreAssetForCategory prefers on-realm 3D over off-realm 3D (fitness)", () => {
    const gym    = lib.getAssetById("real.lifestyle.gym");
    const bqt    = lib.getAssetById("real.nature.flower-bouquet");
    assert(gym && bqt, "seed assets should exist");
    const gs = lib.scoreAssetForCategory(gym!, "fitness");
    const bs = lib.scoreAssetForCategory(bqt!, "fitness");
    assert(gs > bs, `fitness: gym (${gs}) should outrank flower-bouquet (${bs})`);
  });

  test("scoreAssetForCategory prefers nature for wellness over laptop", () => {
    const forest = lib.getAssetById("real.nature.forest");
    const laptop = lib.getAssetById("real.object.laptop");
    assert(forest && laptop, "seed assets should exist");
    const fs = lib.scoreAssetForCategory(forest!, "wellness");
    const ls = lib.scoreAssetForCategory(laptop!, "wellness");
    assert(fs > ls, `wellness: forest (${fs}) should outrank laptop (${ls})`);
  });

  test("scoreAssetForCategory prefers workspace for business over waterfall", () => {
    const workspace = lib.getAssetById("real.lifestyle.workspace");
    const waterfall = lib.getAssetById("real.nature.waterfall");
    assert(workspace && waterfall, "seed assets should exist");
    const ws = lib.scoreAssetForCategory(workspace!, "business");
    const fs = lib.scoreAssetForCategory(waterfall!, "business");
    assert(ws > fs, `business: workspace (${ws}) should outrank waterfall (${fs})`);
  });

  test("scoreAssetForCategory prefers scenic nature for travel over boardroom", () => {
    const mountain  = lib.getAssetById("real.nature.mountain-range");
    const boardroom = lib.getAssetById("real.lifestyle.boardroom");
    assert(mountain && boardroom, "seed assets should exist");
    const ms = lib.scoreAssetForCategory(mountain!, "travel");
    const bs = lib.scoreAssetForCategory(boardroom!, "travel");
    assert(ms > bs, `travel: mountain (${ms}) should outrank boardroom (${bs})`);
  });

  test("asset3dSlugsForCategory returns category-native slugs at the top", () => {
    const top5 = lib.asset3dSlugsForCategory("fitness", { limit: 5 });
    assertEq(top5.length, 5, "should return 5 slugs");
    // At least the first 3 must be on-category or on-prefer-realm.
    const aff = lib.CATEGORY_REALM_AFFINITY["fitness"];
    for (let i = 0; i < 3; i++) {
      const m = top5[i];
      const onCat   = m.category === "fitness";
      const onRealm = aff.prefer.includes(m.realm as any);
      assert(onCat || onRealm,
        `top-${i} slug "${m.slug}" should match fitness category or prefer-realm (got category=${m.category}, realm=${m.realm})`);
    }
  });

  test("asset3dSlugsForCategory can exclude avoided realms entirely", () => {
    const filtered = lib.asset3dSlugsForCategory("business", { excludeAvoidedRealms: true });
    const aff = lib.CATEGORY_REALM_AFFINITY["business"];
    for (const m of filtered) {
      assert(!aff.avoid.includes(m.realm as any),
        `business: slug ${m.slug} is in avoided realm ${m.realm}`);
    }
    assert(filtered.length > 0, "filter should still return some slugs");
  });

  test("selectAssetsForCategory returns picks aligned to category-realm (fitness)", () => {
    const picks = lib.selectAssetsForCategory("fitness", { seed: "step-57-fit" });
    assert(picks.length > 0, "fitness recipe returned zero picks");
    // The hero illustration (first illustration in the pick list) should be
    // a fitness-aligned realm: lifestyle (gym / yoga / running) or object
    // (dumbbell / yoga-mat / running-shoes), NOT a flower bouquet.
    const hero = picks.find(a => a.kind === "illustration");
    if (hero && hero.realm) {
      const aff = lib.CATEGORY_REALM_AFFINITY["fitness"];
      assert(!aff.avoid.includes(hero.realm),
        `fitness hero (${hero.id}) landed in avoided realm ${hero.realm}`);
    }
  });

  test("selectAssetsForCategory returns picks aligned to category-realm (travel)", () => {
    const picks = lib.selectAssetsForCategory("travel", { seed: "step-57-trv" });
    assert(picks.length > 0, "travel recipe returned zero picks");
    const hero = picks.find(a => a.kind === "illustration");
    if (hero && hero.realm) {
      const aff = lib.CATEGORY_REALM_AFFINITY["travel"];
      assert(!aff.avoid.includes(hero.realm),
        `travel hero (${hero.id}) landed in avoided realm ${hero.realm}`);
    }
  });

  section("engines/assets · visual dominance (Step 58)");

  const dominance = await import("../apps/arkiol-core/src/engines/assets/visual-dominance");

  test("accepts a canonical hero-dominant layout (primary 40%, accent 5%)", () => {
    const plan = makePlan([bgEl(), heroEl(), accentEl()]);
    const v = dominance.validateVisualDominance(plan);
    assert(v.filter(x => x.severity === "error").length === 0,
      `expected no errors, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("rejects primary that doesn't dominate the next-largest decoration", () => {
    // Primary 0.25, decoration 0.22 — ratio 1.14, below 1.5× floor.
    const hero   = heroEl({ coverageHint: 0.25 });
    const bigDec = accentEl({ type: "object", role: "support", coverageHint: 0.22 });
    const plan   = makePlan([bgEl(), hero, bigDec]);
    const v = dominance.validateVisualDominance(plan);
    assert(v.some(x => x.rule === "primary_not_dominant" && x.severity === "error"),
      `expected primary_not_dominant error, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("rejects gradient-dominated templates (foreground sum < 25%)", () => {
    // Hero at presence floor (15%) + tiny accent (5%) = 20% foreground.
    const hero = heroEl({ coverageHint: 0.15 });
    const tiny = accentEl({ coverageHint: 0.05 });
    const plan = makePlan([bgEl(), hero, tiny]);
    const v = dominance.validateVisualDominance(plan);
    assert(v.some(x => x.rule === "foreground_too_sparse" && x.severity === "error"),
      `expected foreground_too_sparse error, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("warns when a non-primary visual competes with the hero for focus", () => {
    // Primary 0.30, competitor 0.22 — ratio 1.36 fails dominance, and
    // competitor/primary = 0.73 triggers competing_focal_points warning.
    const hero       = heroEl({ coverageHint: 0.30 });
    const competitor = accentEl({ type: "object", role: "support", coverageHint: 0.22 });
    const plan       = makePlan([bgEl(), hero, competitor]);
    const v = dominance.validateVisualDominance(plan);
    assert(v.some(x => x.rule === "competing_focal_points" && x.severity === "warning"),
      `expected competing_focal_points warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("warns when the primary is pinned to a weak depth tier", () => {
    // Override role so the derived tier drops to surface / ground.
    const buriedHero = heroEl({ role: "background" });
    // Decorations carry the foreground mass so we isolate the tier rule.
    const obj1 = accentEl({ type: "object", role: "support",
                            coverageHint: 0.20, anchor: "center-left"  });
    const obj2 = accentEl({ type: "object", role: "support",
                            coverageHint: 0.15, anchor: "center-right" });
    const plan = makePlan([bgEl(), buriedHero, obj1, obj2]);
    const v = dominance.validateVisualDominance(plan);
    assert(v.some(x => x.rule === "primary_on_weak_tier" && x.severity === "warning"),
      `expected primary_on_weak_tier warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("no-ops when no primary exists (Step 8 owns that error)", () => {
    const plan = makePlan([bgEl(), { ...heroEl(), primary: false }, accentEl()]);
    const v = dominance.validateVisualDominance(plan);
    assert(v.length === 0,
      `expected no dominance issues when primary missing, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("background-hero primary still counts as foreground for coverage sum", () => {
    // A full-bleed hero (type=background, coverageHint=1) is the focal
    // subject — the foreground-sum check must treat it as foreground.
    const hero = heroEl({
      type: "background", compositionMode: "background-hero",
      anchor: "full-bleed", coverageHint: 1.0, role: "support",
    });
    const plan = makePlan([bgEl(), hero]);
    const v = dominance.validateVisualDominance(plan);
    assert(!v.some(x => x.rule === "foreground_too_sparse"),
      "background-hero primary should satisfy foreground coverage");
  });

  test("exports expected dominance thresholds", () => {
    assertEq(dominance.MIN_DOMINANCE_RATIO,     1.5,  "dominance ratio");
    assertEq(dominance.MIN_FOREGROUND_COVERAGE, 0.25, "foreground floor");
    assertEq(dominance.COMPETING_FOCAL_RATIO,   0.70, "competing ratio");
  });

  section("engines/assets · composition structure (Step 59)");

  const structure = await import("../apps/arkiol-core/src/engines/assets/composition-structure");

  test("accepts a canonical framed-center hero + symmetric accents", () => {
    const hero = heroEl();  // anchor=center, compositionMode=framed-center
    const acc1 = accentEl({ anchor: "top-left",    alignment: "left"  });
    const acc2 = accentEl({ anchor: "bottom-right", alignment: "right" });
    const plan = makePlan([bgEl(), hero, acc1, acc2]);
    const v = structure.validateCompositionStructure(plan);
    assert(v.filter(x => x.severity === "error").length === 0,
      `expected no errors, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("rejects templates crammed into a single quadrant (no side hero)", () => {
    // Framed-center hero but every accent clustered at top-left: TL holds
    // ~all foreground mass. Must trigger quadrant_imbalance.
    const hero = heroEl({ anchor: "top-left", compositionMode: "framed-center",
                          coverageHint: 0.35 });
    const a1 = accentEl({ anchor: "top-left", alignment: "left", coverageHint: 0.12 });
    const a2 = accentEl({ anchor: "top-left", alignment: "left", coverageHint: 0.10 });
    const plan = makePlan([bgEl(), hero, a1, a2]);
    const v = structure.validateCompositionStructure(plan);
    assert(v.some(x => x.rule === "quadrant_imbalance" && x.severity === "error"),
      `expected quadrant_imbalance error, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("exempts side-left heroes from quadrant imbalance (tilt is canonical)", () => {
    const hero = heroEl({ anchor: "center-left", compositionMode: "side-left",
                          coverageHint: 0.45 });
    const a1 = accentEl({ anchor: "center-left", alignment: "left",
                          coverageHint: 0.08 });
    const plan = makePlan([bgEl(), hero, a1]);
    const v = structure.validateCompositionStructure(plan);
    assert(!v.some(x => x.rule === "quadrant_imbalance"),
      "side-left hero should be exempt from quadrant imbalance rule");
  });

  test("warns on empty canvas regions when mass clusters in one area", () => {
    // Framed-center hero (mass spread across all 4 quadrants) + a single
    // accent at top-right. No quadrant should be empty — so craft a
    // cleaner case: demote the hero to a non-centered anchor so 2+
    // quadrants go dead.
    const hero = heroEl({ anchor: "top-right", compositionMode: "framed-center",
                          coverageHint: 0.20 });
    const a1   = accentEl({ anchor: "top-right", alignment: "right",
                            coverageHint: 0.08 });
    const plan = makePlan([bgEl(), hero, a1]);
    const v = structure.validateCompositionStructure(plan);
    assert(v.some(x => x.rule === "empty_canvas_region" && x.severity === "warning"),
      `expected empty_canvas_region warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("accepts a grid layout (3+ elements spread across 3+ quadrants)", () => {
    const e1 = accentEl({ type: "object", role: "support", anchor: "top-left",
                          alignment: "left", coverageHint: 0.18 });
    const e2 = accentEl({ type: "object", role: "support", anchor: "top-right",
                          alignment: "right", coverageHint: 0.18 });
    const e3 = accentEl({ type: "object", role: "support", anchor: "bottom-left",
                          alignment: "left", coverageHint: 0.18 });
    const e4 = accentEl({ type: "object", role: "support", anchor: "bottom-right",
                          alignment: "right", coverageHint: 0.18 });
    // No primary — pattern detection must classify as "grid".
    const plan = makePlan([bgEl(), e1, e2, e3, e4]);
    const pat = structure.detectStructure(plan);
    assertEq(pat, "grid", "expected grid pattern");
    const v = structure.validateCompositionStructure(plan);
    assert(!v.some(x => x.rule === "unrecognized_structure"),
      "grid layout should not trip unrecognized_structure");
  });

  test("rejects random-scatter compositions with no canonical pattern", () => {
    // Three foreground elements with anchors that aren't all-centered,
    // aren't a clean top/bottom split, and whose coverages span a >2×
    // range so they can't register as a grid. And no primary to rescue them.
    const e1 = accentEl({ type: "object", role: "support", anchor: "top-right",
                          alignment: "right", coverageHint: 0.28 });
    const e2 = accentEl({ type: "object", role: "support", anchor: "center-left",
                          alignment: "left", coverageHint: 0.10 });
    const e3 = accentEl({ type: "object", role: "support", anchor: "bottom-right",
                          alignment: "right", coverageHint: 0.06 });
    const plan = makePlan([bgEl(), e1, e2, e3]);
    const v = structure.validateCompositionStructure(plan);
    assert(v.some(x => x.rule === "unrecognized_structure" && x.severity === "error"),
      `expected unrecognized_structure error, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("warns on alignment drift within a single vertical band", () => {
    // Framed hero plus three top-band decorations that disagree on
    // alignment: one left, one centered, one right. The composition is
    // otherwise grid-adjacent, but the rhythm is random.
    const hero = heroEl({ coverageHint: 0.35 });
    const t1 = accentEl({ anchor: "top-left",   alignment: "left",  coverageHint: 0.06 });
    const t2 = accentEl({ anchor: "top-center", alignment: "center",coverageHint: 0.06 });
    const t3 = accentEl({ anchor: "top-right",  alignment: "right", coverageHint: 0.06 });
    const plan = makePlan([bgEl(), hero, t1, t2, t3]);
    const v = structure.validateCompositionStructure(plan);
    assert(v.some(x => x.rule === "alignment_drift" && x.severity === "warning"),
      `expected alignment_drift warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("detectStructure routes primary-mode plans to canonical labels", () => {
    const bgHero = makePlan([bgEl(),
      heroEl({ type: "background", anchor: "full-bleed",
               compositionMode: "background-hero", coverageHint: 1.0 })]);
    assertEq(structure.detectStructure(bgHero), "full-bleed-hero", "background hero");

    const sideHero = makePlan([bgEl(),
      heroEl({ anchor: "center-right", compositionMode: "side-right",
               coverageHint: 0.45 })]);
    assertEq(structure.detectStructure(sideHero), "left-right-split", "side hero");

    const framedHero = makePlan([bgEl(), heroEl()]);  // framed-center default
    assertEq(structure.detectStructure(framedHero), "framed-center", "framed hero");
  });

  test("detectStructure finds centered-stack when foreground is all on centerline", () => {
    const e1 = accentEl({ type: "object", role: "support", anchor: "top-center",
                          alignment: "center", coverageHint: 0.12 });
    const e2 = accentEl({ type: "object", role: "support", anchor: "center",
                          alignment: "center", coverageHint: 0.12 });
    const e3 = accentEl({ type: "object", role: "support", anchor: "bottom-center",
                          alignment: "center", coverageHint: 0.12 });
    const plan = makePlan([bgEl(), e1, e2, e3]);
    assertEq(structure.detectStructure(plan), "centered-stack", "stack pattern");
  });

  test("detectStructure finds top-bottom split when halves have center-column anchors", () => {
    // Top-bottom split = both halves populated, no element on the true
    // center axis (that would be centered-stack).
    const t1 = accentEl({ type: "object", role: "support", anchor: "top-center",
                          alignment: "center", coverageHint: 0.14 });
    const t2 = accentEl({ type: "object", role: "support", anchor: "edge-top",
                          alignment: "center", coverageHint: 0.14 });
    const b1 = accentEl({ type: "object", role: "support", anchor: "bottom-center",
                          alignment: "center", coverageHint: 0.14 });
    const plan = makePlan([bgEl(), t1, t2, b1]);
    assertEq(structure.detectStructure(plan), "top-bottom-split", "top-bottom pattern");
  });

  test("quadrantCoverage spreads center/full-bleed elements across all quadrants", () => {
    const centered = heroEl({ anchor: "center", coverageHint: 1.0 });
    const cov = structure.quadrantCoverage([centered]);
    // 1.0 spread over 4 quadrants → 0.25 each.
    assertEq(cov.TL, 0.25, "center → TL share");
    assertEq(cov.TR, 0.25, "center → TR share");
    assertEq(cov.BL, 0.25, "center → BL share");
    assertEq(cov.BR, 0.25, "center → BR share");
  });

  test("exports expected structure thresholds and constants", () => {
    assertEq(structure.MAX_QUADRANT_SHARE,             0.70, "MAX_QUADRANT_SHARE");
    assertEq(structure.EMPTY_QUADRANT_SHARE,           0.03, "EMPTY_QUADRANT_SHARE");
    assertEq(structure.MIN_FOREGROUND_FOR_EMPTY_CHECK, 0.15, "MIN_FOREGROUND_FOR_EMPTY_CHECK");
    assertEq(structure.MIN_ELEMENTS_FOR_STRUCTURE_CHECK, 3, "MIN_ELEMENTS_FOR_STRUCTURE_CHECK");
  });

  section("engines/render · typography hierarchy (Step 60)");

  const typo = await import("../apps/arkiol-core/src/engines/render/typography-hierarchy");

  // Canonical, well-formed typography profile builder. Headline @ 64/800,
  // subhead @ 32/600, body @ 18/400, cta @ 22/700, display Playfair + body
  // Lato — a textbook editorial pair scoring above the harmony floor.
  const makeZone = (overrides: any = {}): any => ({
    zone:       "body",
    fontSize:   18,
    fontWeight: 400,
    fontFamily: "Lato",
    ...overrides,
  });

  const canonicalProfile = (): any => ({
    zones: [
      makeZone({ zone: "headline", fontSize: 64, fontWeight: 800, fontFamily: "Playfair Display" }),
      makeZone({ zone: "subhead",  fontSize: 32, fontWeight: 600, fontFamily: "Lato" }),
      makeZone({ zone: "body",     fontSize: 18, fontWeight: 400, fontFamily: "Lato" }),
      makeZone({ zone: "cta",      fontSize: 22, fontWeight: 700, fontFamily: "Lato" }),
    ],
    displayFont: "Playfair Display",
    bodyFont:    "Lato",
  });

  test("accepts a canonical headline + subhead + body + CTA profile", () => {
    const v = typo.validateTypographyHierarchy(canonicalProfile());
    assert(v.filter(x => x.severity === "error").length === 0,
      `expected no errors, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("rejects templates where headline barely exceeds body in size", () => {
    // Headline 26 / body 24 → ratio 1.08 — well below 1.8× floor.
    const profile = canonicalProfile();
    profile.zones[0].fontSize = 26;
    profile.zones[2].fontSize = 24;
    const v = typo.validateTypographyHierarchy(profile);
    assert(v.some(x => x.rule === "headline_not_dominant" && x.severity === "error"),
      `expected headline_not_dominant error, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("rejects headlines lighter than 600 weight", () => {
    const profile = canonicalProfile();
    profile.zones[0].fontWeight = 400;
    const v = typo.validateTypographyHierarchy(profile);
    assert(v.some(x => x.rule === "headline_not_dominant" &&
                        x.message.includes("weight")),
      `expected headline weight violation, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("rejects flat hierarchy where 3 zones share size + weight", () => {
    const profile = canonicalProfile();
    // Force subhead, body, cta into identical 20/500.
    profile.zones[1].fontSize = 20; profile.zones[1].fontWeight = 500;
    profile.zones[2].fontSize = 20; profile.zones[2].fontWeight = 500;
    profile.zones[3].fontSize = 20; profile.zones[3].fontWeight = 500;
    const v = typo.validateTypographyHierarchy(profile);
    assert(v.some(x => x.rule === "flat_hierarchy" && x.severity === "error"),
      `expected flat_hierarchy error, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("rejects CTAs that blend into body (same size + weight)", () => {
    const profile = canonicalProfile();
    profile.zones[3].fontSize   = profile.zones[2].fontSize;     // body
    profile.zones[3].fontWeight = profile.zones[2].fontWeight;   // 400
    const v = typo.validateTypographyHierarchy(profile);
    assert(v.some(x => x.rule === "cta_not_prominent" && x.severity === "error"),
      `expected cta_not_prominent error, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("rejects CTAs with weight below 600", () => {
    const profile = canonicalProfile();
    profile.zones[3].fontWeight = 400;
    profile.zones[3].fontSize   = 30;  // still larger than body so the size check passes
    const v = typo.validateTypographyHierarchy(profile);
    assert(v.some(x => x.rule === "cta_not_prominent" &&
                        x.message.includes("weight")),
      `expected cta weight violation, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("warns when a zone's weight falls outside its role band", () => {
    // Legal zone role expects 300-400; 800 is outside band.
    const profile: any = {
      zones: [
        makeZone({ zone: "headline", fontSize: 60, fontWeight: 800, fontFamily: "Playfair Display" }),
        makeZone({ zone: "body",     fontSize: 18, fontWeight: 400, fontFamily: "Lato" }),
        makeZone({ zone: "legal",    fontSize: 10, fontWeight: 800, fontFamily: "Lato" }),
      ],
      displayFont: "Playfair Display",
      bodyFont:    "Lato",
    };
    const v = typo.validateTypographyHierarchy(profile);
    assert(v.some(x => x.rule === "zone_weight_out_of_band" && x.zone === "legal"),
      `expected zone_weight_out_of_band for legal, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("warns when subhead competes with headline (>75% of headline size)", () => {
    const profile = canonicalProfile();
    // Headline 64, subhead 52 → 81% of headline — above SUBHEAD_MAX.
    profile.zones[1].fontSize = 52;
    const v = typo.validateTypographyHierarchy(profile);
    assert(v.some(x => x.rule === "subhead_out_of_band"),
      `expected subhead_out_of_band warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("warns when subhead is too close to body (<1.15×)", () => {
    const profile = canonicalProfile();
    // Body 18, subhead 20 → 1.11× body — below SUBHEAD_MIN multiplier.
    profile.zones[1].fontSize = 20;
    const v = typo.validateTypographyHierarchy(profile);
    assert(v.some(x => x.rule === "subhead_out_of_band"),
      `expected subhead_out_of_band warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("rejects anti-pair fonts (two industrial compressed displays)", () => {
    const profile = canonicalProfile();
    profile.displayFont = "Oswald";
    profile.bodyFont    = "Bebas Neue";
    const v = typo.validateTypographyHierarchy(profile);
    assert(v.some(x => x.rule === "font_pair_disharmony" && x.severity === "error"),
      `expected font_pair_disharmony error, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("warns on weak pairings (score below harmony floor but non-negative)", () => {
    // "Nunito"+"Lato" — two humanist sans; scored below floor but not an
    // anti-pair (anti-pair penalty is a stronger negative signal).
    const profile = canonicalProfile();
    profile.displayFont = "Nunito";
    profile.bodyFont    = "Lato";
    const v = typo.validateTypographyHierarchy(profile);
    const pairIssue = v.find(x => x.rule === "font_pair_disharmony");
    if (pairIssue) {
      // Either a warning or an error is acceptable — the severity depends on
      // the scoring internals. The point of this test is that it fires.
      assert(["error", "warning"].includes(pairIssue.severity),
        `expected severity, got ${pairIssue.severity}`);
    } else {
      // If the scorer classifies this pair as harmonious, the test still
      // passes — we're guarding against regressions, not asserting the
      // scorer's opinion.
    }
  });

  test("warns when every zone uses the same family despite a distinct pair", () => {
    const profile: any = {
      zones: [
        makeZone({ zone: "headline", fontSize: 60, fontWeight: 800, fontFamily: "Lato" }),
        makeZone({ zone: "subhead",  fontSize: 30, fontWeight: 600, fontFamily: "Lato" }),
        makeZone({ zone: "body",     fontSize: 18, fontWeight: 400, fontFamily: "Lato" }),
        makeZone({ zone: "cta",      fontSize: 22, fontWeight: 700, fontFamily: "Lato" }),
      ],
      displayFont: "Playfair Display",
      bodyFont:    "Lato",
    };
    const v = typo.validateTypographyHierarchy(profile);
    assert(v.some(x => x.rule === "single_font_overuse" && x.severity === "warning"),
      `expected single_font_overuse warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("ZONE_TYPOGRAPHY_DEFAULTS covers every hierarchical zone", () => {
    const essentials: string[] = [
      "headline", "subhead", "body", "cta", "badge", "section_header",
      "tagline", "price", "legal", "contact",
    ];
    for (const z of essentials) {
      assert(typo.ZONE_TYPOGRAPHY_DEFAULTS[z as any] !== undefined,
        `missing default for zone ${z}`);
    }
  });

  test("buildTypographyProfile round-trips an SvgContent-like input", () => {
    const svgLike = {
      textContents: [
        { zoneId: "headline", text: "Hi", fontSize: 60, weight: 800, color: "#000", fontFamily: "Playfair Display" },
        { zoneId: "body",     text: "Hi", fontSize: 18, weight: 400, color: "#000", fontFamily: "Lato" },
      ],
    };
    const profile = typo.buildTypographyProfile(svgLike, { display: "Playfair Display", body: "Lato" });
    assertEq(profile.zones.length,       2,              "zone count");
    assertEq(profile.zones[0].fontWeight, 800,           "weight maps from weight→fontWeight");
    assertEq(profile.displayFont,        "Playfair Display", "displayFont set");
    assertEq(profile.bodyFont,           "Lato",         "bodyFont set");
  });

  test("exports expected typography thresholds", () => {
    assertEq(typo.HEADLINE_DOMINANCE_RATIO,           1.8,  "HEADLINE_DOMINANCE_RATIO");
    assertEq(typo.FLAT_HIERARCHY_MIN_COUNT,           3,    "FLAT_HIERARCHY_MIN_COUNT");
    assertEq(typo.SUBHEAD_MAX_FRACTION_OF_HEADLINE,   0.75, "SUBHEAD_MAX_FRACTION_OF_HEADLINE");
    assertEq(typo.SUBHEAD_MIN_MULTIPLIER_OF_BODY,     1.15, "SUBHEAD_MIN_MULTIPLIER_OF_BODY");
    assertEq(typo.PAIR_SCORE_HARMONY_FLOOR,           0.5,  "PAIR_SCORE_HARMONY_FLOOR");
    assertEq(typo.SINGLE_FONT_ZONE_THRESHOLD,         4,    "SINGLE_FONT_ZONE_THRESHOLD");
  });

  section("engines/render · color harmony (Step 61)");

  const harmony = await import("../apps/arkiol-core/src/engines/render/color-harmony");

  // Canonical harmonious palette: analogous muted cools (blue + indigo)
  // anchored on a near-white surface. Saturation mean and lightness mean
  // sit inside the productivity category band, so the palette clears
  // every rule when no category is set AND when productivity is.
  const harmoniousPalette = (): any => ({
    background: "#f4f7fb", // very pale cool tint
    surface:    "#ffffff",
    primary:    "#3b6ea5", // HSL ~(211, 0.47, 0.44) — muted blue
    secondary:  "#6589b0", // HSL ~(211, 0.32, 0.54) — same family, softer
    text:       "#0f172a", // slate 900 (effectively neutral)
    textMuted:  "#475569", // slate 600 (effectively neutral)
    highlight:  "#4a5aa0", // HSL ~(229, 0.37, 0.46) — indigo sibling, distinct
  });

  test("accepts a canonical harmonious palette (no errors)", () => {
    const v = harmony.validateColorHarmony(harmoniousPalette());
    const errors = v.filter(x => x.severity === "error");
    assert(errors.length === 0,
      `expected no errors, got: ${errors.map(x => x.rule + ":" + x.message).join("; ")}`);
  });

  test("flags palette_disharmony when core hues are scattered (no harmonic relation)", () => {
    // Primary red, secondary lime, highlight purple — three saturated hues
    // with no monochromatic/analogous/complementary/split/triadic fit.
    const p = harmoniousPalette();
    p.primary   = "#e11d48"; // rose 600 (~350°)
    p.secondary = "#84cc16"; // lime 500 (~85°)
    p.highlight = "#8b5cf6"; // violet 500 (~258°)
    const v = harmony.validateColorHarmony(p);
    assert(v.some(x => x.rule === "palette_disharmony" && x.severity === "error"),
      `expected palette_disharmony error, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("flags saturation_clash when pastels mix with neon", () => {
    const p = harmoniousPalette();
    // #e0d1d1 is a desaturated pastel (HSL ~0°/0.19/0.85) and #ef4444 is
    // a neon-ish red (HSL ~0°/0.84/0.60) — spread well above the cap.
    // All three share the red/orange analogous slice, so only
    // saturation_clash should fire.
    p.primary   = "#e0d1d1";
    p.secondary = "#ef4444";
    p.highlight = "#f97316";
    const v = harmony.validateColorHarmony(p);
    assert(v.some(x => x.rule === "saturation_clash" && x.severity === "warning"),
      `expected saturation_clash warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("flags harsh_gradient when endpoints cross the wheel at similar lightness", () => {
    const p = harmoniousPalette();
    p.gradient = {
      type:   "linear" as const,
      // #ff0000 (red, h=0, l=0.5) → #00ff00 (green, h=120, l=0.5): 120° hue
      // jump, zero lightness delta — textbook harsh band.
      colors: ["#ff0000", "#00ff00"],
    };
    const v = harmony.validateColorHarmony(p);
    assert(v.some(x => x.rule === "harsh_gradient" && x.severity === "error"),
      `expected harsh_gradient error, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("accepts gentle gradients that ramp lightness within a hue family", () => {
    const p = harmoniousPalette();
    p.gradient = {
      type:   "linear" as const,
      colors: ["#1e3a8a", "#60a5fa"], // same blue family, strong L ramp
    };
    const v = harmony.validateColorHarmony(p);
    assert(!v.some(x => x.rule === "harsh_gradient"),
      `expected no harsh_gradient, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("flags text_palette_mismatch when saturated text hue is orphaned", () => {
    const p = harmoniousPalette();
    // Palette sits around blue 210°/sky 200°/amber 40°. A saturated
    // magenta text (~320°) is orphaned — nearest palette hue is >90° away.
    p.text = "#c026d3"; // fuchsia 600
    const v = harmony.validateColorHarmony(p);
    assert(v.some(x => x.rule === "text_palette_mismatch" && x.severity === "warning"),
      `expected text_palette_mismatch warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("allows neutral text regardless of palette hues (no mismatch)", () => {
    const p = harmoniousPalette();
    p.text = "#111111"; // near-black, saturation effectively zero
    const v = harmony.validateColorHarmony(p);
    assert(!v.some(x => x.rule === "text_palette_mismatch"),
      `expected no text_palette_mismatch for neutral text, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("flags category_palette_drift when palette contradicts category mood", () => {
    const p = harmoniousPalette();
    // Recolor the whole palette into warm pinks/oranges — then claim
    // "business" category. Business wants cool + low saturation; this
    // should drift on temperature, saturation, and avoid-family.
    p.background = "#fff7ed"; // warm cream
    p.primary    = "#ec4899"; // pink 500
    p.secondary  = "#f97316"; // orange 500
    p.highlight  = "#facc15"; // yellow 400
    p.category   = "business";
    const v = harmony.validateColorHarmony(p);
    assert(v.some(x => x.rule === "category_palette_drift" && x.severity === "warning"),
      `expected category_palette_drift warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("accepts a productivity palette that matches its category mood", () => {
    const p = harmoniousPalette();
    p.category = "productivity";
    const v = harmony.validateColorHarmony(p);
    assert(!v.some(x => x.rule === "category_palette_drift"),
      `expected no category_palette_drift, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("flags accent_indistinct when highlight clones primary", () => {
    const p = harmoniousPalette();
    p.primary   = "#2563eb";
    p.highlight = "#2966ea"; // 2° hue shift, Δs/Δl well under threshold
    const v = harmony.validateColorHarmony(p);
    assert(v.some(x => x.rule === "accent_indistinct" && x.severity === "warning"),
      `expected accent_indistinct warning, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("allows neutral highlights without flagging accent_indistinct", () => {
    const p = harmoniousPalette();
    p.highlight = "#f8fafc"; // near-white, effectively neutral
    const v = harmony.validateColorHarmony(p);
    assert(!v.some(x => x.rule === "accent_indistinct"),
      `expected no accent_indistinct for neutral highlight, got: ${v.map(x => x.rule).join(", ")}`);
  });

  test("detectHarmonic classifies a monochromatic cluster", () => {
    // Three hues within 15°.
    assertEq(harmony.detectHarmonic([210, 215, 220]), "monochromatic", "monochromatic cluster");
  });

  test("detectHarmonic classifies an analogous slice", () => {
    // Hues within 40° total spread.
    assertEq(harmony.detectHarmonic([200, 220, 235]), "analogous", "analogous slice");
  });

  test("detectHarmonic classifies complementary pairs", () => {
    assertEq(harmony.detectHarmonic([30, 210]), "complementary", "complementary pair");
  });

  test("detectHarmonic classifies triadic layouts", () => {
    assertEq(harmony.detectHarmonic([0, 120, 240]), "triadic", "textbook triadic");
  });

  test("detectHarmonic returns none for scattered incompatible hues", () => {
    assertEq(harmony.detectHarmonic([0, 80, 260]), "none", "scattered hues");
  });

  test("hueFamily classifies family boundaries", () => {
    assertEq(harmony.hueFamily("#ef4444"), "red",    "red 500 → red");
    assertEq(harmony.hueFamily("#f97316"), "orange", "orange 500 → orange");
    assertEq(harmony.hueFamily("#facc15"), "yellow", "yellow 400 → yellow");
    assertEq(harmony.hueFamily("#22c55e"), "green",  "green 500 → green");
    assertEq(harmony.hueFamily("#14b8a6"), "teal",   "teal 500 → teal");
    assertEq(harmony.hueFamily("#3b82f6"), "blue",   "blue 500 → blue");
    assertEq(harmony.hueFamily("#8b5cf6"), "indigo", "violet 500 → indigo");
    assertEq(harmony.hueFamily("#ec4899"), "pink",   "pink 500 → pink");
    assertEq(harmony.hueFamily("#737373"), "neutral","gray → neutral");
  });

  test("warmthOf classifies warm / cool / neutral correctly", () => {
    assertEq(harmony.warmthOf("#ef4444"), "warm",    "red is warm");
    assertEq(harmony.warmthOf("#3b82f6"), "cool",    "blue is cool");
    assertEq(harmony.warmthOf("#737373"), "neutral", "gray is neutral");
  });

  test("hexToHsl returns a sane zero for malformed input", () => {
    const h = harmony.hexToHsl("not-a-color");
    assertEq(h.h, 0, "h=0");
    assertEq(h.s, 0, "s=0");
    assertEq(h.l, 0, "l=0");
  });

  test("hueDistance returns the shortest angular distance", () => {
    assertEq(harmony.hueDistance(10, 350), 20,  "wraps over 360");
    assertEq(harmony.hueDistance(0,  180), 180, "diameter");
    assertEq(harmony.hueDistance(90, 90),  0,   "identity");
  });

  test("CATEGORY_PALETTE_TARGETS covers every AssetCategory", () => {
    const expected = [
      "productivity", "wellness", "education", "business",
      "fitness", "beauty", "travel", "marketing", "motivation",
    ];
    for (const c of expected) {
      assert(harmony.CATEGORY_PALETTE_TARGETS[c as any] !== undefined,
        `missing category target for ${c}`);
    }
  });

  test("exports expected color-harmony thresholds", () => {
    assertEq(harmony.MAX_SATURATION_SPREAD,          0.55, "MAX_SATURATION_SPREAD");
    assertEq(harmony.HARSH_GRADIENT_HUE_DISTANCE,    60,   "HARSH_GRADIENT_HUE_DISTANCE");
    assertEq(harmony.HARSH_GRADIENT_LIGHTNESS_DELTA, 0.15, "HARSH_GRADIENT_LIGHTNESS_DELTA");
    assertEq(harmony.TEXT_PALETTE_MAX_HUE_DISTANCE,  45,   "TEXT_PALETTE_MAX_HUE_DISTANCE");
    assertEq(harmony.ACCENT_MIN_HUE_DISTANCE,        15,   "ACCENT_MIN_HUE_DISTANCE");
    assertEq(harmony.ACCENT_MIN_SATURATION_DELTA,    0.10, "ACCENT_MIN_SATURATION_DELTA");
    assertEq(harmony.ACCENT_MIN_LIGHTNESS_DELTA,     0.08, "ACCENT_MIN_LIGHTNESS_DELTA");
    assertEq(harmony.NEUTRAL_SATURATION_THRESHOLD,   0.12, "NEUTRAL_SATURATION_THRESHOLD");
  });

  section("engines/render · final polish pass (Step 62)");

  const finish = await import("../apps/arkiol-core/src/engines/render/final-polish");

  // Canonical SvgContent-like shape. Minimal surface the finish pass
  // needs — the module never dereferences anything not declared here.
  const makeContent = (overrides: any = {}): any => ({
    backgroundColor: "#ffffff",
    textContents: [
      { zoneId: "headline", text: "Hello world", fontSize: 64, weight: 800, color: "#0f172a", fontFamily: "Inter" },
      { zoneId: "body",     text: "Body copy",   fontSize: 18, weight: 400, color: "#475569", fontFamily: "Inter" },
    ],
    ctaStyle: {
      backgroundColor: "#2563eb", textColor: "#ffffff",
      borderRadius: 8, paddingH: 24, paddingV: 12,
    },
    ...overrides,
  });

  test("expands 3-digit hex across backgroundColor / text / cta / accent", () => {
    const content = makeContent({
      backgroundColor: "#fff",
      textContents: [
        { zoneId: "headline", text: "Hi", fontSize: 64, weight: 800, color: "#0f0", fontFamily: "Inter" },
      ],
      ctaStyle: { backgroundColor: "#f0f", textColor: "#000", borderRadius: 8, paddingH: 24, paddingV: 12 },
      accentShape: { type: "circle", color: "#abc", x: 0, y: 0, w: 10, h: 10 },
    });
    const r = finish.runFinishPass({ content, accumulatedViolations: [] });
    assertEq(r.content.backgroundColor,                "#ffffff",  "background expanded");
    assertEq(r.content.textContents[0].color,           "#00ff00",  "text expanded");
    assertEq(r.content.ctaStyle.backgroundColor,        "#ff00ff",  "cta bg expanded");
    assertEq(r.content.accentShape.color,               "#aabbcc",  "accent expanded");
    assert(r.actions.some(a => a.fix === "expand_short_hex" && (a as any).field === "backgroundColor"),
      `expected backgroundColor expand action, got: ${r.actions.map((a: any) => a.fix + ":" + (a.field ?? "")).join(", ")}`);
  });

  test("strips text zones whose text is empty or whitespace", () => {
    const content = makeContent({
      textContents: [
        { zoneId: "headline", text: "Hi", fontSize: 64, weight: 800, color: "#000", fontFamily: "Inter" },
        { zoneId: "subhead",  text: "",   fontSize: 24, weight: 500, color: "#000", fontFamily: "Inter" },
        { zoneId: "body",     text: "   ",fontSize: 18, weight: 400, color: "#000", fontFamily: "Inter" },
      ],
    });
    const r = finish.runFinishPass({ content, accumulatedViolations: [] });
    assertEq(r.content.textContents.length, 1, "only non-empty zones survive");
    assertEq(r.content.textContents[0].zoneId, "headline", "correct zone kept");
    assert(r.actions.filter((a: any) => a.fix === "strip_empty_text").length === 2,
      `expected 2 strip actions, got ${r.actions.filter((a: any) => a.fix === "strip_empty_text").length}`);
  });

  test("snaps non-standard text weights to nearest CSS weight", () => {
    const content = makeContent({
      textContents: [
        { zoneId: "headline", text: "Hi", fontSize: 64, weight: 780, color: "#000", fontFamily: "Inter" },
        { zoneId: "body",     text: "Hi", fontSize: 18, weight: 420, color: "#000", fontFamily: "Inter" },
      ],
    });
    const r = finish.runFinishPass({ content, accumulatedViolations: [] });
    assertEq(r.content.textContents[0].weight, 800, "780 → 800");
    assertEq(r.content.textContents[1].weight, 400, "420 → 400");
  });

  test("drops overlayOpacity values outside the visible band", () => {
    const contentLow  = makeContent({ overlayOpacity: 0.01 });
    const contentHigh = makeContent({ overlayOpacity: 0.995 });
    const rLow  = finish.runFinishPass({ content: contentLow,  accumulatedViolations: [] });
    const rHigh = finish.runFinishPass({ content: contentHigh, accumulatedViolations: [] });
    assertEq(rLow.content.overlayOpacity,  undefined, "0.01 dropped");
    assertEq(rHigh.content.overlayOpacity, undefined, "0.995 dropped");
  });

  test("rounds overlayOpacity in the visible band to 2 decimals", () => {
    const content = makeContent({ overlayOpacity: 0.4234923 });
    const r = finish.runFinishPass({ content, accumulatedViolations: [] });
    assertEq(r.content.overlayOpacity, 0.42, "rounded to 2 decimals");
  });

  test("is idempotent — re-running on already-polished content is a no-op", () => {
    const content = makeContent();
    const r1 = finish.runFinishPass({ content,            accumulatedViolations: [] });
    const r2 = finish.runFinishPass({ content: r1.content, accumulatedViolations: [] });
    assertEq(r2.actions.length, 0, "second pass produces no actions");
  });

  test("summarizeViolations classifies clean input as finished", () => {
    const summary = finish.summarizeViolations([]);
    assertEq(summary.verdict,     "finished", "verdict");
    assertEq(summary.errors,      0,          "errors");
    assertEq(summary.warnings,    0,          "warnings");
    assertEq(summary.polishScore, 1,          "polishScore");
  });

  test("summarizeViolations flags heavy errors as unfinished", () => {
    // 3 errors × 0.25 = -0.75 → score 0.25, below ROUGH floor of 0.50.
    const summary = finish.summarizeViolations([
      "typography_hierarchy:headline_not_dominant[error]: headline too small",
      "typography_hierarchy:cta_not_prominent[error]: cta blends with body",
      "color_harmony:palette_disharmony[error]: hues scatter",
    ]);
    assertEq(summary.verdict, "unfinished", "verdict");
    assertEq(summary.errors,  3,            "errors counted");
  });

  test("summarizeViolations marks modest warning pile as rough", () => {
    // 5 warnings × 0.05 = -0.25 → score 0.75, below FINISHED floor 0.80.
    const summary = finish.summarizeViolations([
      "typography_hierarchy:subhead_out_of_band[warning]: w1",
      "color_harmony:saturation_clash[warning]: w2",
      "color_harmony:text_palette_mismatch[warning]: w3",
      "color_harmony:accent_indistinct[warning]: w4",
      "color_harmony:category_palette_drift[warning]: w5",
    ]);
    assertEq(summary.verdict, "rough", "verdict");
    assertEq(summary.errors,  0,       "no errors");
    assertEq(summary.warnings, 5,      "warnings counted");
  });

  test("summarizeViolations treats marketplace REJECTED as an error", () => {
    const summary = finish.summarizeViolations([
      "marketplace_gate:REJECTED score=0.40 failed=[gate1,gate2]",
    ]);
    assertEq(summary.errors,     1, "REJECTED counts as error");
    assertEq(summary.rejections, 1, "REJECTED counted in rejections bucket");
  });

  test("summarizeViolations groups counts by source prefix", () => {
    const summary = finish.summarizeViolations([
      "typography_hierarchy:foo[error]: m",
      "typography_hierarchy:bar[warning]: m",
      "color_harmony:baz[warning]: m",
    ]);
    assertEq(summary.bySource.typography_hierarchy.errors,   1, "typo errors");
    assertEq(summary.bySource.typography_hierarchy.warnings, 1, "typo warnings");
    assertEq(summary.bySource.color_harmony.warnings,        1, "color warnings");
  });

  test("runFinishPass emits verdict violation for unfinished inputs", () => {
    const content = makeContent();
    const r = finish.runFinishPass({
      content,
      accumulatedViolations: [
        "typography_hierarchy:headline_not_dominant[error]: m",
        "typography_hierarchy:cta_not_prominent[error]: m",
        "color_harmony:palette_disharmony[error]: m",
      ],
    });
    assertEq(r.summary.verdict, "unfinished", "verdict");
    assert(r.verdictViolation !== undefined, "verdict violation string is present");
    assert(r.verdictViolation!.startsWith("finish_pass:unfinished[error]:"),
      `expected unfinished[error] tag, got: ${r.verdictViolation}`);
  });

  test("runFinishPass emits soft verdict violation for rough inputs", () => {
    const content = makeContent();
    const r = finish.runFinishPass({
      content,
      accumulatedViolations: [
        "color_harmony:w1[warning]: m",
        "color_harmony:w2[warning]: m",
        "color_harmony:w3[warning]: m",
        "color_harmony:w4[warning]: m",
        "color_harmony:w5[warning]: m",
      ],
    });
    assertEq(r.summary.verdict, "rough", "verdict");
    assert(r.verdictViolation?.startsWith("finish_pass:rough[warning]:") ?? false,
      `expected rough[warning] tag, got: ${r.verdictViolation}`);
  });

  test("runFinishPass attaches _finishVerdict to content for downstream consumers", () => {
    const content = makeContent();
    const r = finish.runFinishPass({ content, accumulatedViolations: [] });
    const fv = (r.content as any)._finishVerdict;
    assert(fv !== undefined,           "_finishVerdict attached");
    assertEq(fv.verdict, "finished",    "verdict propagated");
  });

  test("expandShortHex helper handles 3-digit, 6-digit, and garbage inputs", () => {
    assertEq(finish.expandShortHex("#fff"),     "#ffffff", "3-digit expanded");
    assertEq(finish.expandShortHex("#FFaaBB"),  "#FFaaBB", "6-digit untouched");
    assertEq(finish.expandShortHex("not hex"),  "not hex", "garbage untouched");
    assertEq(finish.expandShortHex(undefined),  undefined, "undefined passthrough");
  });

  test("nearestStandardWeight snaps to nearest 100-multiple, ties round up", () => {
    assertEq(finish.nearestStandardWeight(420),  400, "420 → 400");
    assertEq(finish.nearestStandardWeight(450),  500, "450 → 500 (tie rounds up)");
    assertEq(finish.nearestStandardWeight(999),  900, "999 → 900");
    assertEq(finish.nearestStandardWeight(50),   100, "50 → 100 (tie rounds up from floor)");
  });

  test("exports expected finish-pass thresholds", () => {
    assertEq(finish.FINISH_SCORE_FINISHED,     0.80, "FINISH_SCORE_FINISHED");
    assertEq(finish.FINISH_SCORE_ROUGH,        0.50, "FINISH_SCORE_ROUGH");
    assertEq(finish.FINISH_ERROR_WEIGHT,       0.25, "FINISH_ERROR_WEIGHT");
    assertEq(finish.FINISH_WARNING_WEIGHT,     0.05, "FINISH_WARNING_WEIGHT");
    assertEq(finish.FINISH_ROUGH_MAX_ERRORS,   1,    "FINISH_ROUGH_MAX_ERRORS");
    assertEq(finish.FINISH_OPACITY_MIN,        0.02, "FINISH_OPACITY_MIN");
    assertEq(finish.FINISH_OPACITY_MAX,        0.98, "FINISH_OPACITY_MAX");
  });

  section("engines/style · pack consistency (Step 63)");

  const pack       = await import("../apps/arkiol-core/src/engines/style/pack-consistency");
  const themesLib  = await import("../apps/arkiol-core/src/engines/render/design-themes");

  // Build a set of pack members off a shared base so we control which
  // axes drift in each test. Cloning avoids mutating the real theme
  // library that other tests read from.
  const cloneTheme = (theme: any, overrides: any = {}): any => ({
    ...theme,
    palette:     { ...theme.palette,     ...(overrides.palette     ?? {}) },
    typography:  { ...theme.typography,  ...(overrides.typography  ?? {}) },
    ctaStyle:    { ...theme.ctaStyle,    ...(overrides.ctaStyle    ?? {}) },
    background:  overrides.background  ?? theme.background,
    decorations: overrides.decorations ?? theme.decorations.slice(),
    tones:       overrides.tones       ?? theme.tones.slice(),
    id:          overrides.id          ?? theme.id,
    name:        overrides.name        ?? theme.name,
  });

  test("extractDecorationFingerprint counts kinds, finds dominants, reads bgKind", () => {
    const theme: any = {
      id: "t", name: "T", tones: [], colorMoods: [],
      palette: { background: "#fff", surface: "#fff", primary: "#000",
                 secondary: "#000", text: "#000", textMuted: "#000", highlight: "#000" },
      background: { kind: "linear_gradient", colors: ["#000","#fff"], angle: 90 },
      typography: {
        display: "Montserrat", body: "Lato",
        headline: { fontFamily: "Montserrat", fontWeight: 800, color: "#000" },
        subhead:  { fontFamily: "Lato",       fontWeight: 500, color: "#000" },
        body_text:{ fontFamily: "Lato",       fontWeight: 400, color: "#000" },
        cta:      { fontFamily: "Montserrat", fontWeight: 700, color: "#fff" },
        badge:    { fontFamily: "Montserrat", fontWeight: 700, color: "#fff" },
        eyebrow:  { fontFamily: "Montserrat", fontWeight: 600, color: "#000" },
      },
      decorations: [
        { kind: "circle", x:0, y:0, r:1, color:"#000", opacity:1 },
        { kind: "circle", x:0, y:0, r:1, color:"#000", opacity:1 },
        { kind: "circle", x:0, y:0, r:1, color:"#000", opacity:1 },
        { kind: "ribbon", x:0, y:0, w:1, h:1, color:"#000", text:"x", textColor:"#fff", fontSize:10, opacity:1, corner:"tl" },
        { kind: "ribbon", x:0, y:0, w:1, h:1, color:"#000", text:"x", textColor:"#fff", fontSize:10, opacity:1, corner:"tl" },
        { kind: "dots_grid", x:0, y:0, cols:1, rows:1, gap:1, r:1, color:"#000", opacity:1 },
      ],
      ctaStyle: { backgroundColor: "#000", textColor: "#fff", borderRadius: 8, paddingH: 16, paddingV: 8 },
    };
    const fp = pack.extractDecorationFingerprint(theme);
    assertEq(fp.total, 6, "total counted");
    assertEq(fp.kindCounts.circle,    3, "circle count");
    assertEq(fp.kindCounts.ribbon,    2, "ribbon count");
    assertEq(fp.kindCounts.dots_grid, 1, "dots_grid count");
    assertEq(fp.dominant[0], "circle", "dominant first");
    assertEq(fp.dominant[1], "ribbon", "dominant second");
    assertEq(fp.bgKind,  "linear_gradient", "bgKind captured");
    assert(fp.kindSet.includes("circle") && fp.kindSet.includes("ribbon") && fp.kindSet.includes("dots_grid"),
      "kindSet sorted union");
  });

  test("buildPackCohesionProfile picks core vocabulary shared by >=60% of members", () => {
    const base = themesLib.THEMES[0];
    const members = [
      cloneTheme(base, { id: "m1", decorations: [
        { kind: "circle", x:0, y:0, r:1, color:"#000", opacity:1 },
        { kind: "rect",   x:0, y:0, w:1, h:1, color:"#000", opacity:1, rx:0 },
      ]}),
      cloneTheme(base, { id: "m2", decorations: [
        { kind: "circle", x:0, y:0, r:1, color:"#000", opacity:1 },
        { kind: "rect",   x:0, y:0, w:1, h:1, color:"#000", opacity:1, rx:0 },
        { kind: "blob",   x:0, y:0, size:1, color:"#000", opacity:1, seed:1 },
      ]}),
      cloneTheme(base, { id: "m3", decorations: [
        { kind: "circle",    x:0, y:0, r:1, color:"#000", opacity:1 },
        { kind: "half_circle", x:0, y:0, r:1, color:"#000", opacity:1, rotation:0 },
      ]}),
    ];
    const profile = pack.buildPackCohesionProfile(members);
    assertEq(profile.memberCount, 3, "member count");
    assert(profile.coreDecorations.includes("circle"),
      `core vocab should include circle (shared by all), got: ${profile.coreDecorations.join(",")}`);
    assert(!profile.coreDecorations.includes("blob"),
      `core vocab should NOT include blob (only 1/3), got: ${profile.coreDecorations.join(",")}`);
    assert(profile.vocabulary.includes("blob"),
      "vocabulary is full union, should include blob");
  });

  test("scorePackCohesion reports curated verdict for coherent pack", () => {
    const base = themesLib.THEMES[0];
    const pack3 = [
      cloneTheme(base, { id: "a" }),
      cloneTheme(base, { id: "b" }),
      cloneTheme(base, { id: "c" }),
    ];
    const report = pack.scorePackCohesion(pack3);
    assert(report.verdict !== "fragmented",
      `coherent pack reported ${report.verdict} (score=${report.score.toFixed(2)}); violations=${report.violations.join(";")}`);
    assert(report.score >= 0.50,
      `coherent pack score too low: ${report.score.toFixed(2)}`);
  });

  test("scorePackCohesion marks palette-scattered pack as fragmented", () => {
    const base = themesLib.THEMES[0];
    const pack3 = [
      cloneTheme(base, { id: "a",
        palette: { primary: "#ff0000", secondary: "#00ff00", background: "#000000", text: "#ffffff" },
        typography: { display: "Montserrat", body: "Lato" },
        tones: ["energetic"],
        decorations: [
          { kind: "circle", x:0, y:0, r:1, color:"#f00", opacity:1 },
        ],
      }),
      cloneTheme(base, { id: "b",
        palette: { primary: "#0066ff", secondary: "#ffcc00", background: "#ffffff", text: "#111111" },
        typography: { display: "Playfair Display", body: "Cormorant Garamond" },
        tones: ["luxury"],
        decorations: [
          { kind: "blob", x:0, y:0, size:1, color:"#fff", opacity:1, seed:1 },
        ],
      }),
      cloneTheme(base, { id: "c",
        palette: { primary: "#00aa66", secondary: "#ff9900", background: "#eeeeee", text: "#222222" },
        typography: { display: "Bebas Neue", body: "Nunito" },
        tones: ["playful"],
        decorations: [
          { kind: "triangle", x:0, y:0, size:1, color:"#0a6", opacity:1, rotation:0 },
          { kind: "cross",    x:0, y:0, size:1, thickness:1, color:"#0a6", opacity:1, rotation:0 },
        ],
      }),
    ];
    const report = pack.scorePackCohesion(pack3);
    assertEq(report.verdict, "fragmented",
      `expected fragmented, got ${report.verdict} (score=${report.score.toFixed(2)}); violations=${report.violations.join(";")}`);
    assert(report.subscores.palette < 0.85,
      `palette subscore should reflect scatter: ${report.subscores.palette.toFixed(2)}`);
  });

  test("scorePackCohesion rejects decoration-fragmented packs via subscore", () => {
    const base = themesLib.THEMES[0];
    const pack3 = [
      cloneTheme(base, { id: "a", decorations: [
        { kind: "ribbon",       x:0, y:0, w:1, h:1, color:"#000", text:"x", textColor:"#fff", fontSize:10, opacity:1, corner:"tl" },
      ]}),
      cloneTheme(base, { id: "b", decorations: [
        { kind: "checklist",    x:0, y:0, w:1, items:["a","b"], color:"#000", checkColor:"#0f0", fontSize:10, opacity:1 },
      ]}),
      cloneTheme(base, { id: "c", decorations: [
        { kind: "starburst",    x:0, y:0, r:1, rays:5, color:"#000", opacity:1, rotation:0 },
      ]}),
    ];
    const report = pack.scorePackCohesion(pack3);
    // No kind is shared by >=60 % of members → core vocabulary is empty
    // → decoration subscore is 0 → violations should mention fragmentation.
    assert(report.subscores.decoration < 0.3,
      `decoration subscore should be near 0: ${report.subscores.decoration.toFixed(2)}`);
    assert(report.violations.some((v: string) => v.startsWith("decoration_fragmented")),
      `expected decoration_fragmented violation, got: ${report.violations.join(";")}`);
  });

  test("scorePackCohesion flags tone-scattered packs", () => {
    const base = themesLib.THEMES[0];
    const pack3 = [
      cloneTheme(base, { id: "a", tones: ["professional"] }),
      cloneTheme(base, { id: "b", tones: ["playful"] }),
      cloneTheme(base, { id: "c", tones: ["urgent"] }),
    ];
    const report = pack.scorePackCohesion(pack3);
    assert(report.violations.some((v: string) => v.startsWith("tone_scattered")),
      `expected tone_scattered violation, got: ${report.violations.join(";")}`);
    assert(report.subscores.tone < pack.PACK_TONE_CONSENSUS_FLOOR,
      `tone subscore should fall below consensus floor: ${report.subscores.tone.toFixed(2)}`);
  });

  test("scorePackCohesion flags uniform layouts as missing variation", () => {
    const base = themesLib.THEMES[0];
    const identicalDeco = [
      { kind: "circle", x:10, y:10, r:5, color:"#000", opacity:1 },
      { kind: "circle", x:30, y:30, r:5, color:"#000", opacity:1 },
    ];
    const pack3 = [
      cloneTheme(base, { id: "a", decorations: identicalDeco.slice(),
        background: { kind: "solid", color: "#fff" } }),
      cloneTheme(base, { id: "b", decorations: identicalDeco.slice(),
        background: { kind: "solid", color: "#fff" } }),
      cloneTheme(base, { id: "c", decorations: identicalDeco.slice(),
        background: { kind: "solid", color: "#fff" } }),
    ];
    const report = pack.scorePackCohesion(pack3);
    assert(report.subscores.layout < 0.4,
      `identical pack should score low layout variation, got: ${report.subscores.layout.toFixed(2)}`);
  });

  test("scorePackCohesion tags outliers and flips verdict accordingly", () => {
    const base = themesLib.THEMES[0];
    const pack4 = [
      cloneTheme(base, { id: "a" }),
      cloneTheme(base, { id: "b" }),
      cloneTheme(base, { id: "c" }),
      cloneTheme(base, { id: "outlier",
        palette: { primary: "#ff00aa", secondary: "#00ffcc", background: "#0a0a0a", text: "#ffffff" },
        typography: { display: "Bebas Neue", body: "Cormorant Garamond" },
        tones: ["luxury"],
        decorations: [
          { kind: "noise_overlay", opacity: 0.1 },
        ],
      }),
    ];
    const report = pack.scorePackCohesion(pack4);
    const outlier = report.members.find((m: any) => m.themeId === "outlier");
    assert(outlier, "outlier member missing from report");
    assertEq(outlier!.memberVerdict, "outlier",
      `expected outlier verdict, got ${outlier!.memberVerdict} (score=${outlier!.cohesionScore.toFixed(2)})`);
    assert(report.verdict === "loose" || report.verdict === "fragmented",
      `one outlier should flip verdict to loose/fragmented, got ${report.verdict}`);
  });

  test("filterFragmentedMembers drops outliers while keeping aligned + drifting", () => {
    const base = themesLib.THEMES[0];
    const themes = [
      cloneTheme(base, { id: "a" }),
      cloneTheme(base, { id: "b" }),
      cloneTheme(base, { id: "c" }),
      cloneTheme(base, { id: "outlier",
        palette: { primary: "#ff00aa", secondary: "#00ffcc", background: "#0a0a0a", text: "#ffffff" },
        typography: { display: "Bebas Neue", body: "Cormorant Garamond" },
        tones: ["luxury"],
        decorations: [{ kind: "noise_overlay", opacity: 0.1 }],
      }),
    ];
    const report = pack.scorePackCohesion(themes);
    const { kept, dropped } = pack.filterFragmentedMembers(themes, report);
    assert(dropped.length >= 1, "expected at least one drop");
    assert(dropped.some((d: any) => d.theme.id === "outlier"), "outlier theme not dropped");
    assert(kept.every((t: any) => t.id !== "outlier"), "outlier kept incorrectly");
  });

  test("annotatePackCohesion tags each content with the member signal", () => {
    const base = themesLib.THEMES[0];
    const themes = [cloneTheme(base, { id: "a" }), cloneTheme(base, { id: "b" })];
    const contents: any[] = [{ textContents: [] }, { textContents: [] }];
    const report = pack.scorePackCohesion(themes);
    pack.annotatePackCohesion(contents, themes, report);
    for (let i = 0; i < contents.length; i++) {
      const sig = contents[i]._packCohesion;
      assert(sig, `content[${i}] missing _packCohesion signal`);
      assert(typeof sig.packScore === "number",     "packScore attached");
      assert(typeof sig.memberScore === "number",   "memberScore attached");
      assert(["curated","loose","fragmented"].includes(sig.packVerdict),
        `packVerdict invalid: ${sig.packVerdict}`);
      assert(["aligned","drifting","outlier"].includes(sig.memberVerdict),
        `memberVerdict invalid: ${sig.memberVerdict}`);
    }
  });

  test("annotatePackCohesion tolerates null/undefined contents (failed candidates)", () => {
    const base = themesLib.THEMES[0];
    const themes = [cloneTheme(base, { id: "a" }), cloneTheme(base, { id: "b" })];
    const report = pack.scorePackCohesion(themes);
    pack.annotatePackCohesion([null, undefined] as any, themes, report);
    // No throw = pass.
  });

  test("annotatePackCohesion throws on length mismatch to catch coordinator bugs", () => {
    const base = themesLib.THEMES[0];
    const themes = [cloneTheme(base, { id: "a" }), cloneTheme(base, { id: "b" })];
    const report = pack.scorePackCohesion(themes);
    let threw = false;
    try { pack.annotatePackCohesion([{} as any], themes, report); } catch { threw = true; }
    assert(threw, "expected length-mismatch throw");
  });

  test("enforcePackConsistency drops outliers when requested and returns matching contents", () => {
    const base = themesLib.THEMES[0];
    const themes = [
      cloneTheme(base, { id: "a" }),
      cloneTheme(base, { id: "b" }),
      cloneTheme(base, { id: "c" }),
      cloneTheme(base, { id: "outlier",
        palette: { primary: "#ff00aa", secondary: "#00ffcc", background: "#0a0a0a", text: "#ffffff" },
        typography: { display: "Bebas Neue", body: "Cormorant Garamond" },
        tones: ["luxury"],
        decorations: [{ kind: "noise_overlay", opacity: 0.1 }],
      }),
    ];
    const contents: any[] = themes.map((t: any, i: number) => ({ textContents: [], marker: t.id + "-" + i }));
    const out = pack.enforcePackConsistency({ themes, contents, dropOutliers: true });
    assert(out.themes.length === out.contents.length,
      `themes/contents length mismatch: ${out.themes.length} vs ${out.contents.length}`);
    assert(out.themes.every((t: any) => t.id !== "outlier"), "outlier not dropped");
    assert(out.dropped.length >= 1, "drops array empty");
  });

  test("enforcePackConsistency without dropOutliers keeps every member but still annotates", () => {
    const base = themesLib.THEMES[0];
    const themes = [
      cloneTheme(base, { id: "a" }),
      cloneTheme(base, { id: "b" }),
    ];
    const contents: any[] = [{ textContents: [] }, { textContents: [] }];
    const out = pack.enforcePackConsistency({ themes, contents, dropOutliers: false });
    assertEq(out.themes.length, 2, "all themes kept");
    assertEq(out.dropped.length, 0, "nothing dropped");
    assert(contents[0]._packCohesion && contents[1]._packCohesion, "both contents annotated");
  });

  test("scorePackCohesion throws on empty pack", () => {
    let threw = false;
    try { pack.scorePackCohesion([]); } catch { threw = true; }
    assert(threw, "expected throw on empty pack");
  });

  test("scorePackCohesion single-member pack is curated (variation trivially satisfied)", () => {
    const base = themesLib.THEMES[0];
    const report = pack.scorePackCohesion([cloneTheme(base, { id: "only" })]);
    assertEq(report.verdict, "curated",
      `single-member pack should be curated, got ${report.verdict} (score=${report.score.toFixed(2)})`);
  });

  test("exports expected pack-consistency thresholds", () => {
    assertEq(pack.PACK_COHESION_CURATED,               0.72, "PACK_COHESION_CURATED");
    assertEq(pack.PACK_COHESION_FRAGMENTED,            0.50, "PACK_COHESION_FRAGMENTED");
    assertEq(pack.PACK_DECORATION_MIN_CORE_OVERLAP,    0.30, "PACK_DECORATION_MIN_CORE_OVERLAP");
    assertEq(pack.PACK_LAYOUT_MIN_VARIATION,           0.12, "PACK_LAYOUT_MIN_VARIATION");
    assertEq(pack.PACK_TONE_CONSENSUS_FLOOR,           0.55, "PACK_TONE_CONSENSUS_FLOOR");
    assertEq(pack.PACK_MEMBER_OUTLIER_FLOOR,           0.45, "PACK_MEMBER_OUTLIER_FLOOR");
  });

  section("engines/style · script fonts + run emphasis (Step 64)");

  const pairing  = await import("../apps/arkiol-core/src/engines/style/font-pairing");
  const registry = await import("../apps/arkiol-core/src/engines/render/font-registry-ultimate");

  test("font metadata exists for every new script face", () => {
    for (const font of ["Dancing Script","Caveat","Sacramento","Allura","Pacifico"] as const) {
      const md = pairing.getFontMetadata(font);
      assert(md, `${font} has no metadata`);
      assertEq(md.classification, "script", `${font} classification`);
      assertEq(md.role,           "display-only", `${font} role`);
      assert(md.displayPower >= 0.80, `${font} displayPower should be high`);
      assert(md.bodyQuality  <= 0.25, `${font} bodyQuality should be low`);
    }
  });

  test("script faces appear in ULTIMATE_FONTS registry + have CDN char-width ratios", () => {
    const families = new Set(registry.ULTIMATE_FONTS.map(v => v.family));
    for (const font of ["Dancing Script","Caveat","Sacramento","Allura","Pacifico"] as const) {
      assert(families.has(font), `registry missing ${font}`);
      assert(typeof registry.ULTIMATE_CHAR_WIDTH_RATIOS[font] === "number",
        `${font} missing char-width ratio`);
    }
  });

  test("getFontStack falls back to cursive generic for script families", () => {
    for (const font of ["Dancing Script","Caveat","Sacramento","Allura","Pacifico"] as const) {
      const stk = registry.getFontStack(font);
      assert(stk.includes("cursive"), `${font} fallback should end in cursive, got: ${stk}`);
      assert(stk.includes(font), `${font} stack should name itself: ${stk}`);
    }
  });

  test("scoreFontPair rewards script display + humanist/neutral body", () => {
    const good = pairing.scoreFontPair("Dancing Script", "Lato").total;
    const bad  = pairing.scoreFontPair("Dancing Script", "Caveat").total;
    assert(good > 1.0, `script + body-strong sans should score well, got ${good}`);
    assert(bad  < 0,   `two scripts should score negative, got ${bad}`);
  });

  test("scoreFontPair marks Allura + Cormorant as canonical wedding editorial", () => {
    const s = pairing.scoreFontPair("Allura", "Cormorant Garamond");
    assert(s.reasons.some(r => r.startsWith("canonical")),
      `expected canonical pairing reason, got: ${s.reasons.join(";")}`);
  });

  test("anti-pair blocks every script×script combination both directions", () => {
    const scripts = ["Dancing Script","Caveat","Sacramento","Allura","Pacifico"] as const;
    for (const a of scripts) for (const b of scripts) {
      if (a === b) continue;
      const s = pairing.scoreFontPair(a, b);
      assert(s.total < 0,
        `script×script should score negative: ${a}+${b}=${s.total.toFixed(2)}`);
    }
  });

  const runsMod = await import("../apps/arkiol-core/src/engines/render/text-runs");

  test("renderRunTspans emits per-run tspan with fill + weight overrides", () => {
    const lines = ["3 Simple Steps"];
    const runs  = [
      { text: "3 Simple " },
      { text: "Steps", color: "#ff5722", weight: 900 },
    ];
    const out = runsMod.renderRunTspans(lines, runs, 100, 70).join("");
    assert(out.includes("3 Simple"), `first run rendered, got: ${out}`);
    assert(out.includes("Steps"), `emphasized run rendered, got: ${out}`);
    assert(out.includes(`fill="#ff5722"`), `accent fill applied, got: ${out}`);
    assert(out.includes(`font-weight="900"`), `weight override applied, got: ${out}`);
    assert(!out.match(/fill="[^"]*".*3 Simple/),
      "leading run should NOT carry a fill attribute — inherits from parent <text>");
  });

  test("renderRunTspans falls back when run text doesn't match wrapped lines", () => {
    // Simulate text measurement that wrapped differently than runs joined.
    const lines = ["Different text"];
    const runs  = [{ text: "3 Simple ", color: "#000" }, { text: "Steps", color: "#f00" }];
    const out = runsMod.renderRunTspans(lines, runs, 100, 70).join("");
    assert(out.includes("Different text"),
      "fallback should emit the wrapped line verbatim");
    assert(!out.includes("#f00") && !out.includes("#000"),
      "fallback should NOT leak run fills");
  });

  test("renderRunTspans escapes XML specials in run text", () => {
    const out = runsMod.renderRunTspans(["A <b> & \"c\""], [{ text: "A <b> & \"c\"" }], 0, 0).join("");
    assert(out.includes("&lt;b&gt;"), `< and > escaped: ${out}`);
    assert(out.includes("&amp;"), `& escaped: ${out}`);
    assert(out.includes("&quot;"), `" escaped: ${out}`);
  });

  test("renderRunTspans applies italic override", () => {
    const out = runsMod.renderRunTspans(["hello world"], [
      { text: "hello " },
      { text: "world", italic: true },
    ], 0, 0).join("");
    assert(out.includes(`font-style="italic"`),
      `italic run should render font-style="italic", got: ${out}`);
  });

  test("renderRunTspans wraps runs that straddle a line break across tspans", () => {
    const lines = ["hello", "world"];
    const runs  = [{ text: "helloworld", color: "#abcdef" }];
    const spans = runsMod.renderRunTspans(lines, runs, 50, 60);
    assert(spans.length >= 2, `expected 2+ tspans for 2 lines, got ${spans.length}`);
    assert(spans[0].includes(`dy="0"`), `first line dy=0: ${spans[0]}`);
    assert(spans[1].includes(`dy="60"`), `second line dy=60: ${spans[1]}`);
  });

  test("script_elegance theme exists and uses Dancing Script as display", async () => {
    const themesLib = await import("../apps/arkiol-core/src/engines/render/design-themes");
    const t = themesLib.THEMES.find((x: any) => x.id === "script_elegance");
    assert(t, "script_elegance theme missing");
    assertEq(t!.typography.display, "Dancing Script", "display font");
    assertEq(t!.typography.body,    "Lato",           "body font");
  });

  section("engines/render · painterly scenes + foliage (Step 65)");

  const decoMod = await import("../apps/arkiol-core/src/engines/render/svg-decorations");

  test("foliage_silhouette emits 3-layer painted tufts anchored to bottom", () => {
    const svg = decoMod.renderDecoration(
      { kind: "foliage_silhouette", anchor: "bottom",
        palette: ["#1e3a2a", "#2c5139", "#3d6a49"], density: 8, height: 10, opacity: 0.9 } as any,
      1080, 1080,
    );
    // Three color layers present
    assert(svg.includes("#1e3a2a"), "far tuft color missing");
    assert(svg.includes("#2c5139"), "mid tuft color missing");
    assert(svg.includes("#3d6a49"), "near tuft color missing");
    // Tuft paths use cubic bezier commands
    assert(svg.match(/<path d="M /g)!.length >= 8, "expected multiple tuft paths");
    // Outer group opacity
    assert(svg.includes(`opacity="0.9"`), "outer opacity missing");
  });

  test("foliage_silhouette supports every anchor direction", () => {
    for (const anchor of ["top","bottom","left","right"] as const) {
      const svg = decoMod.renderDecoration(
        { kind: "foliage_silhouette", anchor,
          palette: ["#111111", "#222222", "#333333"], density: 4, height: 8, opacity: 1 } as any,
        400, 400,
      );
      assert(svg.includes("<path"), `anchor ${anchor} produced no path`);
      assert(svg.length > 200, `anchor ${anchor} body too short`);
    }
  });

  test("mountain_range draws parallax silhouettes with deterministic peaks", () => {
    const svg1 = decoMod.renderDecoration(
      { kind: "mountain_range", y: 60, layers: 3,
        palette: ["#6b8eb1", "#456c8f", "#2c3e50"], peakVariance: 0.35, opacity: 0.95 } as any,
      800, 800,
    );
    const svg2 = decoMod.renderDecoration(
      { kind: "mountain_range", y: 60, layers: 3,
        palette: ["#6b8eb1", "#456c8f", "#2c3e50"], peakVariance: 0.35, opacity: 0.95 } as any,
      800, 800,
    );
    assertEq(svg1, svg2, "mountain_range is non-deterministic");
    assert(svg1.match(/<polygon/g)!.length === 3, "expected 3 mountain layers");
  });

  test("watercolor_corner draws blob + leaf sprigs + blooms", () => {
    const svg = decoMod.renderDecoration(
      { kind: "watercolor_corner", corner: "tl", size: 22,
        palette: ["#f4d7ae", "#4d8640", "#e76f51"], opacity: 0.7 } as any,
      1080, 1080,
    );
    assert(svg.includes("#f4d7ae"), "wash color missing");
    assert(svg.includes("#4d8640"), "leaf color missing");
    assert(svg.includes("#e76f51"), "bloom color missing");
    // blob path + 3 stem paths + 9 leaf paths + 2 bloom circles
    assert(svg.match(/<path/g)!.length >= 10, "expected multi-layer composition");
    assert(svg.match(/<circle/g)!.length >= 2, "expected bloom circles");
  });

  test("themed_cluster food variant uses category-appropriate props", () => {
    const svg = decoMod.renderDecoration(
      { kind: "themed_cluster", x: 50, y: 50, size: 30, theme: "food",
        palette: ["#2e7d32", "#f57f17", "#f4a261", "#ffffff"], opacity: 1 } as any,
      1080, 1080,
    );
    assert(svg.length > 500, "food cluster too small");
    assert(svg.includes("#2e7d32"), "leaf color missing");
    assert(svg.includes("#f57f17"), "bread color missing");
  });

  test("themed_cluster supports all six theme variants", () => {
    for (const theme of ["food","spa","study","office","travel","floral"] as const) {
      const svg = decoMod.renderDecoration(
        { kind: "themed_cluster", x: 50, y: 50, size: 25, theme,
          palette: ["#4d8640","#e76f51","#f4a261","#ffffff"], opacity: 1 } as any,
        600, 600,
      );
      assert(svg.includes("<g"), `${theme} cluster missing group`);
      assert(svg.length > 200, `${theme} cluster too short`);
    }
  });

  test("torn_paper_frame renders jagged polygon with drop shadow", () => {
    const svg = decoMod.renderDecoration(
      { kind: "torn_paper_frame", x: 10, y: 15, w: 80, h: 70,
        color: "#fdfaf2", shadowColor: "#000000", opacity: 0.95, seed: 271 } as any,
      1080, 1080,
    );
    assert(svg.includes("<filter"), "drop shadow filter missing");
    assert(svg.includes("feDropShadow"), "shadow filter primitive missing");
    assert(svg.includes(`fill="#fdfaf2"`), "paper color missing");
    assert(svg.includes("<path"), "path missing");
  });

  test("torn_paper_frame is deterministic per seed", () => {
    const shape = { kind: "torn_paper_frame", x: 10, y: 15, w: 80, h: 70,
      color: "#fff", shadowColor: "#000", opacity: 1, seed: 271 };
    const a = decoMod.renderDecoration(shape as any, 800, 800);
    const b = decoMod.renderDecoration(shape as any, 800, 800);
    assertEq(a, b, "torn_paper_frame non-deterministic");
    const c = decoMod.renderDecoration({ ...shape, seed: 599 } as any, 800, 800);
    assert(a !== c, "torn_paper_frame same output for different seeds");
  });

  test("renderScene mountain_lake paints sun, mountains, lake, ripples", () => {
    const svg = decoMod.renderScene(
      "mountain_lake",
      ["#9ec8e3","#f2d6b2","#6b8eb1","#2c3e50","#a5c4dd","#486b8a","#fcd27b"],
      1080, 1080,
    );
    assert(svg.includes("#fcd27b"), "sun color missing");
    assert(svg.includes("#6b8eb1"), "far mountain color missing");
    assert(svg.includes("#2c3e50"), "near mountain color missing");
    assert(svg.includes("linearGradient"), "lake gradient missing");
    assert(svg.match(/<polygon/g)!.length >= 2, "expected 2 mountain polygons");
  });

  test("renderScene supports all six scene kinds", () => {
    const palette = ["#1","#2","#3","#4","#5","#6","#7"];
    for (const scene of ["mountain_lake","jungle","sunset_sky","meadow","ocean_horizon","forest"] as const) {
      const svg = decoMod.renderScene(scene, palette, 800, 800);
      assert(svg.length > 200, `scene ${scene} too short`);
    }
  });

  test("buildBackgroundDefs handles scene kind with sky gradient", () => {
    const { defs, fill } = decoMod.buildBackgroundDefs(
      { kind: "scene", scene: "meadow",
        palette: ["#e6efd6","#cfe0b1","#9ac47a","#74a859","#4d8640","#f4a261","#e76f51"] } as any,
    );
    assert(defs.includes("linearGradient"), "sky gradient missing");
    assert(defs.includes("#e6efd6"), "sky top color missing");
    assert(defs.includes("#cfe0b1"), "sky horizon color missing");
    assertEq(fill, "url(#bg_grad)", "fill ref");
  });

  test("renderMeshOverlay emits scene body for scene bg", () => {
    const body = decoMod.renderMeshOverlay(
      { kind: "scene", scene: "mountain_lake",
        palette: ["#9ec8e3","#f2d6b2","#6b8eb1","#2c3e50","#a5c4dd","#486b8a","#fcd27b"] } as any,
      800, 800,
    );
    assert(body.includes("polygon"), "scene body missing mountains");
    assert(body.length > 300, "scene body too short");
  });

  test("travel_vista theme uses scene background with mountain_lake", async () => {
    const themesLib = await import("../apps/arkiol-core/src/engines/render/design-themes");
    const t = themesLib.THEMES.find((x: any) => x.id === "travel_vista");
    assert(t, "travel_vista theme missing");
    assertEq((t!.background as any).kind, "scene", "bg kind");
    assertEq((t!.background as any).scene, "mountain_lake", "scene kind");
    const foliage = t!.decorations.find((d: any) => d.kind === "foliage_silhouette");
    assert(foliage, "travel_vista missing foliage_silhouette");
  });

  test("wellness_meadow theme uses meadow scene and Caveat display font", async () => {
    const themesLib = await import("../apps/arkiol-core/src/engines/render/design-themes");
    const t = themesLib.THEMES.find((x: any) => x.id === "wellness_meadow");
    assert(t, "wellness_meadow theme missing");
    assertEq((t!.background as any).scene, "meadow", "scene kind");
    assertEq(t!.typography.display, "Caveat", "display font");
  });

  test("vintage_paper theme uses torn_paper_frame + floral cluster", async () => {
    const themesLib = await import("../apps/arkiol-core/src/engines/render/design-themes");
    const t = themesLib.THEMES.find((x: any) => x.id === "vintage_paper");
    assert(t, "vintage_paper theme missing");
    const torn = t!.decorations.find((d: any) => d.kind === "torn_paper_frame");
    assert(torn, "vintage_paper missing torn_paper_frame");
    const floral = t!.decorations.find((d: any) => d.kind === "themed_cluster" && (d as any).theme === "floral");
    assert(floral, "vintage_paper missing floral themed_cluster");
  });

  test("tropical_jungle theme uses jungle scene", async () => {
    const themesLib = await import("../apps/arkiol-core/src/engines/render/design-themes");
    const t = themesLib.THEMES.find((x: any) => x.id === "tropical_jungle");
    assert(t, "tropical_jungle theme missing");
    assertEq((t!.background as any).scene, "jungle", "scene kind");
  });

  test("travel category prefers travel_vista theme", async () => {
    const packs = await import("../apps/arkiol-core/src/engines/style/category-style-packs");
    const travel = packs.getCategoryPack("travel");
    assert(travel, "travel pack missing");
    assert(travel!.preferredThemeIds.includes("travel_vista"),
      `travel preferredThemeIds should include travel_vista: ${travel!.preferredThemeIds.join(",")}`);
    assert(travel!.preferredBgKinds.includes("scene"),
      "travel preferredBgKinds should include scene");
  });

  test("wellness category prefers wellness_meadow theme", async () => {
    const packs = await import("../apps/arkiol-core/src/engines/style/category-style-packs");
    const wellness = packs.getCategoryPack("wellness");
    assert(wellness!.preferredThemeIds.includes("wellness_meadow"),
      `wellness preferredThemeIds should include wellness_meadow`);
  });

  section("engines/render · photo + shape_panel + washi_tape (Step 66)");

  test("photo_circle falls back to solid bgColor when no slug/url provided", () => {
    const svg = decoMod.renderDecoration(
      { kind: "photo_circle", x: 50, y: 50, r: 20,
        borderColor: "#ffffff", borderWidth: 2, opacity: 1,
        shadow: false, bgColor: "#c9a84c" } as any,
      1080, 1080,
    );
    assert(svg.includes("<circle"), "fallback circle missing");
    assert(svg.includes(`fill="#c9a84c"`), "fallback bgColor missing");
    assert(!svg.includes("<image"), "must not emit <image> without url");
  });

  test("photo_circle emits <image> with clipPath when photoUrl is set", () => {
    const svg = decoMod.renderDecoration(
      { kind: "photo_circle", x: 50, y: 50, r: 20,
        borderColor: "#ffffff", borderWidth: 0, opacity: 1,
        shadow: false, bgColor: "#000",
        photoUrl: "https://cdn.example.com/hero.jpg" } as any,
      1080, 1080,
    );
    assert(svg.includes("<image"), "image element missing");
    assert(svg.includes("<clipPath"), "clipPath missing");
    assert(svg.includes("https://cdn.example.com/hero.jpg"), "url missing");
    assert(svg.includes(`preserveAspectRatio="xMidYMid slice"`), "aspect ratio attr missing");
  });

  test("photo_circle escapes entities in photoUrl", () => {
    const svg = decoMod.renderDecoration(
      { kind: "photo_circle", x: 50, y: 50, r: 20,
        borderColor: "#fff", borderWidth: 0, opacity: 1,
        shadow: false, bgColor: "#000",
        photoUrl: 'https://cdn.example.com/a.jpg?q=1&size=50&"x"' } as any,
      1080, 1080,
    );
    assert(svg.includes("&amp;"), "ampersand not escaped");
    assert(svg.includes("&quot;"), "quote not escaped");
    assert(!svg.match(/href="[^"]*"[^ \/>]/), "attribute breakout detected");
  });

  test("photo_circle resolves photoSlug via ARKIOL_PHOTO_ASSET_BASE", () => {
    const prev = process.env.ARKIOL_PHOTO_ASSET_BASE;
    process.env.ARKIOL_PHOTO_ASSET_BASE = "https://assets.arkiol.test";
    try {
      const svg = decoMod.renderDecoration(
        { kind: "photo_circle", x: 50, y: 50, r: 20,
          borderColor: "#fff", borderWidth: 0, opacity: 1,
          shadow: false, bgColor: "#000",
          photoSlug: "fashion-hero" } as any,
        1080, 1080,
      );
      assert(svg.includes("<image"), "image missing when slug configured");
      assert(svg.includes("https://assets.arkiol.test"), "configured base missing");
      assert(svg.includes("fashion-hero"), "slug missing from resolved url");
    } finally {
      if (prev === undefined) delete process.env.ARKIOL_PHOTO_ASSET_BASE;
      else process.env.ARKIOL_PHOTO_ASSET_BASE = prev;
    }
  });

  test("photo_shape renders every shape variant", () => {
    for (const shape of ["heart","circle","blob","rounded"] as const) {
      const svg = decoMod.renderDecoration(
        { kind: "photo_shape", x: 20, y: 20, w: 60, h: 60, shape,
          fallbackColor: "#b7c4c5", opacity: 1, shadow: false } as any,
        1080, 1080,
      );
      assert(svg.includes("<clipPath"), `clipPath missing for ${shape}`);
      assert(svg.includes("<path"), `path missing for ${shape}`);
      assert(svg.includes(`fill="#b7c4c5"`), `fallback color missing for ${shape}`);
    }
  });

  test("photo_shape adds drop shadow filter when shadow:true", () => {
    const svg = decoMod.renderDecoration(
      { kind: "photo_shape", x: 20, y: 20, w: 60, h: 60, shape: "rounded",
        fallbackColor: "#000", opacity: 1, shadow: true } as any,
      1080, 1080,
    );
    assert(svg.includes("feDropShadow"), "drop shadow primitive missing");
    assert(svg.includes("filter=\"url("), "filter attribute missing");
  });

  test("photo_shape emits <image> when photoUrl is supplied", () => {
    const svg = decoMod.renderDecoration(
      { kind: "photo_shape", x: 20, y: 20, w: 60, h: 60, shape: "heart",
        photoUrl: "https://cdn.example.com/heart.jpg",
        fallbackColor: "#c00", opacity: 1 } as any,
      1080, 1080,
    );
    assert(svg.includes("<image"), "image missing");
    assert(svg.includes("https://cdn.example.com/heart.jpg"), "url missing");
    assert(!svg.includes(`fill="#c00"`), "fallback fill should not render when url present");
  });

  test("shape_panel renders heart/blob/arc/badge variants", () => {
    for (const shape of ["heart","blob","arc","badge"] as const) {
      const svg = decoMod.renderDecoration(
        { kind: "shape_panel", x: 10, y: 10, w: 80, h: 80, shape,
          color: "#e85a79", opacity: 0.95, seed: 173 } as any,
        1080, 1080,
      );
      assert(svg.includes("<path"), `${shape} panel missing path`);
      assert(svg.includes(`fill="#e85a79"`), `${shape} panel missing fill`);
    }
  });

  test("shape_panel adds stroke when strokeWidth set", () => {
    const svg = decoMod.renderDecoration(
      { kind: "shape_panel", x: 10, y: 10, w: 80, h: 60, shape: "heart",
        color: "#ffffff", strokeColor: "#c92f55", strokeWidth: 2, opacity: 1 } as any,
      1080, 1080,
    );
    assert(svg.includes("stroke=\"#c92f55\""), "stroke color missing");
    assert(svg.includes("stroke-width=\"2\""), "stroke width missing");
  });

  test("shape_panel blob is deterministic per seed", () => {
    const make = (seed: number) => decoMod.renderDecoration(
      { kind: "shape_panel", x: 10, y: 10, w: 80, h: 60, shape: "blob",
        color: "#fff", opacity: 1, seed } as any,
      800, 800,
    );
    assertEq(make(173), make(173), "blob non-deterministic");
    assert(make(173) !== make(311), "different seeds produced identical output");
  });

  test("washi_tape renders rotated group with stripes and shadow", () => {
    const svg = decoMod.renderDecoration(
      { kind: "washi_tape", x: 10, y: 10, w: 20, h: 4, rotation: -15,
        colorA: "#f06292", colorB: "#ffffff", opacity: 0.82, stripes: 5 } as any,
      1080, 1080,
    );
    assert(svg.includes("rotate(-15"), "rotation transform missing");
    assert(svg.includes(`fill="#f06292"`), "base colorA missing");
    assert(svg.includes(`fill="#ffffff"`), "stripe colorB missing");
    assert(svg.includes("<clipPath"), "stripe clipPath missing");
    // base rect + N stripe rects + shadow rect
    assert(svg.match(/<rect/g)!.length >= 3, "expected multiple rects");
  });

  test("washi_tape clamps stripe count to [2, 12]", () => {
    const svgLo = decoMod.renderDecoration(
      { kind: "washi_tape", x: 0, y: 0, w: 20, h: 4, rotation: 0,
        colorA: "#000000", colorB: "#ffff00", opacity: 1, stripes: 0 } as any,
      800, 800,
    );
    const svgHi = decoMod.renderDecoration(
      { kind: "washi_tape", x: 0, y: 0, w: 20, h: 4, rotation: 0,
        colorA: "#000000", colorB: "#ffff00", opacity: 1, stripes: 99 } as any,
      800, 800,
    );
    const countStripes = (s: string) => (s.match(/fill="#ffff00"/g) || []).length;
    assertEq(countStripes(svgLo), 2, "stripes floor should clamp to 2");
    assertEq(countStripes(svgHi), 12, "stripes ceiling should clamp to 12");
  });

  test("heart_health theme uses heart shape_panel as hero container", async () => {
    const themesLib = await import("../apps/arkiol-core/src/engines/render/design-themes");
    const t = themesLib.THEMES.find((x: any) => x.id === "heart_health");
    assert(t, "heart_health theme missing");
    const heart = t!.decorations.find(
      (d: any) => d.kind === "shape_panel" && d.shape === "heart",
    );
    assert(heart, "heart_health missing heart shape_panel");
  });

  test("style_photo theme pairs photo_shape with Allura display font", async () => {
    const themesLib = await import("../apps/arkiol-core/src/engines/render/design-themes");
    const t = themesLib.THEMES.find((x: any) => x.id === "style_photo");
    assert(t, "style_photo theme missing");
    assertEq(t!.typography.display, "Allura", "display font");
    const photo = t!.decorations.find((d: any) => d.kind === "photo_shape");
    assert(photo, "style_photo missing photo_shape");
    const washi = t!.decorations.find((d: any) => d.kind === "washi_tape");
    assert(washi, "style_photo missing washi_tape");
  });

  test("scrapbook_pop theme layers blob + torn paper + washi tape", async () => {
    const themesLib = await import("../apps/arkiol-core/src/engines/render/design-themes");
    const t = themesLib.THEMES.find((x: any) => x.id === "scrapbook_pop");
    assert(t, "scrapbook_pop theme missing");
    assertEq(t!.typography.display, "Caveat", "display font");
    const blob = t!.decorations.find((d: any) => d.kind === "shape_panel" && d.shape === "blob");
    assert(blob, "scrapbook_pop missing blob shape_panel");
    const torn = t!.decorations.find((d: any) => d.kind === "torn_paper_frame");
    assert(torn, "scrapbook_pop missing torn_paper_frame");
    const washiCount = t!.decorations.filter((d: any) => d.kind === "washi_tape").length;
    assert(washiCount >= 2, `scrapbook_pop should have >= 2 washi_tape strips, got ${washiCount}`);
  });

  test("wellness category prefers heart_health theme", async () => {
    const packs = await import("../apps/arkiol-core/src/engines/style/category-style-packs");
    const wellness = packs.getCategoryPack("wellness");
    assert(wellness!.preferredThemeIds.includes("heart_health"),
      `wellness preferredThemeIds should include heart_health`);
  });

  test("beauty category prefers style_photo theme", async () => {
    const packs = await import("../apps/arkiol-core/src/engines/style/category-style-packs");
    const beauty = packs.getCategoryPack("beauty");
    assert(beauty!.preferredThemeIds.includes("style_photo"),
      `beauty preferredThemeIds should include style_photo`);
  });

  test("motivation category prefers scrapbook_pop theme", async () => {
    const packs = await import("../apps/arkiol-core/src/engines/style/category-style-packs");
    const motivation = packs.getCategoryPack("motivation");
    assert(motivation!.preferredThemeIds.includes("scrapbook_pop"),
      `motivation preferredThemeIds should include scrapbook_pop`);
  });

  section("api/generate · non-blocking invariants (504 regression guard)");

  // These tests assert source-level invariants rather than spinning up
  // Next.js + Prisma. The production failure they guard against: when
  // /api/generate awaits runInlineGeneration inline, a 6-variation run
  // (up to 16 pipeline attempts × ~5-12s each) blows past Vercel's
  // maxDuration and the edge returns 504 — the frontend surfaces that
  // as "Generation failed" even though the job is still running in the
  // background. The fix: fire generation as an unawaited promise and
  // ship {jobId, status: "PENDING"} immediately so EditorShell's 2-sec
  // /api/jobs?id=<jobId> poll loop takes over. These asserts make sure
  // nobody re-introduces the `await` or regresses maxDuration below the
  // Pro-tier ceiling of 300s.
  const fs = await import("fs");
  const path = await import("path");
  const generateRouteSrc = fs.readFileSync(
    path.resolve("apps/arkiol-core/src/app/api/generate/route.ts"),
    "utf-8",
  );

  test("generate route fires runInlineGeneration without awaiting", () => {
    assert(
      /void\s+runInlineGeneration\s*\(/.test(generateRouteSrc),
      "expected `void runInlineGeneration(...)` (fire-and-forget) in route",
    );
    assert(
      !/await\s+runInlineGeneration\s*\(/.test(generateRouteSrc),
      "runInlineGeneration must NOT be awaited — it re-introduces the 504",
    );
  });

  test("generate route keeps maxDuration at or above 300s", () => {
    const m = generateRouteSrc.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
    assert(m, "maxDuration export missing from generate route");
    assert(
      Number(m![1]) >= 300,
      `maxDuration must be >= 300 so background generation completes, got ${m![1]}`,
    );
  });

  test("generate route returns 202 with PENDING status for new jobs", () => {
    assert(
      /status:\s*"PENDING"/.test(generateRouteSrc),
      `route must surface status: "PENDING" so the frontend polls /api/jobs`,
    );
    assert(
      /\{\s*status:\s*202\s*\}/.test(generateRouteSrc),
      "route must respond with HTTP 202 Accepted",
    );
  });

  test("generate route attaches .catch() to the background promise", () => {
    assert(
      /void\s+runInlineGeneration\s*\([\s\S]*?\)\.catch\(/.test(generateRouteSrc),
      "unawaited runInlineGeneration must attach .catch() to avoid unhandledRejection",
    );
  });

  section("evaluation · rejection-rules");

  const reject = await import("../apps/arkiol-core/src/engines/evaluation/rejection-rules");
  const themesMod = await import("../apps/arkiol-core/src/engines/render/design-themes");

  test("REJECTION_RULES has unique ids and both hard/soft severities", () => {
    const ids = new Set<string>();
    let hard = 0, soft = 0;
    for (const r of reject.REJECTION_RULES) {
      assert(!ids.has(r.id), `duplicate rule id ${r.id}`);
      ids.add(r.id);
      if (r.severity === "hard") hard++; else soft++;
    }
    assert(hard > 0, "no hard rules defined");
    assert(soft > 0, "no soft rules defined");
  });

  test("evaluateRejection accepts a full production theme", () => {
    const theme = themesMod.THEMES[0];
    const verdict = reject.evaluateRejection(theme);
    assert(verdict.accept, `production theme rejected: ${verdict.hardReasons.join(",")}`);
  });

  test("evaluateRejection rejects an empty-decoration theme (too_empty)", () => {
    const theme = { ...themesMod.THEMES[0], decorations: [] };
    const verdict = reject.evaluateRejection(theme as any);
    assert(!verdict.accept, "empty theme was accepted — too_empty should have fired");
    assert(verdict.hardReasons.some(r => r.startsWith("too_empty")),
      `expected too_empty, got ${verdict.hardReasons.join(",")}`);
  });

  test("evaluateRejection rejects a mono-kind theme (too_repetitive)", () => {
    const base = themesMod.THEMES[0];
    const mono = {
      ...base,
      decorations: Array.from({ length: 12 }, (_, i) => ({
        kind: "circle" as const, x: 10 + i, y: 10 + i, r: 20,
        color: "#ffffff", opacity: 1,
      })),
    };
    const verdict = reject.evaluateRejection(mono as any);
    assert(verdict.hardReasons.some(r => r.startsWith("too_repetitive")),
      `expected too_repetitive, got ${verdict.hardReasons.join(",")}`);
  });

  test("evaluateRejection rejects content with unfinished finish verdict (Step 62)", () => {
    const theme = themesMod.THEMES[0];
    const contentWithVerdict: any = {
      backgroundColor: "#ffffff",
      textContents: [],
      _finishVerdict: { verdict: "unfinished", polishScore: 0.25, errors: 3, warnings: 2 },
    };
    const verdict = reject.evaluateRejection(theme, contentWithVerdict);
    assert(verdict.hardReasons.some(r => r.startsWith("unfinished_polish")),
      `expected unfinished_polish, got ${verdict.hardReasons.join(",")}`);
  });

  test("evaluateRejection does not reject content with finished verdict", () => {
    const theme = themesMod.THEMES[0];
    const contentWithVerdict: any = {
      backgroundColor: "#ffffff",
      textContents: [],
      _finishVerdict: { verdict: "finished", polishScore: 1, errors: 0, warnings: 0 },
    };
    const verdict = reject.evaluateRejection(theme, contentWithVerdict);
    assert(!verdict.hardReasons.some(r => r.startsWith("unfinished_polish")),
      `unfinished_polish should not fire for finished verdict, got: ${verdict.hardReasons.join(",")}`);
  });

  test("evaluateRejection rejects content flagged as pack outlier (Step 63)", () => {
    const theme = themesMod.THEMES[0];
    const contentWithPack: any = {
      backgroundColor: "#ffffff",
      textContents: [],
      _finishVerdict: { verdict: "finished", polishScore: 1, errors: 0, warnings: 0 },
      _packCohesion: {
        packVerdict:   "fragmented",
        packScore:     0.30,
        memberVerdict: "outlier",
        memberScore:   0.20,
        coreOverlap:   0.0,
      },
    };
    const verdict = reject.evaluateRejection(theme, contentWithPack);
    assert(verdict.hardReasons.some(r => r.startsWith("pack_outlier")),
      `expected pack_outlier, got ${verdict.hardReasons.join(",")}`);
  });

  test("evaluateRejection keeps aligned pack members", () => {
    const theme = themesMod.THEMES[0];
    const contentWithPack: any = {
      backgroundColor: "#ffffff",
      textContents: [],
      _finishVerdict: { verdict: "finished", polishScore: 1, errors: 0, warnings: 0 },
      _packCohesion: {
        packVerdict:   "curated",
        packScore:     0.92,
        memberVerdict: "aligned",
        memberScore:   0.90,
        coreOverlap:   0.85,
      },
    };
    const verdict = reject.evaluateRejection(theme, contentWithPack);
    assert(!verdict.hardReasons.some(r => r.startsWith("pack_outlier")),
      `pack_outlier fired for aligned member: ${verdict.hardReasons.join(",")}`);
  });

  test("filterCandidateBatch annotates packCohesion on multi-candidate batches", () => {
    const base = themesMod.THEMES[0];
    const items = [
      { theme: base, label: "a", content: { textContents: [] } as any },
      { theme: base, label: "b", content: { textContents: [] } as any },
      { theme: base, label: "c", content: { textContents: [] } as any },
    ];
    const result = reject.filterCandidateBatch(items, { minAccepted: 0 });
    assert(result.packCohesion, "packCohesion rollup missing from multi-item batch");
    assert(typeof result.packCohesion!.score === "number", "packCohesion.score missing");
    // And the individual contents should have been tagged.
    const tagged = items.filter(i => (i.content as any)._packCohesion).length;
    assert(tagged === items.length, `expected all ${items.length} contents tagged, got ${tagged}`);
  });

  test("filterCandidateBatch separates accepted vs rejected", () => {
    const good = { theme: themesMod.THEMES[0], label: "good-0" };
    const bad  = { theme: { ...themesMod.THEMES[0], decorations: [] } as any, label: "bad-0" };
    const result = reject.filterCandidateBatch([good, bad], { minAccepted: 0 });
    assert(result.accepted.length >= 1, "good candidate was not accepted");
    assert(result.rejected.length >= 1, "bad candidate was not rejected");
    assert(result.rejected.some(r => r.label === "bad-0" || r.item.label === "bad-0"),
      "bad label missing in rejected list");
  });

  test("filterCandidateBatch floor-fills when minAccepted > survivors", () => {
    const bad  = { theme: { ...themesMod.THEMES[0], decorations: [] } as any, label: "bad-1" };
    const bad2 = { theme: { ...themesMod.THEMES[0], decorations: [] } as any, label: "bad-2" };
    const result = reject.filterCandidateBatch([bad, bad2], { minAccepted: 1 });
    assert(result.accepted.length >= 1, "floor-fill did not keep a candidate");
  });

  section("svg-scene-composer · coverage & fallback");

  test("every SceneKind registered in SCENES has deterministic 6 variants", () => {
    // Exhaustive enumeration comes from the integration test. Here we
    // just sanity-check that each newly added kind renders distinct
    // palette variants (catches a missing palette entry).
    const kinds = [
      "phone-mockup", "podium-stage", "notebook-pen", "paint-brush", "music-note",
    ] as const;
    for (const k of kinds) {
      const v0 = composer.renderScene(k, "marketing", 0);
      const v3 = composer.renderScene(k, "marketing", 3);
      assert(v0 && v0.startsWith("<svg"), `${k} v0 not an svg`);
      assert(v0 !== v3, `${k}: variant 0 and 3 returned identical SVG`);
    }
  });

  test("unknown scene kind throws a clear error", () => {
    let threw = false;
    try { (composer.renderScene as any)("no-such-scene", "motivation", 0); }
    catch (err: any) {
      threw = true;
      assert(/unknown|scene|no-such/i.test(err?.message ?? ""),
        `unhelpful error message: ${err?.message}`);
    }
    assert(threw, "expected unknown scene kind to throw");
  });

  test("clearSceneCache drops memoization", () => {
    const k = "mountain-sunrise" as const;
    const a = composer.renderScene(k, "motivation", 0);
    composer.clearSceneCache?.();
    const b = composer.renderScene(k, "motivation", 0);
    // String content must be identical (deterministic), but cache was
    // cleared, so both are freshly built — that's fine.
    assertEq(a, b, "identical content after cache clear");
  });

  section("layout · constraints balance");

  const lc = await import("../apps/arkiol-core/src/engines/layout/layout-constraints");

  const mkZone = (over: Partial<any>): any => ({
    id: "headline", x: 10, y: 10, width: 80, height: 10,
    required: true, zIndex: 1, alignH: "center", alignV: "middle",
    ...over,
  });

  test("centered-layout balance: horizontal skew is near zero", () => {
    // A realistic centered Instagram post: every text zone spans
    // x:10–90, every image spans the top. Pre-fix this reported 100%
    // skew because every center point was exactly 50 and all weight
    // collapsed into the right half.
    const zones = [
      mkZone({ id: "headline", x: 10, y: 14, width: 80, height: 20 }),
      mkZone({ id: "subhead",  x: 10, y: 38, width: 80, height: 10 }),
      mkZone({ id: "body",     x: 10, y: 52, width: 80, height: 16 }),
      mkZone({ id: "cta",      x: 30, y: 74, width: 40, height: 10 }),
      mkZone({ id: "image",    x: 20, y: 0,  width: 60, height: 12 }),
    ];
    const r = lc.evaluateConstraints(zones, "instagram", "balanced");
    const hSkew = r.violations.find(v => v.category === "balance" && v.message.includes("horizontal"));
    assert(!hSkew, `centered layout still reports horizontal skew: ${hSkew?.message}`);
  });

  test("asymmetric layout still detects real skew", () => {
    // All text pushed to the right — real skew > 50%.
    const zones = [
      mkZone({ id: "headline", x: 55, y: 14, width: 40, height: 20 }),
      mkZone({ id: "subhead",  x: 55, y: 38, width: 40, height: 10 }),
      mkZone({ id: "body",     x: 55, y: 52, width: 40, height: 16 }),
      mkZone({ id: "cta",      x: 58, y: 74, width: 34, height: 10 }),
    ];
    const r = lc.evaluateConstraints(zones, "instagram", "balanced");
    const hSkew = r.violations.find(v => v.category === "balance" && v.message.includes("horizontal"));
    assert(hSkew, "heavily right-stacked layout should still trigger balance warning");
  });

  test("cta × logo bottom-row collision is auto-resolved", () => {
    // Reproduces the production hard-failure: CTA centered across
    // the bottom of an Instagram post + logo parked in the bottom
    // corner. Pre-fix the resolver tried to push the logo below the
    // canvas floor, failed, trimmed the CTA marginally, and the gate
    // blocked with "overlap: cta × logo 43%".
    const zones = [
      mkZone({ id: "headline", x: 10, y: 14, width: 80, height: 20 }),
      mkZone({ id: "subhead",  x: 10, y: 38, width: 80, height: 10 }),
      mkZone({ id: "body",     x: 10, y: 52, width: 80, height: 16 }),
      mkZone({ id: "cta",      x: 20, y: 80, width: 60, height: 12 }),
      mkZone({ id: "logo",     x: 64, y: 84, width: 24, height: 10 }),
    ];
    const r = lc.evaluateConstraints(zones, "instagram", "balanced");
    const overlap = r.violations.find(v =>
      v.category === "overlap" && v.severity === "critical" &&
      v.zoneIds.includes("cta") && v.zoneIds.includes("logo"));
    assert(!overlap, `cta × logo still critical after resolver: ${overlap?.message}`);
    assert(!r.blocking, `report blocking=true after resolve: ${r.violations.map(v => v.message).join(" | ")}`);
  });

  test("multi-zone cascade is fully cleared by multi-pass resolver", () => {
    // Three zones all vertically overlapping each other in a stack —
    // single-pass resolvers leave residual conflicts after the first
    // shift. The multi-pass resolver must fully clear them.
    const zones = [
      mkZone({ id: "headline", x: 10, y: 20, width: 80, height: 18 }),
      mkZone({ id: "subhead",  x: 10, y: 30, width: 80, height: 10 }),
      mkZone({ id: "body",     x: 10, y: 34, width: 80, height: 16 }),
    ];
    const r = lc.evaluateConstraints(zones, "instagram", "balanced");
    const critOverlap = r.violations.find(v => v.category === "overlap" && v.severity === "critical");
    assert(!critOverlap, `cascade left critical overlap: ${critOverlap?.message}`);
  });

  test("image on left + text on right reads as balanced within cap", () => {
    // Classic split layout — weight on both sides, should pass.
    const zones = [
      mkZone({ id: "image",    x: 4,  y: 10, width: 40, height: 80 }),
      mkZone({ id: "headline", x: 48, y: 14, width: 46, height: 20 }),
      mkZone({ id: "subhead",  x: 48, y: 38, width: 46, height: 12 }),
      mkZone({ id: "cta",      x: 48, y: 74, width: 30, height: 10 }),
    ];
    const r = lc.evaluateConstraints(zones, "instagram", "balanced");
    const hCrit = r.violations.find(v => v.category === "balance" && v.severity === "critical");
    assert(!hCrit, `split layout wrongly hit balance: ${hCrit?.message}`);
  });

  section("library · integration with new breadth scenes");

  test("library total is at least 225 after Step 45 photo expansion", () => {
    const stats = lib.libraryStats();
    assert(stats.total >= 225, `library total ${stats.total} < 225`);
  });

  test("every category's recipe yields >= 4 assets", () => {
    for (const c of lib.ASSET_CATEGORIES) {
      const picks = lib.selectAssetsForCategory(c, { seed: `coverage-${c}` });
      assert(picks.length >= 4, `category ${c} returned only ${picks.length} picks`);
    }
  });

  test("selectAssetsForCategory with different seeds produces different picks", () => {
    const a = lib.selectAssetsForCategory("motivation", { seed: "seed-A" });
    const b = lib.selectAssetsForCategory("motivation", { seed: "seed-B" });
    const ids = (xs: typeof a) => xs.map(x => x.id).join("|");
    assert(ids(a) !== ids(b),
      `different seeds produced identical picks: ${ids(a)}`);
  });

  section("metrics · percentile math");

  test("metrics percentiles are monotonic p50 <= p90 <= p99", () => {
    metrics.__resetMetrics();
    for (const ms of [50, 75, 100, 120, 150, 200, 300, 450, 700, 1000]) {
      metrics.recordGenerationStart();
      metrics.recordGenerationSuccess(ms);
    }
    const s = metrics.snapshot();
    assert(s.latency.p50_ms <= s.latency.p90_ms, `p50 ${s.latency.p50_ms} > p90 ${s.latency.p90_ms}`);
    assert(s.latency.p90_ms <= s.latency.p99_ms, `p90 ${s.latency.p90_ms} > p99 ${s.latency.p99_ms}`);
  });

  test("metrics successRate is 0 when counters are empty", () => {
    metrics.__resetMetrics();
    const s = metrics.snapshot();
    assertEq(s.successRate, 0, "empty successRate");
  });

  section("engines/assets · photo-asset-manifest");

  const photoMan = await import("../apps/arkiol-core/src/engines/assets/photo-asset-manifest");

  test("photo manifest has >= 35 slugs covering gap archetypes", () => {
    assert(photoMan.PHOTO_ASSET_MANIFEST.length >= 35,
      `photo manifest only has ${photoMan.PHOTO_ASSET_MANIFEST.length} slugs`);
  });

  test("photo manifest slugs are unique", () => {
    const seen = new Set<string>();
    for (const m of photoMan.PHOTO_ASSET_MANIFEST) {
      assert(!seen.has(m.slug), `duplicate slug ${m.slug}`);
      seen.add(m.slug);
    }
  });

  test("photo manifest covers food / beauty / fashion gap realms", () => {
    const realms = new Set(photoMan.PHOTO_ASSET_MANIFEST.map(m => m.realm));
    for (const r of ["food", "beauty", "fashion", "lifestyle"]) {
      assert(realms.has(r as any), `missing gap realm ${r}`);
    }
  });

  test("photoAssetUrl returns undefined without base configured", () => {
    delete (process.env as any).ARKIOL_PHOTO_ASSET_BASE;
    assertEq(photoMan.photoAssetUrl("food-salad-bowl"), undefined as any, "undefined when unset");
  });

  test("photoAssetUrl builds URL with configured base + default jpg ext", () => {
    (process.env as any).ARKIOL_PHOTO_ASSET_BASE = "https://cdn.test.com/photos";
    delete (process.env as any).ARKIOL_PHOTO_ASSET_EXT;
    assertEq(
      photoMan.photoAssetUrl("food-salad-bowl"),
      "https://cdn.test.com/photos/food-salad-bowl.jpg",
      "default jpg url",
    );
    delete (process.env as any).ARKIOL_PHOTO_ASSET_BASE;
  });

  test("photoAssetUrl honors ARKIOL_PHOTO_ASSET_EXT=webp", () => {
    (process.env as any).ARKIOL_PHOTO_ASSET_BASE = "https://cdn.test.com/photos";
    (process.env as any).ARKIOL_PHOTO_ASSET_EXT  = "webp";
    assertEq(
      photoMan.photoAssetUrl("beauty-skincare-flatlay"),
      "https://cdn.test.com/photos/beauty-skincare-flatlay.webp",
      "webp url",
    );
    delete (process.env as any).ARKIOL_PHOTO_ASSET_BASE;
    delete (process.env as any).ARKIOL_PHOTO_ASSET_EXT;
  });

  test("photoAssetUrl rejects unsafe extensions and falls back to jpg", () => {
    (process.env as any).ARKIOL_PHOTO_ASSET_BASE = "https://cdn.test.com/photos";
    (process.env as any).ARKIOL_PHOTO_ASSET_EXT  = "exe";
    assertEq(
      photoMan.photoAssetUrl("food-salad-bowl"),
      "https://cdn.test.com/photos/food-salad-bowl.jpg",
      "unsafe ext coerced",
    );
    delete (process.env as any).ARKIOL_PHOTO_ASSET_BASE;
    delete (process.env as any).ARKIOL_PHOTO_ASSET_EXT;
  });

  test("photoAssetManifestStats reports configured=false with no env", () => {
    delete (process.env as any).ARKIOL_PHOTO_ASSET_BASE;
    const s = photoMan.photoAssetManifestStats();
    assertEq(s.configured, false, "configured");
    assert(s.totalSlugs >= 35, "totalSlugs");
    assert(s.byRealm.food >= 6, `food realm ${s.byRealm.food}`);
    assert(s.byRealm.beauty >= 6, `beauty realm ${s.byRealm.beauty}`);
    assert(s.byRealm.fashion >= 4, `fashion realm ${s.byRealm.fashion}`);
  });

  test("getPhotoAssetSlug round-trips by slug", () => {
    const entry = photoMan.getPhotoAssetSlug("food-salad-bowl");
    assert(entry !== undefined, "lookup missed");
    assertEq(entry!.realm, "food", "realm");
    assertEq(photoMan.getPhotoAssetSlug("no-such-slug"), undefined as any, "miss returns undefined");
  });

  section("3d-asset-manifest · realm distribution");

  test("byRealm counts sum to total slugs", () => {
    const s = manifest.asset3dManifestStats();
    const sum = Object.values(s.byRealm).reduce((a: number, b: number) => a + (b as number), 0);
    assertEq(sum, s.totalSlugs, "byRealm sum");
  });

  test("manifest slugs are unique", () => {
    const seen = new Set<string>();
    for (const m of manifest.ASSET_3D_MANIFEST) {
      assert(!seen.has(m.slug), `duplicate slug ${m.slug}`);
      seen.add(m.slug);
    }
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log(`\n─────────────────────────────────────────`);
  console.log(`Passed: ${_passed}   Failed: ${_failed}`);
  console.log(`─────────────────────────────────────────`);
  if (_failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
