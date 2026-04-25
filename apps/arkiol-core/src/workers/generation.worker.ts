// src/workers/generation.worker.ts
// Generation Worker — uses the Advanced AI Engine pipeline orchestrator.
// Run as a separate long-running process (Railway / Fly.io / EC2):
//   npm run worker:gen
//
// All generation now goes through runGenerationPipeline() which enforces the
// full 7-stage AI engine in strict execution order:
//
//   Stage 1: Intent Analysis
//   Stage 2: Layout Intelligence
//   Stage 3: Auto-Variation
//   Stage 4: Audience Modeling
//   Stage 5: Content Density / Hierarchy Optimization
//   Stage 6: Brand Learning
//   Stage 7: Asset Engine (unified render: Layout Authority → Density →
//             AssetContract → AI → Hierarchy → Style → Render)
//
// Zero cross-stage mutation, deterministic fallbacks, idempotent safety,
// structured logging, benchmarking, A/B hooks, and metadata persistence.

import { Worker, Job } from "bullmq";
import { prisma }      from "../lib/prisma";
import { analyzeBrief } from "../engines/ai/brief-analyzer";
// ── v9 Observability + Queue Intelligence ──────────────────────────────────
import {
  recordQueueMetrics,
  obsLogger,
  buildCorrelationId,
} from "../lib/observability";
import {
  inferJobPriority,
  CostMonitor,
} from "../engines/queue/render-queue";
import { scorePlatformCompliance } from "../engines/platform/intelligence";
// Cost monitor singleton (in-process; reset on worker restart)
const workerCostMonitor = new CostMonitor();
import {
  runGenerationPipeline,
  KillSwitchError,
  PipelineHardFailureError,
  type OrchestratorInput,
} from "../engines/ai/pipeline-orchestrator";
import { SpendGuardError } from "../engines/render/pipeline";
import { uploadToS3, buildS3Key, getSignedDownloadUrl } from "../lib/s3";
import { getOpenAIClient }                              from "../lib/openai";
import { getCreditCost, getCategoryLabel, GIF_ELIGIBLE_FORMATS } from "../lib/types";
import { withRetry, extractErrorCode } from "../lib/error-handling";
import { logJobEvent, logError, logger } from "../lib/logger";
import { dlqQueue } from "../lib/queue";
import { deliverWebhooks, deliverDirectWebhook } from "./webhook.worker";
import { JobStatus } from "@prisma/client";
import {
  createFeedbackLogger,
  summarizeJobBenchmarks,
  persistBenchmark,
  persistJobSummary,
  writeStageTraces,
  upsertJobMetadata,
  buildStageTracesFromPerfs,
  checkKillSwitch,
  checkGlobalMonthlySpend,
  getEnv,
  getPlanConfig,
  CREDIT_COSTS,
  createCreditService,
  // ── Control Plane v2 ──────────────────────────────────────────────────────
  initializeControlPlane,
  createCrashSafetyService,
  buildAssetRelationships,
  recordAssetRelationships,
  type AssetBenchmark,
  type AssetEngineDeps,
  // ── Production Hardening ──────────────────────────────────────────────────
  holdCredits,
  finalizeCredits,
  refundCredits,
  checkAssetIdempotency,
  buildAssetIdempotencyKey,
  createStructuredLogger,
  createPipelineTracer,
  computeParallelismMetrics,
  type ParallelPipelineResult,
} from "@arkiol/shared";

// ── Structured observability ─────────────────────────────────────────────────
const structuredLogger = createStructuredLogger({
  service:  'worker:generation',
  env:      process.env.NODE_ENV ?? 'production',
  workerId: process.env.WORKER_ID ?? `w_${Date.now().toString(36)}`,
});

// ── Worker heartbeat state ───────────────────────────────────────────────────
const workerStartTime = Date.now();
const workerId = process.env.WORKER_ID ?? `w_gen_${Date.now().toString(36)}`;
let activeJobCount    = 0;
let completedLast5Min = 0;
let failedLast5Min    = 0;

const heartbeatInterval = setInterval(async () => {
  const cs = createCrashSafetyService({ prisma, logger });
  await cs.recordWorkerHealth({
    workerId,
    queueName:         'arkiol:generation',
    status:            'healthy',
    activeJobs:        activeJobCount,
    completedLast5Min,
    failedLast5Min,
    avgJobDurationMs:  0,
    lastHeartbeatAt:   new Date().toISOString(),
    uptimeMs:          Date.now() - workerStartTime,
  }).catch(() => {});
  completedLast5Min = 0;
  failedLast5Min    = 0;
}, 30_000);
if (heartbeatInterval.unref) heartbeatInterval.unref();

// ── Control plane boot (idempotent — runs once per worker process) ─────────────
// Registers all engine contracts, locks the registry, and validates integrity.
// Any engine not registered here CANNOT execute — RegistryViolationError is thrown.
initializeControlPlane();

// ── Types ─────────────────────────────────────────────────────────────────────
interface GenerationPayload {
  jobId:       string;
  userId:      string;
  orgId:       string;
  prompt:      string;
  formats:     string[];
  stylePreset: string;
  variations:  number;
  brandId?:    string;
  campaignId?: string;
  includeGif:  boolean;
  maxVariationsPerRun?: number;
  // BCP-47 locale code — all AI-generated copy is produced in this language
  locale?:     string;
  // Bulk generation: if this job belongs to a batch
  batchId?:    string;
  // Automation API extras (present when job originates from /api/automation/generate)
  webhookUrl?:      string;   // caller webhook URL for direct automation delivery
  externalId?:      string;   // caller-supplied correlation ID
  automationLabel?: string;   // human label for this automation batch
  // V16: Intelligence pipeline metadata (from /api/generate pre-flight)
  v16_layout?:      Record<string, unknown>;
  v16_variation?:   Record<string, unknown>;
  v16_audience?:    Record<string, unknown>;
  v16_density?:     Record<string, unknown>;
  v16_brand?:       Record<string, unknown>;
  v16_pipeline_ms?: number;
  v16_any_fallback?: boolean;
  // HQ upgrade: explicit user choice — only applied when true (never auto-inferred)
  hqUpgrade?:   boolean;
  // Stage 8: Archetype + Preset Intelligence override from editor UI
  archetypeOverride?: {
    archetypeId: string;
    presetId:    string;
  };
}

