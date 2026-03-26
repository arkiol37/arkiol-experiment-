// src/app/api/generate/bulk/route.ts
// POST /api/generate/bulk — submit up to 50 generation jobs in one request.
//
// Plan gates:
//   • PRO:    canBatchGenerate=true, max 20 jobs per batch
//   • STUDIO: canBatchGenerate=true, max 50 jobs per batch
//   • FREE/CREATOR: 403
//
// Each item in the `jobs` array is identical to a single /api/generate payload.
// A BatchJob row is created upfront; constituent Job rows are created atomically
// inside a $transaction; all are enqueued to BullMQ after the transaction commits.
//
// Credits are reserved (deducted) upfront for the whole batch — no partial deductions.
// If total credits are insufficient the entire batch is rejected before any job is created.
//
// Idempotency: each batch item may supply its own idempotencyKey. Duplicate keys
// within a 24-hour window return the existing job rather than creating a new one.
//
// Progress polling: GET /api/jobs/batch/[batchId]

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse }  from "next/server";
import { prisma }                     from "../../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../../lib/auth";
import { rateLimit, rateLimitHeaders }       from "../../../../lib/rate-limit";
import { generationQueue }                   from "../../../../lib/queue";
import { withErrorHandling, dbUnavailable, aiUnavailable, queueUnavailable }                 from "../../../../lib/error-handling";
import { ApiError, getCreditCost, GIF_ELIGIBLE_FORMATS } from "../../../../lib/types";
import { assertBatchAllowed, countOrgRunningJobs } from "../../../../lib/planGate";
import { isFounderEmail } from "../../../../lib/ownerAccess";
import {
  createConcurrencyEnforcer,
  checkHqUpgrade,
  getPlanConfig,
  CREDIT_COSTS,
  runIntelligencePipeline,
} from "@arkiol/shared";
import { z } from "zod";

// ── Schema ────────────────────────────────────────────────────────────────────

const BulkJobItemSchema = z.object({
  prompt:         z.string().min(10).max(2000),
  formats:        z.array(
    z.enum(["instagram_post","instagram_story","youtube_thumbnail",
            "flyer","poster","presentation_slide",
            "business_card","resume","logo"] as const)
  ).min(1).max(9),
  stylePreset:    z.string().max(80).default("auto"),
  variations:     z.number().int().min(1).max(5).default(1),
  brandId:        z.string().optional(),
  campaignId:     z.string().optional(),
  includeGif:     z.boolean().default(false),
  idempotencyKey: z.string().max(128).optional(),
  hqUpgrade:      z.boolean().default(false),
  archetypeOverride: z.object({
    archetypeId: z.string().default("auto"),
    presetId:    z.string().default("auto"),
  }).optional(),
});

const BulkGenerateSchema = z.object({
  jobs: z.array(BulkJobItemSchema).min(1).max(50),
  // Optional batch-level label shown in the dashboard
  label: z.string().max(200).optional(),
});

type BulkJobItem = z.infer<typeof BulkJobItemSchema>;

// ── Credit calculation (mirrors single /api/generate logic) ───────────────────

const COST_PER_CREDIT_USD     = 0.008;
const MAX_COST_PER_BATCH_USD  = 20.00;   // hard ceiling for a single bulk request

