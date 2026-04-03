// src/app/api/generate/pack/route.ts
// POST /api/generate/pack — Generate all formats in a Template Pack at once.
// GET  /api/generate/pack — List all packs available for the calling user's plan.
// ─────────────────────────────────────────────────────────────────────────────
//
// A Template Pack is a curated bundle of formats optimised for a use case
// (e.g. "Product Launch Bundle" = post + story + flyer + thumbnail).
//
// POST flow:
//   1. Look up the pack definition from TEMPLATE_PACKS
//   2. Check plan allows the pack's requiredPlan tier
//   3. Run buildCampaignPlan() to get coherent visual identity for all formats
//   4. If PRO/STUDIO (canBatchGenerate): fan out via /api/generate/bulk logic
//      → creates BatchJob + N Job rows in one transaction
//   5. If CREATOR (cannot batch): create a single COMPILE_CAMPAIGN job that
//      queues child jobs sequentially (max 3 formats for CREATOR plan)
//   6. Return batchId / jobIds, estimatedCredits, pack metadata
//
// GET returns all packs visible at the calling user's plan tier.

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse }         from "next/server";
import { prisma, safeTransaction }                 from "../../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../../lib/auth";
import { rateLimit, rateLimitHeaders }       from "../../../../lib/rate-limit";
import { generationQueue }                   from "../../../../lib/queue";
import { withErrorHandling, dbUnavailable, aiUnavailable, queueUnavailable }                 from "../../../../lib/error-handling";
import { ApiError, getCreditCost, GIF_ELIGIBLE_FORMATS } from "../../../../lib/types";
import { assertBatchAllowed, countOrgRunningJobs, loadOrgSnapshot } from "../../../../lib/planGate";
import { isFounderEmail } from "../../../../lib/ownerAccess";
import { buildCampaignPlan, campaignFormatToGenerationPayload } from "../../../../engines/campaign/creative-director";
import { TEMPLATE_PACKS, getPackById, getPacksByPlan } from "../../../../engines/campaign/template-packs";
import {
  createConcurrencyEnforcer,
  checkBatchGenerate,
  getPlanConfig,
  CREDIT_COSTS,
  runIntelligencePipeline,
} from "@arkiol/shared";
import { z } from "zod";

// ── Schema ────────────────────────────────────────────────────────────────────

const PackGenerateSchema = z.object({
  packId:     z.string().max(60),
  prompt:     z.string().min(10).max(2000),
  brandId:    z.string().optional(),
  variations: z.number().int().min(1).max(5).optional(),  // override pack default
  locale:     z.string().max(10).default("en"),           // NEW: multi-language support
  hqUpgrade:  z.boolean().default(false),
  seed:       z.string().max(64).optional(),
});

// ── GET — list available packs ────────────────────────────────────────────────

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();
  if (!detectCapabilities().ai) return aiUnavailable();
  if (!detectCapabilities().queue) return queueUnavailable();

  const user   = await getRequestUser(req);
  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: { org: { select: { plan: true } } },
  });
  const plan = (dbUser?.org as any)?.plan ?? "FREE";

  const packs = getPacksByPlan(plan).map(p => ({
    id:               p.id,
    name:             p.name,
    description:      p.description,
    emoji:            p.emoji,
    category:         p.category,
    formatCount:      p.formats.length,
    formats:          p.formats,
    defaultVariations: p.defaultVariations,
    objective:        p.objective,
    recommendedTones: p.recommendedTones,
    accentColor:      p.accentColor,
    examplePrompt:    p.examplePrompt,
    requiredPlan:     p.requiredPlan,
    estimatedCredits: p.estimatedCredits * p.defaultVariations,
    locked:           false,
  }));

  // Also return locked packs so the UI can show upgrade prompts
  const PLAN_ORDER: Record<string, number> = { FREE: 0, CREATOR: 1, PRO: 2, STUDIO: 3 };
  const planRank = PLAN_ORDER[plan.toUpperCase()] ?? 0;
  const lockedPacks = TEMPLATE_PACKS
    .filter(p => (PLAN_ORDER[p.requiredPlan] ?? 99) > planRank)
    .map(p => ({
      id:           p.id,
      name:         p.name,
      description:  p.description,
      emoji:        p.emoji,
      category:     p.category,
      formatCount:  p.formats.length,
      requiredPlan: p.requiredPlan,
      accentColor:  p.accentColor,
      locked:       true,
    }));

  return NextResponse.json({ packs, lockedPacks, total: packs.length + lockedPacks.length });
});

