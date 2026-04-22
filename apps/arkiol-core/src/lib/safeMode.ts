// src/lib/safeMode.ts
//
// Safe-mode detection for the inline generation pipeline.
//
// Safe mode is the pessimistic runtime profile the pipeline should use
// when the serverless platform doesn't give us strong lifetime
// guarantees. The richer the pipeline has become — photo integration,
// scene composition, decorative expansions, per-variation brand
// extraction — the less forgiving Vercel's serverless limits are of
// "just fire 6 concurrent sharp renders and hope for the best".
//
// When we're in safe mode we:
//   • Cap CONCURRENCY lower (fewer concurrent sharp renders)
//   • Cap MAX_ATTEMPTS lower (prefer fewer stronger attempts over
//     large over-generate-and-filter fan-outs)
//   • Emit heartbeats more aggressively (already handled by
//     inlineGenerate's stage+pulse helper)
//   • Never allow the pipeline to exceed the serverless maxDuration
//
// The three triggers:
//
//   1. ARKIOL_SAFE_MODE=1 env var — explicit opt-in. Useful for
//      flipping safe mode on temporarily during an incident without
//      touching code.
//
//   2. !detectCapabilities().queue — no BullMQ queue means there's no
//      long-lived worker process to absorb heavy renders. The inline
//      path runs INSIDE the HTTP request lifecycle, where every extra
//      second of work risks a container kill.
//
//   3. workerMode === "fire_and_forget" — the weakest durability tier.
//      No Vercel waitUntil primitive is available; the response has
//      been flushed and the container is already on borrowed time.
//      Running at full tilt in this mode is asking for a mid-render
//      kill.
//
// This module is pure + boundary-light so it can be imported from both
// the inline runner and the admin dashboard. It has no DB access.

import type { WorkerMode } from "./jobDiagnostics";

export interface SafeModeVerdict {
  /** True when the pipeline should run with reduced load. */
  safeMode: boolean;
  /** The specific trigger(s) that activated safe mode. Multiple
   *  triggers can fire at once — all are reported so ops can see
   *  whether flipping one off would exit safe mode. */
  reasons:  Array<
    | "env_var"           // ARKIOL_SAFE_MODE=1
    | "no_queue"          // no BullMQ capability
    | "fire_and_forget"   // weakest durability tier active
  >;
}

/** Inspect the runtime environment + worker mode and decide whether
 *  safe mode should be on for this run. */
export function detectSafeMode(workerMode: WorkerMode | undefined): SafeModeVerdict {
  const reasons: SafeModeVerdict["reasons"] = [];

  // (1) Explicit env opt-in. Pulled at call time (not module load)
  // so an ops flag flip takes effect on the next request.
  if ((process.env.ARKIOL_SAFE_MODE ?? "").trim() === "1") {
    reasons.push("env_var");
  }

  // (2) No BullMQ capability — means no long-lived worker is available
  // to absorb heavy work; every request runs the inline path.
  //
  // `detectCapabilities` is lazy-required so this module can also be
  // imported from test harnesses / client-side code that don't have
  // `@arkiol/shared` on their module-resolution path.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { detectCapabilities } = require("@arkiol/shared") as { detectCapabilities: () => { queue?: boolean } };
    if (!detectCapabilities().queue) reasons.push("no_queue");
  } catch { /* capability probe failed — assume safe */ reasons.push("no_queue"); }

  // (3) Weakest durability tier. next_after and vercel_waitUntil keep
  // the container alive past response-flush; fire_and_forget doesn't.
  if (workerMode === "fire_and_forget") {
    reasons.push("fire_and_forget");
  }

  return { safeMode: reasons.length > 0, reasons };
}

/** Resolve the runtime knobs the inline pipeline should use for this
 *  run. totalVariations is the user's requested variation count.
 *  Safe-mode values are deliberately conservative — prefer a few
 *  high-quality candidates over a big over-generate fan-out. */
export function resolveRuntimeLimits(opts: {
  safeMode:         boolean;
  totalVariations:  number;
}): {
  concurrency:  number;
  maxAttempts:  number;
} {
  const v = Math.max(1, opts.totalVariations);
  if (opts.safeMode) {
    return {
      // 2 concurrent sharps keep libvips + the main-thread pulse
      // breathing room even on cold-start-heavy serverless
      // containers. Any higher and we re-introduce the main-thread
      // starvation symptoms from earlier steps.
      concurrency: 2,
      // `v + 1` attempts — one headroom for rejection-and-retry on
      // top of every requested variation. Capped at 10 to match the
      // non-safe ceiling; floored at 3 so a single-variation request
      // still gets real over-generation. Gives ~30% fewer attempts
      // than non-safe mode at v=3 (4 vs 6) and ~50% fewer at v=6
      // (7 vs 10), while always covering every variation at least
      // once.
      maxAttempts: Math.min(Math.max(v + 1, 3), 10),
    };
  }
  // Non-safe (queue-backed) profile — prior generation budget.
  return {
    concurrency: Math.min(4, v + 1),
    maxAttempts: Math.min(Math.max(v * 2, v + 3), 10),
  };
}
