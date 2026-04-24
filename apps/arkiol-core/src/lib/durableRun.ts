// src/lib/durableRun.ts
//
// Durable background execution for inline generation.
//
// The production failure this module exists to prevent:
//
//   1. Request hits /api/generate.
//   2. Route creates a PENDING job and kicks off `runInlineGeneration`
//      as `void runInlineGeneration(...)`.
//   3. Route returns HTTP 202 {status:"PENDING"} so the frontend can poll.
//   4. Vercel considers the response "done" and — because the returned
//      promise is unawaited — may terminate the serverless container
//      BEFORE the background work reaches `status:"RUNNING"`.
//   5. Job sits in the DB at PENDING, startedAt=null, forever.
//      The stale watchdog in /api/jobs only fires after 5 minutes, and
//      even then it just flips to FAILED — the user's credits are gone
//      and they get an error for a job that literally never ran.
//
// Fix: use the platform's sanctioned "waitUntil" primitive so the
// runtime knows the response has shipped but the container must stay
// alive until the background promise resolves.
//
// Order of preference:
//   1. Next.js 14.2+ `unstable_after` / stable `after` from "next/server"
//      — integrated with Vercel's platform waitUntil and survives
//      response flush.
//   2. `@vercel/functions` `waitUntil` — raw Vercel primitive; works
//      when Next.js doesn't export `after` yet.
//   3. Fire-and-forget `void promise` — last resort. The job row's
//      stale watchdog + poller auto-resume cover this case.
//
// This module ALWAYS returns which strategy it used, so the route
// handler can include `durability` in the response for observability.

// NOTE: this module is dynamically `require()`d from inlineGenerate.ts at
// runtime for the auto-retry path. It must not crash on import outside
// of Next.js — the `next/server` and `@vercel/functions` lookups below
// are wrapped in try/catch so this file is safe to require under plain
// Node (apps/render-backend). Do not add `import "server-only"` here.
import { runInlineGeneration, type InlineGenerateParams } from "./inlineGenerate";

export type DurableStrategy =
  /** Next.js 14.2+ `unstable_after` / `after` — preferred on Vercel. */
  | "next_after"
  /** Raw Vercel platform primitive — used when Next didn't expose `after`. */
  | "vercel_waitUntil"
  /** Unawaited promise — only used when neither primitive is available. */
  | "fire_and_forget";

export interface DurableRunResult {
  strategy: DurableStrategy;
}

/** Try Next.js's after / unstable_after. Returns true if the work was
 *  scheduled; false if the import failed or the export isn't there
 *  (older Next, different runtime, etc.). */
function tryNextAfter(work: () => Promise<void>): boolean {
  try {
    // Wrapped in try/require so this module can be imported in test
    // contexts where "next/server" isn't available.
    const mod = require("next/server") as Record<string, unknown>;
    const after =
      (typeof mod.after === "function" && mod.after) ||
      (typeof mod.unstable_after === "function" && mod.unstable_after);
    if (after) {
      (after as (fn: () => unknown) => void)(() => work());
      return true;
    }
  } catch { /* older Next, not installed, or not in a request scope */ }
  return false;
}

/** Try @vercel/functions waitUntil. Not a hard dep — present on Vercel
 *  deploys, absent in CI / local tests.
 *
 *  We resolve the module name through an indirect binding so webpack's
 *  static analyser can't trace the import. Without this indirection,
 *  production builds emit a noisy "Module not found: '@vercel/functions'"
 *  warning on every deploy, because webpack doesn't know the package
 *  will be present at runtime. The try/catch still catches the real
 *  "module not found" at execution time when the package genuinely
 *  isn't installed. */
function tryVercelWaitUntil(work: () => Promise<void>): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req: NodeRequire = eval("require");
    const mod = req("@vercel/functions") as Record<string, unknown>;
    if (typeof mod.waitUntil === "function") {
      (mod.waitUntil as (p: Promise<unknown>) => void)(work());
      return true;
    }
  } catch { /* not installed — normal outside Vercel */ }
  return false;
}

/** Schedule `runInlineGeneration` against the most durable primitive
 *  the platform exposes. Returns the strategy that ran so the caller
 *  (API route) can surface it in the response body for observability.
 *
 *  IMPORTANT: this function NEVER awaits the inline work — it returns
 *  synchronously (well, returns DurableRunResult synchronously after
 *  scheduling). The caller must still return HTTP 202 immediately so
 *  the frontend can start polling /api/jobs.
 */
export function durableRunInlineGeneration(params: InlineGenerateParams): DurableRunResult {
  // Decide workerMode for diagnostics BEFORE dispatching. The strategy
  // we ultimately pick via tryNextAfter / tryVercelWaitUntil defines
  // which workerMode value the inline pipeline will record — callers
  // that already tagged a more-specific class (prepareRetry sets
  // "retry"; the poller auto-resume sets "poller_resume") are
  // preserved via the ?? below.
  //
  // We build two closures that each stamp the correct workerMode on
  // the params so recording happens BEFORE the scheduler hands us a
  // lifecycle commitment.
  const mkWork = (workerMode: InlineGenerateParams["workerMode"]) => {
    const enriched: InlineGenerateParams = { ...params, workerMode: params.workerMode ?? workerMode };
    return async (): Promise<void> => {
      try {
        await runInlineGeneration(enriched);
      } catch (err: any) {
        console.error(
          `[durable-run] Inline generation threw for job ${enriched.jobId}:`,
          err?.message ?? err,
        );
      }
    };
  };

  if (tryNextAfter(mkWork("next_after")))             return { strategy: "next_after" };
  if (tryVercelWaitUntil(mkWork("vercel_waitUntil"))) return { strategy: "vercel_waitUntil" };

  // Last resort. The job row's 5-min stale watchdog + poller auto-resume
  // in /api/jobs provide a safety net when we land here (e.g. running
  // under an older Next, or in a non-Vercel Node server where the
  // process simply doesn't die mid-request).
  console.warn(
    `[durable-run] No platform waitUntil primitive available for job ${params.jobId}. ` +
    `Falling back to fire-and-forget — durability depends on /api/jobs poller resume + stale watchdog.`,
  );
  void mkWork("fire_and_forget")();
  return { strategy: "fire_and_forget" };
}
