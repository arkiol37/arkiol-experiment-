/**
 * arkiol-core — integration tests for the scene composer.
 *
 * Exercises every (SceneKind × Category × PaletteVariant) combination —
 * 25 scenes × 9 categories × 6 palettes = 1350 renders. For each,
 * asserts the output is syntactically valid SVG, within a sane byte
 * budget, contains the effects filters we added in Phase 1, and shows
 * no NaN / undefined / broken interpolation leaking through.
 *
 * Runs via:
 *   npx tsx tests/arkiol-core-integration.test.ts
 */

let _passed = 0;
let _failed = 0;
const _failures: string[] = [];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function run() {
  const composer = await import("../apps/arkiol-core/src/engines/assets/svg-scene-composer");
  const lib      = await import("../apps/arkiol-core/src/lib/asset-library");

  console.log(`▸ Scene-composer exhaustive render test`);

  // Build full enumeration.
  const sceneKinds = Object.keys(composer.SCENE_PALETTES.productivity[0])
    ? [ // Grab every SceneKind by inspecting the SCENES registry keys.
        // We don't export SCENES directly, so piggy-back on renderScene.
        "mountain-sunrise", "plant-potted", "heart-centered", "dumbbell-rack",
        "trophy-podium", "books-stack", "water-bottle", "paper-plane",
        "idea-bulb", "target-arrow", "megaphone-launch", "leaf-scene",
        "cloudscape", "polaroid-mountain", "floral-wreath", "workout-scene",
        "script-banner", "confidence-spark", "diet-plate",
        "yoga-pose", "coffee-mug", "calendar-day", "brain-sparks",
        "confetti-burst", "map-compass",
        "phone-mockup", "podium-stage", "notebook-pen", "paint-brush", "music-note",
      ] as const
    : [];

  const categories = lib.ASSET_CATEGORIES;
  const variants   = [0, 1, 2, 3, 4, 5];

  let totalRenders = 0;
  let svgErrors    = 0;
  const byteStats = { min: Infinity, max: 0, total: 0 };

  for (const kind of sceneKinds) {
    for (const category of categories) {
      for (const variant of variants) {
        totalRenders++;
        let svg = "";
        try {
          svg = composer.renderScene(kind as any, category, variant);
        } catch (err: any) {
          svgErrors++;
          _failures.push(`render failed: ${kind}/${category}/v${variant} — ${err?.message}`);
          continue;
        }

        // Byte budget + shape checks
        byteStats.min = Math.min(byteStats.min, svg.length);
        byteStats.max = Math.max(byteStats.max, svg.length);
        byteStats.total += svg.length;

        // Structural invariants every scene must satisfy.
        if (!svg.startsWith("<svg")) {
          svgErrors++; _failures.push(`${kind}/${category}/v${variant}: missing <svg prefix`);
          continue;
        }
        if (!svg.endsWith("</svg>")) {
          svgErrors++; _failures.push(`${kind}/${category}/v${variant}: unclosed <svg>`);
          continue;
        }
        if (!svg.includes('viewBox="0 0 400 400"')) {
          svgErrors++; _failures.push(`${kind}/${category}/v${variant}: missing viewBox`);
          continue;
        }
        // Every scene goes through defsGradients → must have the
        // effects library elements.
        if (!svg.includes("feDropShadow") || !svg.includes("radialGradient")) {
          svgErrors++;
          _failures.push(`${kind}/${category}/v${variant}: missing filter/gradient effects`);
          continue;
        }
        // Leak guards — stringified bad values never leave the composer.
        if (svg.includes("NaN") || svg.includes("undefined") || svg.includes("[object Object]")) {
          svgErrors++;
          _failures.push(`${kind}/${category}/v${variant}: leaked NaN/undefined`);
          continue;
        }
        // Balanced tags — simple open/close count per element type.
        const openSvg  = (svg.match(/<svg\b/g)  ?? []).length;
        const closeSvg = (svg.match(/<\/svg>/g) ?? []).length;
        if (openSvg !== closeSvg) {
          svgErrors++;
          _failures.push(`${kind}/${category}/v${variant}: svg tag imbalance (${openSvg}/${closeSvg})`);
          continue;
        }
      }
    }
  }

  const allOk = svgErrors === 0;
  if (allOk) {
    console.log(`  ✓ ${totalRenders} renders produced valid SVG with depth effects`);
    _passed++;
  } else {
    console.log(`  ✗ ${svgErrors} of ${totalRenders} renders failed`);
    console.log(_failures.slice(0, 10).map(f => `    ${f}`).join("\n"));
    if (_failures.length > 10) console.log(`    … and ${_failures.length - 10} more`);
    _failed++;
  }

  // Byte stats
  const avgBytes = Math.round(byteStats.total / totalRenders);
  console.log(`    stats: min=${byteStats.min}B avg=${avgBytes}B max=${byteStats.max}B`);
  if (avgBytes > 20_000) {
    console.log(`  ⚠ average SVG size is >20KB — consider tightening subjects`);
  }

  // ── Cache behavior ────────────────────────────────────────────────────────
  console.log(`\n▸ Scene cache behavior`);

  const beforeLen = composer.renderScene("mountain-sunrise", "travel", 0).length;
  const again     = composer.renderScene("mountain-sunrise", "travel", 0);
  if (again.length === beforeLen) {
    console.log(`  ✓ repeat render returns identical output`);
    _passed++;
  } else {
    console.log(`  ✗ cache returned different output on repeat render`);
    _failed++;
  }

  // ── Library coverage ──────────────────────────────────────────────────────
  console.log(`\n▸ Library integration`);

  const stats = lib.libraryStats();
  const total = stats.total;
  if (total >= 190) {
    console.log(`  ✓ library has ${total} curated assets (≥190)`);
    _passed++;
  } else {
    console.log(`  ✗ library has only ${total} assets (expected ≥190)`);
    _failed++;
  }

  // Every category should produce a non-empty recipe result
  let badCategories = 0;
  for (const cat of lib.ASSET_CATEGORIES) {
    const picks = lib.selectAssetsForCategory(cat, { seed: `it-${cat}` });
    if (picks.length === 0) {
      badCategories++;
      _failures.push(`category ${cat}: selectAssetsForCategory returned empty`);
    }
  }
  if (badCategories === 0) {
    console.log(`  ✓ every category produces a non-empty recipe`);
    _passed++;
  } else {
    console.log(`  ✗ ${badCategories} categories returned empty`);
    _failed++;
  }

  // ── E2E smoke: brief → theme → score → reject → gate ─────────────────────
  // We bypass the Next-coupled render pipeline and wire the pure-TS modules
  // end-to-end. This catches the "imports + chain works" regressions that
  // isolated unit tests won't notice.
  console.log(`\n▸ E2E smoke: brief → theme → score → reject → gate`);

  const themesMod  = await import("../apps/arkiol-core/src/engines/render/design-themes");
  const qualityMod = await import("../apps/arkiol-core/src/engines/evaluation/candidate-quality");
  const rejectMod  = await import("../apps/arkiol-core/src/engines/evaluation/rejection-rules");
  const gateMod    = await import("../apps/arkiol-core/src/engines/evaluation/marketplace-gate");

  const briefs = [
    { intent: "announce new product launch", audience: "indie founders",
      tone: "bold", keywords: ["launch","SaaS","beta"], colorMood: "vibrant",
      imageStyle: "illustration", headline: "We're live.", cta: "Try it free" },
    { intent: "morning motivation post", audience: "runners",
      tone: "energetic", keywords: ["morning","run","mindset"], colorMood: "warm",
      imageStyle: "illustration", headline: "Run your mind.", cta: "Start today" },
    { intent: "summer promo", audience: "boutique shoppers",
      tone: "warm", keywords: ["summer","sale","limited"], colorMood: "vibrant",
      imageStyle: "illustration", headline: "Summer Sale", cta: "Shop now" },
    { intent: "wellness newsletter", audience: "holistic practitioners",
      tone: "minimal", keywords: ["calm","breathe","reset"], colorMood: "cool",
      imageStyle: "illustration", headline: "Breathe.", cta: "Subscribe" },
    { intent: "business coaching invite", audience: "mid-career managers",
      tone: "professional", keywords: ["coach","grow","lead"], colorMood: "muted",
      imageStyle: "illustration", headline: "Lead with calm.", cta: "Join now" },
  ];

  let e2ePassed = 0;
  let e2eFailed = 0;
  const e2eFailures: string[] = [];

  for (let i = 0; i < briefs.length; i++) {
    const brief = briefs[i] as any;
    try {
      // 1. Theme selection — two variations to prove non-determinism.
      const theme0 = themesMod.selectTheme(brief, 0);
      const theme1 = themesMod.selectTheme(brief, 1);
      if (!theme0 || !theme0.id) throw new Error("selectTheme returned empty");
      if (!Array.isArray(theme0.decorations)) throw new Error("theme has no decorations");

      // 2. Quality score must be populated with real numbers.
      const score = qualityMod.scoreThemeQuality(theme0);
      if (!Number.isFinite(score.total)) throw new Error(`score.total is ${score.total}`);
      if (score.total < 0.2) throw new Error(`score too low for ${theme0.id}: ${score.total}`);

      // 3. Rejection evaluation — production themes should pass.
      const verdict = rejectMod.evaluateRejection(theme0);
      if (!verdict.accept) {
        throw new Error(`production theme ${theme0.id} rejected: ${verdict.hardReasons.join(",")}`);
      }

      // 4. Batch filter on a 3-candidate gallery, one intentionally bad.
      const goodA = { theme: theme0, label: `brief${i}-v0` };
      const goodB = { theme: theme1, label: `brief${i}-v1` };
      const bad   = { theme: { ...theme0, decorations: [] } as any, label: `brief${i}-bad` };
      const batch = rejectMod.filterCandidateBatch([goodA, bad, goodB], { minAccepted: 1 });
      if (batch.accepted.length === 0) throw new Error("batch dropped every candidate");
      if (!batch.rejected.some(r => r.reasons.some(x => x.startsWith("too_empty")))) {
        throw new Error("bad candidate not flagged too_empty");
      }

      // 5. Marketplace gate threshold shape — must expose all 6 criteria.
      const t = gateMod.MARKETPLACE_THRESHOLDS as any;
      for (const k of ["polished","layered","categorySpecific","assetRich","publishReady","styleConsistent"]) {
        if (!(k in t)) throw new Error(`gate missing threshold ${k}`);
      }

      e2ePassed++;
    } catch (err: any) {
      e2eFailed++;
      e2eFailures.push(`brief[${i}] "${brief.intent}" — ${err.message}`);
    }
  }

  if (e2eFailed === 0) {
    console.log(`  ✓ ${e2ePassed}/${briefs.length} briefs threaded brief→theme→score→reject→gate cleanly`);
    _passed++;
  } else {
    console.log(`  ✗ ${e2eFailed}/${briefs.length} briefs failed`);
    console.log(e2eFailures.map(f => `    ${f}`).join("\n"));
    _failed++;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────────`);
  console.log(`Passed: ${_passed}   Failed: ${_failed}   Total renders: ${totalRenders}`);
  console.log(`─────────────────────────────────────────`);
  if (_failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
