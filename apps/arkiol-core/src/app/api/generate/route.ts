// src/app/api/generate/route.ts
// Generation endpoint — THIN FORWARDER to the Render backend.
//
// Vercel responsibilities (kept here):
//   - authenticate the user (NextAuth + founder bypass)
//   - validate + rate-limit the request
//   - enforce plan / concurrency / credit rules
//   - create the Job row in Postgres
//   - POST to the Render backend's /generate endpoint
//   - return the jobId so the frontend can poll /api/jobs
//
// What's NOT here anymore (moved to apps/render-backend):
//   - OpenAI intelligence / analyzer calls
//   - BullMQ queue dispatch
//   - durableRunInlineGeneration (the inline heavy path)
//   - runIntelligencePipeline
//
// If RENDER_BACKEND_URL / RENDER_GENERATION_KEY are unset or the
// Render service is unreachable, this route returns 503 — Vercel
// no longer has a heavy-generation fallback path, so generation
// will not time out serverless functions.
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from "next/server";
import { prisma, safeTransaction } from "../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../lib/auth";
import { isFounderEmail } from "../../../lib/ownerAccess";
import { rateLimit, rateLimitHeaders }    from "../../../lib/rate-limit";
import {
  buildRenderPayload,
  dispatchToRenderBackend,
  isRenderBackendConfigured,
} from "../../../lib/renderDispatch";
import { withErrorHandling, dbUnavailable, authUnavailable } from "../../../lib/error-handling";
import { ApiError, getCreditCost, GIF_ELIGIBLE_FORMATS } from "../../../lib/types";
import {
  GALLERY_DEFAULT_CANDIDATE_COUNT,
  GALLERY_MAX_CANDIDATE_COUNT,
  GALLERY_MIN_CANDIDATE_COUNT,
} from "../../../lib/gallery-config";
import {
  assertGenerationAllowed,
  countOrgRunningJobs,
} from "../../../lib/planGate";
import {
  createConcurrencyEnforcer,
  checkHqUpgrade,
  CREDIT_COSTS,
} from "@arkiol/shared";
import { JobStatus } from "@prisma/client";
import { z } from "zod";

