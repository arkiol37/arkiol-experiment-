// src/app/api/generate/route.ts
// Generation endpoint — plan enforcement via @arkiol/shared planEnforcer.
// All checks happen before job creation: subscription status, feature flags,
// concurrency caps, format/variation limits, credit sufficiency.
import {
  detectCapabilities,
  runIntelligencePipeline,
} from '@arkiol/shared';
import { NextRequest, NextResponse } from "next/server";
import { prisma }           from "../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../lib/auth";
// hasOwnerAccess removed — replaced by isFounder/effectiveRole resolved at handler entry
import { rateLimit, rateLimitHeaders }    from "../../../lib/rate-limit";
import { generationQueue }  from "../../../lib/queue";
import { withErrorHandling, dbUnavailable, aiUnavailable, queueUnavailable, authUnavailable } from "../../../lib/error-handling";
import { ApiError, getCreditCost, GIF_ELIGIBLE_FORMATS } from "../../../lib/types";
import {
  assertGenerationAllowed,
  countOrgRunningJobs,
} from "../../../lib/planGate";
import {
  createConcurrencyEnforcer,
  checkHqUpgrade,
  checkOnDemandAssetCount,
  getPlanConfig,
  CREDIT_COSTS,
} from "@arkiol/shared";
import { z } from "zod";

// Vercel route config — replaces vercel.json functions block
export const maxDuration = 30;


const COST_PER_CREDIT_USD     = 0.008;
const MAX_COST_PER_RENDER_USD = 0.50;
const ABUSE_JOBS_THRESHOLD    = 20;
const ABUSE_WINDOW_MS         = 10 * 60 * 1000;

