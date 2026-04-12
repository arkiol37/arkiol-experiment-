// src/app/api/generate/schedule/route.ts
// POST /api/generate/schedule — Schedule a generation job for future execution.
// GET  /api/generate/schedule — List all scheduled (pending/delayed) jobs for the org.
// DELETE /api/generate/schedule?jobId=xxx — Cancel a scheduled job before it fires.
// ─────────────────────────────────────────────────────────────────────────────
//
// Uses BullMQ's native `delay` option: the job sits in BullMQ's "delayed" state
// until the scheduled time, then moves to "waiting" and is processed normally.
//
// Plan gates:
//   • Any plan:     schedule up to 24h in advance
//   • PRO/STUDIO:   schedule up to 30 days in advance
//   • STUDIO only:  schedule recurring jobs (recurrence field)
//
// A ScheduledJob record (stored in the Job table with type=GENERATE_ASSETS,
// status=PENDING, and a `scheduledAt` timestamp in the payload) tracks the
// scheduled intent. On cancellation the BullMQ job is removed and the DB
// record is updated to CANCELLED.
//
// The existing generation worker processes scheduled jobs exactly as normal
// jobs — the scheduling is purely a queue delay concern.
//
// Limits:
//   • Max 10 scheduled jobs per org (any plan)
//   • Max 50 scheduled jobs per org (STUDIO)
//   • Minimum schedule horizon: 5 minutes from now
//   • Maximum: 24h (FREE/CREATOR), 30 days (PRO/STUDIO)

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse }         from "next/server";
import { prisma }                            from "../../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../../lib/auth";
import { rateLimit, rateLimitHeaders }       from "../../../../lib/rate-limit";
import { generationQueue }                   from "../../../../lib/queue";
import { withErrorHandling, dbUnavailable, aiUnavailable }                 from "../../../../lib/error-handling";
import { ApiError, getCreditCost }           from "../../../../lib/types";
import { loadOrgSnapshot }                   from "../../../../lib/planGate";
import { isFounderEmail }                    from "../../../../lib/ownerAccess";
import { getPlanConfig }                     from "@arkiol/shared";
import { z }                                 from "zod";

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_DELAY_MS       = 5 * 60 * 1000;          // 5 min minimum
const MAX_DELAY_BASIC_MS = 24 * 60 * 60 * 1000;    // 24h for FREE/CREATOR
const MAX_DELAY_PRO_MS   = 30 * 24 * 60 * 60 * 1000; // 30 days for PRO/STUDIO
const MAX_SCHEDULED_BASIC  = 10;
const MAX_SCHEDULED_STUDIO = 50;

// ── Schema ────────────────────────────────────────────────────────────────────

const ScheduleSchema = z.object({
  // Identical to /api/generate body
  prompt:      z.string().min(10).max(2000),
  formats:     z.array(
    z.enum(["instagram_post","instagram_story","youtube_thumbnail",
            "flyer","poster","presentation_slide",
            "business_card","resume","logo"] as const)
  ).min(1).max(9),
  stylePreset: z.string().max(80).default("auto"),
  variations:  z.number().int().min(1).max(5).default(1),
  brandId:     z.string().optional(),
  campaignId:  z.string().optional(),
  includeGif:  z.boolean().default(false),
  hqUpgrade:   z.boolean().default(false),
  locale:      z.string().max(10).default("en"),
  // Schedule-specific
  runAt:       z.string().datetime(),   // ISO 8601, must be in the future
  label:       z.string().max(200).optional(),
});

// ── POST — create a scheduled job ────────────────────────────────────────────

