/**
 * arkiol-core — micro-benchmark. Validates the speed claims:
 *   - Scene composer throughput (cold + warm cache)
 *   - Asset-library selection throughput
 *   - Two-phase parallel gallery wall-clock simulation
 *
 *   npx tsx tests/arkiol-core-benchmark.ts
 */

function ns(): number { return Number(process.hrtime.bigint()); }
function msSince(start: number): number { return (ns() - start) / 1e6; }

async function run() {
  const composer = await import("../apps/arkiol-core/src/engines/assets/svg-scene-composer");
  const lib      = await import("../apps/arkiol-core/src/lib/asset-library");

  const sceneKinds = [
    "mountain-sunrise", "plant-potted", "heart-centered", "dumbbell-rack",
    "trophy-podium", "books-stack", "water-bottle", "paper-plane",
    "idea-bulb", "target-arrow", "megaphone-launch", "leaf-scene",
    "cloudscape", "polaroid-mountain", "floral-wreath", "workout-scene",
    "script-banner", "confidence-spark", "diet-plate",
    "yoga-pose", "coffee-mug", "calendar-day", "brain-sparks",
    "confetti-burst", "map-compass",
  ] as const;
  const categories = lib.ASSET_CATEGORIES;

  // ─── Bench 1: cold cache — first render per (kind, category, variant) ───
  composer.clearSceneCache?.();
  {
    const iterations = 500;
    const start = ns();
    for (let i = 0; i < iterations; i++) {
      const k = sceneKinds[i % sceneKinds.length];
      const c = categories[i % categories.length];
      const v = i % 6;
      composer.renderScene(k as any, c, v);
    }
    const ms = msSince(start);
    const perRender = ms / iterations;
    console.log(`▸ Cold-cache scene render`);
    console.log(`  ${iterations} renders in ${ms.toFixed(1)}ms`);
    console.log(`  avg ${perRender.toFixed(3)}ms / render → ${Math.round(1000 / perRender)} renders/sec`);
  }

  // ─── Bench 2: warm cache — same (kind, category, variant) repeats ───────
  {
    const iterations = 100_000;
    const start = ns();
    for (let i = 0; i < iterations; i++) {
      composer.renderScene("mountain-sunrise", "motivation", 0);
    }
    const ms = msSince(start);
    const perRender = ms / iterations;
    console.log(`\n▸ Warm-cache scene render (memoized)`);
    console.log(`  ${iterations.toLocaleString()} renders in ${ms.toFixed(1)}ms`);
    console.log(`  avg ${(perRender * 1000).toFixed(1)}ns / render → ${Math.round(1000 / perRender).toLocaleString()} renders/sec`);
  }

  // ─── Bench 3: selectAssetsForCategory ───────────────────────────────────
  {
    const iterations = 2000;
    const start = ns();
    for (let i = 0; i < iterations; i++) {
      const c = categories[i % categories.length];
      lib.selectAssetsForCategory(c, { seed: `bench-${i}` });
    }
    const ms = msSince(start);
    console.log(`\n▸ selectAssetsForCategory throughput`);
    console.log(`  ${iterations} picks in ${ms.toFixed(1)}ms`);
    console.log(`  avg ${(ms / iterations).toFixed(3)}ms / pick → ${Math.round(1000 / (ms / iterations))} picks/sec`);
  }

  // ─── Bench 4: simulated two-phase parallel gallery vs sequential ────────
  // renderFn simulates a ~40ms pipeline stage (composition + theme
  // selection + quality gate). In a real worker each render is closer
  // to 200-500ms; the ratio between sequential and parallel is what
  // we're measuring here.
  const simulatedRender = (ms: number) => new Promise<{ packStyleSnapshot?: unknown }>(
    resolve => setTimeout(() => resolve({}), ms),
  );

  const N = 6;
  const perRenderMs = 40;

  // Sequential
  {
    const start = ns();
    for (let i = 0; i < N; i++) await simulatedRender(perRenderMs);
    const ms = msSince(start);
    console.log(`\n▸ Sequential 6-candidate gallery (baseline)`);
    console.log(`  wall-clock: ${ms.toFixed(0)}ms (6 × ~${perRenderMs}ms)`);
  }

  // Two-phase parallel (Step 42 coordinator shape)
  {
    const start = ns();
    await simulatedRender(perRenderMs);                                // phase A: 1 render
    await Promise.all(Array.from({ length: N - 1 }, () => simulatedRender(perRenderMs))); // phase B: N-1 in parallel
    const ms = msSince(start);
    const seqMs = N * perRenderMs;
    const speedup = (seqMs / ms).toFixed(2);
    console.log(`\n▸ Two-phase parallel 6-candidate gallery`);
    console.log(`  wall-clock: ${ms.toFixed(0)}ms`);
    console.log(`  speedup vs sequential: ${speedup}× (theoretical ceiling 3×)`);
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`Benchmarks complete`);
  console.log(`─────────────────────────────────────────`);
}

run().catch(err => { console.error(err); process.exit(1); });
