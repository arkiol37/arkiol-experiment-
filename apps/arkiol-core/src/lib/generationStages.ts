// src/lib/generationStages.ts
//
// User-facing generation stages.
//
// The inline pipeline ticks through several internal diagnostic stages
// (font_init / mark_running / brand_load / brief_analyze /
// pipeline_render / rank_select / s3_upload / credit_deduction /
// terminal_write). Those labels are great for ops debugging but not
// for the end user — "pipeline_render" doesn't mean anything to
// someone watching a progress bar.
//
// This module defines the FIVE canonical user-facing stages the UI
// should render, and maps them from the internal diagnostic stages.
// The inline pipeline persists the current user stage + label to
// `job.result.progressStage` / `job.result.progressLabel` on every
// transition, so:
//
//   • The UI reads the persisted label directly — no fragile
//     progress-range heuristics.
//   • Every stage transition also writes the DB row, providing an
//     additional heartbeat beat on top of the periodic pulse()
//     setInterval.
//   • Ops can query "which user stage did this FAILED job last see"
//     without having to interpret internal diag enums.
//
// This module is pure — importable from client AND server — so the
// UI can use the same labels without duplicating them.

import type { JobFailStage } from "./jobDiagnostics";

/** The five canonical user-facing stages. Ordered as the pipeline
 *  progresses. */
export type UserStage =
  | "starting"
  | "generating_content"
  | "building_layout"
  | "applying_assets"
  | "finalizing";

export const USER_STAGES: readonly UserStage[] = [
  "starting", "generating_content", "building_layout", "applying_assets", "finalizing",
] as const;

/** Human-readable label rendered in the UI. Kept in the same module as
 *  the enum so server-written job.result.progressLabel and
 *  client-computed fallbacks can never drift. */
export const USER_STAGE_LABEL: Record<UserStage, string> = {
  starting:           "Starting",
  generating_content: "Generating content",
  building_layout:    "Building layout",
  applying_assets:    "Applying assets",
  finalizing:         "Finalizing",
};

/** Map an internal diagnostic stage to the user-facing bucket it
 *  belongs in. Ambiguous / unknown stages fall through to "starting"
 *  so a corrupt or legacy row never produces a blank label. */
export function userStageForDiagStage(s: JobFailStage): UserStage {
  switch (s) {
    case "init":
    case "font_init":
    case "mark_running":
    case "brand_load":
      return "starting";
    case "brief_analyze":
      return "generating_content";
    case "pipeline_render":
      return "building_layout";
    case "rank_select":
    case "s3_upload":
      return "applying_assets";
    case "credit_deduction":
    case "terminal_write":
      return "finalizing";
    case "stale_watchdog":
    case "client_abandoned":
    case "unknown":
    default:
      return "starting";
  }
}

/** Fallback mapping from a raw progress percentage to a user stage,
 *  used only when the server hasn't persisted an explicit stage yet
 *  (e.g. the very first poll tick before the pipeline wrote
 *  anything). The thresholds line up with the progress values the
 *  inline pipeline pulses at each transition:
 *
 *    0-10%  → starting           (init / font / mark / brand)
 *    10-20% → generating_content (brief_analyze)
 *    20-85% → building_layout    (pipeline_render batches)
 *    85-95% → applying_assets    (rank_select + s3_upload)
 *    95%+   → finalizing         (credits + terminal)
 */
export function userStageForProgress(progress: number): UserStage {
  const p = Math.max(0, Math.min(100, progress));
  if (p < 10) return "starting";
  if (p < 20) return "generating_content";
  if (p < 85) return "building_layout";
  if (p < 95) return "applying_assets";
  return "finalizing";
}

/** One-shot resolver used by the UI: prefer the server-persisted
 *  label, fall back to progress heuristic. Never returns undefined. */
export function resolveUserStage(
  persistedStage: string | null | undefined,
  progress:       number,
): { stage: UserStage; label: string } {
  const stage =
    (persistedStage && (USER_STAGES as readonly string[]).includes(persistedStage))
      ? (persistedStage as UserStage)
      : userStageForProgress(progress);
  return { stage, label: USER_STAGE_LABEL[stage] };
}
