// src/app/api/generate/route.ts
// Generation endpoint — plan enforcement via @arkiol/shared planEnforcer.
// All checks happen before job creation: subscription status, feature flags,
// concurrency caps, format/variation limits, credit sufficiency.
//
// FIX: Removed the hard queueUnavailable() guard that blocked ALL generation
// when REDIS_HOST was not set. The inline generation path (runInlineGeneration)
// works correctly without Redis — jobs run synchronously within the serverless
// function. The queue check is now soft: we attempt to enqueue when possible,
// but fall through to inline execution when the queue is unavailable or empty.
import {
  detectCapabilities,
  runIntelligencePipeline,
} from '@arkiol/shared';
import { NextRequest, NextResponse } from "next/server";
import { prisma, safeTransaction } from "../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../lib/auth";
import { isFounderEmail } from "../../../lib/ownerAccess";
import { rateLimit, rateLimitHeaders }    from "../../../lib/rate-limit";
import { generationQueue }  from "../../../lib/queue";
import { withErrorHandling, dbUnavailable, aiUnavailable, authUnavailable } from "../../../lib/error-handling";
import { ApiError, getCreditCost, GIF_ELIGIBLE_FORMATS } from "../../../lib/types";
import {
  assertGenerationAllowed,
  countOrgRunningJobs,
} from "../../../lib/planGate";
import {
  createConcurrencyEnforcer,
  checkHqUpgrade,
  getPlanConfig,
  CREDIT_COSTS,
} from "@arkiol/shared";
import { z } from "zod";

// Vercel route config — increased to 60s for inline generation
export const maxDuration = 60;

const COST_PER_CREDIT_USD     = 0.008;
const MAX_COST_PER_RENDER_USD = 0.50;
const ABUSE_JOBS_THRESHOLD    = 20;
const ABUSE_WINDOW_MS         = 10 * 60 * 1000;

