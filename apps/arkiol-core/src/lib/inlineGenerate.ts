// src/lib/inlineGenerate.ts
// ─────────────────────────────────────────────────────────────────────────────
// Inline generation — runs the AI pipeline WITHIN the API request.
//
// WHY: Arkiol's generation architecture is queue-based (BullMQ Worker).
// The worker runs as a separate long-lived process on Railway/Fly/EC2.
// On Vercel-only deployments, there IS NO worker process — jobs sit in the
// queue forever. This module runs the same pipeline inline so generation
// works without an external worker.
//
// STRICT CANDIDATE PIPELINE:
//   Instead of persisting every rendered candidate, this module
//   over-generates up to ~2x the requested count, evaluates each against
//   the strict rejection rules + marketplace gate (already computed
//   inside renderAsset as PipelineResult.qualityVerdict), and only
//   admits strong, structured, visually rich templates into the gallery.
//   Weak outputs (gradient-only, single text block, asset-poor, weak
//   composition, poor spacing, repetitive) are discarded before the user
//   sees them. If too few survive, a minimum floor is filled from the
//   strongest rejected candidates so the gallery is never empty — those
//   entries are tagged so the audit trail still knows why they shipped.
//
// BEST-N SELECTION:
//   After over-generation, survivors are ranked by the penalty-aware
//   rank score (qualityVerdict.rankScore) and the top `variations`
//   templates are shipped. FIFO is never used: if attempt 4 scores
//   higher than attempts 0..3 it ships; weaker accepted candidates are
//   demoted. Floor-fills are ordered by rank score too so the strongest
//   rescues win.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// FRAMEWORK-NEUTRAL: this module runs in plain Node (apps/render-backend)
// AND in Next.js (apps/arkiol-core). Do NOT add `import "server-only"` or
// any `next/server` import — the Render backend re-imports this file via
// a relative path and crashes at startup if the chain pulls in Next-only
// modules. Next/Vercel-specific wrappers (durableRun, renderDispatch, the
// API routes) live elsewhere.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./prisma";
import { detectCapabilities } from "@arkiol/shared";
import { tagError, extractReason } from "./jobErrorFormat";
import { DiagnosticsCollector, type JobFailStage, type WorkerMode } from "./jobDiagnostics";
import { userStageForDiagStage, USER_STAGE_LABEL } from "./generationStages";
import { detectSafeMode, resolveRuntimeLimits, resolveTimeBudgetMs } from "./safeMode";
import {
  buildDesignBrain,
  isDomainMatch,
  DESIGN_BRAIN_TEMPLATE_COUNT,
  DESIGN_BRAIN_MIN_TEMPLATE_COUNT,
  type DesignBrainPlan,
} from "../engines/design-brain";
import { JobStatus } from "@prisma/client";

export interface InlineGenerateParams {
  jobId: string;
  userId: string;
  orgId: string;
  prompt: string;
  formats: string[];
  stylePreset: string;
  variations: number;
  brandId?: string | null;
  campaignId?: string | null;
  includeGif: boolean;
  locale: string;
  archetypeOverride?: { archetypeId: string; presetId: string };
  expectedCreditCost: number;
  /** Pre-computed brief snapshot from a previous run. When present
   *  (always populated by retries — see lib/jobRetry.ts and the
   *  briefSnapshot writeback below), the analyzer call is skipped and
   *  the cached structured brief is reused. Saves an OpenAI call and
   *  several seconds per retry. */
  briefSnapshot?: unknown;
  /** Which dispatch path owned this run. Propagated by durableRun,
   *  the queue entry path, the poller auto-resume, and prepareRetry —
   *  so the diagnostics collector can record it at the top of the
   *  pipeline without peering into the runtime's private state. */
  workerMode?: WorkerMode;
  /** Caller has already claimed PENDING → RUNNING and started a
   *  heartbeat in their own process. Set to true by the Render
   *  backend wrapper (apps/render-backend/src/lib/runGeneration.ts)
   *  so this function does NOT re-attempt the atomic claim — which
   *  would always see count=0 (because the wrapper's claim already
   *  consumed the PENDING state) and bail out before any
   *  generation happens.
   *
   *  When true, the function skips the mark_running claim AND
   *  the early "already claimed" return, going straight into the
   *  brand_load / brief_analyze / pipeline_render stages. The
   *  caller must guarantee:
   *    - the row is RUNNING with startedAt set,
   *    - a heartbeat is writing to the row at least every
   *      HEARTBEAT_GAP_MS,
   *    - on caller-side crash the row gets flipped to FAILED. */
  skipClaim?: boolean;
}

/** Hard timeout caps for every DB write that COULD freeze the
 *  finalization stretch. The 98% stuck-bar bug came from
 *  unbounded prisma calls (pulse, credit deduction, the COMPLETED
 *  write) sitting forever when PgBouncer's pool was saturated.
 *  Each call site below wraps its prisma operation with
 *  withTimeout — on timeout the caller's existing try/catch turns
 *  it into either a tagged FAILED row or a swallowed best-effort
 *  no-op (depending on whether the call was load-bearing). */
const PULSE_TIMEOUT_MS           = 5_000;   // best-effort heartbeat write
const CREDIT_DEDUCTION_TIMEOUT_MS = 10_000; // org.update during credit_deduction
const ASSET_CREATE_TIMEOUT_MS    = 30_000;
const FINAL_DB_WRITE_TIMEOUT_MS  = 60_000;
const FAIL_WRITE_TIMEOUT_MS      = 30_000;  // catch-path FAILED write
const CLAIM_TIMEOUT_MS           = 15_000;  // PENDING→RUNNING claim

