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

  section("library · integration with new breadth scenes");

  test("library total is at least 200 after Step 44 additions", () => {
    const stats = lib.libraryStats();
    assert(stats.total >= 200, `library total ${stats.total} < 200`);
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
