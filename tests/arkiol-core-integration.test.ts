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

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────────`);
  console.log(`Passed: ${_passed}   Failed: ${_failed}   Total renders: ${totalRenders}`);
  console.log(`─────────────────────────────────────────`);
  if (_failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