const GenerateSchema = z.object({
  prompt:         z.string().min(10).max(2000),
  formats:        z.array(
    z.enum([
      "instagram_post","instagram_story","youtube_thumbnail",
      "flyer","poster","presentation_slide",
      "business_card","resume","logo",
      // Animation Studio + extended social formats
      "facebook_post","twitter_post","display_banner",
      "linkedin_post","tiktok_video",
    ] as const)
  ).min(1).max(9),
  stylePreset:    z.string().max(80).default("auto"),
  variations:     z.number().int().min(1).max(5).default(1),
  brandId:        z.string().optional(),
  campaignId:     z.string().optional(),
  includeGif:     z.boolean().default(false),
  idempotencyKey: z.string().max(128).optional(),
  youtubeThumbnailMode: z.enum(["auto","face","product"]).default("auto"),
  hqUpgrade:      z.boolean().default(false),
  archetypeOverride: z.object({
    archetypeId: z.string().default('auto'),
    presetId:    z.string().default('auto'),
  }).optional(),
  locale: z.string().max(10).default('en'),
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  // Capability checks — queue is intentionally NOT a hard blocker here.
  // When queue is unavailable, we fall through to inline execution below.
  const caps = detectCapabilities();
  if (!caps.database) return dbUnavailable();
  if (!caps.ai)       return aiUnavailable();
  if (!caps.auth)     return authUnavailable();

  const user = await getRequestUser(req);

  // Founder / owner resolution
  const _headerEmail  = req.headers.get("x-user-email")?.toLowerCase().trim() || "";
  const _userObjEmail = ((user as any).email as string | undefined)?.toLowerCase().trim() || "";

  const _dbEmailResult = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, role: true },
  }).catch(() => null);
  const _dbEmail = _dbEmailResult?.email?.toLowerCase().trim() || "";
  const _dbRole  = _dbEmailResult?.role || "";

  const _userEmail: string = _headerEmail || _userObjEmail || _dbEmail;
  const isFounder     = isFounderEmail(_userEmail);
  const effectiveRole = isFounder || user.role === "SUPER_ADMIN" || _dbRole === "SUPER_ADMIN"
    ? "SUPER_ADMIN"
    : user.role;

  // Guaranteed founder bypass — self-heal DB role
  if (isFounder && _dbRole !== "SUPER_ADMIN") {
    await prisma.user.update({
      where: { id: user.id },
      data: { role: "SUPER_ADMIN" as any },
    }).catch(() => {});
  }

  requirePermission(effectiveRole, "GENERATE_ASSETS");

  const rl = await rateLimit(user.id, "generate");
  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before generating more assets." },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = GenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Resolve org
  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: { org: { select: { id: true, budgetCapCredits: true, creditBalance: true, maxVariationsPerRun: true } } },
  });
  if (!dbUser?.org) throw new ApiError(403, "You must belong to an organization to generate assets");
  const orgId = dbUser.org.id;

  // Founder runtime credit injection (non-DB — no write)
  if (isFounder) {
    (dbUser.org as any).creditBalance    = 999_999;
    (dbUser.org as any).budgetCapCredits = null;
  }

  // Idempotency: return existing job if same key
  if (input.idempotencyKey) {
    const existing = await prisma.job.findFirst({
      where: {
        userId:    user.id,
        payload:   { path: ["idempotencyKey"], equals: input.idempotencyKey },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return NextResponse.json({
        jobId:    existing.id,
        message:  "Duplicate request — returning existing job",
        status:   existing.status,
        progress: existing.progress,
      });
    }
  }

  // Abuse detection (skipped for founder/owner)
  if (!isFounder && effectiveRole !== "SUPER_ADMIN") {
    const recentJobCount = await prisma.job.count({
      where: {
        userId:    user.id,
        createdAt: { gte: new Date(Date.now() - ABUSE_WINDOW_MS) },
        type:      "GENERATE_ASSETS",
      },
    });
    if (recentJobCount >= ABUSE_JOBS_THRESHOLD) {
      throw new ApiError(429,
        `Too many requests: ${recentJobCount} jobs in 10 minutes. Please wait.`
      );
    }
  }

  // Plan enforcement
  const currentRunning = await countOrgRunningJobs(orgId);
  await assertGenerationAllowed({
    orgId,
    formats:        input.formats,
    variations:     input.variations,
    includeGif:     input.includeGif,
    currentRunning,
    userRole:       effectiveRole,
    userEmail:      _userEmail,
  });

  // HQ upgrade plan enforcement
  if (input.hqUpgrade && !isFounder && effectiveRole !== "SUPER_ADMIN") {
    const dbOrg = await prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { plan: true, creditBalance: true, dailyCreditBalance: true, subscriptionStatus: true, costProtectionBlocked: true } });
    const hqCheck = checkHqUpgrade({
      orgId,
      plan:              dbOrg.plan,
      creditBalance:     dbOrg.creditBalance,
      dailyCreditBalance: dbOrg.dailyCreditBalance,
      subscriptionStatus: dbOrg.subscriptionStatus,
      costProtectionBlocked: dbOrg.costProtectionBlocked,
    });
    if (!hqCheck.allowed) throw new ApiError(hqCheck.httpStatus ?? 403, hqCheck.reason ?? 'HQ upgrade not allowed');
  }

  // Credit cost calculation
  const totalAssets = input.formats.length * input.variations;
  const hqExtraCostPerStaticAsset = input.hqUpgrade ? (CREDIT_COSTS.static_hq - CREDIT_COSTS.static) : 0;
  const creditCost  = input.formats.reduce((acc: number, fmt: string) => {
    const baseCost = getCreditCost(fmt, input.includeGif && GIF_ELIGIBLE_FORMATS.has(fmt));
    const hqExtra  = input.hqUpgrade ? hqExtraCostPerStaticAsset : 0;
    return acc + (baseCost + hqExtra) * input.variations;
  }, 0);

  const estimatedCostUSD = creditCost * COST_PER_CREDIT_USD;
  if (!isFounder && estimatedCostUSD > MAX_COST_PER_RENDER_USD) {
    throw new ApiError(402,
      `Estimated render cost $${estimatedCostUSD.toFixed(4)} exceeds the per-render safety limit ` +
      `$${MAX_COST_PER_RENDER_USD.toFixed(2)}. Reduce formats or variations.`
    );
  }

  // Budget cap check
  const budgetCapCredits = dbUser.org.budgetCapCredits ?? null;
  if (
    budgetCapCredits !== null &&
    !isFounder && effectiveRole !== "SUPER_ADMIN" &&
    dbUser.org.creditBalance < creditCost
  ) {
    throw new ApiError(402,
      `Monthly budget cap (${budgetCapCredits} credits) reached. Purchase more credits to continue.`
    );
  }

  // Intelligence pipeline (non-blocking)
  let intelligenceMeta: Record<string, unknown> = {};
  try {
    const brandKit = input.brandId
      ? await prisma.brand.findFirst({ where: { id: input.brandId, orgId } })
      : null;

    const pipeline = await runIntelligencePipeline(
      {
        prompt:      input.prompt,
        format:      input.formats[0] ?? 'instagram_post',
        stylePreset: input.stylePreset,
        brandId:     input.brandId,
        campaignId:  input.campaignId,
      },
      {
        requestedVariations:  input.variations,
        maxAllowedVariations: dbUser.org.maxVariationsPerRun ?? 1,
        brandKit: brandKit as Record<string, unknown> | null,
      }
    );

    intelligenceMeta = {
      v16_layout:    pipeline.layout.data,
      v16_variation: pipeline.variation.data,
      v16_audience:  pipeline.audience.data,
      v16_density:   pipeline.density.data,
      v16_brand:     pipeline.brand.data,
      v16_pipeline_ms: pipeline.totalMs,
      v16_any_fallback: pipeline.anyFallback,
    };
  } catch (pipelineErr: any) {
    console.warn('[generate] Intelligence pipeline non-fatal error:', pipelineErr.message);
  }

  // Create job record with DB-level concurrency enforcement
  const concurrencyEnforcer = createConcurrencyEnforcer(prisma as any);
  const orgLimit = await concurrencyEnforcer.loadOrgConcurrencyLimit(orgId);

  const job = await safeTransaction(async (tx: any) => {
    await concurrencyEnforcer.assertWithinLimit(tx as any, {
      orgId,
      userId:         user.id,
      maxConcurrency: orgLimit.maxConcurrency,
    });

    return tx.job.create({
      data: {
        type:        "GENERATE_ASSETS",
        status:      "PENDING",
        userId:      user.id,
        orgId,
        campaignId:  input.campaignId ?? null,
        progress:    0,
        maxAttempts: 3,
        payload: {
          userId:               user.id,
          orgId,
          prompt:               input.prompt,
          formats:              input.formats,
          stylePreset:          input.stylePreset,
          variations:           input.variations,
          brandId:              input.brandId ?? null,
          campaignId:           input.campaignId ?? null,
          includeGif:           input.includeGif,
          idempotencyKey:       input.idempotencyKey ?? null,
          youtubeThumbnailMode: input.youtubeThumbnailMode,
          expectedCreditCost:   creditCost,
          maxVariationsPerRun:  dbUser.org.maxVariationsPerRun ?? 1,
          hqUpgrade:            input.hqUpgrade,
          archetypeOverride:    input.archetypeOverride ?? undefined,
          locale:               input.locale,
          ...intelligenceMeta,
        },
      },
    });
  });

  // ── Execute generation ─────────────────────────────────────────────────────
  // Try BullMQ queue first (when an external worker is running).
  // Fall through to inline execution when:
  //   - REDIS_HOST is not configured (no queue capability)
  //   - Queue is configured but no workers are listening
  //   - Queue enqueue throws
  let queued = false;
  let inlineResult: any = null;

  try {
    if (detectCapabilities().queue) {
      await generationQueue.add(
        "generate",
        { ...(job.payload as object), jobId: job.id },
        {
          jobId:    job.id,
          attempts: 3,
          backoff:  { type: "exponential", delay: 3000 },
          removeOnComplete: { count: 100 },
          removeOnFail:     false,
        }
      );
      try {
        const workers = await generationQueue.getWorkers?.() ?? [];
        queued = workers.length > 0;
      } catch {
        queued = false;
      }
    }
  } catch {
    queued = false;
  }

  // Inline execution when no worker is available
  if (!queued) {
    try {
      const { runInlineGeneration } = require("../../../lib/inlineGenerate");
      await runInlineGeneration({
        jobId:              job.id,
        userId:             user.id,
        orgId,
        prompt:             input.prompt,
        formats:            input.formats,
        stylePreset:        input.stylePreset,
        variations:         input.variations,
        brandId:            input.brandId ?? null,
        campaignId:         input.campaignId ?? null,
        includeGif:         input.includeGif,
        locale:             input.locale,
        archetypeOverride:  input.archetypeOverride,
        expectedCreditCost: creditCost,
      });

      inlineResult = await prisma.job.findUnique({
        where: { id: job.id },
        select: { status: true, progress: true, result: true },
      }).catch(() => null);
    } catch (inlineErr: any) {
      console.error(`[generate] Inline generation failed for job ${job.id}:`, inlineErr.message);
    }
  }

  const finalStatus = inlineResult?.status ?? "PENDING";
  const finalResult = inlineResult?.result as Record<string, unknown> | null;

  return NextResponse.json(
    {
      jobId:            job.id,
      status:           finalStatus,
      totalAssets,
      creditCost,
      estimatedCostUSD: +estimatedCostUSD.toFixed(4),
      estimatedSeconds: Math.round(totalAssets * (input.hqUpgrade ? 14 : 8)),
      formats:          input.formats,
      creditsReserved:  creditCost,
      hqUpgrade:        input.hqUpgrade,
      inlineExecution:  !queued,
      ...(finalResult ? { result: finalResult } : {}),
    },
    { status: finalStatus === "COMPLETED" ? 200 : 202 }
  );
});
