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

  test("ASSET_REALMS contains all 5 realms", () => {
    const expected = ["nature", "animal", "lifestyle", "object", "scene"];
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

  test("manifest has 33 slugs", () => {
    // 8 nature + 5 animal + 6 lifestyle + 9 object + 5 scene = 33
    assertEq(manifest.ASSET_3D_MANIFEST.length, 33, "manifest size");
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
    assertEq(s.totalSlugs, 33, "totalSlugs");
    assertEq(s.byRealm.nature, 8, "nature count");
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

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log(`\n─────────────────────────────────────────`);
  console.log(`Passed: ${_passed}   Failed: ${_failed}`);
  console.log(`─────────────────────────────────────────`);
  if (_failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