// ── V16: Fire-and-forget AI feedback logger (Prisma sink) ─────────────────────
const feedbackLogger = createFeedbackLogger(async (event) => {
  await (prisma as any).aIFeedbackEvent.create({
    data: {
      id:           `fe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      orgId:        event.orgId,
      sessionId:    event.sessionId,
      jobId:        event.jobId        ?? null,
      assetId:      event.assetId      ?? null,
      eventType:    event.eventType,
      format:       event.format       ?? null,
      planKey:      event.planKey      ?? null,
      variationIdx: event.variationIdx ?? null,
      durationMs:   event.durationMs   ?? null,
      qualityScore: event.qualityScore ?? null,
      metadata:     event.metadata     ?? {},
      occurredAt:   new Date(event.occurredAt),
    },
  });
});

// ── Worker ────────────────────────────────────────────────────────────────────
const worker = new Worker<GenerationPayload>(
  "arkiol:generation",
  async (job: Job<GenerationPayload>) => {
    const {
      jobId, userId, orgId,
      prompt, formats, stylePreset, variations,
      brandId, campaignId, includeGif, archetypeOverride,
      locale,
    } = job.data;

    logJobEvent(jobId, "started", { formatsCount: formats.length, variations, includeGif });

    // ── A2: Idempotency — same job ID cannot be processed twice ────────────
    // NEW-002 FIX: Also skip CANCELLED jobs. Previously only COMPLETED was
    // checked, so a user calling DELETE /api/jobs?id=X would mark the DB row
    // CANCELLED but the BullMQ job would still execute — generating assets and
    // deducting credits. Now we bail early for both terminal states.
    const existingJob = await prisma.job.findUnique({ where: { id: jobId } });
    if (existingJob?.status === "COMPLETED") {
      logJobEvent(jobId, "skipped_duplicate", { reason: "already_completed" });
      return { assetIds: (existingJob.result as any)?.assetIds ?? [], creditCost: 0, skipped: true };
    }
    if (existingJob?.status === "CANCELLED") {
      logJobEvent(jobId, "skipped_cancelled", { reason: "user_cancelled" });
      return { assetIds: [], creditCost: 0, skipped: true, cancelled: true };
    }

    // ── Mark running (FSM-validated via control plane crash safety) ───────
    const crashSafety = createCrashSafetyService({ prisma, logger });
    await crashSafety.transitionJob(jobId, 'running');
    // Legacy direct update preserved alongside for progress tracking compat
    await prisma.job.update({
      where: { id: jobId },
      data:  { startedAt: new Date(), attempts: { increment: 1 } },
    }).catch(() => {});
    await job.updateProgress(2);
    await job.updateProgress(5); // "picked up and running"

    // ── EARLY KILL-SWITCH + SPEND GUARD CHECK ─────────────────────────────
    // Check before any DB writes, brief analysis, or AI calls.
    // This is an additional defensive layer — preflightJob() already runs at
    // the API /generate endpoint, but we re-check here because the kill-switch
    // may have been activated between job submission and worker pickup.
    // FAIL-CLOSED: if check throws unexpectedly, the error propagates to BullMQ.
    const earlyKillResult = checkKillSwitch();
    if (!earlyKillResult.allowed) {
      logger.warn({ jobId, reason: earlyKillResult.reason }, '[generation-worker] Kill-switch active at job start — aborting before brief analysis');
      const err = new KillSwitchError(jobId, formats[0] ?? 'unknown');
      await prisma.job.update({
        where: { id: jobId },
        data:  {
          status:   JobStatus.FAILED,
          failedAt: new Date(),
          result:   { error: err.userMessage, code: err.code, httpStatus: err.httpStatus, stage: 'pre_brief' } as any,
        },
      }).catch(() => {});
      throw err;
    }

    // ── Fetch brand ────────────────────────────────────────────────────────
    const brand = brandId
      ? await prisma.brand.findUnique({ where: { id: brandId } }) ?? undefined
      : undefined;

    // ── Analyze brief once — shared across all format × variation tasks ───
    let brief: Awaited<ReturnType<typeof analyzeBrief>>;
    try {
      brief = await withRetry(
        () => analyzeBrief({
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
        }),
        { maxAttempts: 3 }
      );
    } catch (err: any) {
      logError(err, { jobId, stage: "brief_analysis" });
      await prisma.job.update({
        where: { id: jobId },
        data:  { status: JobStatus.FAILED, result: { error: "Brief analysis failed", detail: err.message } },
      });
      throw new Error(`Brief analysis failed: ${err.message}`);
    }
    await job.updateProgress(12); // brief analysis done, starting generation

    const totalTasks      = formats.length * variations;
    const createdAssetIds: string[] = [];
    const jobBenchmarks:   AssetBenchmark[] = [];
    let   totalCreditCost = 0;
    let   completedTasks  = 0;

    // ── Resolve org plan config for asset engine enforcement ─────────────
    const orgForPlan = await prisma.org.findUnique({
      where:  { id: orgId },
      select: { plan: true, creditsUsed: true, creditLimit: true, budgetCapCredits: true },
    });
    const planConfig = orgForPlan ? getPlanConfig(orgForPlan.plan) : null;

    // ── Build asset engine dependencies (injected, not imported directly) ─
    // These are threaded through the orchestrator → pipeline → assetEngine so
    // the engine module stays dependency-free (testable in isolation).
    const assetEngineDeps: AssetEngineDeps = {
      prisma: prisma as any,
      openai: getOpenAIClient(),
      uploadFn: async (buf: Buffer, key: string, mimeType: string, metadata?: Record<string, string>) => {
        return uploadToS3(key, buf, mimeType, metadata);
      },
      getSignedUrlFn: async (key: string, expiresIn?: number) => {
        return getSignedDownloadUrl(key, expiresIn);
      },
    };

    // ── Credit service for atomic on-demand asset deduction/refund ────────
    const creditService = createCreditService(prisma as any);

    // ── Global monthly spend for asset engine spend guard (fetched once) ──
    // Used by the asset engine's internal spend guard; read from DB aggregate.
    // FAIL-CLOSED: if the query throws or returns an unexpected value, we use
    // a sentinel (Infinity) so checkGlobalMonthlySpend() will deny generation
    // rather than silently permitting unlimited spend.
    let globalMonthlySpendUsd: number = Infinity; // fail-closed default
    try {
      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const spendAgg = await (prisma as any).creditTransaction.aggregate({
        where: { type: 'ai_generation', createdAt: { gte: monthStart } },
        _sum: { providerCostUsd: true },
      });
      const raw = spendAgg._sum?.providerCostUsd;
      if (typeof raw === 'number' && isFinite(raw) && raw >= 0) {
        globalMonthlySpendUsd = raw;
      } else if (raw === null || raw === undefined) {
        // No records yet — spend is 0, allow generation
        globalMonthlySpendUsd = 0;
      }
      // If raw is NaN or non-numeric, remains Infinity (fail-closed)
    } catch (spendErr: any) {
      logger.error(
        { jobId, err: spendErr.message },
        '[generation-worker] SPEND_GUARD_FETCH_FAILED: cannot calculate global monthly spend — generation blocked (fail-closed)'
      );
      // globalMonthlySpendUsd remains Infinity — checkGlobalMonthlySpend will deny
    }

    // ── Per-format × per-variation generation — PARALLEL with bounded concurrency ──
    // Tasks run concurrently up to TASK_CONCURRENCY at a time.
    // Rationale: renderAsset is CPU+I/O bound (Sharp + S3). Unbounded parallelism
    // would thrash CPU and spike memory. Concurrency=3 lets a 9-task job complete
    // in ~3 sequential rounds rather than 9, while keeping memory and CPU safe.
    //
    // Fatal errors (KillSwitch, SpendGuard, HardFailure) re-throw immediately,
    // which cancels all pending tasks via Promise.allSettled short-circuit.
    // Per-asset errors remain non-fatal — that task is skipped, others continue.
    const TASK_CONCURRENCY = 3;
    const activeSlots = new Array(TASK_CONCURRENCY).fill(Promise.resolve());
    let slotIdx = 0;

    // Build the flat task list upfront so we can compute totalTasks for progress
    type TaskDef = { format: string; vi: number; taskLabel: string };
    const taskDefs: TaskDef[] = formats.flatMap((format: string) =>
      Array.from({ length: variations }, (_, vi) => ({ format, vi, taskLabel: `${format}@v${vi}` }))
    );

    // Per-task runner — returns the asset ID on success, null on non-fatal skip
    const runTask = async ({ format, vi, taskLabel }: TaskDef): Promise<string | null> => {
      try {
        // Build orchestrator input — threads brand kit for Stage 6 learning
        const orchestratorInput: OrchestratorInput = {
            jobId:       jobId,
            orgId,
            campaignId:  campaignId ?? jobId,
            format,
            variationIdx: vi,
            stylePreset,
            archetypeOverride: archetypeOverride as any,
            outputFormat: "png",
            pngScale:     1,
            brief,
            brand: brand ? {
              primaryColor:   brand.primaryColor,
              secondaryColor: brand.secondaryColor,
              fontDisplay:    brand.fontDisplay,
              fontBody:       brand.fontBody,
              voiceAttribs:   brand.voiceAttribs as Record<string, number>,
              // Stage 6 brand learning inputs
              colors:   [brand.primaryColor, brand.secondaryColor],
              fonts:    brand.fontDisplay ? [{ family: brand.fontDisplay }] : [],
              tone:     brand.voiceAttribs ? Object.keys(brand.voiceAttribs as object) : [],
            } : undefined,
            requestedVariations:  variations,
            maxAllowedVariations: (job.data as GenerationPayload).maxVariationsPerRun ?? variations,

            // ── On-Demand Asset Engine context ──────────────────────────────
            assetEngine: planConfig ? {
              deps:                 assetEngineDeps,
              orgId,
              jobId,
              planCanUseHq:         planConfig.canUseHqUpgrade,
              maxOnDemandAssets:    planConfig.maxOnDemandAssets,
              globalMonthlySpendUsd,
              palette:              brand ? [brand.primaryColor, brand.secondaryColor].filter(Boolean) : [],
              hqUpgradeRequested:   (job.data as GenerationPayload).hqUpgrade === true,
              style:                stylePreset,
              onCreditDeduct: async (amount: number, reason: string, assetId: string) => {
                const iKey = `on_demand_asset:${jobId}:${assetId}`;
                await creditService.deductCredits(orgId, amount, reason, iKey, {
                  jobId, assetId, format, variationIdx: vi,
                });
                totalCreditCost += amount;
                logger.info(
                  { jobId, orgId, assetId, amount, reason },
                  "[generation-worker] On-demand asset credit deducted"
                );
              },
              onCreditRefund: async (amount: number, reason: string, assetId: string) => {
                const iKey = `on_demand_refund:${jobId}:${assetId}`;
                try {
                  await creditService.refundOnDemandCredits(orgId, amount, reason, iKey, {
                    jobId, assetId, format,
                  });
                  totalCreditCost = Math.max(0, totalCreditCost - amount);
                  logger.info(
                    { jobId, orgId, assetId, amount, reason },
                    "[generation-worker] On-demand asset credit refunded"
                  );
                } catch (refundErr: any) {
                  logger.error(
                    { jobId, orgId, assetId, amount, reason, err: refundErr.message },
                    "[generation-worker] REFUND_FAILED: manual review required"
                  );
                }
              },
            } : undefined,
        };

        const orchestrated = await withRetry(
          () => runGenerationPipeline(orchestratorInput),
          { maxAttempts: 2 }
        );
        const { render: result } = orchestrated;

        // ── Log on-demand asset stage metadata (structured) ──────────────
        if (result.onDemandAssets) {
          const oda = result.onDemandAssets;
          logger.info({
            jobId, orgId, format, variationIdx: vi,
            stage:                "on_demand_assets",
            cacheHits:            oda.cacheHits,
            libraryHits:          oda.libraryHits,
            aiGenerations:        oda.aiGenerations,
            totalCreditCost:      oda.totalCreditCost,
            totalProviderCostUsd: oda.totalProviderCostUsd,
            elementCount:         oda.elements.length,
            elements:             oda.elements.map(e => ({
              elementId:   e.elementId,
              elementType: e.elementType,
              source:      e.source,
              creditCost:  e.creditCost,
              cacheHit:    e.cacheHit,
              durationMs:  e.durationMs,
              hasCdnUrl:   !!e.cdnUrl,
            })),
          }, "[generation-worker] On-demand asset stage complete");
        }

        // Upload PNG + SVG concurrently (no dependency between the two)
        const assetId = result.assetId;
        const s3Key   = buildS3Key(orgId, assetId, "png");
        const svgKey  = buildS3Key(orgId, assetId, "svg");

        await Promise.all([
          uploadToS3(s3Key, result.buffer, "image/png"),
          uploadToS3(svgKey, Buffer.from(result.svgSource, "utf-8"), "image/svg+xml"),
        ]);

        const creditCost = getCreditCost(format, false);
        totalCreditCost += creditCost;

        const idemCheck = await checkAssetIdempotency(prisma as any, jobId ?? assetId, format, vi);
        const asset = (idemCheck.exists && idemCheck.assetId)
          ? { id: idemCheck.assetId }
          : await prisma.asset.create({
          data: {
            id:             assetId,
            userId,
            orgId,
            campaignId:     campaignId ?? null,
            name:           `${format}-v${vi + 1}`,
            format,
            category:       getCategoryLabel(format),
            mimeType:       "image/png",
            s3Key,
            s3Bucket:       getEnv().S3_BUCKET_NAME,
            width:          result.width,
            height:         result.height,
            fileSize:       result.fileSize,
            layoutFamily:   result.layoutFamily,
            svgSource:      result.svgSource,
            brandScore:     result.brandScore,
            hierarchyValid: result.hierarchyValid,
            metadata: {
              layoutVariation:  result.layoutVariation,
              violations:       result.violations.slice(0, 10),
              svgKey,
              durationMs:       result.durationMs,
              pipelineMs:       orchestrated.totalPipelineMs,
              anyFallback:      orchestrated.anyFallback,
              allStagesPassed:  orchestrated.allStagesPassed,
              overallQuality:   orchestrated.benchmark.quality.overallScore,
              archetypeMetadata: (orchestrated as any).archetypeMetadata ?? null,
              layoutStrategy:   orchestrated.stages.layout.data.layoutType,
              audienceSegment:  orchestrated.stages.audience.data.segment,
              densityProfile:   orchestrated.stages.density.data.textBlockCount,
              brandAccuracy:    orchestrated.stages.brand.data.historicalAccuracy,
              variationAxes:    orchestrated.stages.variation.data.axes,
              ...(result.onDemandAssets ? {
                onDemandAssets: {
                  cacheHits:            result.onDemandAssets.cacheHits,
                  libraryHits:          result.onDemandAssets.libraryHits,
                  aiGenerations:        result.onDemandAssets.aiGenerations,
                  totalCreditCost:      result.onDemandAssets.totalCreditCost,
                  totalProviderCostUsd: result.onDemandAssets.totalProviderCostUsd,
                  elementCount:         result.onDemandAssets.elements.length,
                  elements:             result.onDemandAssets.elements.map(e => ({
                    elementId:   e.elementId,
                    elementType: e.elementType,
                    cdnUrl:      e.cdnUrl,
                    source:      e.source,
                  })),
                },
              } : {}),
              ...(result.editorZones ? {
                editorZones:      result.editorZones,
                editorSvgContent: result.editorSvgContent,
              } : {}),
            },
          },
        });
        jobBenchmarks.push(orchestrated.benchmark);

        // ── Record asset graph relationships (fire-and-forget) ────────────
        recordAssetRelationships(
          buildAssetRelationships({
            orgId,
            assetId:    asset.id,
            jobId,
            campaignId: campaignId ?? undefined,
            brandId:    brandId    ?? undefined,
            archetypeId: archetypeOverride?.archetypeId,
            presetId:    archetypeOverride?.presetId ?? stylePreset,
          }),
          { prisma, logger }
        ).catch(() => {});

        // ── Persist benchmark (non-blocking) ─────────────────────────────
        persistBenchmark(orchestrated.benchmark, { prisma, logger }).catch(
          (e: Error) => logger.warn({ err: e.message }, '[worker] benchmark persist failed (non-fatal)')
        );

        // ── Persist per-stage traces (non-blocking) ───────────────────────
        const stageTraces = buildStageTracesFromPerfs(
          jobId,
          orchestrated.render.assetId,
          orgId,
          orchestrated.stages ? Object.entries(orchestrated.stages).map(([id, s]: [string, any]) => ({
            stageId:    id,
            durationMs: s?.durationMs ?? 0,
            ok:         !s?.fallback,
            fallback:   s?.fallback ?? false,
            errorCount: s?.errorCount ?? 0,
            fallbackReason: s?.fallbackReason,
            decision:   s?.data ? JSON.stringify(s.data).slice(0, 200) : undefined,
          })) : []
        );
        writeStageTraces(stageTraces, { prisma, logger }).catch(() => {});

        // ── Per-asset progress + immediate webhook — user sees this asset NOW ──
        completedTasks++;
        const progress = Math.round(12 + (completedTasks / totalTasks) * 83);
        await job.updateProgress(progress);
        deliverWebhooks(orgId, "asset.ready", {
          jobId,
          assetId:        asset.id,
          format,
          variationIdx:   vi,
          totalExpected:  totalTasks,
          completedSoFar: completedTasks,
        }).catch(() => {});

        // ── GIF variant (same orchestrator, gif output) ────────────────────
        if (includeGif && GIF_ELIGIBLE_FORMATS.has(format)) {
          try {
            const gifOrchestrated = await runGenerationPipeline({
              ...orchestratorInput,
              outputFormat: "gif",
              gifStyle:     "kinetic_text",
            });
            const gifResult = gifOrchestrated.render;

            const gifId  = gifResult.assetId + "_gif";
            const gifKey = buildS3Key(orgId, gifId, "gif");
            await uploadToS3(gifKey, gifResult.buffer, "image/gif");
            totalCreditCost += CREDIT_COSTS.gif;

            const gifAsset = await prisma.asset.create({
              data: {
                id:           gifId,
                userId,
                orgId,
                campaignId:   campaignId ?? null,
                name:         `${format}-v${vi + 1}-animated`,
                format:       `gif_${format}`,
                category:     "motion",
                mimeType:     "image/gif",
                s3Key:        gifKey,
                s3Bucket:     getEnv().S3_BUCKET_NAME,
                width:        gifResult.width,
                height:       gifResult.height,
                fileSize:     gifResult.buffer.length,
                layoutFamily: gifResult.layoutFamily,
                svgSource:    gifResult.svgSource,
                brandScore:   gifResult.brandScore,
                hierarchyValid: gifResult.hierarchyValid,
                metadata: {
                  gifKey, gifStyle: "kinetic_text",
                  pipelineMs:   gifOrchestrated.totalPipelineMs,
                  anyFallback:  gifOrchestrated.anyFallback,
                  overallQuality: gifOrchestrated.benchmark.quality.overallScore,
                },
              },
            });
            createdAssetIds.push(gifAsset.id);
            jobBenchmarks.push(gifOrchestrated.benchmark);

            persistBenchmark(gifOrchestrated.benchmark, { prisma, logger }).catch(() => {});

          } catch (gifErr: any) {
            logError(gifErr, { jobId, stage: "gif_render", taskLabel });
            // GIF failure is non-fatal
          }
        }

        return asset.id;

      } catch (taskErr: any) {
        // ── KillSwitchError: ops emergency halt — fail the entire job immediately
        if (taskErr instanceof KillSwitchError) {
          logError(taskErr, { jobId, stage: "kill_switch", taskLabel });
          await crashSafety.sendToDeadLetter(jobId, taskErr.code ?? 'KILL_SWITCH_ACTIVE', taskErr.userMessage, {
            stage: 'kill_switch', taskLabel, attemptCount: job.attemptsMade,
          }).catch(() => {});
          await prisma.job.update({
            where: { id: jobId },
            data: {
              status:      JobStatus.FAILED,
              failedAt:    new Date(),
              result: {
                error:       taskErr.userMessage,
                code:        taskErr.code,
                httpStatus:  taskErr.httpStatus,
                internal:    taskErr.message,
                taskLabel,
                refunded:    false,
              } as any,
            },
          }).catch(() => {});
          deliverWebhooks(orgId, "job.failed", {
            jobId, code: taskErr.code, error: taskErr.userMessage,
          }).catch(() => {});
          throw taskErr;
        }

        // ── SpendGuardError: global monthly spend limit hit
        if (taskErr instanceof SpendGuardError) {
          logError(taskErr, { jobId, stage: "spend_guard", taskLabel, code: taskErr.code });
          const userMessage = "Generation is temporarily paused: global monthly spend limit has been reached. Please contact support.";
          await crashSafety.sendToDeadLetter(jobId, taskErr.code ?? 'SPEND_GUARD_ACTIVE', userMessage, {
            stage: 'spend_guard', taskLabel, attemptCount: job.attemptsMade,
          }).catch(() => {});
          await prisma.job.update({
            where: { id: jobId },
            data: {
              status:      JobStatus.FAILED,
              failedAt:    new Date(),
              result: {
                error:       userMessage,
                code:        taskErr.code,
                httpStatus:  503,
                internal:    taskErr.message,
                taskLabel,
                refunded:    false,
              } as any,
            },
          }).catch(() => {});
          deliverWebhooks(orgId, "job.failed", {
            jobId, code: taskErr.code, error: userMessage,
          }).catch(() => {});
          throw taskErr;
        }

        // ── PipelineHardFailureError: both PNG and SVG render paths failed
        if (taskErr instanceof PipelineHardFailureError) {
          logError(taskErr, { jobId, stage: "render_hard_failure", taskLabel });
          await prisma.job.update({
            where: { id: jobId },
            data: {
              status:      JobStatus.FAILED,
              failedAt:    new Date(),
              result: {
                error:      taskErr.userMessage,
                code:       taskErr.code,
                httpStatus: taskErr.httpStatus,
                internal:   taskErr.message,
                taskLabel,
              } as any,
            },
          }).catch(() => {});
          deliverWebhooks(orgId, "job.failed", {
            jobId, code: taskErr.code, error: taskErr.userMessage,
          }).catch(() => {});
          throw taskErr;
        }

        // ── All other per-asset errors are non-fatal: skip this asset
        logError(taskErr, { jobId, stage: "render", taskLabel });
        return null;
      }
    };

    // ── Bounded parallel execution ────────────────────────────────────────
    // p-limit pattern inline (no dep needed): maintain a pool of TASK_CONCURRENCY
    // active promises. Each slot picks the next task when it frees.
    const queue = [...taskDefs];
    const results: (string | null)[] = [];

    const runSlot = async (): Promise<void> => {
      while (queue.length > 0) {
        const task = queue.shift()!;
        const result = await runTask(task);
        results.push(result);
      }
    };

    // Launch TASK_CONCURRENCY concurrent slots — they drain the shared queue
    await Promise.all(
      Array.from({ length: Math.min(TASK_CONCURRENCY, taskDefs.length) }, runSlot)
    );

    // Collect all successfully created asset IDs into the outer tracking array
    for (const id of results) {
      if (id !== null) createdAssetIds.push(id);
    }

    // ── Persist job-level benchmark summary (non-blocking) ────────────────
    if (jobBenchmarks.length > 0) {
      const jobSummary = summarizeJobBenchmarks(jobId, orgId, jobBenchmarks);
      persistJobSummary(jobSummary, { prisma, logger }).catch(
        (e: Error) => logger.warn({ err: e.message }, '[worker] job summary persist failed (non-fatal)')
      );

      // ── Persist job-level metadata with stage aggregates ──────────────
      // Provides structured observability for admin dashboard.
      const fallbackReasons: Array<{ stageId: string; reason: string; assetId?: string }> = [];
      const stageTimings: Record<string, number> = {};
      for (const bm of jobBenchmarks) {
        if (Array.isArray(bm.stagePerfs)) {
          for (const sp of bm.stagePerfs as any[]) {
            stageTimings[sp.stageId] = (stageTimings[sp.stageId] ?? 0) + sp.durationMs;
            if (sp.fallback && sp.fallbackReason) {
              fallbackReasons.push({ stageId: sp.stageId, reason: sp.fallbackReason, assetId: bm.assetId });
            }
          }
        }
      }
      const killResult = checkKillSwitch();
      upsertJobMetadata({
        id:               `jm_${jobId}`,
        jobId,
        orgId,
        stageTimings,
        fallbackReasons,
        abAssignments:    jobSummary.abVariants as Record<string, string>,
        overallScore:     jobSummary.avgOverallScore,
        totalAssets:      jobSummary.assetCount,
        totalFallbacks:   Math.round(jobSummary.fallbackRate * jobSummary.assetCount),
        totalViolations:  Math.round(jobSummary.violationRate * jobSummary.assetCount),
        totalPipelineMs:  jobSummary.avgPipelineMs * jobSummary.assetCount,
        killSwitchActive: !killResult.allowed,
      }, { prisma, logger }).catch(() => {});

      logger.info({
        jobId,
        avgQuality:   jobSummary.avgOverallScore,
        avgMs:        jobSummary.avgPipelineMs,
        fallbackRate: jobSummary.fallbackRate,
        worstStage:   jobSummary.worstStage,
        abVariants:   jobSummary.abVariants,
      }, '[worker] Job benchmark summary');
    }

    // ── Finalize credits atomically (two-phase commit) ──────────────────────
    // finalizeCredits is idempotent — safe even if holdCredits was already
    // called at the API layer. Prevents double-charge via creditFinalized flag.
    if (totalCreditCost > 0 && createdAssetIds.length > 0) {
      await finalizeCredits(orgId, jobId, totalCreditCost, { prisma: prisma as any, logger }).catch((err: unknown) => {
        logger.error({ jobId, orgId, err }, '[generation-worker] finalizeCredits failed');
      });
    }

    if (campaignId) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data:  { status: JobStatus.COMPLETED, completedAt: new Date(), creditCost: totalCreditCost },
      });
    }

    // Route through crashSafety FSM — prevents illegal state transitions
    await crashSafety.transitionJob(jobId, 'completed');

    await job.updateProgress(100);
    completedLast5Min++;
    logJobEvent(jobId, "completed", { assetCount: createdAssetIds.length, creditCost: totalCreditCost });

    // ── Automation API: direct webhook delivery (fire-and-forget) ─────────
    // If this job came from /api/automation/generate, deliver to the caller's URL
    // rather than (or in addition to) org-registered webhooks.
    const automationWebhookUrl = job.data.webhookUrl;
    if (automationWebhookUrl) {
      // Collect signed download URLs (best-effort, 24h TTL)
      const downloadUrls: string[] = await Promise.all(
        createdAssetIds.map(aid =>
          prisma.asset.findUnique({ where: { id: aid }, select: { s3Key: true } })
            .then((a: { s3Key: string | null } | null) => a?.s3Key ? getSignedDownloadUrl(a.s3Key).catch(() => "") : "")
        )
      ).then(urls => urls.filter(Boolean));

      deliverDirectWebhook(automationWebhookUrl, "automation.job.completed", {
        batchId:      job.data.batchId ?? null,
        jobId,
        externalId:   job.data.externalId ?? null,
        label:        job.data.automationLabel ?? null,
        assetIds:     createdAssetIds,
        downloadUrls,
        creditCost:   totalCreditCost,
        formats:      formats ?? [],
        variations:   createdAssetIds.length,
      }).catch(() => {});  // errors already logged inside deliverDirectWebhook
    }

    // ── Batch progress callback (fire-and-forget) ─────────────────────────
    // If this job belongs to a batch, update the BatchJob counters and derive
    // the aggregate status. Non-fatal — batch counter drift is acceptable.
    const batchId = (job.data as GenerationPayload).batchId;
    if (batchId) {
      (async () => {
        try {
          const updated = await (prisma as any).batchJob.update({
            where: { id: batchId },
            data: {
              completedJobs: { increment: 1 },
              startedAt:     prisma.batchJob ? undefined : undefined, // set below
            },
          });
          // Derive aggregate status after increment
          const batchRow = await (prisma as any).batchJob.findUnique({ where: { id: batchId } });
          if (batchRow) {
            const done = batchRow.completedJobs + batchRow.failedJobs + batchRow.cancelledJobs;
            if (done >= batchRow.totalJobs) {
              let newStatus = "COMPLETED";
              if (batchRow.failedJobs === batchRow.totalJobs) newStatus = "FAILED";
              else if (batchRow.failedJobs > 0 || batchRow.cancelledJobs > 0) newStatus = "PARTIAL";
              await (prisma as any).batchJob.update({
                where: { id: batchId },
                data:  { status: newStatus, completedAt: new Date() },
              });
              // Fire batch.completed webhook
              deliverWebhooks(orgId, "batch.completed", {
                batchId,
                status:        newStatus,
                completedJobs: batchRow.completedJobs,  // already incremented by the update above
                failedJobs:    batchRow.failedJobs,
                totalJobs:     batchRow.totalJobs,
              }).catch(() => {});
            } else if (!batchRow.startedAt) {
              await (prisma as any).batchJob.update({
                where: { id: batchId },
                data:  { status: JobStatus.RUNNING, startedAt: new Date() },
              });
            }
          }
        } catch (batchErr: any) {
          logger.warn({ batchId, jobId, err: batchErr.message }, "[generation-worker] batch progress update failed (non-fatal)");
        }
      })();
    }

    // ── v9: Record render queue telemetry ────────────────────────────────
    const jobDurationMs    = Date.now() - (job.processedOn ?? Date.now());
    const isCampaign       = !!campaignId;
    const inferredPriority = inferJobPriority({
      isCampaignHero:    false,
      isCampaignJob:     isCampaign,
      isRegen:           false,
      isFirstGeneration: !isCampaign,
    });
    recordQueueMetrics({
      jobId,
      orgId,
      priority:   inferredPriority,
      outcome:    "success",
      durationMs: jobDurationMs,
      provider:   "openai",
      costUsd:    0,
      attempts:   1,
    });
    // Track spend in the in-process cost monitor
    if (totalCreditCost > 0) {
      workerCostMonitor.record({
        orgId, jobId, provider: "openai",
        costUsd: totalCreditCost * 0.02, // credit → USD approximation
        idempotencyKey: `${jobId}_completion`,
        timestamp: new Date().toISOString(),
      });
    }
    obsLogger.info(`[worker] Job completed — ${createdAssetIds.length} assets, ${jobDurationMs}ms`, {
      jobId, orgId, formats: formats.join(","), correlationId: buildCorrelationId(jobId, orgId, formats[0] ?? ""),
    });

    // V16: Fire-and-forget feedback event for AI learning pipeline
    // Includes benchmark quality scores to close the learning feedback loop
    feedbackLogger({
      eventType:    'generation_completed',
      orgId,
      sessionId:    jobId, // jobId as session proxy
      jobId,
      format:       formats[0],
      durationMs:   Date.now() - (job.processedOn ?? Date.now()),
      qualityScore: jobBenchmarks.length
        ? jobBenchmarks.reduce((s, b) => s + b.quality.overallScore, 0) / jobBenchmarks.length
        : undefined,
      metadata: {
        assetCount:       createdAssetIds.length,
        creditCost:       totalCreditCost,
        formats,
        variations,
        v16_any_fallback: (job.data as GenerationPayload).v16_any_fallback ?? false,
        // Benchmark data — feeds adaptive refinement signals
        avgQualityScore:  jobBenchmarks.length
          ? jobBenchmarks.reduce((s, b) => s + b.quality.overallScore, 0) / jobBenchmarks.length
          : null,
        avgBrandScore:    jobBenchmarks.length
          ? jobBenchmarks.reduce((s, b) => s + b.quality.brandAlignment, 0) / jobBenchmarks.length
          : null,
        fallbackCount:    jobBenchmarks.filter(b => b.anyFallback).length,
        totalViolations:  jobBenchmarks.reduce((s, b) => s + b.violationCount, 0),
      },
    });

    if (campaignId) {
      deliverWebhooks(orgId, "campaign.completed", {
        campaignId, jobId, assetCount: createdAssetIds.length, creditCost: totalCreditCost,
      }).catch((err: unknown) => logError(err, { stage: "webhook_delivery", jobId }));
    }

    return { assetIds: createdAssetIds, creditCost: totalCreditCost };
  },
  (() => {
    const env = getEnv();
    return {
      connection: {
        host:     env.REDIS_HOST,
        port:     env.REDIS_PORT,
        password: env.REDIS_PASSWORD,
        tls:      env.REDIS_TLS ? {} : undefined,
      },
      concurrency: env.WORKER_CONCURRENCY ?? 3,
      limiter:     { max: 15, duration: 60_000 },
    };
  })()
);

worker.on("failed", async (job: Job<GenerationPayload> | undefined, err: Error) => {
  if (!job) return;
  logError(err, { jobId: job.id, attempt: job.attemptsMade, queue: "arkiol:generation" });

  const maxAttempts = job.opts.attempts ?? 3;
  // ── v9: Record failure telemetry ────────────────────────────────────────
  recordQueueMetrics({
    jobId:      job.data.jobId,
    orgId:      job.data.orgId,
    priority:   inferJobPriority({ isCampaignHero: false, isCampaignJob: !!job.data.campaignId, isRegen: false, isFirstGeneration: true }),
    outcome:    job.attemptsMade >= maxAttempts ? "permanent_failure" : "retry",
    durationMs: Date.now() - (job.processedOn ?? Date.now()),
    provider:   "openai",
    costUsd:    0,
    attempts:   job.attemptsMade,
  });
  obsLogger.error(`[worker] Job failed (attempt ${job.attemptsMade}/${maxAttempts}): ${err.message}`, {
    jobId: job.data.jobId, orgId: job.data.orgId,
    correlationId: buildCorrelationId(job.data.jobId, job.data.orgId, "failure"),
  });
  if (job.attemptsMade >= maxAttempts) {
    // ── Write to authoritative DeadLetterJob table (crash safety) ────────
    // This is the permanent record — BullMQ's DLQ is ephemeral by comparison.
    const crashSafety = createCrashSafetyService({ prisma, logger });
    await crashSafety.sendToDeadLetter(job.data.jobId, extractErrorCode(err, 'PIPELINE_ERROR'), err.message, {
      attemptCount: job.attemptsMade, maxAttempts, stack: err.stack,
    }).catch(() => {});

    // ── Move to BullMQ Dead-Letter Queue (also preserved for backward compat) ──
    await dlqQueue.add("dead-letter", {
      originalQueue: "arkiol:generation",
      jobId:         job.data.jobId,
      orgId:         job.data.orgId,
      userId:        job.data.userId,
      payload:       job.data,
      error:         err.message,
      stack:         err.stack,
      attempts:      job.attemptsMade,
      failedAt:      new Date().toISOString(),
    }, {
      removeOnComplete: false,
      removeOnFail:     false,
    }).catch((dlqErr: unknown) => logError(dlqErr, { stage: "dlq_enqueue", jobId: job.data.jobId }));

    await prisma.job.update({
      where: { id: job.data.jobId },
      data:  {
        status:      JobStatus.FAILED,
        completedAt: new Date(),
        result: {
          error:      err.message,
          stack:      err.stack,
          attempts:   job.attemptsMade,
          dlq:        true,
          failReason: `Permanently failed after ${job.attemptsMade} attempts: ${err.message}`,
        },
      },
    }).catch(() => {});

    // ── A3: Credit safety — refund any held credits ───────────────────────
    // If holdCredits() ran at the API layer (/api/generate), credits were
    // reserved (creditsHeld += cost) but not yet charged. On permanent failure
    // we must release that hold. refundCredits() is idempotent — safe to call
    // even if no hold exists (returns alreadyDone=true with no DB writes).
    if (job.data.orgId && job.data.jobId) {
      await refundCredits(
        job.data.orgId,
        job.data.jobId,
        `permanent_failure:${extractErrorCode(err, 'PIPELINE_ERROR')}`,
        { prisma: prisma as any, logger }
      ).catch((refundErr: unknown) => {
        const msg = refundErr instanceof Error ? refundErr.message : String(refundErr);
        logger.error(
          { jobId: job.data.jobId, orgId: job.data.orgId, err: msg },
          '[generation-worker] CRITICAL: refundCredits failed on permanent failure — manual review required'
        );
      });
    }

    if (job.data.orgId) {
      deliverWebhooks(job.data.orgId, "job.failed", {
        jobId: job.data.jobId, error: err.message, attempts: job.attemptsMade,
      }).catch(() => {});
    }

    // ── Batch failure callback (fire-and-forget) ──────────────────────────
    const failedBatchId = (job.data as GenerationPayload).batchId;
    if (failedBatchId) {
      (async () => {
        try {
          await (prisma as any).batchJob.update({
            where: { id: failedBatchId },
            data:  { failedJobs: { increment: 1 } },
          });
          const batchRow = await (prisma as any).batchJob.findUnique({ where: { id: failedBatchId } });
          if (batchRow) {
            const done = batchRow.completedJobs + batchRow.failedJobs + batchRow.cancelledJobs;
            if (done >= batchRow.totalJobs) {
              let newStatus = "PARTIAL";
              if (batchRow.failedJobs === batchRow.totalJobs) newStatus = "FAILED";
              await (prisma as any).batchJob.update({
                where: { id: failedBatchId },
                data:  { status: newStatus, completedAt: new Date() },
              });
            }
          }
        } catch (batchErr: any) {
          logger.warn({ batchId: failedBatchId, jobId: job.data.jobId, err: batchErr.message },
            "[generation-worker] batch fail-update failed (non-fatal)");
        }
      })();
    }

    logger.error({
      event:   "job_dead_lettered",
      jobId:   job.data.jobId,
      orgId:   job.data.orgId,
      error:   err.message,
      attempts: job.attemptsMade,
    }, `[generation-worker] Job ${job.data.jobId} moved to DLQ after ${job.attemptsMade} attempts`);
  }
});

worker.on("error", (err: Error) => logError(err, { stage: "worker_error" }));

logger.info("[generation-worker] Started -- listening for jobs");

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});