function calcJobCredits(item: BulkJobItem): number {
  const hqExtraPerStatic = item.hqUpgrade
    ? (CREDIT_COSTS.static_hq - CREDIT_COSTS.static)
    : 0;
  return item.formats.reduce((acc, fmt) => {
    const base   = getCreditCost(fmt, item.includeGif && GIF_ELIGIBLE_FORMATS.has(fmt));
    const hqExtra = item.hqUpgrade ? hqExtraPerStatic : 0;
    return acc + (base + hqExtra) * item.variations;
  }, 0);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();
  if (!detectCapabilities().ai) return aiUnavailable();
  if (!detectCapabilities().queue) return queueUnavailable();

  const user = await getRequestUser(req);

  // ── Founder bypass — resolved before any credit/plan check ───────────────
  // ── Founder / owner resolution (DB-authoritative) ──────────────────────────
  const _bulkHeaderEmail  = req.headers.get("x-user-email")?.toLowerCase().trim() || "";
  const _bulkUserObjEmail = ((user as any).email as string | undefined)?.toLowerCase().trim() || "";
  const _bulkDbResult = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, role: true },
  }).catch(() => null);
  const _bulkDbEmail = _bulkDbResult?.email?.toLowerCase().trim() || "";
  const _bulkDbRole  = _bulkDbResult?.role || "";
  const _bulkEmail: string = _bulkHeaderEmail || _bulkUserObjEmail || _bulkDbEmail;
  const isFounder     = isFounderEmail(_bulkEmail);
  const effectiveRole = isFounder || user.role === "SUPER_ADMIN" || _bulkDbRole === "SUPER_ADMIN"
    ? "SUPER_ADMIN"
    : user.role;
  if (isFounder && _bulkDbRole !== "SUPER_ADMIN") {
    await prisma.user.update({ where: { id: user.id }, data: { role: "SUPER_ADMIN" as any } }).catch(() => {});
  }
  requirePermission(effectiveRole, "GENERATE_ASSETS");

  // Rate-limit: 5 bulk requests/min per user (heavier than single generate)
  const rl = await rateLimit(user.id, "bulk");
  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded for bulk generation. Please wait before submitting another batch." },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = BulkGenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { jobs: jobItems, label } = parsed.data;

  // ── Resolve org ─────────────────────────────────────────────────────────────
  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: {
      org: {
        select: {
          id: true, plan: true, creditBalance: true,
          budgetCapCredits: true, maxVariationsPerRun: true,
        },
      },
    },
  });
  if (!dbUser?.org) throw new ApiError(403, "You must belong to an organization to generate assets");
  const orgId = dbUser.org.id;

  // ── Founder runtime credit injection ─────────────────────────────────────
  if (isFounder) {
    (dbUser.org as any).creditBalance    = 999_999;
    (dbUser.org as any).budgetCapCredits = null;
  }

  // ── Plan gate: bulk feature + size cap ─────────────────────────────────────
  if (!isFounder && effectiveRole !== "SUPER_ADMIN") await assertBatchAllowed(orgId, jobItems.length, effectiveRole);

  // ── Per-item HQ upgrade plan check ─────────────────────────────────────────
  const orgPlanRaw = (dbUser.org as any).plan ?? "FREE";
  for (const item of jobItems) {
    if (item.hqUpgrade) {
      const hqCheck = checkHqUpgrade({
        orgId,
        plan:               orgPlanRaw,
        creditBalance:      dbUser.org.creditBalance,
        dailyCreditBalance: 0,
        subscriptionStatus: "ACTIVE",
        costProtectionBlocked: false,
      });
      if (!hqCheck.allowed) {
        throw new ApiError(hqCheck.httpStatus ?? 403, `HQ upgrade not allowed: ${hqCheck.reason}`);
      }
      break; // plan-level check is the same for all — one check is sufficient
    }
  }

  // ── Idempotency: resolve any pre-existing jobs ──────────────────────────────
  // Items with an idempotencyKey that already has a Job record within 24h are
  // mapped to the existing job and skipped during creation.
  const existingByKey = new Map<string, string>(); // key → existing jobId
  const idemKeys = jobItems
    .map(it => it.idempotencyKey)
    .filter((k): k is string => !!k);

  if (idemKeys.length > 0) {
    const existing = await prisma.job.findMany({
      where: {
        userId:    user.id,
        idempotencyKey: { in: idemKeys },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true, idempotencyKey: true },
    });
    for (const e of existing) {
      if (e.idempotencyKey) existingByKey.set(e.idempotencyKey, e.id);
    }
  }

  // ── Credit calculation ──────────────────────────────────────────────────────
  // Only count credits for items that will actually create new jobs
  const newItems = jobItems.filter(
    it => !it.idempotencyKey || !existingByKey.has(it.idempotencyKey)
  );
  const totalCreditCost = newItems.reduce((acc, it) => acc + calcJobCredits(it), 0);
  const estimatedCostUSD = totalCreditCost * COST_PER_CREDIT_USD;

  if (!isFounder && estimatedCostUSD > MAX_COST_PER_BATCH_USD) {
    throw new ApiError(402,
      `Estimated batch cost $${estimatedCostUSD.toFixed(4)} exceeds the per-batch safety limit ` +
      `$${MAX_COST_PER_BATCH_USD.toFixed(2)}. Reduce job count, formats, or variations.`
    );
  }

  // Founder/owner bypasses all credit checks
  if (!isFounder && effectiveRole !== "SUPER_ADMIN") {
    const creditsAvailable = dbUser.org.creditBalance;
    const budgetCap        = dbUser.org.budgetCapCredits ?? null;
    if (totalCreditCost > creditsAvailable) {
      throw new ApiError(402,
        `Insufficient credits. Batch requires ${totalCreditCost} credits, you have ${creditsAvailable}.`
      );
    }
    if (budgetCap !== null && dbUser.org.creditBalance < totalCreditCost) {
      throw new ApiError(402,
        `Monthly budget cap (${budgetCap}) would be exceeded. Batch cost: ${totalCreditCost}.`
      );
    }
  }

  // ── Concurrency gate ────────────────────────────────────────────────────────
  const currentRunning = await countOrgRunningJobs(orgId);
  const planConfig     = getPlanConfig(orgPlanRaw);
  // A batch counts as 1 concurrent "slot" from the plan perspective;
  // the individual child jobs are queued and processed by the worker pool.
  const concurrencyEnforcer = createConcurrencyEnforcer(prisma as any);
  const orgLimit = await concurrencyEnforcer.loadOrgConcurrencyLimit(orgId);

  // ── Pre-compute intelligence metadata for each new item ────────────────────
  // Run intelligence pipeline concurrently for all new items — one pipeline call
  // per unique (prompt+format) combination so bulk jobs with the same prompt share it.
  const intelligenceMetas: Record<string, unknown>[] = await Promise.all(
    newItems.map(async (item) => {
      try {
        const brandKit = item.brandId
          ? await prisma.brand.findFirst({ where: { id: item.brandId, orgId } })
          : null;
        const pipeline = await runIntelligencePipeline(
          {
            prompt:      item.prompt,
            format:      item.formats[0] ?? "instagram_post",
            stylePreset: item.stylePreset,
            brandId:     item.brandId,
            campaignId:  item.campaignId,
          },
          {
            requestedVariations:  item.variations,
            maxAllowedVariations: dbUser.org.maxVariationsPerRun ?? 1,
            brandKit: brandKit as Record<string, unknown> | null,
          }
        );
        return {
          v16_layout:       pipeline.layout.data,
          v16_variation:    pipeline.variation.data,
          v16_audience:     pipeline.audience.data,
          v16_density:      pipeline.density.data,
          v16_brand:        pipeline.brand.data,
          v16_pipeline_ms:  pipeline.totalMs,
          v16_any_fallback: pipeline.anyFallback,
        };
      } catch {
        return {}; // intelligence failure never blocks generation
      }
    })
  );

  // ── Atomic creation: BatchJob + all constituent Jobs ───────────────────────
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const { batchJob, createdJobs } = await prisma.$transaction(async (tx) => {
    // Re-enforce concurrency inside transaction
    await concurrencyEnforcer.assertWithinLimit(tx as any, {
      orgId,
      userId:         user.id,
      maxConcurrency: orgLimit.maxConcurrency,
    });

    // Create BatchJob
    const batchJob = await (tx as any).batchJob.create({
      data: {
        id:             batchId,
        orgId,
        userId:         user.id,
        status:         "PENDING",
        totalJobs:      jobItems.length,  // includes pre-existing (already counted)
        completedJobs:  existingByKey.size,
        failedJobs:     0,
        cancelledJobs:  0,
        totalCreditCost,
        ...(label ? {} : {}),
      },
    });

    // Create new Job rows
    const createdJobs: Array<{ jobId: string; promptIdx: number }> = [];
    let newItemIdx = 0;

    for (let idx = 0; idx < jobItems.length; idx++) {
      const item = jobItems[idx];
      const existingJobId = item.idempotencyKey
        ? existingByKey.get(item.idempotencyKey)
        : undefined;

      if (existingJobId) {
        // Link pre-existing job to the batch
        await (tx as any).batchJobItem.create({
          data: {
            batchId,
            jobId:     existingJobId,
            promptIdx: idx,
          },
        });
        continue;
      }

      const meta = intelligenceMetas[newItemIdx++] ?? {};
      const job  = await tx.job.create({
        data: {
          type:        "GENERATE_ASSETS",
          status:      "PENDING",
          userId:      user.id,
          orgId,
          campaignId:  item.campaignId ?? null,
          progress:    0,
          maxAttempts: 3,
          idempotencyKey: item.idempotencyKey ?? null,
          payload: {
            userId:               user.id,
            orgId,
            prompt:               item.prompt,
            formats:              item.formats,
            stylePreset:          item.stylePreset,
            variations:           item.variations,
            brandId:              item.brandId ?? null,
            campaignId:           item.campaignId ?? null,
            includeGif:           item.includeGif,
            idempotencyKey:       item.idempotencyKey ?? null,
            youtubeThumbnailMode: "auto",
            expectedCreditCost:   calcJobCredits(item),
            maxVariationsPerRun:  dbUser.org.maxVariationsPerRun ?? 1,
            hqUpgrade:            item.hqUpgrade,
            archetypeOverride:    item.archetypeOverride ?? undefined,
            batchId,             // propagate so worker can call back
            ...meta,
          },
        },
      });

      await (tx as any).batchJobItem.create({
        data: {
          batchId,
          jobId:     job.id,
          promptIdx: idx,
        },
      });

      createdJobs.push({ jobId: job.id, promptIdx: idx });
    }

    return { batchJob, createdJobs };
  });

  // ── Enqueue all new jobs to BullMQ (after transaction commits) ─────────────
  // Use plan queue priority so STUDIO jobs run before PRO in shared workers.
  const queuePriority = planConfig.queuePriority;

  await Promise.all(
    createdJobs.map(({ jobId, promptIdx }) => {
      const item = jobItems[promptIdx];
      return generationQueue.add(
        "generate",
        { ...(item as object), jobId, orgId, userId: user.id, batchId },
        {
          jobId,
          priority:  queuePriority,
          attempts:  3,
          backoff:   { type: "exponential", delay: 3000 },
          removeOnComplete: { count: 100 },
          removeOnFail:     false,
        }
      );
    })
  );

  // ── Response ────────────────────────────────────────────────────────────────
  const totalAssets = jobItems.reduce(
    (acc, it) => acc + it.formats.length * it.variations,
    0
  );

  return NextResponse.json(
    {
      batchId,
      status:           "PENDING",
      totalJobs:        jobItems.length,
      newJobs:          createdJobs.length,
      skippedDuplicates: existingByKey.size,
      totalAssets,
      totalCreditCost,
      estimatedCostUSD: +estimatedCostUSD.toFixed(4),
      estimatedSeconds: Math.round(totalAssets * 8 / Math.min(3, createdJobs.length || 1)),
      pollUrl:          `/api/jobs/batch/${batchId}`,
    },
    { status: 202 }
  );
});