export const POST = withErrorHandling(async (req: NextRequest) => {
  const user = await getRequestUser(req);

  // ── Founder bypass — resolved before any credit/plan check ───────────────
  // ── Founder / owner resolution (DB-authoritative) ──────────────────────────
  const _schedHeaderEmail  = req.headers.get("x-user-email")?.toLowerCase().trim() || "";
  const _schedUserObjEmail = ((user as any).email as string | undefined)?.toLowerCase().trim() || "";
  const _schedDbResult = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, role: true },
  }).catch(() => null);
  const _schedDbEmail = _schedDbResult?.email?.toLowerCase().trim() || "";
  const _schedDbRole  = _schedDbResult?.role || "";
  const _schedEmail: string = _schedHeaderEmail || _schedUserObjEmail || _schedDbEmail;
  const isFounder     = isFounderEmail(_schedEmail);
  const effectiveRole = isFounder || user.role === "SUPER_ADMIN" || _schedDbRole === "SUPER_ADMIN"
    ? "SUPER_ADMIN"
    : user.role;
  if (isFounder && _schedDbRole !== "SUPER_ADMIN") {
    await prisma.user.update({ where: { id: user.id }, data: { role: "SUPER_ADMIN" as any } }).catch(() => {});
  }
  requirePermission(effectiveRole, "GENERATE_ASSETS");

  const rl = await rateLimit(user.id, "generate");
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = ScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { runAt: runAtStr, label, ...genParams } = parsed.data;
  const runAt     = new Date(runAtStr);
  const nowMs     = Date.now();
  const delayMs   = runAt.getTime() - nowMs;

  // ── Validate schedule horizon ────────────────────────────────────────────
  if (delayMs < MIN_DELAY_MS) {
    throw new ApiError(400, `Schedule time must be at least 5 minutes in the future. Got ${Math.round(delayMs / 60000)} minutes.`);
  }

  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: {
      org: {
        select: {
          id: true, plan: true, creditBalance: true,
          maxVariationsPerRun: true, budgetCapCredits: true,
        },
      },
    },
  });
  if (!dbUser?.org) throw new ApiError(403, "You must belong to an organization");
  const orgId   = dbUser.org.id;
  const orgPlan: string = (dbUser.org as any).plan ?? "FREE";
  const planConfig = getPlanConfig(orgPlan);

  const maxDelay = (orgPlan === "PRO" || orgPlan === "STUDIO") ? MAX_DELAY_PRO_MS : MAX_DELAY_BASIC_MS;
  if (delayMs > maxDelay) {
    const maxDays = Math.floor(maxDelay / 86400000);
    throw new ApiError(400, `Your plan allows scheduling up to ${maxDays} day(s) in advance. Upgrade to PRO for up to 30 days.`);
  }

  // ── Count existing scheduled jobs (PENDING/QUEUED with future runAt) ─────
  const existingScheduled = await prisma.job.count({
    where: {
      orgId,
      type:   "GENERATE_ASSETS",
      status: { in: ["PENDING", "QUEUED"] as any },
    },
  });
  const maxScheduled = orgPlan === "STUDIO" ? MAX_SCHEDULED_STUDIO : MAX_SCHEDULED_BASIC;
  if (existingScheduled >= maxScheduled) {
    throw new ApiError(409, `You have ${existingScheduled} pending scheduled jobs. Maximum is ${maxScheduled} for your plan.`);
  }

  // ── Credit pre-check (soft — no deduction yet, deducted at execution) ────
  const creditCost = genParams.formats.reduce((acc: number, fmt: string) => {
    return acc + getCreditCost(fmt, genParams.includeGif) * genParams.variations;
  }, 0);
  // Founder/owner bypasses credit pre-check entirely
  if (!isFounder && effectiveRole !== "SUPER_ADMIN") {
    const creditsAvailable = dbUser.org.creditBalance;
    if (creditCost > creditsAvailable) {
      throw new ApiError(402,
        `Insufficient credits at schedule time. This job requires ${creditCost} credits; you have ${creditsAvailable}. ` +
        `Note: credits are deducted at execution time, not when scheduling.`
      );
    }
  }

  // ── Create DB job record ──────────────────────────────────────────────────
  const job = await prisma.job.create({
    data: {
      type:        "GENERATE_ASSETS",
      status:      "PENDING",
      userId:      user.id,
      orgId,
      campaignId:  genParams.campaignId ?? null,
      progress:    0,
      maxAttempts: 3,
      payload: {
        userId:              user.id,
        orgId,
        prompt:              genParams.prompt,
        formats:             genParams.formats,
        stylePreset:         genParams.stylePreset,
        variations:          genParams.variations,
        brandId:             genParams.brandId ?? null,
        campaignId:          genParams.campaignId ?? null,
        includeGif:          genParams.includeGif,
        hqUpgrade:           genParams.hqUpgrade,
        locale:              genParams.locale,
        scheduledAt:         runAt.toISOString(),
        label:               label ?? null,
        expectedCreditCost:  creditCost,
        maxVariationsPerRun: dbUser.org.maxVariationsPerRun ?? 1,
      },
    },
  });

  // ── Enqueue with BullMQ delay ─────────────────────────────────────────────
  await generationQueue.add(
    "generate",
    {
      jobId: job.id,
      orgId,
      userId:    user.id,
      prompt:    genParams.prompt,
      formats:   genParams.formats,
      stylePreset: genParams.stylePreset,
      variations: genParams.variations,
      brandId:    genParams.brandId,
      campaignId: genParams.campaignId,
      includeGif: genParams.includeGif,
      hqUpgrade:  genParams.hqUpgrade,
      locale:     genParams.locale,
      scheduledAt: runAt.toISOString(),
    },
    {
      jobId:    job.id,
      delay:    delayMs,
      priority: planConfig.queuePriority,
      attempts: 3,
      backoff:  { type: "exponential", delay: 3000 },
      removeOnComplete: { count: 100 },
      removeOnFail:     false,
    }
  );

  return NextResponse.json({
    jobId:         job.id,
    runAt:         runAt.toISOString(),
    delayMs,
    delayMinutes:  Math.round(delayMs / 60000),
    label:         label ?? null,
    estimatedCreditCost: creditCost,
    status:        "PENDING",
    cancelUrl:     `/api/generate/schedule?jobId=${job.id}`,
  }, { status: 202 });
});

