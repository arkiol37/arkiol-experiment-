// src/app/api/cost-protection/estimate/route.ts
// POST /api/cost-protection/estimate — per-render cost estimate (C3)

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getRequestUser }       from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../lib/error-handling";
import { ApiError }          from "../../../../lib/types";
import { prisma }            from "../../../../lib/prisma";
import { getCreditCost, GIF_ELIGIBLE_FORMATS } from "../../../../lib/types";
import { CREDIT_COSTS } from "@arkiol/shared";
import { z }                 from "zod";
import {
  GALLERY_DEFAULT_CANDIDATE_COUNT,
  GALLERY_MAX_CANDIDATE_COUNT,
  GALLERY_MIN_CANDIDATE_COUNT,
} from "../../../../lib/gallery-config";

const COST_PER_CREDIT_USD     = 0.008;
const MAX_COST_PER_RENDER_USD = 0.50;  // margin safeguard per render
const ABUSE_JOBS_THRESHOLD    = 20;
const ABUSE_WINDOW_MINUTES    = 10;

const EstimateSchema = z.object({
  formats:    z.array(z.string()).min(1).max(9),
  // Step 21: mirror the /api/generate schema so the UI can preview cost
  // for the broader gallery candidate count.
  variations: z.number()
               .int()
               .min(GALLERY_MIN_CANDIDATE_COUNT)
               .max(GALLERY_MAX_CANDIDATE_COUNT)
               .default(GALLERY_DEFAULT_CANDIDATE_COUNT),
  includeGif: z.boolean().default(false),
  hqUpgrade:  z.boolean().default(false), // explicit HQ upgrade — costs more credits
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);

  const body   = await req.json().catch(() => null);
  if (!body) throw new ApiError(400, "Request body required");

  const parsed = EstimateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { formats, variations, includeGif, hqUpgrade } = parsed.data;

  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: { org: true },
  });
  if (!dbUser?.org) throw new ApiError(403, "No organization");

  // NEW-001 FIX: Mirror generate route — only count GIF credits for GIF_ELIGIBLE_FORMATS.
  // HQ upgrade: adds (static_hq - static) extra credits per asset.
  const hqExtra = hqUpgrade ? (CREDIT_COSTS.static_hq - CREDIT_COSTS.static) : 0;
  const totalCredits = formats.reduce(
    (acc: number, fmt: string) => acc + (getCreditCost(fmt, includeGif && GIF_ELIGIBLE_FORMATS.has(fmt)) + hqExtra) * variations, 0
  );
  const estimatedCostUSD = totalCredits * COST_PER_CREDIT_USD;
  const marginSafe       = estimatedCostUSD <= MAX_COST_PER_RENDER_USD;
  const creditsRemaining = dbUser.org.creditLimit - dbUser.org.creditsUsed;
  const canAfford        = totalCredits <= creditsRemaining;

  // Budget cap check using real DB field
  const budgetCapCredits = dbUser.org.budgetCapCredits ?? null;
  const budgetCapHit     = budgetCapCredits !== null &&
    (dbUser.org.creditsUsed + totalCredits) > budgetCapCredits;

  // Abuse detection
  const windowStart    = new Date(Date.now() - ABUSE_WINDOW_MINUTES * 60 * 1000);
  const recentJobCount = await prisma.job.count({
    where: { userId: user.id, createdAt: { gte: windowStart }, type: "GENERATE_ASSETS" },
  });
  const isThrottled = recentJobCount >= ABUSE_JOBS_THRESHOLD;

  const blockReasons: string[] = [];
  if (!canAfford)  blockReasons.push(`Insufficient credits (need ${totalCredits}, have ${creditsRemaining})`);
  if (budgetCapHit) blockReasons.push(`Monthly budget cap reached (${dbUser.org.creditsUsed}/${budgetCapCredits} credits used)`);
  if (isThrottled) blockReasons.push(`Abuse detection: ${recentJobCount} jobs in ${ABUSE_WINDOW_MINUTES} minutes (limit: ${ABUSE_JOBS_THRESHOLD})`);
  if (!marginSafe) blockReasons.push(`Estimated cost $${estimatedCostUSD.toFixed(4)} exceeds per-render safety limit $${MAX_COST_PER_RENDER_USD.toFixed(2)}`);

  const blocked = blockReasons.length > 0;

  return NextResponse.json({
    estimate: {
      totalCredits,
      estimatedCostUSD: +estimatedCostUSD.toFixed(4),
      formats,
      variations,
      includeGif,
      hqUpgrade,
      hqExtraCostPerAsset: hqExtra,
    },
    allowed:      !blocked,
    blocked,
    blockReasons,
    marginSafe,
    creditsRemaining,
    canAfford,
    budgetCapCredits,
    budgetCapHit,
    isThrottled,
  });
});