// ── POST — generate a pack ────────────────────────────────────────────────────

export const POST = withErrorHandling(async (req: NextRequest) => {
  const user = await getRequestUser(req);

  // ── Founder bypass ────────────────────────────────────────────────────────
  // ── Founder / owner resolution (DB-authoritative) ──────────────────────────
  const _packHeaderEmail  = req.headers.get("x-user-email")?.toLowerCase().trim() || "";
  const _packUserObjEmail = ((user as any).email as string | undefined)?.toLowerCase().trim() || "";
  const _packDbResult = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, role: true },
  }).catch(() => null);
  const _packDbEmail = _packDbResult?.email?.toLowerCase().trim() || "";
  const _packDbRole  = _packDbResult?.role || "";
  const _packEmail: string = _packHeaderEmail || _packUserObjEmail || _packDbEmail;
  const isFounder     = isFounderEmail(_packEmail);
  const effectiveRole = isFounder || user.role === "SUPER_ADMIN" || _packDbRole === "SUPER_ADMIN"
    ? "SUPER_ADMIN"
    : user.role;
  if (isFounder && _packDbRole !== "SUPER_ADMIN") {
    await prisma.user.update({ where: { id: user.id }, data: { role: "SUPER_ADMIN" as any } }).catch(() => {});
  }
  requirePermission(effectiveRole, "GENERATE_ASSETS");

  const rl = await rateLimit(user.id, "generate");
  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = PackGenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { packId, prompt, brandId, variations: overrideVariations, locale, hqUpgrade, seed } = parsed.data;

  // ── Resolve pack ─────────────────────────────────────────────────────────
  const pack = getPackById(packId);
  if (!pack) {
    return NextResponse.json(
      { error: `Unknown pack ID: ${packId}`, availablePacks: TEMPLATE_PACKS.map(p => p.id) },
      { status: 404 }
    );
  }

  // ── Resolve org ──────────────────────────────────────────────────────────
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
  const orgId   = dbUser.org.id;
  const orgPlan: string = (dbUser.org as any).plan ?? "FREE";

  // ── Founder runtime credit injection ─────────────────────────────────────
  if (isFounder) {
    (dbUser.org as any).creditBalance    = 999_999;
    (dbUser.org as any).budgetCapCredits = null;
  }

  // ── Plan gate: check pack's requiredPlan ─────────────────────────────────
  const PLAN_ORDER: Record<string, number> = { FREE: 0, CREATOR: 1, PRO: 2, STUDIO: 3 };
  const userPlanRank = PLAN_ORDER[orgPlan.toUpperCase()] ?? 0;
  const packPlanRank = PLAN_ORDER[pack.requiredPlan]     ?? 99;
  if (!isFounder && effectiveRole !== "SUPER_ADMIN" && userPlanRank < packPlanRank) {
    throw new ApiError(403,
      `The "${pack.name}" pack requires ${pack.requiredPlan} plan. Your current plan is ${orgPlan}.`
    );
  }

  // ── Build campaign plan (shared visual identity across all formats) ───────
  let brandPrimaryColor: string | undefined;
  if (brandId) {
    const brand = await prisma.brand.findFirst({
      where: { id: brandId, orgId },
      select: { primaryColor: true },
    });
    brandPrimaryColor = brand?.primaryColor ?? undefined;
  }

  // Thread locale into the campaign prompt so brief analyzer generates copy in the right language
  const localeAugmentedPrompt = locale !== "en"
    ? `${prompt}\n\n[Generate all copy in ${getLocaleName(locale)}]`
    : prompt;

  const campaignPlan = buildCampaignPlan({
    prompt:           localeAugmentedPrompt,
    brandId,
    brandPrimaryColor,
    requestedFormats: pack.formats,
    seed,
  });

  const variations = Math.min(
    overrideVariations ?? pack.defaultVariations,
    (dbUser.org.maxVariationsPerRun ?? 1)
  );

  // ── Credit calculation ───────────────────────────────────────────────────
  const hqExtra = hqUpgrade ? (CREDIT_COSTS.static_hq - CREDIT_COSTS.static) : 0;
  const totalCreditCost = pack.formats.reduce((acc, fmt) => {
    const base = getCreditCost(fmt, false);
    return acc + (base + hqExtra) * variations;
  }, 0);

  // Founder/owner bypasses all credit checks
  if (!isFounder && effectiveRole !== "SUPER_ADMIN") {
    const creditsAvailable = dbUser.org.creditBalance;
    if (totalCreditCost > creditsAvailable) {
      throw new ApiError(402,
        `Insufficient credits. Pack requires ${totalCreditCost} credits, you have ${creditsAvailable}.`
      );
    }
  }

  const planConfig = getPlanConfig(orgPlan);
  const _packCreditBalance = isFounder ? 999_999 : dbUser.org.creditBalance;
  const canBatch   = checkBatchGenerate({ orgId, plan: orgPlan, creditBalance: _packCreditBalance,
    dailyCreditBalance: 0, subscriptionStatus: "ACTIVE", costProtectionBlocked: false });

  // ── Route: PRO/STUDIO → BatchJob; CREATOR → sequential campaign jobs ─────
  if (canBatch.allowed) {
    // ── Batch path (PRO / STUDIO) ──────────────────────────────────────────
    // Validate batch size won't exceed plan limit
    await assertBatchAllowed(orgId, pack.formats.length);

    const concurrencyEnforcer = createConcurrencyEnforcer(prisma as any);
    const orgLimit = await concurrencyEnforcer.loadOrgConcurrencyLimit(orgId);

    // Pre-compute intelligence metadata for all formats in parallel
    const intelligenceMetas = await Promise.all(
      pack.formats.map(async (format) => {
        try {
          const brandKit = brandId
            ? await prisma.brand.findFirst({ where: { id: brandId, orgId } })
            : null;
          const pipeline = await runIntelligencePipeline(
            {
              prompt:      localeAugmentedPrompt,
              format,
              stylePreset: "auto",
              brandId,
            },
            {
              requestedVariations:  variations,
              maxAllowedVariations: dbUser.org.maxVariationsPerRun ?? 1,
              brandKit: brandKit as Record<string, unknown> | null,
            }
          );
          return {
            v16_layout:    pipeline.layout.data,
            v16_variation: pipeline.variation.data,
            v16_audience:  pipeline.audience.data,
            v16_density:   pipeline.density.data,
            v16_brand:     pipeline.brand.data,
          };
        } catch {
          return {};
        }
      })
    );

    const batchId = `pack_${packId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const { createdJobs } = await safeTransaction(async (tx: any) => {
      await concurrencyEnforcer.assertWithinLimit(tx as any, {
        orgId, userId: user.id, maxConcurrency: orgLimit.maxConcurrency,
      });

      await (tx as any).batchJob.create({
        data: {
          id:             batchId,
          orgId,
          userId:         user.id,
          status:         "PENDING",
          totalJobs:      pack.formats.length,
          completedJobs:  0,
          failedJobs:     0,
          cancelledJobs:  0,
          totalCreditCost,
        },
      });

      const createdJobs: Array<{ jobId: string; format: string; idx: number }> = [];

      for (let idx = 0; idx < pack.formats.length; idx++) {
        const format     = pack.formats[idx];
        const formatPlan = campaignPlan.formats.find(fp => fp.format === format) ?? campaignPlan.formats[0];
        const basePayload = campaignFormatToGenerationPayload(campaignPlan, formatPlan!, user.id, orgId);
        const meta        = intelligenceMetas[idx] ?? {};

        const job = await tx.job.create({
          data: {
            type:        "GENERATE_ASSETS",
            status:      "PENDING",
            userId:      user.id,
            orgId,
            campaignId:  campaignPlan.campaignId,
            progress:    0,
            maxAttempts: 3,
            payload: {
              ...basePayload,
              userId:    user.id,
              orgId,
              formats:   [format],
              variations,
              hqUpgrade,
              batchId,
              locale,
              expectedCreditCost: getCreditCost(format, false) * variations,
              ...meta,
            },
          },
        });

        await (tx as any).batchJobItem.create({
          data: { batchId, jobId: job.id, promptIdx: idx },
        });

        createdJobs.push({ jobId: job.id, format, idx });
      }

      return { createdJobs };
    });

    await Promise.all(
      createdJobs.map(({ jobId, format }) =>
        generationQueue.add(
          "generate",
          { jobId, orgId, userId: user.id, batchId, formats: [format], variations, prompt: localeAugmentedPrompt, locale },
          {
            jobId,
            priority:  planConfig.queuePriority,
            attempts:  3,
            backoff:   { type: "exponential", delay: 3000 },
            removeOnComplete: { count: 100 },
            removeOnFail:     false,
          }
        )
      )
    );

    return NextResponse.json({
      packId,
      packName:         pack.name,
      batchId,
      status:           "PENDING",
      totalFormats:     pack.formats.length,
      formats:          pack.formats,
      variations,
      locale,
      totalCreditCost,
      campaignObjective: campaignPlan.objective,
      pollUrl:           `/api/jobs/batch/${batchId}`,
      estimatedSeconds:  Math.round(pack.formats.length * variations * 8 / 3),
    }, { status: 202 });

  } else {
    // ── Sequential path (CREATOR — no batch, max 3 formats) ──────────────
    const allowedFormats = pack.formats.slice(0, planConfig.maxFormatsPerRun);
    const jobIds: string[] = [];

    const currentRunning = await countOrgRunningJobs(orgId);
    const concurrencyEnforcer = createConcurrencyEnforcer(prisma as any);
    const orgLimit = await concurrencyEnforcer.loadOrgConcurrencyLimit(orgId);

    for (let idx = 0; idx < allowedFormats.length; idx++) {
      const format     = allowedFormats[idx];
      const formatPlan = campaignPlan.formats.find(fp => fp.format === format) ?? campaignPlan.formats[0];
      const basePayload = campaignFormatToGenerationPayload(campaignPlan, formatPlan!, user.id, orgId);

      const job = await safeTransaction(async (tx: any) => {
        if (idx === 0) {
          await concurrencyEnforcer.assertWithinLimit(tx as any, {
            orgId, userId: user.id, maxConcurrency: orgLimit.maxConcurrency,
          });
        }
        return tx.job.create({
          data: {
            type:        "GENERATE_ASSETS",
            status:      "PENDING",
            userId:      user.id,
            orgId,
            campaignId:  campaignPlan.campaignId,
            progress:    0,
            maxAttempts: 3,
            payload: {
              ...basePayload,
              userId:    user.id,
              orgId,
              formats:   [format],
              variations,
              hqUpgrade,
              locale,
              expectedCreditCost: getCreditCost(format, false) * variations,
            },
          },
        });
      });

      await generationQueue.add(
        "generate",
        { jobId: job.id, orgId, userId: user.id, formats: [format], variations, prompt: localeAugmentedPrompt, locale },
        {
          jobId:    job.id,
          priority: planConfig.queuePriority,
          attempts: 3,
          backoff:  { type: "exponential", delay: 3000 },
          removeOnComplete: { count: 100 },
          removeOnFail:     false,
        }
      );

      jobIds.push(job.id);
    }

    return NextResponse.json({
      packId,
      packName:          pack.name,
      jobIds,
      status:            "PENDING",
      totalFormats:      allowedFormats.length,
      skippedFormats:    pack.formats.length - allowedFormats.length,
      formats:           allowedFormats,
      variations,
      locale,
      totalCreditCost:   allowedFormats.reduce((acc, fmt) => acc + getCreditCost(fmt, false) * variations, 0),
      campaignObjective: campaignPlan.objective,
      note:              allowedFormats.length < pack.formats.length
        ? `Your plan supports up to ${planConfig.maxFormatsPerRun} formats. Upgrade to PRO to generate all ${pack.formats.length} formats.`
        : undefined,
    }, { status: 202 });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocaleName(locale: string): string {
  const names: Record<string, string> = {
    en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian",
    pt: "Portuguese", nl: "Dutch", pl: "Polish", ru: "Russian", ja: "Japanese",
    zh: "Chinese (Simplified)", ko: "Korean", ar: "Arabic", hi: "Hindi",
    tr: "Turkish", sv: "Swedish", da: "Danish", fi: "Finnish", nb: "Norwegian",
    el: "Greek", he: "Hebrew", th: "Thai", vi: "Vietnamese", id: "Indonesian",
  };
  return names[locale.toLowerCase().slice(0, 2)] ?? locale;
}
