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

import "server-only";
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
 *  deploys, absent in CI / local tests. */
function tryVercelWaitUntil(work: () => Promise<void>): boolean {
  try {
    const mod = require("@vercel/functions") as Record<string, unknown>;
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
  // Every durability path runs this wrapper so a crash in the inline
  // pipeline is logged once centrally. runInlineGeneration's own outer
  // catch already writes FAILED to the DB, so this handler is purely
  // for container logs / Sentry.
  const work = async (): Promise<void> => {
    try {
      await runInlineGeneration(params);
    } catch (err: any) {
      console.error(
        `[durable-run] Inline generation threw for job ${params.jobId}:`,
        err?.message ?? err,
      );
    }
  };

  if (tryNextAfter(work))       return { strategy: "next_after" };
  if (tryVercelWaitUntil(work)) return { strategy: "vercel_waitUntil" };

  // Last resort. The job row's 5-min stale watchdog + poller auto-resume
  // in /api/jobs provide a safety net when we land here (e.g. running
  // under an older Next, or in a non-Vercel Node server where the
  // process simply doesn't die mid-request).
  console.warn(
    `[durable-run] No platform waitUntil primitive available for job ${params.jobId}. ` +
    `Falling back to fire-and-forget — durability depends on /api/jobs poller resume + stale watchdog.`,
  );
  void work();
  return { strategy: "fire_and_forget" };
}