/** Wrap a promise with a hard timeout. On expiry the returned
 *  promise rejects with a labelled error — the surrounding
 *  try/catch turns that into a tagged finalization_failed /
 *  asset_save_failed FAILED row, which is what the user sees in
 *  the UI. The original underlying promise is left to settle on
 *  its own (Node has no way to cancel pg/Prisma queries from
 *  outside) — this just stops US from waiting on it. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    // Don't keep the event loop alive solely to fire this rejection.
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export async function runInlineGeneration(params: InlineGenerateParams): Promise<void> {
  const {
    jobId, userId, orgId, prompt, formats, stylePreset,
    variations, brandId, campaignId, locale, archetypeOverride,
  } = params;

  // Wall-clock start. Used for the strict-quality 60s contract log so
  // ops can verify "Design Brain mode finished in <60s" at a glance.
  const runStartMs = Date.now();

  // Diagnostics collector — captures stage transitions, per-class
  // failure counts, elapsed time, and worker mode. Persisted to
  // job.result.diagnostics on both terminal paths so ops can query
  // "why did this specific job fail" without grepping serverless logs.
  const capSnapshot = (() => {
    try {
      const c = detectCapabilities();
      return {
        database: !!c.database,
        ai:       !!c.ai,
        queue:    !!c.queue,
        storage:  !!c.storage,
        auth:     !!c.auth,
      } as Record<string, boolean>;
    } catch { return undefined; }
  })();
  const diag = new DiagnosticsCollector({
    workerMode:  params.workerMode ?? "fire_and_forget",
    // attempt defaults to 1 here because the outer catch re-reads the
    // live row's attempts before persisting — the collector value is
    // only a fallback when the read fails.
    attempt:     1,
    maxAttempts: 3,
    capabilitySnapshot: capSnapshot,
  });

  // Safe-mode resolution. Fires when the platform can't guarantee a
  // long-lived worker (no queue, fire_and_forget durability, or
  // operator opt-in via ARKIOL_SAFE_MODE=1). Under safe mode we
  // reduce concurrency + candidate fan-out so the pipeline finishes
  // comfortably inside the serverless budget even under heavy sharp
  // render load. See lib/safeMode.ts for the exact trigger rules.
  const safeVerdict = detectSafeMode(params.workerMode);
  if (safeVerdict.safeMode) {
    console.info(
      `[inline-generate] Job ${jobId} running in SAFE MODE (reasons: ${safeVerdict.reasons.join(", ")}). ` +
      `Reduced concurrency + attempts to protect against serverless container kills.`,
    );
  }

  // ── Heartbeat plumbing ────────────────────────────────────────────────────
  // Prisma auto-bumps `updatedAt` on every `.update()`, so the stale-job
  // watchdog in /api/jobs treats an update as a "worker is alive" signal.
  // The old heartbeat only fired once per *attempt* (~45s apart), leaving
  // the UI bar frozen and — worse — letting the 5-min stale watchdog
  // trip on legitimately-running jobs that were deep inside a render.
  //
  // `pulse(progress?)` is the single entry point for nudging the job row.
  // Calling it with no arg re-writes the current progress value, which
  // still rolls updatedAt forward (Prisma doesn't skip identical writes).
  // `runHeartbeat` schedules one every PULSE_INTERVAL_MS for as long as
  // generation is live, so even a long blocking render step keeps the
  // row warm. Both are best-effort — a transient DB hiccup must never
  // take down the generation itself.
  let currentProgress = 0;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  // 7s pulse cadence gives us ~13× margin against the 90s backend
  // heartbeat-gap threshold — enough slack to survive a missed tick or
  // two when sharp's libvips worker pool saturates the main thread
  // during concurrent renders. Previously 10s, which left only ~9×
  // margin and occasionally tripped the "no worker heartbeat for 91s"
  // backend stale verdict under heavy render load.
  const PULSE_INTERVAL_MS = 7_000;
  const pulse = async (progress?: number) => {
    if (typeof progress === "number" && progress > currentProgress) {
      currentProgress = Math.min(100, progress);
    }
    try {
      // Bounded by PULSE_TIMEOUT_MS so a hung PgBouncer doesn't
      // freeze the whole pipeline — pulse is best-effort, the
      // wrapper's worker-thread heartbeat is the authoritative
      // updatedAt-bumper. Without this timeout, any caller that
      // does `await pulse(...)` (e.g. the `await pulse(98)` right
      // before the COMPLETED write) would block indefinitely on a
      // stalled connection. That was the 98% freeze.
      await withTimeout(prisma.job.update({
        where: { id: jobId },
        data: { progress: currentProgress },
      }), PULSE_TIMEOUT_MS, "pulse");
    } catch { /* best effort — never kill the pipeline over a DB hiccup */ }
  };
  const runHeartbeat = () => {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => { void pulse(); }, PULSE_INTERVAL_MS);
  };
  const stopHeartbeat = () => {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  };

  // In-memory snapshot of the job row's `result` JSONB that we own
  // during this run. Stage transitions merge new fields (progressStage,
  // progressLabel) into this object and write the whole blob via
  // prisma.update. Terminal writes (COMPLETED / FAILED) construct
  // their own result objects and replace whatever's here. Initialized
  // from the current row so retry-breadcrumbs (retryFromReason /
  // previousAttempts) written by prepareRetry survive into this
  // attempt's diagnostics.
  let resultCtx: Record<string, unknown> = { inlineGenerated: true };
  try {
    const fresh = await prisma.job.findUnique({ where: { id: jobId }, select: { result: true } });
    if (fresh?.result && typeof fresh.result === "object") {
      resultCtx = { ...(fresh.result as Record<string, unknown>), inlineGenerated: true };
    }
  } catch { /* best effort — pipeline continues with the default ctx */ }

  // Combined stage-transition + pulse + user-facing label helper.
  // Every enterStage() call now:
  //   (a) advances the diagnostic stage (ops telemetry)
  //   (b) derives + writes the user-facing `progressStage` +
  //       `progressLabel` to `job.result` so the UI can render e.g.
  //       "Building layout" without guessing from the progress %
  //   (c) pulses the row's updatedAt to keep the backend heartbeat
  //       watchdog happy.
  // The progress arg is optional — if provided it monotonically
  // advances currentProgress; if omitted the write just rolls
  // updatedAt forward at the same progress value.
  const stage = async (name: JobFailStage, progress?: number): Promise<void> => {
    diag.enterStage(name);
    const userStage = userStageForDiagStage(name);
    resultCtx = {
      ...resultCtx,
      progressStage: userStage,
      progressLabel: USER_STAGE_LABEL[userStage],
    };
    if (typeof progress === "number" && progress > currentProgress) {
      currentProgress = Math.min(100, progress);
    }
    try {
      // Same timeout reasoning as pulse(): a stage transition is
      // best-effort breadcrumb data, the wrapper's worker-thread
      // heartbeat is what keeps updatedAt fresh. Without the
      // timeout a hung PgBouncer freezes the next stage's
      // `await stage(...)` call indefinitely.
      await withTimeout(prisma.job.update({
        where: { id: jobId },
        data: {
          progress: currentProgress,
          result:   resultCtx as any,
        },
      }), PULSE_TIMEOUT_MS, `stage(${name})`);
    } catch { /* best effort — never kill the pipeline over a DB hiccup */ }
  };

  // Yields the Node event loop so any pending pulse / setInterval
  // callbacks get a chance to run before the next CPU-bound burst.
  // Called between render batches where the main thread has been
  // loaded with sharp SVG parsing + libvips calls for 30-60s.
  const yieldEventLoop = (): Promise<void> => new Promise<void>(r => setImmediate(r));

  try {
    // Start the periodic heartbeat BEFORE any blocking work. Even font
    // init can take several seconds on a cold serverless container, and
    // we want updatedAt moving from tick one so the watchdog never sees
    // a silent gap.
    runHeartbeat();

    // Initialize fonts for Vercel/serverless — downloads Google Fonts TTFs
    // to /tmp so buildUltimateFontFaces() can base64-embed them in SVG.
    // Critical for sharp PNG rendering with custom typography.
    await stage("font_init");
    try {
      const { initUltimateFonts } = require("../engines/render/font-registry-ultimate");
      await initUltimateFonts();
    } catch (fontErr: any) {
      console.warn("[inline-generate] Font init failed (non-fatal):", fontErr.message);
      diag.recordFailure("render", fontErr);
    }

    // Mark job as RUNNING + initial 2% so the UI bar moves immediately.
    //
    // CRITICAL: this write must be ATOMIC. Two dispatch paths (the
    // BullMQ worker and the inline fallback from durableRun) can both
    // land here for the same job when the queue is configured but its
    // worker pool is unreliable — we fire both to maximise the chance
    // that SOMETHING picks the job up. `updateMany` with a
    // `startedAt: null` guard means only the first caller flips the
    // row; the second sees `count === 0` and bails cleanly instead of
    // double-rendering, double-charging credits, or racing the final
    // COMPLETED write.
    await stage("mark_running");
    if (params.skipClaim) {
      // Caller (the Render backend wrapper) has already done the
      // PENDING→RUNNING claim and started a heartbeat in its own
      // event loop. We MUST NOT re-attempt the claim here — it
      // would always see count=0 and the early-bail below would
      // exit before any generation runs. Just skip straight to
      // the work.
      console.info(`[inline-generate] Job ${jobId} skipping claim (skipClaim=true, owned by ${params.workerMode ?? "unknown"})`);
      currentProgress = 2;
    } else {
      const claim = await withTimeout(prisma.job.updateMany({
        where: {
          id:        jobId,
          status:    JobStatus.PENDING,
          startedAt: null,
        },
        data: {
          status:    JobStatus.RUNNING,
          startedAt: new Date(),
          progress:  2,
          attempts:  { increment: 1 },
        },
      }), CLAIM_TIMEOUT_MS, "PENDING→RUNNING claim").catch(() => ({ count: 0 })) as { count: number };
      if (claim.count === 0) {
        // Another worker already owns this job. Drop out silently — our
        // heartbeat is the only piece of mutable state we registered, so
        // tearing it down is enough to release the container.
        console.info(`[inline-generate] Job ${jobId} already claimed by another worker — bailing.`);
        stopHeartbeat();
        return;
      }
      currentProgress = 2;
    }

    // Load brand if specified
    await stage("brand_load", 5);
    const brand = brandId
      ? await prisma.brand.findUnique({ where: { id: brandId } }).catch(() => null)
      : null;

    // Brief analysis (~2-5s). Skipped on retries that carry a cached
    // briefSnapshot from the original run — analyzeBrief is
    // deterministic for a given prompt and the analyzer call is one of
    // the slowest single operations in the pipeline, so reusing the
    // snapshot turns a retry into a "resume from render" instead of
    // "start from zero".
    await stage("brief_analyze", 10);
    const { analyzeBrief } = require("../engines/ai/brief-analyzer");
    let brief: any;
    let briefFromCache = false;
    if (params.briefSnapshot) {
      brief = params.briefSnapshot;
      briefFromCache = true;
      console.info(`[inline-generate] Job ${jobId} reusing cached briefSnapshot (retry resume).`);
    } else {
      try {
        brief = await analyzeBrief({
          prompt,
          stylePreset,
          format: formats[0],
          locale: locale ?? "en",
          brand: brand ? {
            primaryColor:   brand.primaryColor,
            secondaryColor: brand.secondaryColor,
            voiceAttribs:   brand.voiceAttribs as Record<string, number>,
            fontDisplay:    brand.fontDisplay,
          } : undefined,
        });
      } catch (briefErr: any) {
        // Record + rethrow — the brief stage is required, so a failure
        // here terminates the run. The outer catch will persist the
        // diagnostic bundle which now shows both `failStage:
        // "brief_analyze"` and `openaiFailures.count = 1`.
        diag.recordFailure("openai", briefErr);
        throw briefErr;
      }
      // Persist the snapshot back onto the job's payload so the next
      // retry (auto or explicit) can skip this step. Best-effort: if
      // the merge fails (legacy row, race with concurrent write), we
      // continue — the worst case is the next retry re-analyzes.
      try {
        const fresh = await prisma.job.findUnique({ where: { id: jobId }, select: { payload: true } });
        const existingPayload = (fresh?.payload as Record<string, unknown>) ?? {};
        await prisma.job.update({
          where: { id: jobId },
          data:  { payload: { ...existingPayload, briefSnapshot: brief } as any },
        });
      } catch (cacheErr: any) {
        console.warn("[inline-generate] briefSnapshot writeback failed (non-fatal):", cacheErr?.message);
      }
    }

    await pulse(briefFromCache ? 18 : 15);

    // ── Design Brain (deterministic creative direction) ─────────────────────
    // Runs BEFORE pipeline_render. Locks domain + visual style + palette +
    // layout + typography + composition for the entire run so every
    // variation produced below differs only in layout structure /
    // element positioning / composition style — never in domain or feel.
    //
    // Pure / synchronous. Adds <5ms; persisted to job.result.designBrain so
    // ops + the UI can audit the plan that drove the gallery.
    const designBrainStartedAt = Date.now();
    const designBrain: DesignBrainPlan = buildDesignBrain({
      prompt,
      briefCategory:  (brief as any)?.category ?? null,
      requestedCount: variations,
    });
    const designBrainElapsedMs = Date.now() - designBrainStartedAt;

    console.info(
      `[design-brain] Job ${jobId} plan: ` +
      `domain=${designBrain.domain} ` +
      `style=${designBrain.visualStyle} ` +
      `palette=${designBrain.palette.background}/${designBrain.palette.primary}/${designBrain.palette.accent} ` +
      `layout=${designBrain.layout} ` +
      `assetType=${designBrain.assetType} ` +
      `typography=${designBrain.typography} ` +
      `cta=${JSON.stringify(designBrain.ctaSuggestion)} ` +
      `templates=${designBrain.templateCount} ` +
      `confidence=${designBrain.confidence.toFixed(2)} ` +
      `elapsedMs=${designBrainElapsedMs}`,
    );

    // Persist the plan back to job.result so the UI / audit trail can
    // surface "this gallery was directed by this plan" alongside the
    // candidate audit. Best-effort; pulse() patterns elsewhere in this
    // file establish that DB hiccups must never kill the pipeline.
    resultCtx = { ...resultCtx, designBrain };
    try {
      await withTimeout(prisma.job.update({
        where: { id: jobId },
        data:  { result: resultCtx as any },
      }), PULSE_TIMEOUT_MS, "design-brain persist");
    } catch { /* best-effort */ }

    await stage("pipeline_render", 20);
    const format = formats[0];
    const { runGenerationPipeline } = require("../engines/ai/pipeline-orchestrator");
    const { getCreditCost, getCategoryLabel } = require("./types");

    const brandInput = brand ? {
      primaryColor:   brand.primaryColor,
      secondaryColor: brand.secondaryColor,
      fontDisplay:    brand.fontDisplay,
      fontBody:       brand.fontBody,
      voiceAttribs:   brand.voiceAttribs as Record<string, number>,
      colors:         [brand.primaryColor, brand.secondaryColor],
      fonts:          brand.fontDisplay ? [{ family: brand.fontDisplay }] : [],
      tone:           brand.voiceAttribs ? Object.keys(brand.voiceAttribs as object) : [],
    } : undefined;

    // Target: `totalVariations` accepted candidates, each strong enough
    // for the gallery. The Design Brain has clamped this to the strict
    // 3-4 ceiling (per-prompt "first impression" contract) so the
    // pipeline produces a small, focused, high-quality gallery instead
    // of a large random fan-out. In non-safe mode we over-generate up to
    // 2x attempts; in safe mode we prefer fewer stronger attempts so the
    // pipeline finishes inside the serverless budget. Design Brain mode
    // overrides both with a tight "exactly v + 1 retry" profile.
    const totalVariations = Math.max(
      DESIGN_BRAIN_MIN_TEMPLATE_COUNT,
      Math.min(DESIGN_BRAIN_TEMPLATE_COUNT, designBrain.templateCount),
    );
    const runtimeLimits   = resolveRuntimeLimits({
      safeMode:        safeVerdict.safeMode,
      totalVariations,
      designBrain:     true,
    });
    const MAX_ATTEMPTS    = runtimeLimits.maxAttempts;
    // Persist the resolved safe-mode verdict + runtime limits so the
    // admin failure dashboard can pivot by safe-mode, and so
    // post-mortems can see exactly what CONCURRENCY / MAX_ATTEMPTS
    // was active.
    diag.setSafeMode({
      safeMode:    safeVerdict.safeMode,
      reasons:     safeVerdict.reasons,
      concurrency: runtimeLimits.concurrency,
      maxAttempts: runtimeLimits.maxAttempts,
    });

    // ── Time budget ──────────────────────────────────────────────────────────
    // Vercel kills the serverless function at maxDuration (300s in
    // /api/generate/route.ts). We must stop launching new render
    // attempts before that or the platform will SIGKILL us mid-render
    // and leave the DB job stuck in RUNNING — producing the "generating
    // forever / 30-minute hang" symptom the user reported.
    //
    // Non-safe mode: 240s budget, leaves ~60s headroom for uploads.
    // Safe mode (Vercel default): 180s budget, leaves ~120s headroom
    // — enough cushion for cold-start recovery + S3 uploads + final
    // writes even when sharp's libvips is contending for CPU. See
    // resolveTimeBudgetMs() in lib/safeMode.ts.
    const GENERATION_BUDGET_MS = resolveTimeBudgetMs(safeVerdict.safeMode, true);
    const startedAt = Date.now();
    const deadlineAt = startedAt + GENERATION_BUDGET_MS;
    const timeLeft = () => Math.max(0, deadlineAt - Date.now());
    // Concurrency is deliberately conservative. The earlier cap of 6
    // assumed each attempt was pure I/O on OpenAI, but sharp's
    // SVG→PNG render is heavily CPU-bound via libvips — too many
    // concurrent renders saturate the worker-thread pool and starve
    // the Node main thread, delaying setInterval callbacks past the
    // backend's 90s heartbeat threshold. Non-safe mode caps at 4 (for
    // queue-backed deploys); safe mode drops to 2 for maximum
    // main-thread breathing room. See lib/safeMode.ts.
    const CONCURRENCY = runtimeLimits.concurrency;

    interface RenderedCandidate {
      vi:             number;
      result:         any;
      orchestrated:   any;
      /** Penalty-aware rank score used for best-N selection. */
      rankScore:      number;
      /** Raw marketplace score (audit only). */
      marketScore:    number;
      /** Top penalty reasons pulled from the verdict (audit only). */
      rankPenalties:  string[];
      accepted:       boolean;
      /** True when the renderer produced an svg + buffer we can ship.
       *  False candidates are excluded from the rescue tier — there's
       *  nothing visual to admit. */
      hasUsableArtefact: boolean;
      rejectReasons:  string[];
      failedCriteria: string[];
      themeId:        string;
      paletteKey:     string;
      /** Template type the composer shaped this render for — drives
       *  gallery-level diversity. */
      templateType:   string;
      /** Populated sections (header / content / visual / list_block / cta
       *  / supporting) derived from the actual text zones that render.
       *  Surfaced in the admission audit so gallery ops can verify the
       *  multi-section structural floor held. */
      sections:       string[];
      sectionCount:   number;
      /** Component mix the renderer composed the template from
       *  (checklist_item / tip_card / step_block / quote_box /
       *  content_card / cta_button / badge / labeled_section). */
      componentKinds: string[];
      componentCount: number;
      structuredComponentCount: number;
      /** Content-aware structure classification + bullet item count. */
      contentKind:    string;
      contentItems:   number;
      contentSatisfied: boolean;
      /** Where the body text came from — openai_structured means the
       *  template-type-aware generator produced the copy; legacy_zone_text
       *  means the generic zone prompt ran; fallback means we had no AI
       *  and populated from the brief alone. */
      contentSource:  string;
      /** Distinct structured items delivered by the generator (tips /
       *  checklist rows / steps / benefits / insights / list picks). */
      structuredItemCount: number;
      /** Step 8 — per-role mapping audit. Shows how many of the items
       *  the generator produced actually landed in distinct zones, and
       *  whether any required roles were dropped. */
      mappingPlaced:     number;
      mappingExpected:   number;
      mappingSlots:      number;
      mappingMissing:    string[];
      mappingUnderfilled: boolean;
      mappingCompressed:  boolean;
      /** Step 9 — real visual subject. Slug / category / placement
       *  summarise the photo the renderer painted into the image zone
       *  (or blank when no photo was selected). `subjectExpected`
       *  tracks whether a photo was expected by the brief's intent. */
      subjectSlug:       string;
      subjectCategory:   string;
      subjectPlacement:  string;
      subjectLicensed:   boolean;
      subjectExpected:   boolean;
      /** Step 10 — composition balance verdict. `compositionFlags`
       *  lists every failing heuristic (no_focal / overcrowded /
       *  poor_spacing / text_overlap / missing_cta / …) so admission
       *  audits can explain layout rejections. */
      compositionPattern:    string;
      compositionFocal:      string;
      compositionFocalArea:  number;
      compositionCoverage:   number;
      compositionFlags:      string[];
      /** Step 11 — style consistency verdict. Hue + font counts, worst
       *  text / CTA contrast, corner-radius spread, decoration volume,
       *  subject mode, and the flag list that drove the palette /
       *  font / contrast / noise / mismatch rejection rules. */
      styleHues:            number;
      styleFonts:           number;
      styleFontFamilies:    string[];
      styleMinContrast:     number;
      styleCtaContrast:     number;
      styleRadiusCv:        number;
      styleDecorCount:      number;
      styleSubjectMode:     string;
      styleFlags:           string[];
    }

    const rendered: RenderedCandidate[] = [];
    let attemptedCount = 0;
    let totalPipelineMs = 0;

    // Signature used to greedy-dedup palette + typography twins. We treat
    // two candidates as near-clones when theme id, primary colour, and
    // surface match — this mirrors the looser `areTooSimilar` rule in
    // candidate-quality but works off the lean snapshot the pipeline
    // already returns. Undefined snapshot → unique-per-call key.
    const paletteKeyOf = (r: any): string => {
      const snap = r?.packStyleSnapshot;
      if (!snap) return `raw:${r?.assetId ?? Math.random()}`;
      return [
        r?.evaluationSignals?.themeId ?? "?",
        snap.primary, snap.surface, snap.ink,
        snap.fontDisplay, snap.fontBody,
      ].join("|").toLowerCase();
    };

    const acceptedCount = () => rendered.filter(r => r.accepted).length;

    // Single-attempt render. Pure async work — no shared mutation until
    // the caller appends the resolved candidate to `rendered`.
    //
    // Wraps runGenerationPipeline in a per-attempt 5s heartbeat so
    // even single long attempts (a slow OpenAI call + heavy sharp
    // render = 40-60s) keep touching updatedAt. Without this, a
    // single stuck attempt inside a batch can go 60+ seconds between
    // the global setInterval's last successful tick (if starved) and
    // the next batch-boundary pulse — enough to trip the backend's
    // 90s heartbeat watchdog.
    // ── Free-tier output contract: SVG previews only ─────────────────────
    // The initial generation must finish in <60s on Render's free
    // 0.5-CPU shared instance. Sharp's PNG render via libvips
    // dominates the per-attempt cost (10-30s each), so the initial
    // pass renders SVG only — fast, cacheable, editable. The high-res
    // PNG/PDF export runs separately when the user clicks
    // download/export from the gallery (see /api/export).
    //
    // The orchestrator's renderAsset() supports outputFormat: "svg"
    // and emits a result with `svgSource` populated and `buffer`
    // empty. The asset row is stored with mimeType=image/svg+xml so
    // the gallery knows to render the SVG directly and surface a
    // separate "High-res export preparing" affordance.
    const INITIAL_OUTPUT_FORMAT: "svg" | "png" = "svg";
    const INITIAL_MIME_TYPE = INITIAL_OUTPUT_FORMAT === "svg"
      ? "image/svg+xml"
      : "image/png";

    const runOneAttempt = async (vi: number) => {
      const attemptPulseTimer = setInterval(() => { void pulse(); }, 5_000);
      try {
        const orchestrated = await runGenerationPipeline({
          jobId,
          orgId,
          campaignId: campaignId ?? jobId,
          format,
          variationIdx: vi,
          stylePreset,
          archetypeOverride: archetypeOverride as any,
          outputFormat: INITIAL_OUTPUT_FORMAT,
          pngScale: 1,
          brief,
          brand: brandInput,
          requestedVariations:  totalVariations,
          maxAllowedVariations: totalVariations,
        });
        return { vi, orchestrated };
      } finally {
        clearInterval(attemptPulseTimer);
      }
    };

    // Batched parallel execution with an explicit time budget.
    // Stop launching new batches when:
    //   1. enough candidates are accepted,
    //   2. the MAX_ATTEMPTS cap is hit, or
    //   3. less than ~1.2× the per-batch time estimate remains in the
    //      budget (launching another batch would get killed mid-flight).
    // Free-tier SVG-only renders are ~2-6s each (no sharp/libvips PNG
    // encode), so a batch of 2-3 typically settles in 6-10s. 8s
    // estimate keeps the loop honest about whether another batch
    // fits — too low and we'd start a batch that overruns the 40s
    // budget; too high and we'd stop early and ship fewer templates
    // than we could have.
    const PER_BATCH_MS_ESTIMATE = 8_000;

    // Per-attempt progress heartbeat. Without this, progress only moves
    // when an entire batch of N variations settles — a 45-second freeze
    // at a single percentage value, which the UI surfaces as "Analyzing
    // prompt… 5%" and the user perceives as hung. Bumping progress as
    // each attempt finishes (success or failure) gives the polling
    // frontend something visible to render every few seconds and drives
    // the stage indicator (0-20% analyze → 20-40% layout → 40-60%
    // variations → 60-80% ranking → 80-100% prepare results) through
    // its full sweep.
    let completedAttempts = 0;
    let lastProgress = 20;
    const heartbeatProgress = async () => {
      completedAttempts++;
      // Span 20 → 85, weighted by finished attempts vs. the bound we
      // actually plan to hit. The 90% and 100% checkpoints are reserved
      // for the post-loop S3 upload + final COMPLETED write.
      const divisor = Math.max(totalVariations, Math.min(MAX_ATTEMPTS, attemptedCount || 1));
      const target  = 20 + Math.floor((Math.min(completedAttempts, divisor) / divisor) * 65);
      if (target > lastProgress) {
        lastProgress = target;
      }
      await pulse(lastProgress);
    };

    while (
      acceptedCount() < totalVariations &&
      attemptedCount < MAX_ATTEMPTS &&
      timeLeft() > PER_BATCH_MS_ESTIMATE * 1.2
    ) {
      const remaining = totalVariations - acceptedCount();
      const batchSize = Math.min(CONCURRENCY, remaining + 1, MAX_ATTEMPTS - attemptedCount);
      if (batchSize <= 0) break;

      const batchVis: number[] = [];
      for (let i = 0; i < batchSize; i++) batchVis.push(attemptedCount + i);
      attemptedCount += batchSize;

      // Yield the event loop so any pulse / setInterval callbacks
      // queued during the previous batch's sharp-heavy rendering get
      // a chance to fire BEFORE we start the next batch and saturate
      // libvips again. Without this, back-to-back batches can keep
      // the main thread pinned for 90+ seconds.
      await yieldEventLoop();

      // Per-batch start heartbeat so even a batch whose first attempt
      // won't settle for 40s still shows fresh updatedAt the moment the
      // batch is kicked off — catches cases where a single stuck OpenAI
      // call would otherwise pin the progress number for an entire
      // batch window.
      await pulse(Math.max(lastProgress, 20));

      // `.finally()` is called regardless of accept/reject so the bar
      // keeps moving even when a variation hard-fails and we re-launch.
      const batchResults = await Promise.allSettled(
        batchVis.map(vi => runOneAttempt(vi).finally(() => heartbeatProgress())),
      );

      // Post-batch yield + pulse. Sharp's PNG encode runs synchronously
      // for the last few ms of each render, so all N attempts often
      // settle within the same tick; yielding here gives pending
      // timers a chance to run before we move to the verdict / admit
      // loop, and the explicit pulse guarantees updatedAt moved.
      await yieldEventLoop();
      await pulse(lastProgress);

      for (let i = 0; i < batchResults.length; i++) {
        // Per-candidate evaluation heartbeat. The verdict/palette-dedup/
        // logging block below is O(1) but reads the whole rendered[]
        // array + emits a console line per iteration; a batch of 4
        // candidates with several log lines each has enough sync work
        // that on a starved main thread we could go 10s+ between
        // iterations. Pulsing on each iteration guarantees updatedAt
        // moves forward even if nothing else does.
        await pulse();
        const vi = batchVis[i];
        const settled = batchResults[i];
        if (settled.status === "rejected") {
          console.warn(`[inline-generate] vi=${vi} pipeline threw: ${settled.reason?.message ?? settled.reason}`);
          // Classify the per-variation crash by its message so
          // diagnostics show openai vs render counts. The pipeline
          // orchestrator wraps OpenAI calls already — a fetch / rate
          // limit / 5xx shows up with openai markers; sharp / svg
          // crashes surface render markers.
          const msg = String(settled.reason?.message ?? settled.reason ?? "").toLowerCase();
          const kind: "openai" | "render" =
            (msg.includes("openai") || msg.includes("rate limit") || msg.includes("429") || msg.includes("502") || msg.includes("timeout"))
              ? "openai" : "render";
          diag.recordFailure(kind, settled.reason);
          continue;
        }
        const { orchestrated } = settled.value;
        const result = orchestrated.render;
        totalPipelineMs += orchestrated.totalPipelineMs ?? 0;

      const verdict = result.qualityVerdict;
      const paletteKey = paletteKeyOf(result);
      const priorPalette = rendered.some(r => r.accepted && r.paletteKey === paletteKey);

      // SOFT-GATING CONTRACT (always-ship rescue):
      //   The previous strict gate (rules + dedup + domain) frequently
      //   produced an empty admitted set on free-tier resources, which
      //   then threw "no admissible candidates" — leaving the user with
      //   a blank gallery. The strict-quality contract is now: rank
      //   candidates with soft penalties, ship the strongest 3-4
      //   regardless. Hard reject is only for renders that didn't
      //   produce a usable artefact (no svg, no buffer).
      //
      //   Domain mismatch, palette twin, and rules-not-accepted become
      //   rank-score deductions, not blocks. The greedy picker will
      //   still prefer perfect candidates when they exist, and the
      //   floor-fill / rescue tier always backstops to "at least one
      //   shipped per request" so the user never sees blank state.
      const subjectCategory = verdict?.subjectImageCategory ?? "";
      const domainMatched   = isDomainMatch(designBrain, subjectCategory);

      // Hard reject only when the candidate didn't render anything
      // usable. Everything else is soft.
      const hasUsableArtefact = !!(result?.svgSource || result?.buffer);

      // "accepted" still means "passed every gate" — used for the
      // primary admission tier so the gallery prefers strong
      // candidates first when they exist. Soft-rejects flow into the
      // rescue tier with a penalty applied.
      const accepted =
        !!verdict &&
        verdict.rulesAccepted &&
        !priorPalette &&
        domainMatched;

      // Soft penalties applied to the rank score so weak candidates
      // sort lower than strong ones inside the rescue tier without
      // being blocked. Tuned so a perfect candidate always beats a
      // soft-rejected one, but a soft-rejected candidate still beats
      // an empty gallery.
      const RULES_PENALTY  = 0.25;
      const DOMAIN_PENALTY = 0.30;
      const PALETTE_PENALTY = 0.10;

      const rawScore = verdict?.rankScore ?? verdict?.qualityScore ?? 0;
      let softScore  = rawScore;
      const softReasons: string[] = [];
      if (verdict && !verdict.rulesAccepted) {
        softScore -= RULES_PENALTY;
        // hardReasons SHOULD be a string[] when rulesAccepted is
        // false, but the verdict shape can come back partial from
        // degraded fallback renders — default to [] so the spread
        // can't throw.
        softReasons.push(...(verdict.hardReasons ?? []));
      }
      if (priorPalette) {
        softScore -= PALETTE_PENALTY;
        softReasons.push(`near_duplicate:${paletteKey}`);
      }
      if (!domainMatched) {
        softScore -= DOMAIN_PENALTY;
        softReasons.push(
          `domain_mismatch:expected=${designBrain.domain}:got=${subjectCategory || "none"}`,
        );
      }
      if (!hasUsableArtefact) {
        softReasons.push("no_usable_artefact");
      }

      // rejectReasons remain populated for ops audit even when the
      // candidate is admitted via the rescue tier — so the dashboard
      // can answer "why was this template ranked last".
      const rejectReasons: string[] = !verdict
        ? ["verdict_missing", ...softReasons]
        : softReasons;

      rendered.push({
        vi,
        result,
        orchestrated,
        // rankScore now reflects the soft-penalised score so the
        // greedy picker naturally prefers strong candidates without
        // any branching at selection time. The original raw score is
        // available via marketScore for audit.
        rankScore:      softScore,
        marketScore:    verdict?.marketplaceScore ?? rawScore,
        rankPenalties:  verdict?.rankPenalties ?? [],
        accepted,
        hasUsableArtefact,
        rejectReasons,
        failedCriteria: verdict?.failedCriteria ?? [],
        themeId:        verdict?.themeId ?? result?.evaluationSignals?.themeId ?? "unknown",
        paletteKey,
        templateType:   verdict?.templateType ?? "unknown",
        sections:       verdict?.sections ?? [],
        sectionCount:   verdict?.sectionCount ?? 0,
        componentKinds: verdict?.componentKinds ?? [],
        componentCount: verdict?.componentCount ?? 0,
        structuredComponentCount: verdict?.structuredComponentCount ?? 0,
        contentKind:      verdict?.contentKind ?? "prose",
        contentItems:     verdict?.contentItems ?? 0,
        contentSatisfied: verdict?.contentSatisfied ?? true,
        contentSource:    verdict?.contentSource ?? "unknown",
        structuredItemCount: verdict?.structuredItemCount ?? 0,
        mappingPlaced:       verdict?.mappingPlacedItems ?? 0,
        mappingExpected:     verdict?.mappingExpectedItems ?? 0,
        mappingSlots:        verdict?.mappingSlotCount ?? 0,
        mappingMissing:      verdict?.mappingMissingRoles ?? [],
        mappingUnderfilled:  verdict?.mappingUnderfilled ?? false,
        mappingCompressed:   verdict?.mappingCompressed ?? false,
        subjectSlug:         verdict?.subjectImageSlug ?? "",
        subjectCategory:     verdict?.subjectImageCategory ?? "",
        subjectPlacement:    verdict?.subjectImagePlacement ?? "",
        subjectLicensed:     verdict?.subjectImageLicensed ?? false,
        subjectExpected:     verdict?.subjectImageExpected ?? false,
        compositionPattern:    verdict?.compositionPattern ?? "none",
        compositionFocal:      verdict?.compositionFocalZone ?? "none",
        compositionFocalArea:  verdict?.compositionFocalArea ?? 0,
        compositionCoverage:   verdict?.compositionCoverage ?? 0,
        compositionFlags:      verdict?.compositionFlags ?? [],
        styleHues:             verdict?.styleDistinctHues ?? 0,
        styleFonts:            verdict?.styleDistinctFonts ?? 0,
        styleFontFamilies:     verdict?.styleFontFamilies ?? [],
        styleMinContrast:      verdict?.styleMinContrast ?? 0,
        styleCtaContrast:      verdict?.styleCtaContrast ?? 0,
        styleRadiusCv:         verdict?.styleRadiusCv ?? 0,
        styleDecorCount:       verdict?.styleDecorationCount ?? 0,
        styleSubjectMode:      verdict?.styleSubjectMode ?? "none",
        styleFlags:            verdict?.styleFlags ?? [],
      });

      console.info(
        `[inline-generate] vi=${vi} theme=${verdict?.themeId ?? "?"} ` +
        `type=${verdict?.templateType ?? "?"} ` +
        `sections=${verdict?.sectionCount ?? 0}[${(verdict?.sections ?? []).join("+")}] ` +
        `components=${verdict?.componentCount ?? 0}/${verdict?.structuredComponentCount ?? 0}[${(verdict?.componentKinds ?? []).join("+")}] ` +
        `content=${verdict?.contentKind ?? "?"}×${verdict?.contentItems ?? 0} ` +
        `src=${verdict?.contentSource ?? "?"} items=${verdict?.structuredItemCount ?? 0} ` +
        `map=${verdict?.mappingPlacedItems ?? 0}/${verdict?.mappingExpectedItems ?? 0}` +
        `×${verdict?.mappingSlotCount ?? 0}` +
        (verdict?.mappingMissingRoles?.length ? `[-${verdict.mappingMissingRoles.join(",")}]` : "") +
        (verdict?.mappingCompressed  ? "!compressed"  : "") +
        (verdict?.mappingUnderfilled ? "!underfilled" : "") + " " +
        `subject=${verdict?.subjectImageSlug || (verdict?.subjectImageExpected ? "MISSING" : "n/a")} ` +
        (verdict?.subjectImagePlacement ? `@${verdict.subjectImagePlacement} ` : "") +
        `layout=${verdict?.compositionPattern ?? "?"}` +
        `/focal=${verdict?.compositionFocalZone ?? "?"}(${(verdict?.compositionFocalArea ?? 0).toFixed(0)}%)` +
        `/cov=${(verdict?.compositionCoverage ?? 0).toFixed(0)}%` +
        (verdict?.compositionFlags?.length ? `!${verdict.compositionFlags.join(",")}` : "") + " " +
        `style=hues${verdict?.styleDistinctHues ?? 0}` +
        `/fonts${verdict?.styleDistinctFonts ?? 0}` +
        `/contrast${(verdict?.styleMinContrast ?? 0).toFixed(1)}` +
        `/decor${verdict?.styleDecorationCount ?? 0}` +
        (verdict?.styleFlags?.length ? `!${verdict.styleFlags.join(",")}` : "") + " " +
        `accepted=${accepted} rank=${(verdict?.rankScore ?? 0).toFixed(2)} ` +
        `market=${(verdict?.marketplaceScore ?? 0).toFixed(2)}` +
        (rejectReasons.length > 0 ? ` reasons=[${rejectReasons.slice(0, 3).join("|")}]` : "") +
        ((verdict?.rankPenalties?.length ?? 0) > 0 ? ` pen=[${verdict!.rankPenalties.slice(0, 3).join("|")}]` : ""),
      );
      } // end inner for-loop over batchResults
    } // end outer while-loop over batches

    const budgetExhausted = timeLeft() <= PER_BATCH_MS_ESTIMATE * 1.2;
    if (budgetExhausted) {
      console.warn(
        `[inline-generate] Job ${jobId} hit the ${GENERATION_BUDGET_MS}ms time budget. ` +
        `attempts=${attemptedCount}/${MAX_ATTEMPTS} accepted=${acceptedCount()}/${totalVariations} ` +
        `elapsed=${Date.now() - startedAt}ms`,
      );
    }

    // Build the final admission list with *best-N by rank score + template-
    // type variety*. Candidates are picked greedily: each iteration
    // re-sorts the pool by rank score with a small penalty applied to
    // types already admitted, so the gallery surfaces different template
    // types (checklist, tips, quote, step-by-step, list, promotional,
    // educational, minimal) whenever available — without letting a
    // significantly higher-scoring candidate be blocked just because its
    // type was already picked. Floor-fill follows the same greedy logic
    // when accepted candidates alone can't satisfy the requested count.
    type Admission = RenderedCandidate & { floorFill: boolean };
    const TYPE_VARIETY_PENALTY = 0.06;

    const greedyPickN = (pool: RenderedCandidate[], n: number, seen: Set<string>, floorFill: boolean): Admission[] => {
      const remaining = pool.slice();
      const out: Admission[] = [];
      while (out.length < n && remaining.length > 0) {
        remaining.sort((a, b) => {
          const aPen = seen.has(a.templateType) ? TYPE_VARIETY_PENALTY : 0;
          const bPen = seen.has(b.templateType) ? TYPE_VARIETY_PENALTY : 0;
          return (b.rankScore - bPen) - (a.rankScore - aPen);
        });
        const pick = remaining.shift()!;
        out.push({ ...pick, floorFill });
        if (pick.templateType) seen.add(pick.templateType);
      }
      return out;
    };

    // Heartbeat between the end of the render loop and the start of
    // ranking/selection. Selection itself is ~O(n) over the candidate
    // pool so it's fast, but updating here means the UI bar tracks the
    // pipeline entering its "ranking" stage instead of sitting on the
    // last batch's attempt percentage.
    await stage("rank_select", Math.max(lastProgress, 86));

    // ── Per-rejected-candidate Design Brain audit ──────────────────────────
    // The strict-quality contract requires logging WHY each rejected
    // template was rejected so a post-mortem can answer "did this
    // gallery ship 2 candidates because 4 attempts hit domain_mismatch?".
    // Single line per reject; concise but structured (vi + reasons).
    const rejectedAudit = rendered.filter(r => !r.accepted);
    if (rejectedAudit.length > 0) {
      for (const r of rejectedAudit) {
        console.info(
          `[design-brain] Job ${jobId} rejected vi=${r.vi} ` +
          `theme=${r.themeId} type=${r.templateType} ` +
          `subjectCategory=${r.subjectCategory || "none"} ` +
          `rank=${r.rankScore.toFixed(2)} ` +
          `reasons=[${r.rejectReasons.slice(0, 4).join("|")}]`,
        );
      }
    }
    // ──────────────────────────────────────────────────────────────────
    // FINALIZATION STAGE BEGINS HERE.
    //
    // From this point through the COMPLETED write, every step is
    // wrapped in fine-grained try/catch. A throw here is a
    // FINALIZATION FAILURE — we log finalization_failed with a stack,
    // re-throw to the outer catch which writes a real FAILED row with
    // the exception message, and the Render wrapper's verify path then
    // surfaces it to the UI as `Render reported: ...`. Previously a
    // hang in S3 upload / asset.create / the COMPLETED write left the
    // job at RUNNING ~90% until the 360s stale watchdog flipped it
    // to FAILED with the generic "no worker heartbeat" copy.
    //
    // The heartbeat is INTENTIONALLY kept alive through the entire
    // finalization stretch (asset.create loop + the COMPLETED write).
    // The previous code stopped it before prisma.job.update — fine on
    // a fast Vercel function, but on Render's 0.5-CPU starter the
    // COMPLETED write itself can sit for several seconds while the
    // PgBouncer round-trip + JSON serialisation of the diagnostics
    // bundle complete. Stopping the heartbeat first meant updatedAt
    // didn't move during that window.
    // ──────────────────────────────────────────────────────────────────
    console.info(`[inline-generate] Job ${jobId} final_render_started progress=${currentProgress}`);

    // ── Always-ship admission (three tiers, never empty) ──────────────────
    //   Tier 1: candidates that passed every gate (accepted = true).
    //   Tier 2: floor-fill from soft-rejected candidates that still
    //           rendered something usable. Domain-mismatched
    //           candidates ARE eligible here — the soft penalty
    //           already pushed them down the rank, but a relevant-ish
    //           visual is strictly better than blank state.
    //   Tier 3: rescue. If the first two tiers can't fill the
    //           requested count, ship anything that produced an
    //           artefact ranked by softScore — including weak/
    //           off-domain candidates. This is what makes the
    //           contract "never empty under any condition".
    //
    //   The greedy picker uses softScore (rankScore field) so a
    //   perfect candidate always beats a soft-rejected one. The user
    //   sees the strongest available 3-4 templates, in priority
    //   order.
    const seenTypes = new Set<string>();
    const admitted: Admission[] = greedyPickN(
      rendered.filter(r => r.accepted && r.hasUsableArtefact),
      totalVariations,
      seenTypes,
      false,
    );

    if (admitted.length < totalVariations) {
      await pulse();
      const admittedVis = new Set(admitted.map(a => a.vi));
      // Floor-fill: ALL non-admitted candidates that produced an
      // artefact, including domain-mismatched ones. The soft
      // penalties on softScore already make domain-correct candidates
      // win when present; admitting mismatched ones is what keeps the
      // gallery non-empty on a free-tier resource hiccup.
      const fillPool = rendered.filter(
        r => !admittedVis.has(r.vi) && r.hasUsableArtefact,
      );
      const fill = greedyPickN(
        fillPool,
        totalVariations - admitted.length,
        seenTypes,
        true,
      );
      admitted.push(...fill);
    }

    // Stable order by render index so the UI shows variation numbering
    // in the order they were produced.
    admitted.sort((a, b) => a.vi - b.vi);
    // Post-admission pulse so the transition from ranking into the S3
    // upload loop doesn't leave a silent gap.
    await pulse();

    // Empty-gallery handling. The new always-ship contract means we
    // never throw "no admissible candidates" while a candidate
    // exists. The only path that still throws is the genuine
    // infrastructure failure: zero candidates rendered an artefact at
    // all (every attempt crashed mid-pipeline). That's not a quality
    // issue — there's literally nothing to ship — so we surface it
    // as a render-engine failure rather than an empty-gallery one.
    if (admitted.length === 0) {
      const renderable = rendered.filter(r => r.hasUsableArtefact).length;
      console.error(
        `[inline-generate] Job ${jobId} no_renderable_candidates ` +
        `attempts=${attemptedCount} rendered=${rendered.length} ` +
        `withArtefact=${renderable} budgetExhausted=${budgetExhausted}`,
      );
      throw tagError(
        new Error(
          budgetExhausted
            ? `Render engine produced no usable artefacts within the ${GENERATION_BUDGET_MS}ms budget across ${attemptedCount} attempt(s). Please retry.`
            : `Render engine produced no usable artefacts across ${attemptedCount} attempt(s). Please retry.`,
        ),
        budgetExhausted ? "timeout" : "render_failure",
      );
    }

    // Always-ship contract observability. When the gallery shipped
    // entirely from rescue tiers (every admitted candidate was a
    // floorFill), log a warning so ops can see "this user got a
    // rescue gallery" — not a failure, but worth tracking for
    // quality regressions on free-tier resources.
    const rescueCount = admitted.filter(a => a.floorFill).length;
    if (rescueCount > 0) {
      console.warn(
        `[design-brain] Job ${jobId} always_ship_rescue ` +
        `shipped=${admitted.length} rescued=${rescueCount} ` +
        `accepted=${admitted.length - rescueCount} ` +
        `attempts=${attemptedCount} ` +
        `domainMismatch=${admitted.filter(a => a.rejectReasons.some(r => r.startsWith("domain_mismatch:"))).length}`,
      );
    }

    const allAssetIds: string[] = [];
    let totalCreditCost = 0;
    let lastThumbnailUrl: string | null = null;
    let lastResult: any = null;

    // Pre-upload heartbeat so the user sees the bar tick forward from
    // "ranking" into "uploading" immediately when the loop starts.
    await stage("s3_upload", Math.max(lastProgress, 88));

    for (let idx = 0; idx < admitted.length; idx++) {
      const adm    = admitted[idx];
      const result = adm.result;
      const assetId = result.assetId;

      // Per-asset upload heartbeat. 88 → 95 across the admitted[] loop
      // so a 4-variation batch ticks ~2% per upload. Keeps updatedAt
      // moving while S3 is doing work (which can be several hundred ms
      // per blob when the bucket is in a different region).
      const uploadTarget = 88 + Math.floor(((idx + 1) / Math.max(1, admitted.length)) * 7);
      await pulse(uploadTarget);

      // Upload to S3 if configured. Free-tier mode renders SVG only,
      // so there's no PNG buffer to upload — only the SVG source. The
      // high-res PNG/PDF export runs separately when the user clicks
      // download/export and is uploaded then.
      let s3Key:  string | null = null;
      let svgKey: string | null = null;

      const hasPngBuffer = !!(result.buffer && result.buffer.length > 0);
      // Defensive: the renderer is supposed to populate svgSource for
      // every successful render (PNG mode rasterises the same SVG),
      // but the soft-gating contract admits anything with a usable
      // artefact — including PNG-only edge cases. Skip the SVG upload
      // (and the inline fallback) cleanly when there's no SVG text
      // to ship rather than letting Buffer.from(undefined) throw.
      const hasSvgSource = typeof result.svgSource === "string" && result.svgSource.length > 0;
      console.info(
        `[inline-generate] Job ${jobId} preview_upload_started idx=${idx} ` +
        `assetId=${assetId} mode=${INITIAL_OUTPUT_FORMAT} ` +
        `svgBytes=${result.svgSource?.length ?? 0} pngBytes=${result.buffer?.length ?? 0}`,
      );
      if (detectCapabilities().storage) {
        try {
          const { uploadToS3, buildS3Key } = require("./s3");
          if (hasSvgSource) {
            svgKey = buildS3Key(orgId, assetId, "svg");
          }
          // PNG is only uploaded when the renderer actually produced a
          // buffer — i.e. when the operator opted out of SVG-only mode.
          if (hasPngBuffer && hasSvgSource) {
            s3Key = buildS3Key(orgId, assetId, "png");
            await Promise.all([
              uploadToS3(s3Key,  result.buffer,                          "image/png"),
              uploadToS3(svgKey!, Buffer.from(result.svgSource, "utf-8"), "image/svg+xml"),
            ]);
          } else if (hasPngBuffer) {
            s3Key = buildS3Key(orgId, assetId, "png");
            await uploadToS3(s3Key, result.buffer, "image/png");
          } else if (hasSvgSource) {
            await uploadToS3(svgKey!, Buffer.from(result.svgSource, "utf-8"), "image/svg+xml");
          }
        } catch (s3Err: any) {
          // S3 failure is non-fatal per asset: the row is created with
          // s3Key = `inline:${assetId}` and the SVG source itself is
          // stored on the asset (so the gallery / editor can still
          // render). The wrapper's verify path doesn't care that the
          // s3Key is "inline:" — only that the asset row exists.
          console.warn(`[inline-generate] Job ${jobId} preview_upload_s3_failed idx=${idx} fallback=inline_svg: ${s3Err?.message ?? s3Err}`);
          diag.recordFailure("storage", s3Err);
          s3Key  = null;
          svgKey = null;
        }
      } else {
        console.info(`[inline-generate] Job ${jobId} preview_upload_skipped_no_storage idx=${idx} fallback=inline_svg`);
      }
      // Precedence note: `??` binds looser than `?:`, so writing
      // `s3Key ?? svgKey ? "s3" : "inline"` would resolve to
      // `s3Key ?? (svgKey ? "s3" : "inline")` and log the s3Key path
      // string itself when uploaded. Wrap the nullish coalesce.
      const stored = (s3Key ?? svgKey) ? "s3" : "inline";
      console.info(`[inline-generate] Job ${jobId} preview_upload_done idx=${idx} assetId=${assetId} stored=${stored}`);

      // Resolve thumbnailUrl. SVG-only mode ALWAYS surfaces the SVG
      // directly — either as a signed S3 URL when storage is wired up,
      // or as an inline base64 data: URL so the gallery can render
      // without any external fetch.
      let thumbnailUrl: string | null = null;
      const previewKey = s3Key ?? svgKey;
      if (previewKey && detectCapabilities().storage) {
        try {
          const { getSignedDownloadUrl } = require("./s3");
          thumbnailUrl = await getSignedDownloadUrl(previewKey, 3600).catch(() => null);
        } catch { /* no-op */ }
      }
      if (!thumbnailUrl && hasSvgSource) {
        thumbnailUrl = `data:image/svg+xml;base64,${Buffer.from(result.svgSource, "utf-8").toString("base64")}`;
      }

      // Credit only ACCEPTED admissions. Over-generated rejects are not
      // charged — they never reach the user.
      const creditCost = getCreditCost(format, false);
      totalCreditCost += creditCost;

      console.info(`[inline-generate] Job ${jobId} asset_create_started idx=${idx} assetId=${assetId} format=${format} mode=${INITIAL_OUTPUT_FORMAT}`);
      // SVG-only previews don't have a render-time fileSize from
      // sharp, so fall back to the SVG source byte length so the
      // gallery / billing have a real number rather than 0.
      const previewFileSize = (typeof result.fileSize === "number" && result.fileSize > 0)
        ? result.fileSize
        : (result.svgSource ? Buffer.byteLength(result.svgSource, "utf-8") : 0);
      // Persisted s3Key prefers the PNG (high-res, what export
      // workers will produce later) when present; falls back to the
      // SVG when only the preview was uploaded; finally falls back
      // to the inline marker so the gallery can render from
      // svgSource directly.
      const persistedKey = s3Key ?? svgKey ?? `inline:${assetId}`;
      try {
        await withTimeout(prisma.asset.create({
          data: {
            id:           assetId,
            userId,
            orgId,
            campaignId:   campaignId ?? null,
            name:         `${format}-v${idx + 1}`,
            format,
            category:     getCategoryLabel(format),
            mimeType:     INITIAL_MIME_TYPE,
            s3Key:        persistedKey,
            s3Bucket:     process.env.S3_BUCKET_NAME ?? "inline",
            width:        result.width,
            height:       result.height,
            fileSize:     previewFileSize,
            layoutFamily: result.layoutFamily,
            svgSource:    result.svgSource,
            brandScore:   result.brandScore,
            hierarchyValid: result.hierarchyValid,
            metadata: {
              layoutVariation:  result.layoutVariation,
              violations:       result.violations?.slice(0, 10) ?? [],
              svgKey:           svgKey ?? null,
              durationMs:       result.durationMs,
              pipelineMs:       adm.orchestrated.totalPipelineMs,
              anyFallback:      adm.orchestrated.anyFallback,
              allStagesPassed:  adm.orchestrated.allStagesPassed,
              inlineGenerated:  true,
              variationIdx:     adm.vi,
              thumbnailUrl,
              // Free-tier preview contract: tag every asset with the
              // initial output mode so the gallery UI can render the
              // SVG immediately and surface "High-res export
              // preparing" as a separate affordance until the user
              // requests a download/export and a high-res render
              // completes.
              outputMode:       INITIAL_OUTPUT_FORMAT === "svg" ? "svg_preview" : "png_full",
              previewMimeType:  INITIAL_MIME_TYPE,
              hasHighResPng:    hasPngBuffer,
              exportReady:      hasPngBuffer,
              // Gallery-grade admission audit.
              strictAdmission:  {
                accepted:         adm.accepted,
                floorFill:        adm.floorFill,
                rankScore:        adm.rankScore,
                marketplaceScore: adm.marketScore,
                rankPenalties:    adm.rankPenalties,
                themeId:          adm.themeId,
                templateType:     adm.templateType,
                sections:         adm.sections,
                sectionCount:     adm.sectionCount,
                componentKinds:   adm.componentKinds,
                componentCount:   adm.componentCount,
                structuredComponentCount: adm.structuredComponentCount,
                contentKind:      adm.contentKind,
                contentItems:     adm.contentItems,
                contentSatisfied: adm.contentSatisfied,
                rejectReasons:    adm.rejectReasons,
                failedCriteria:   adm.failedCriteria,
                attemptsUsed:     attemptedCount,
                acceptedCount:    acceptedCount(),
                requested:        totalVariations,
              },
            } as any,
          },
        }), ASSET_CREATE_TIMEOUT_MS, `asset.create idx=${idx}`);
      } catch (assetSaveErr: any) {
        // A persistent asset.create failure (or our own hard
        // timeout) is unrecoverable for this run — bail with a
        // tagged error so the outer catch writes FAILED with a
        // clear "Couldn't save asset N: <pg error>" message.
        // Without this throw the loop would keep going and
        // eventually write COMPLETED with a partial allAssetIds[]
        // that the wrapper's verify path would rightly reject.
        console.error(`[inline-generate] Job ${jobId} asset_create_failed idx=${idx} assetId=${assetId}: ${assetSaveErr?.message ?? assetSaveErr}`);
        diag.recordFailure("storage", assetSaveErr);
        throw tagError(
          new Error(`Couldn't save asset ${idx + 1}/${admitted.length}: ${assetSaveErr?.message ?? assetSaveErr}`),
          "asset_save_failed",
        );
      }
      console.info(`[inline-generate] Job ${jobId} asset_create_done idx=${idx} assetId=${assetId}`);

      allAssetIds.push(assetId);
      lastThumbnailUrl = thumbnailUrl;
      lastResult = result;

      // Post-asset-write heartbeat. Prisma's asset.create can be
      // several hundred ms (Postgres round-trip + JSONB column
      // write) and on a big gallery batch these stack up. Pulsing
      // here means even a 12-asset save loop never goes silent.
      await pulse();
    }

    const uniqueTypes = new Set(admitted.map(a => a.templateType));
    const avgSections = admitted.length
      ? (admitted.reduce((s, a) => s + a.sectionCount, 0) / admitted.length).toFixed(1)
      : "0.0";
    const uniqueSections   = new Set(admitted.flatMap(a => a.sections));
    const uniqueComponents = new Set(admitted.flatMap(a => a.componentKinds));
    const avgComponents    = admitted.length
      ? (admitted.reduce((s, a) => s + a.componentCount, 0) / admitted.length).toFixed(1)
      : "0.0";
    const uniqueContentKinds = new Set(admitted.map(a => a.contentKind));
    const avgContentItems    = admitted.length
      ? (admitted.reduce((s, a) => s + a.contentItems, 0) / admitted.length).toFixed(1)
      : "0.0";
    const contentSources = admitted.reduce<Record<string, number>>((acc, a) => {
      const k = a.contentSource || "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    const contentSourcesLabel = Object.entries(contentSources)
      .map(([k, v]) => `${k}:${v}`).join(",") || "none";
    const avgStructuredItems = admitted.length
      ? (admitted.reduce((s, a) => s + a.structuredItemCount, 0) / admitted.length).toFixed(1)
      : "0.0";
    const avgMappingPlaced = admitted.length
      ? (admitted.reduce((s, a) => s + a.mappingPlaced, 0) / admitted.length).toFixed(1)
      : "0.0";
    const avgMappingSlots = admitted.length
      ? (admitted.reduce((s, a) => s + a.mappingSlots, 0) / admitted.length).toFixed(1)
      : "0.0";
    const mappingCompressedCount  = admitted.filter(a => a.mappingCompressed).length;
    const mappingUnderfilledCount = admitted.filter(a => a.mappingUnderfilled).length;
    const subjectCount       = admitted.filter(a => a.subjectSlug).length;
    const subjectExpectedCount = admitted.filter(a => a.subjectExpected).length;
    const subjectLicensedCount = admitted.filter(a => a.subjectLicensed).length;
    const subjectSlugs = [...new Set(admitted.filter(a => a.subjectSlug).map(a => a.subjectSlug))];
    const patternCounts = admitted.reduce<Record<string, number>>((acc, a) => {
      const k = a.compositionPattern || "none";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    const patternLabel = Object.entries(patternCounts)
      .map(([k, v]) => `${k}:${v}`).join(",") || "none";
    const avgFocalArea = admitted.length
      ? (admitted.reduce((s, a) => s + a.compositionFocalArea, 0) / admitted.length).toFixed(1)
      : "0.0";
    const avgCoverage = admitted.length
      ? (admitted.reduce((s, a) => s + a.compositionCoverage, 0) / admitted.length).toFixed(1)
      : "0.0";
    const compFlagCounts = admitted.reduce<Record<string, number>>((acc, a) => {
      for (const f of a.compositionFlags) acc[f] = (acc[f] ?? 0) + 1;
      return acc;
    }, {});
    const compFlagsLabel = Object.entries(compFlagCounts)
      .map(([k, v]) => `${k}:${v}`).join(",") || "clean";
    const avgHues = admitted.length
      ? (admitted.reduce((s, a) => s + a.styleHues, 0) / admitted.length).toFixed(1)
      : "0.0";
    const avgFonts = admitted.length
      ? (admitted.reduce((s, a) => s + a.styleFonts, 0) / admitted.length).toFixed(1)
      : "0.0";
    const avgContrast = admitted.length
      ? (admitted.reduce((s, a) => s + a.styleMinContrast, 0) / admitted.length).toFixed(2)
      : "0.00";
    const avgDecor = admitted.length
      ? (admitted.reduce((s, a) => s + a.styleDecorCount, 0) / admitted.length).toFixed(1)
      : "0.0";
    const styleFlagCounts = admitted.reduce<Record<string, number>>((acc, a) => {
      for (const f of a.styleFlags) acc[f] = (acc[f] ?? 0) + 1;
      return acc;
    }, {});
    const styleFlagsLabel = Object.entries(styleFlagCounts)
      .map(([k, v]) => `${k}:${v}`).join(",") || "clean";
    const uniqueFontFamilies = new Set(admitted.flatMap(a => a.styleFontFamilies));
    console.info(
      `[inline-generate] Job ${jobId} admission: ` +
      `requested=${totalVariations} attempts=${attemptedCount} ` +
      `accepted=${acceptedCount()} shipped=${admitted.length} ` +
      `floorFilled=${admitted.filter(a => a.floorFill).length} ` +
      `types=[${[...uniqueTypes].join(",")}] ` +
      `avgSections=${avgSections} sections=[${[...uniqueSections].join(",")}] ` +
      `avgComponents=${avgComponents} components=[${[...uniqueComponents].join(",")}] ` +
      `avgContentItems=${avgContentItems} contentKinds=[${[...uniqueContentKinds].join(",")}] ` +
      `contentSources={${contentSourcesLabel}} avgStructuredItems=${avgStructuredItems} ` +
      `avgMapping=${avgMappingPlaced}items×${avgMappingSlots}slots ` +
      `compressed=${mappingCompressedCount} underfilled=${mappingUnderfilledCount} ` +
      `subjects=${subjectCount}/${subjectExpectedCount}expected licensed=${subjectLicensedCount} ` +
      `slugs=[${subjectSlugs.join(",")}] ` +
      `layouts={${patternLabel}} avgFocalArea=${avgFocalArea}% avgCoverage=${avgCoverage}% ` +
      `compositionFlags={${compFlagsLabel}} ` +
      `avgHues=${avgHues} avgFonts=${avgFonts} avgContrast=${avgContrast} avgDecor=${avgDecor} ` +
      `fontFamilies=[${[...uniqueFontFamilies].join(",")}] styleFlags={${styleFlagsLabel}}`,
    );

    // ── Domain-match audit ─────────────────────────────────────────────────
    // Every accepted candidate's asset usage is logged against the
    // brief's inferred category so the next time someone reports
    // "fitness clubs has no fitness visuals" we have a structured
    // log line to diagnose. This is observability only — we do NOT
    // reject mismatched candidates here (that's a quality-gate
    // concern, owned by marketplace-gate.ts).
    const briefCategory: string | null = (brief as any)?.category ?? null;
    if (briefCategory && admitted.length > 0) {
      const slugMatchCount = admitted.filter(a => {
        // Heuristic: an asset slug is a "match" if the brief
        // category appears anywhere in the slug or the slug's
        // recorded subject category. e.g. brief=fitness +
        // slug=dumbbell-3d → no string match, but for a richer
        // check we'd cross-reference selectAssetsForCategory's
        // output. Keep this simple for now — the OBSERVABILITY
        // signal is what matters; a false-negative just under-
        // counts matches.
        const slug = (a.subjectSlug ?? "").toLowerCase();
        return slug.includes(briefCategory) ||
               (a.compositionPattern ?? "").toLowerCase().includes(briefCategory);
      }).length;
      const matchPct = admitted.length > 0
        ? Math.round((slugMatchCount / admitted.length) * 100)
        : 0;
      console.info(
        `[inline-generate] Job ${jobId} domain_audit category=${briefCategory} ` +
        `admitted=${admitted.length} slugMatches=${slugMatchCount}/${admitted.length} (${matchPct}%) ` +
        `slugs=[${subjectSlugs.join(",")}]`,
      );
      if (matchPct === 0) {
        console.warn(
          `[inline-generate] Job ${jobId} domain_audit_warning: shipping ${admitted.length} candidates ` +
          `with ZERO ${briefCategory}-tagged assets. Asset selection or category recipes may need review.`,
        );
      }
    } else if (!briefCategory) {
      console.info(`[inline-generate] Job ${jobId} domain_audit category=null (skipping match check)`);
    }

    await pulse(96);

    // Deduct credits (creditBalance = canonical credit field).
    // Bounded by CREDIT_DEDUCTION_TIMEOUT_MS — credit deduction
    // is non-fatal (we log + continue if it fails or times out)
    // but it must not freeze the pipeline indefinitely. Without
    // this timeout, a hung org.update at this point would leave
    // the bar stuck at 96% (or 98% after the next pulse), which
    // was a contributor to the 98% freeze.
    await stage("credit_deduction", 96);
    try {
      await withTimeout(prisma.org.update({
        where: { id: orgId },
        data:  { creditBalance: { decrement: totalCreditCost } },
      }), CREDIT_DEDUCTION_TIMEOUT_MS, "credit deduction org.update");
    } catch (creditErr: any) {
      console.warn("[inline-generate] Credit deduction failed:", creditErr.message);
    }

    await pulse(98);

    // Heartbeat is INTENTIONALLY kept alive through the COMPLETED
    // write. The previous code stopped it here — fine on a fast
    // Vercel function, but on Render's 0.5-CPU starter the
    // PgBouncer round-trip + JSON serialisation of the diagnostics
    // bundle can sit for several seconds. Stopping the heartbeat
    // first meant updatedAt didn't move during that window, and a
    // PgBouncer hiccup or large-result hang could push us past the
    // stale-watchdog threshold mid-write.

    // Mark job COMPLETED. Diagnostics attach here too so successful
    // runs carry the same breadcrumb bundle as failures — ops can pivot
    // "average pipeline_render duration" across all COMPLETED jobs, not
    // just failed ones.
    diag.enterStage("terminal_write");
    if (allAssetIds.length === 0) {
      // Belt-and-braces: never write COMPLETED with empty assetIds.
      // The Render wrapper's verify path enforces this, but we'd
      // rather throw here so the outer catch writes a tagged FAILED
      // (with the real "no assets" message) than have the wrapper
      // discover an empty assetIds[] and write the generic
      // NO_ASSETS_ERROR.
      console.error(`[inline-generate] Job ${jobId} finalization_failed reason=no_assets_after_save_loop`);
      throw tagError(
        new Error("Final-stage rendering produced zero saved assets — refusing to mark COMPLETED."),
        "no_assets",
      );
    }
    console.info(`[inline-generate] Job ${jobId} final_db_write_started assetCount=${allAssetIds.length} progress=${currentProgress}`);
    try {
      await withTimeout(prisma.job.update({
        where: { id: jobId },
        data: {
          status:      JobStatus.COMPLETED,
          progress:    100,
          completedAt: new Date(),
          result: {
            assetIds:        allAssetIds,
            creditCost:      totalCreditCost,
            totalAssets:     allAssetIds.length,
            durationMs:      totalPipelineMs,
            inlineGenerated: true,
            thumbnailUrl:    lastThumbnailUrl,
            svgSource:       lastResult?.svgSource ?? null,
            format,
            width:           lastResult?.width,
            height:          lastResult?.height,
            // Free-tier preview contract: tell the UI it's looking at
            // SVG previews and that high-res PNG/PDF will be
            // generated lazily when the user clicks export. The
            // gallery can render the SVG immediately and surface a
            // separate "High-res export preparing" affordance per
            // asset.
            outputMode:      INITIAL_OUTPUT_FORMAT === "svg" ? "svg_preview" : "png_full",
            previewMimeType: INITIAL_MIME_TYPE,
            exportReady:     INITIAL_OUTPUT_FORMAT !== "svg",
            // Persist the Design Brain plan + free-tier flag so the
            // UI / audit trail knows which preset drove the gallery.
            designBrain:     designBrain,
            // Persist the terminal user-facing stage alongside the
            // diagnostics bundle so a job's last-seen progressStage is
            // always queryable, regardless of whether it completed or
            // failed.
            progressStage:   "finalizing",
            progressLabel:   USER_STAGE_LABEL.finalizing,
            diagnostics:     diag.snapshot(),
          } as any,
        },
      }), FINAL_DB_WRITE_TIMEOUT_MS, "final job.update for COMPLETED");
    } catch (terminalWriteErr: any) {
      // The COMPLETED write itself failed (or our own hard timeout
      // fired). Re-throw with a tagged reason so the outer catch
      // writes a FAILED row with a clear message instead of leaving
      // the job at RUNNING for the stale-watchdog to flip 6 minutes
      // later. This is the bug that caused the 98% freeze.
      console.error(`[inline-generate] Job ${jobId} finalization_failed stage=final_db_write: ${terminalWriteErr?.message ?? terminalWriteErr}`);
      console.error(terminalWriteErr?.stack?.split("\n").slice(0, 8).join("\n") ?? "(no stack)");
      throw tagError(
        new Error(`Finalization failed at COMPLETED write: ${terminalWriteErr?.message ?? terminalWriteErr}`),
        "finalization_failed",
      );
    }
    console.info(`[inline-generate] Job ${jobId} final_db_write_done assetCount=${allAssetIds.length}`);

    // Now that the row is COMPLETED the heartbeat is no longer
    // needed — and a stray pulse() AFTER COMPLETED would clobber
    // progress=100. Stop it here.
    stopHeartbeat();

    const totalWallClockMs = Date.now() - runStartMs;
    console.info(`[inline-generate] Job ${jobId} completed: ${allAssetIds.length} assets, ${totalPipelineMs}ms`);
    // Design Brain stage timing summary. Mirrors the diagnostics
    // collector's per-stage durations and adds the overall wall-clock
    // so a single grep tells ops whether the strict 60s "first
    // impression" contract held for this run.
    const stageSnapshot = diag.snapshot();
    const stageTimings  = stageSnapshot.stages
      .filter((s) => typeof s.durationMs === "number")
      .map((s) => `${s.stage}=${s.durationMs}ms`)
      .join(",");
    console.info(
      `[design-brain] Job ${jobId} stage_timings ` +
      `total=${totalWallClockMs}ms ` +
      `under60s=${totalWallClockMs <= 60_000} ` +
      `assets=${allAssetIds.length} ` +
      `attempts=${attemptedCount} ` +
      `accepted=${rendered.filter(r => r.accepted).length} ` +
      `rejected=${rendered.filter(r => !r.accepted).length} ` +
      `domain=${designBrain.domain} ` +
      `style=${designBrain.visualStyle} ` +
      `[${stageTimings}]`,
    );

    // ── Free-tier breakdown log ─────────────────────────────────────────
    // Spec'd timing fields rolled up from the diagnostic stage table:
    //   designBrainMs   — buildDesignBrain() wall-clock
    //   briefMs         — analyzeBrief OpenAI call
    //   svgBuildMs      — pipeline_render (orchestrator + per-variation
    //                     SVG renders, no PNG)
    //   assetSelectMs   — rank_select (greedy admission + floor-fill)
    //   dbSaveMs        — sum of s3_upload + credit_deduction +
    //                     terminal_write
    //   totalMs         — wall-clock since runInlineGeneration entered
    const stageMsByName: Record<string, number> = {};
    for (const s of stageSnapshot.stages) {
      if (typeof s.durationMs === "number") {
        stageMsByName[s.stage] = (stageMsByName[s.stage] ?? 0) + s.durationMs;
      }
    }
    const briefMs        = stageMsByName.brief_analyze ?? 0;
    const svgBuildMs     = stageMsByName.pipeline_render ?? 0;
    const assetSelectMs  = stageMsByName.rank_select ?? 0;
    const dbSaveMs       = (stageMsByName.s3_upload ?? 0) +
                           (stageMsByName.credit_deduction ?? 0) +
                           (stageMsByName.terminal_write ?? 0);
    console.info(
      `[free-tier] Job ${jobId} timing ` +
      `designBrainMs=${designBrainElapsedMs} ` +
      `briefMs=${briefMs} ` +
      `svgBuildMs=${svgBuildMs} ` +
      `assetSelectMs=${assetSelectMs} ` +
      `dbSaveMs=${dbSaveMs} ` +
      `totalMs=${totalWallClockMs} ` +
      `under60s=${totalWallClockMs <= 60_000} ` +
      `outputMode=${INITIAL_OUTPUT_FORMAT === "svg" ? "svg_preview" : "png_full"} ` +
      `domain=${designBrain.domain} ` +
      `assets=${allAssetIds.length}`,
    );

    if (totalWallClockMs > 60_000) {
      console.warn(
        `[design-brain] Job ${jobId} BUDGET_OVERRUN: total=${totalWallClockMs}ms ` +
        `exceeds 60s strict-quality contract — investigate stage timings.`,
      );
    }

  } catch (err: any) {
    // Extract the structured reason code — either explicitly tagged at
    // a throw site (time-budget exhaustion, empty gallery) or inferred
    // from the error message for third-party failures (OpenAI 5xx,
    // sharp / S3 errors). This is what the UI uses to pick the right
    // title ("AI service error" vs "Rendering failed") and to decide
    // whether retry is meaningful.
    const reason = extractReason(err);
    console.error(`[inline-generate] Job ${jobId} failed [${reason}]:`, err.message);
    // If the error is from the finalization stretch we've already
    // flagged (asset_save_failed / no_assets / finalization_failed)
    // — keep a structured log line with the FULL stack so
    // post-mortem in Render's dashboard doesn't require digging.
    // Other reasons fall through to the existing diagnostic write
    // unchanged.
    if (
      reason === "asset_save_failed" ||
      reason === "no_assets" ||
      reason === "finalization_failed"
    ) {
      console.error(
        `[inline-generate] Job ${jobId} finalization_failed reason=${reason} message=${JSON.stringify(err?.message ?? "")}`,
      );
      console.error(err?.stack ?? "(no stack)");
    }

    // Always write a FAILED row first so the row reflects truth even if
    // the auto-retry path below also fails to schedule. The retry block
    // then resets the row through prepareRetry — which goes through the
    // same atomic FAILED→PENDING claim the explicit /retry endpoint
    // uses, so we can't accidentally race a user-initiated retry.
    //
    // diagnostics bundle is snapshot()ed BEFORE any side-effectful
    // work so the persisted stage reflects where the error actually
    // fired (pipeline_render, brief_analyze, etc.) rather than
    // "terminal_write". That single field makes ops queries like
    // "which stage produces the most failures" possible.
    const diagSnapshot = diag.snapshot();
    // Derive the user-facing stage from the diagnostic failStage so
    // the UI can show "Generation failed during: Building layout"
    // instead of a blank or technical label.
    const failUserStage = userStageForDiagStage(diagSnapshot.failStage);
    // Bounded by FAIL_WRITE_TIMEOUT_MS — without this timeout, a
    // hung PgBouncer at this point would leave the row at RUNNING
    // forever (the heartbeat worker keeps updatedAt fresh, so the
    // stale watchdog never fires). The wrapper's verify path
    // would then mark FAILED via writeFailedTerminal, which is
    // also bounded.
    await withTimeout(prisma.job.update({
      where: { id: jobId },
      data: {
        status:   JobStatus.FAILED,
        failedAt: new Date(),
        result: {
          error:           err.message ?? "Generation failed",
          failReason:      reason,
          failStage:       diagSnapshot.failStage,
          elapsedMs:       diagSnapshot.elapsedMs,
          workerMode:      diagSnapshot.workerMode,
          inlineGenerated: true,
          // Last-known user-facing stage when the error fired. Useful
          // both in the dashboard's failure cards and on the
          // user-visible retry prompt.
          progressStage:   failUserStage,
          progressLabel:   USER_STAGE_LABEL[failUserStage],
          diagnostics:     diagSnapshot,
        } as any,
      },
    }), FAIL_WRITE_TIMEOUT_MS, "outer-catch FAILED write").catch((failWriteErr) => {
      console.error(`[inline-generate] Job ${jobId} fail_write_failed: ${failWriteErr?.message ?? failWriteErr}`);
    });

    // ── Auto-retry DISABLED on free-tier ─────────────────────────────────
    // The free-tier contract is "one fast attempt, then best-available
    // result". Auto-retries chain another full pipeline run on a
    // 0.5-CPU shared instance, which blows the 60s wall-clock budget
    // and contributes to the "still generating after 3 minutes"
    // symptom. The user already sees the FAILED row written above
    // with a real error message + the Design Brain plan attached, so
    // they can re-run from the UI when ready.
    //
    // The opt-out exists so a future paid-tier deploy can flip
    // ARKIOL_DISABLE_AUTO_RETRY=0 to restore the old chain without
    // a code change.
    const autoRetryDisabled =
      (process.env.ARKIOL_DISABLE_AUTO_RETRY ?? "1").trim() !== "0";
    try {
      if (autoRetryDisabled) {
        console.info(
          `[inline-generate] Job ${jobId} auto-retry skipped (free-tier contract: one attempt only). ` +
          `Reason was ${reason}.`,
        );
        // Skip the prepareRetry path entirely — the catch below is
        // only kept for the rare opt-out case.
      } else {
        // Lazy require — these modules pull in the platform primitives
        // (next/server, @vercel/functions) and the prisma client; we
        // don't want to risk the catch handler itself throwing during
        // a top-of-module import.
        const { prepareRetry } = require("./jobRetry");
        const { durableRunInlineGeneration } = require("./durableRun");
        const prep = await prepareRetry(jobId, null);
        console.info(
          `[inline-generate] Job ${jobId} auto-retrying after ${reason} ` +
          `(attempt ${prep.attemptsUsed + 1}/${prep.maxAttempts}).`,
        );
        durableRunInlineGeneration(prep.params);
      }
    } catch (retryErr: any) {
      // Rejected retry is the EXPECTED path for non-retryable failure
      // reasons and for jobs that have already used their retry budget.
      // Log at info — the row is already FAILED, the user can see the
      // explanation, no further action needed.
      const isExpected = retryErr?.name === "RetryNotAllowedError";
      const lvl = isExpected ? console.info : console.warn;
      lvl(
        `[inline-generate] Auto-retry skipped for job ${jobId}: ` +
        `${retryErr?.message ?? retryErr}`,
      );
    }
  } finally {
    // Always tear down the periodic heartbeat so the Node event loop
    // can drain after the request returns. Without this the serverless
    // function would sit idle holding a timer reference.
    stopHeartbeat();
  }
}