// This route forwards heavy work to the Render backend, but the
// Render service may cold-start (~30-60s on starter plans). The
// dispatch helper retries once with a 25s timeout, so we ask Vercel
// for up to 60s of function lifetime to give the cold-start path
// room to land. Pro plans honour 60s; Hobby caps to 60s as well.
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
  // Step 21: gallery flow defaults to GALLERY_DEFAULT_CANDIDATE_COUNT so a
  // single prompt produces a real shortlist of layouts / compositions /
  // styling picks to choose from. Requests are always clamped downstream
  // by the caller's plan (maxVariationsPerRun), so lower tiers still
  // receive the correct number even if the client asked for the default.
  variations:     z.number()
                   .int()
                   .min(GALLERY_MIN_CANDIDATE_COUNT)
                   .max(GALLERY_MAX_CANDIDATE_COUNT)
                   .default(GALLERY_DEFAULT_CANDIDATE_COUNT),
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
  // Capability checks. The `ai` cap lived here because the Vercel
  // function used to call OpenAI directly — that work is now on
  // Render, so we don't block here on the OpenAI key. We DO still
  // require database + auth (used to create the job row and
  // authenticate the user).
  const caps = detectCapabilities();
  if (!caps.database) return dbUnavailable();
  if (!caps.auth)     return authUnavailable();

  // Render backend is the only path to generation. Fail fast with a
  // clear message if the operator hasn't configured it yet.
  if (!isRenderBackendConfigured()) {
    return NextResponse.json(
      { error: "Generation backend is not configured (RENDER_BACKEND_URL / RENDER_GENERATION_KEY missing)." },
      { status: 503 },
    );
  }

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

  // Intelligence pipeline (non-blocking) used to run here and call
  // OpenAI. That work now lives on the Render backend — the Vercel
  // route stays lightweight so it never approaches a serverless
  // timeout.

  // Create job record with DB-level concurrency enforcement.
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
        status:      JobStatus.PENDING,
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
        },
      },
    });
  });

  // ── Dispatch to the Render backend ────────────────────────────────────────
  // The Render service runs the heavy pipeline (OpenAI calls,
  // template composition, asset selection + injection, layout,
  // rendering). It responds fast after scheduling the job in the
  // background; the frontend polls /api/jobs?id=<jobId> for status.
  const renderPayload = buildRenderPayload({
    prompt:               input.prompt,
    jobId:                job.id,
    userId:               user.id,
    orgId,
    formats:              input.formats,
    stylePreset:          input.stylePreset,
    variations:           input.variations,
    brandId:              input.brandId ?? null,
    campaignId:           input.campaignId ?? null,
    includeGif:           input.includeGif,
    locale:               input.locale,
    archetypeOverride:    input.archetypeOverride,
    expectedCreditCost:   creditCost,
    hqUpgrade:            input.hqUpgrade,
    youtubeThumbnailMode: input.youtubeThumbnailMode,
  });

  const renderResult = await dispatchToRenderBackend(renderPayload);

  if (!renderResult.ok) {
    const isTimeout = renderResult.status === undefined &&
      /timed out/i.test(renderResult.error);
    const isUnreachable = renderResult.status === undefined && !isTimeout;

    // Server-side log so Vercel logs show the exact failure for
    // the operator. The log includes payload keys (not values) so
    // we can verify field shape without spilling the prompt.
    console.error(
      `[generate] Render dispatch failed for job ${job.id}: ` +
      `status=${renderResult.status ?? "n/a"} ` +
      `error=${JSON.stringify(renderResult.error)} ` +
      `details=${JSON.stringify(renderResult.details ?? null)} ` +
      `payloadKeys=${Object.keys(renderPayload).join(",")}`,
    );

    if (isTimeout) {
      // Cold-start timeout — Render is probably waking up. The job
      // row is already PENDING in Postgres, so when the backend
      // finishes booting it will pick up the request from the
      // initial fetch (which kept retrying inside the dispatch
      // helper). Returning 202 here keeps the frontend polling
      // /api/jobs; the stale watchdog in /api/jobs will only flip
      // to FAILED if the row sits PENDING for the full grace
      // period, refunding credits at that point.
      //
      // Note: in this branch we did NOT successfully reach the
      // Render service, so the job will only execute if Render
      // wakes up *and* a future poll triggers an auto-resume. The
      // alternative (mark FAILED here) would refund credits and
      // require the user to retry — strictly worse UX, since on a
      // cold start the second click usually succeeds anyway.
      return NextResponse.json(
        {
          jobId:            job.id,
          status:      JobStatus.PENDING,
          totalAssets,
          creditCost,
          estimatedCostUSD: +estimatedCostUSD.toFixed(4),
          estimatedSeconds: Math.round(totalAssets * (input.hqUpgrade ? 14 : 8)) + 30,
          formats:          input.formats,
          creditsReserved:  creditCost,
          hqUpgrade:        input.hqUpgrade,
          durability:       "render_backend",
          coldStart:        true,
          notice:           "Render backend is starting up — your job will run as soon as it's ready.",
        },
        { status: 202 },
      );
    }

    const failReason = isUnreachable
      ? "render_backend_unreachable"
      : `render_backend_${renderResult.status}`;
    const userMessage = isUnreachable
      ? "Generation backend is unavailable. Please try again."
      : renderResult.error;

    // Mark the job as FAILED so the poller doesn't leave it stuck
    // at PENDING and the user sees a real error in the UI.
    await prisma.job.update({
      where: { id: job.id },
      data:  {
        status:      JobStatus.FAILED,
        failedAt: new Date(),
        result:   {
          error:         renderResult.error,
          failReason,
          renderDetails: renderResult.details ?? null,
          renderStatus:  renderResult.status ?? null,
        } as any,
      },
    }).catch(() => {});

    return NextResponse.json(
      {
        error:        userMessage,
        // Surface the exact validation error from Render (per-field
        // breakdown when it's a 400) AND the short backend message
        // so the UI can render either form without guessing.
        detail:       renderResult.error,
        details:      renderResult.details ?? null,
        renderStatus: renderResult.status ?? null,
        jobId:        job.id,
      },
      { status: renderResult.status ?? 502 },
    );
  }

  // Pass through the backend's response alongside the frontend
  // contract fields (jobId / estimates / credit reservation) so the
  // existing UI doesn't need to change.
  return NextResponse.json(
    {
      jobId:            job.id,
      status:      JobStatus.PENDING,
      totalAssets,
      creditCost,
      estimatedCostUSD: +estimatedCostUSD.toFixed(4),
      estimatedSeconds: Math.round(totalAssets * (input.hqUpgrade ? 14 : 8)),
      formats:          input.formats,
      creditsReserved:  creditCost,
      hqUpgrade:        input.hqUpgrade,
      durability:       "render_backend",
      render:           renderResult.data,
    },
    { status: 202 }
  );
});
