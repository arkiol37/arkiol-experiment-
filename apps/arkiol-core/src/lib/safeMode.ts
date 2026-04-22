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
    | "vercel"            // running on Vercel (process.env.VERCEL=1)
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

  // (2) Vercel deployment marker. Production failures showed that
  // even with all the heartbeat + concurrency fixes in place,
  // Vercel's serverless containers can be killed mid-render under
  // heavy load. Treating Vercel as a safe-mode trigger means the
  // platform automatically gets the conservative profile (sequential
  // renders, no over-generation, tighter time budget) regardless of
  // whether queue capability happens to be configured. The override
  // path is still available: a deploy that knows it has a real
  // dedicated worker can flip ARKIOL_DISABLE_VERCEL_SAFE_MODE=1 to
  // opt out.
  const isVercel =
    (process.env.VERCEL ?? "") === "1" ||
    (process.env.VERCEL_ENV ?? "") !== "";
  const vercelOptOut =
    (process.env.ARKIOL_DISABLE_VERCEL_SAFE_MODE ?? "").trim() === "1";
  if (isVercel && !vercelOptOut) {
    reasons.push("vercel");
  }

  // (3) No BullMQ capability — means no long-lived worker is available
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

  // (4) Weakest durability tier. next_after and vercel_waitUntil keep
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
      // Sequential renders (concurrency 1) eliminate the libvips
      // worker-pool saturation that has been the root cause of the
      // recurring "no worker heartbeat for 91s" failures on Vercel.
      // Yes, this is slower; the trade is a job that ALWAYS finishes
      // vs a faster job that sometimes gets killed mid-render.
      concurrency: 1,
      // Exactly `v` attempts — no over-generation. The pipeline's
      // floor-fill path (already in inlineGenerate) handles the
      // rare case where some attempts get rejected by the quality
      // gate, by promoting the strongest rejected candidates into
      // the gallery. Floored at 2 so even single-variation requests
      // get one retry attempt. Capped at 6 so the worst case
      // (6 sequential renders × ~30s each) still finishes inside
      // the safe-mode time budget.
      maxAttempts: Math.min(Math.max(v, 2), 6),
    };
  }
  // Non-safe (queue-backed) profile — prior generation budget.
  return {
    concurrency: Math.min(4, v + 1),
    maxAttempts: Math.min(Math.max(v * 2, v + 3), 10),
  };
}

/** Time budget the inline pipeline gives itself before it stops
 *  launching new attempts. Safe mode shaves the budget so we leave
 *  more headroom inside Vercel's 300s maxDuration — a partial-result
 *  job is better than a SIGKILL'd one. */
export function resolveTimeBudgetMs(safeMode: boolean): number {
  return safeMode ? 180_000 : 240_000;
}
