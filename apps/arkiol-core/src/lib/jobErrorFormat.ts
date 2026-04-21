// src/lib/jobErrorFormat.ts
//
// Single source of truth for turning a FAILED job's backend error into
// something the UI can render. Importable from BOTH server code
// (/api/jobs route, /api/generate, runInlineGeneration) and client
// components (GeneratePanel, EditorShell, *StudioView, DashboardHome) —
// no "server-only" import, no DOM/window access, pure TS.
//
// The job record's `result` column on FAILED jobs is expected to carry:
//   - result.error:      human-readable message written by whichever
//                        code path failed (OpenAI throw, time budget,
//                        stale watchdog, storage upload, etc.)
//   - result.failReason: machine-readable short code for the category
//                        ("timeout" / "empty_gallery" / "openai_failure"
//                        / "render_failure" / "storage_failure" /
//                        "missing_asset" / "stale_worker" /
//                        "cancelled" / "unknown")
//
// Older rows may lack `failReason`; in that case we best-effort infer
// it from the message text so historical FAILED jobs still render a
// sensible title.

export type JobFailReason =
  | "timeout"
  | "empty_gallery"
  | "openai_failure"
  | "render_failure"
  | "storage_failure"
  | "missing_asset"
  | "stale_worker"
  | "cancelled"
  | "unknown";

export interface JobLike {
  status?: string;
  error?:  string | null;
  result?: {
    error?:      string | null;
    failReason?: string | null;
    message?:    string | null;
  } | null;
}

export interface JobErrorDisplay {
  /** Short category label for list / badge UI. */
  title:      string;
  /** One-line explanation for the current user state. */
  message:    string;
  /** Reason code — always non-null, defaults to "unknown". */
  reason:     JobFailReason;
  /** Whether the user should try again. Retrying an auth/quota failure
   *  is pointless; retrying a timeout usually isn't. */
  retryable:  boolean;
}

const TITLES: Record<JobFailReason, string> = {
  timeout:         "Generation timed out",
  empty_gallery:   "No designs produced",
  openai_failure:  "AI service error",
  render_failure:  "Rendering failed",
  storage_failure: "Storage error",
  missing_asset:   "Asset missing",
  stale_worker:    "Worker stalled",
  cancelled:       "Cancelled",
  unknown:         "Generation failed",
};

const DEFAULT_MESSAGES: Record<JobFailReason, string> = {
  timeout:         "The pipeline couldn't finish within the time limit. Try fewer variations or a simpler prompt.",
  empty_gallery:   "The pipeline ran but none of the candidates passed the quality gate. Try a more specific prompt.",
  openai_failure:  "The AI model failed to respond. This is usually transient — please retry.",
  render_failure:  "A rendering step crashed. Please retry; if it keeps happening, simplify the prompt.",
  storage_failure: "Generated assets could not be saved. Please retry.",
  missing_asset:   "A required visual asset was missing. The team has been notified.",
  stale_worker:    "The worker went silent mid-generation. This is usually transient — please retry.",
  cancelled:       "This job was cancelled.",
  unknown:         "Something went wrong. Please retry.",
};

const RETRYABLE: Record<JobFailReason, boolean> = {
  timeout:         true,
  empty_gallery:   true,
  openai_failure:  true,
  render_failure:  true,
  storage_failure: true,
  missing_asset:   false,
  stale_worker:    true,
  cancelled:       true,
  unknown:         true,
};

const KNOWN_REASONS: ReadonlySet<JobFailReason> = new Set<JobFailReason>([
  "timeout", "empty_gallery", "openai_failure", "render_failure",
  "storage_failure", "missing_asset", "stale_worker", "cancelled", "unknown",
]);

/** Lowercase fuzzy-match the raw message to a reason code. Used only
 *  as a fallback when `result.failReason` is missing or unrecognised
 *  (e.g. rows written before the structured-reason migration).
 *
 *  Order matters: more specific markers check first. The stale-worker
 *  message is literally "Generation timed out — no progress for Xs",
 *  so the generic "timed out" check must come AFTER the stale marker
 *  or every stalled-worker row would be mis-classified as a timeout. */
export function inferReasonFromMessage(message: string | null | undefined): JobFailReason {
  if (!message) return "unknown";
  const m = message.toLowerCase();
  if (m.includes("stale") || m.includes("no progress") || m.includes("worker was likely killed")) return "stale_worker";
  if (m.includes("cancelled") || m.includes("canceled"))                                   return "cancelled";
  if (m.includes("no admissible") || m.includes("empty gallery") || m.includes("no candidates")) return "empty_gallery";
  if (m.includes("timed out") || m.includes("timeout") || m.includes("time budget"))      return "timeout";
  if (m.includes("openai") || m.includes("gpt-") || m.includes("rate limit") || m.includes("429")) return "openai_failure";
  if (m.includes("s3")   || m.includes("upload") || m.includes("storage"))                 return "storage_failure";
  if (m.includes("asset") && m.includes("missing"))                                        return "missing_asset";
  if (m.includes("render") || m.includes("svg") || m.includes("sharp"))                    return "render_failure";
  return "unknown";
}

/** Canonicalise whatever's in `result.failReason` — handles legacy
 *  rows where the code was empty / free-text / an unrelated message. */
export function normalizeReason(code: string | null | undefined, message?: string | null): JobFailReason {
  if (code && KNOWN_REASONS.has(code as JobFailReason)) return code as JobFailReason;
  return inferReasonFromMessage(message ?? code ?? null);
}

/** Turn any FAILED job-ish object into a UI-ready { title, message }
 *  tuple. Safe to call on any shape — missing fields degrade to
 *  "Generation failed / Something went wrong". */
export function formatJobError(job: JobLike | null | undefined): JobErrorDisplay {
  const rawError  = job?.result?.error ?? job?.error ?? job?.result?.message ?? null;
  const rawReason = job?.result?.failReason ?? null;
  const reason    = normalizeReason(rawReason, rawError);
  const title     = TITLES[reason];
  // Prefer the concrete message the backend wrote — that's where the
  // real "no progress for 312s", "OpenAI 502", etc. context lives.
  // Fall back to the generic per-reason explanation when the backend
  // said nothing useful.
  const message   = (rawError && rawError.trim().length > 0 && rawError !== "Generation failed")
    ? rawError
    : DEFAULT_MESSAGES[reason];
  return { title, message, reason, retryable: RETRYABLE[reason] };
}

/** Extend a thrown Error with a structured reason code. The
 *  runInlineGeneration outer catch reads this property so it can write
 *  a structured `failReason` to the DB — instead of just dumping the
 *  full message into both fields. */
export function tagError(err: Error, reason: JobFailReason): Error & { failReason: JobFailReason } {
  (err as any).failReason = reason;
  return err as Error & { failReason: JobFailReason };
}

/** Pull the reason back off a thrown error. Falls back to inferring
 *  from the message for OpenAI / sharp / fetch errors that weren't
 *  tagged at the throw site. */
export function extractReason(err: any): JobFailReason {
  const tagged = err?.failReason;
  if (tagged && KNOWN_REASONS.has(tagged)) return tagged;
  return inferReasonFromMessage(err?.message);
}