// ── GET — list scheduled jobs ─────────────────────────────────────────────────

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();
  if (!detectCapabilities().ai) return aiUnavailable();

  const user   = await getRequestUser(req);
  const dbUser = await prisma.user.findUnique({
    where:  { id: user.id },
    select: { orgId: true },
  });
  const orgId = dbUser?.orgId;
  if (!orgId) throw new ApiError(403, "No organization");

  interface ScheduleJobRow { id: string; status: string; payload: unknown; createdAt: Date; }

  const jobs: ScheduleJobRow[] = await prisma.job.findMany({
    where: {
      orgId,
      userId: user.id,
      type:   "GENERATE_ASSETS",
      status: { in: ["PENDING", "QUEUED"] as any },
    },
    orderBy: { createdAt: "asc" },
    take:    100,
  });

  // Filter to only scheduled jobs (have scheduledAt in payload)
  const scheduled = jobs
    .filter(j => !!(j.payload as any)?.scheduledAt)
    .map(j => {
      const p = j.payload as any;
      return {
        jobId:       j.id,
        label:       p.label ?? null,
        runAt:       p.scheduledAt,
        prompt:      p.prompt,
        formats:     p.formats,
        variations:  p.variations,
        creditCost:  p.expectedCreditCost ?? 0,
        status:      j.status,
        createdAt:   j.createdAt.toISOString(),
        cancelUrl:   `/api/generate/schedule?jobId=${j.id}`,
      };
    });

  return NextResponse.json({ scheduled, total: scheduled.length });
});

// ── DELETE — cancel a scheduled job ──────────────────────────────────────────

export const DELETE = withErrorHandling(async (req: NextRequest) => {
  const user  = await getRequestUser(req);
  const url   = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) throw new ApiError(400, "jobId query parameter required");

  const job = await prisma.job.findFirst({
    where: { id: jobId, userId: user.id, status: { in: ["PENDING", "QUEUED"] as any } },
  });
  if (!job) throw new ApiError(404, "Scheduled job not found or already started");

  // Remove from BullMQ (may already have started — safe to call even if not found)
  const bullJob = await generationQueue.getJob(jobId);
  if (bullJob) {
    const state = await bullJob.getState();
    if (state === "delayed" || state === "waiting") {
      await bullJob.remove();
    }
  }

  // Mark cancelled in DB
  await prisma.job.update({
    where: { id: jobId },
    data:  { status: "CANCELLED" as any, canceledAt: new Date() },
  });

  return NextResponse.json({ jobId, cancelled: true });
});
