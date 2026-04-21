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