const GenerateSchema = z.object({
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
  youtubeThumbnailMode: z.enum(["auto","face","product"]).default("auto"),
  // HQ upgrade: explicit user choice — costs extra credits, plan-gated (Pro/Studio only)
  hqUpgrade:      z.boolean().default(false),
  // Stage 8: Archetype + Preset Intelligence — optional user override
  archetypeOverride: z.object({
    archetypeId: z.string().default('auto'),
    presetId:    z.string().default('auto'),
  }).optional(),
  // Multi-language: BCP-47 locale code. All copy text will be generated in this language.
  locale: z.string().max(10).default('en'),
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  // ── Capability checks ─────────────────────────────────────────────────────
  const caps = detectCapabilities();
  if (!caps.database) return dbUnavailable();
  if (!caps.ai)       return aiUnavailable();
  if (!caps.queue)    return queueUnavailable();
  if (!caps.auth)     return authUnavailable();


  const user = await getRequestUser(req);

  // ── Founder / owner resolution — must happen before ANY plan or credit check ──
  // Priority order for email:
  //   1. x-user-email header (injected by middleware from JWT — fastest, no DB)
  //   2. email field on user object returned by getRequestUser
  //   3. Guaranteed DB lookup as final fallback (covers stale/missing headers)
  // We always do the DB lookup when headers are absent to guarantee correctness.
  // This single resolved email is the source of truth for all bypass decisions.
  const _headerEmail  = req.headers.get("x-user-email")?.toLowerCase().trim() || "";
  const _userObjEmail = ((user as any).email as string | undefined)?.toLowerCase().trim() || "";

  // Always perform DB lookup to guarantee correct email — do not rely solely on
  // headers which may be absent or stale in certain deployment configurations.
  const _dbEmailResult = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, role: true },
  }).catch(() => null);
  const _dbEmail = _dbEmailResult?.email?.toLowerCase().trim() || "";
  const _dbRole  = _dbEmailResult?.role || "";

  // Resolved email: DB is authoritative fallback, headers are fast path
  const _userEmail: string = _headerEmail || _userObjEmail || _dbEmail;

  // isFounder is the single gate for all bypasses in this handler.
  // It checks the resolved email against process.env.FOUNDER_EMAIL directly —
  // no dependency on DB role, JWT role, or any cached state.
  const { isFounderEmail } = await import("../../../lib/ownerAccess");
  const isFounder     = isFounderEmail(_userEmail);

  // effectiveRole: promote to SUPER_ADMIN if founder by email OR if DB role is SUPER_ADMIN.
  // This covers cases where JWT/header role is stale (e.g., still shows DESIGNER).
  const effectiveRole = isFounder || user.role === "SUPER_ADMIN" || _dbRole === "SUPER_ADMIN"
    ? "SUPER_ADMIN"
    : user.role;

  // ── GUARANTEED FOUNDER BYPASS — must be before ANY other check ───────────
  // If the resolved email matches FOUNDER_EMAIL, skip ALL plan/credit/
  // subscription/capability checks and jump straight to job creation.
  // This is the single authoritative bypass and cannot be defeated by stale
  // JWT roles, missing headers, or incorrect DB plan state.
  if (isFounder) {
    // Ensure the founder's DB role is SUPER_ADMIN (self-healing promotion)
    if (_dbRole !== "SUPER_ADMIN") {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: "SUPER_ADMIN" as any },
      }).catch(() => {/* non-fatal — bypass still applies */});
    }
  }

  // Permission check uses effectiveRole, not raw user.role, so the founder
  // is never blocked even if the JWT carries a stale DESIGNER role.
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

  // ── Resolve org ────────────────────────────────────────────────────────────
  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: { org: { select: { id: true, budgetCapCredits: true, creditBalance: true, maxVariationsPerRun: true } } },
  });
  if (!dbUser?.org) throw new ApiError(403, "You must belong to an organization to generate assets");
  const orgId = dbUser.org.id;

  // ── Founder runtime credit injection ─────────────────────────────────────
  // For the founder, override creditBalance to 999999 at runtime so any
  // downstream code paths that read dbUser.org.creditBalance directly
  // (e.g. fallback budget cap checks) also pass safely.
  // This is a runtime-only override — it does NOT write to the database.
  if (isFounder) {
    (dbUser.org as any).creditBalance    = 999_999;
    (dbUser.org as any).budgetCapCredits = null; // null = no cap
  }

  // ── Idempotency: return existing job if same key ───────────────────────────
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

  // ── Abuse detection (skipped for founder/owner) ─────────────────────────
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

  // ── Plan enforcement via shared planEnforcer ───────────────────────────────
  // effectiveRole is already resolved above. If founder/owner, loadOrgSnapshot
  // inside assertGenerationAllowed returns ownerSnapshot (unlimited credits,
  // STUDIO plan, ACTIVE status) and preflightJob never runs credit checks.
  const currentRunning = await countOrgRunningJobs(orgId);
  await assertGenerationAllowed({
    orgId,
    formats:        input.formats,
    variations:     input.variations,
    includeGif:     input.includeGif,
    currentRunning,
    userRole:       effectiveRole,
    userEmail:      _userEmail,   // second-layer founder bypass inside loadOrgSnapshot
  });

  // ── HQ upgrade plan enforcement (skipped for owner/admin) ──────────────────
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

  // ── Credit cost calculation ────────────────────────────────────────────────
  // HQ upgrade adds extra credits per static asset (static_hq = 3 vs standard static = 1)
  const totalAssets = input.formats.length * input.variations;
  const hqExtraCostPerStaticAsset = input.hqUpgrade ? (CREDIT_COSTS.static_hq - CREDIT_COSTS.static) : 0;
  const creditCost  = input.formats.reduce((acc, fmt) => {
    const baseCost = getCreditCost(fmt, input.includeGif && GIF_ELIGIBLE_FORMATS.has(fmt));
    const hqExtra  = input.hqUpgrade ? hqExtraCostPerStaticAsset : 0;
    return acc + (baseCost + hqExtra) * input.variations;
  }, 0);

  // C3: Per-render cost safety cap (skipped for founder)
  const estimatedCostUSD = creditCost * COST_PER_CREDIT_USD;
  if (!isFounder && estimatedCostUSD > MAX_COST_PER_RENDER_USD) {
    throw new ApiError(402,
      `Estimated render cost $${estimatedCostUSD.toFixed(4)} exceeds the per-render safety limit ` +
      `$${MAX_COST_PER_RENDER_USD.toFixed(2)}. Reduce formats or variations.`
    );
  }

  // Budget cap check (skipped for founder/owner)
  // Uses creditBalance (canonical field) — creditsUsed/creditLimit were removed from schema.
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

  // ── V16: Run intelligence pipeline (non-blocking, sandboxed) ─────────────
  // Pipeline runs BEFORE job creation. Any stage failure uses deterministic fallback.
  // Pipeline results are attached to job payload for the worker to use.
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
    // Intelligence pipeline failure NEVER blocks generation
    console.warn('[generate] Intelligence pipeline non-fatal error:', pipelineErr.message);
  }

  // ── Create job record with DB-level concurrency enforcement ──────────────
  // The soft middleware check above is a fast-path rejection. This transaction
  // provides the hard guarantee: count + insert are atomic, preventing races
  // where two simultaneous requests both pass the middleware check.
  const concurrencyEnforcer = createConcurrencyEnforcer(prisma as any);
  const orgLimit = await concurrencyEnforcer.loadOrgConcurrencyLimit(orgId);

  const job = await prisma.$transaction(async (tx) => {
    // Re-enforce concurrency inside transaction (serializable) to catch races
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
          // Stage 8: Archetype + Preset Intelligence override
          archetypeOverride:    input.archetypeOverride ?? undefined,
          locale:               input.locale,
          // V16: Intelligence pipeline results
          ...intelligenceMeta,
        },
      },
    });
  });

  // ── Enqueue to BullMQ ──────────────────────────────────────────────────────
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

  return NextResponse.json(
    {
      jobId:            job.id,
      status:           "PENDING",
      totalAssets,
      creditCost,
      estimatedCostUSD: +estimatedCostUSD.toFixed(4),
      estimatedSeconds: Math.round(totalAssets * (input.hqUpgrade ? 14 : 8)),
      formats:          input.formats,
      creditsReserved:  creditCost,
      hqUpgrade:        input.hqUpgrade,
    },
    { status: 202 }
  );
});
