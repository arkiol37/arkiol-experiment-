// src/app/api/cost-protection/route.ts
// C3: Cost Protection — GET org cost status
// GET /api/cost-protection — current cost status + budget info

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getAuthUser }       from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { ApiError }          from "../../../lib/types";
import { prisma }            from "../../../lib/prisma";

const COST_PER_CREDIT_USD   = 0.008;
const ABUSE_JOBS_THRESHOLD  = 20;
const ABUSE_WINDOW_MINUTES  = 10;

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user   = await getAuthUser();
  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: { org: true },
  });
  if (!dbUser?.org) throw new ApiError(403, "No organization");

  const org              = dbUser.org;
  const creditsRemaining = org.creditLimit - org.creditsUsed;
  const budgetCapCredits = org.budgetCapCredits ?? null;
  const budgetCapHit     = budgetCapCredits !== null && org.creditsUsed >= budgetCapCredits;

  const windowStart    = new Date(Date.now() - ABUSE_WINDOW_MINUTES * 60 * 1000);
  const recentJobCount = await prisma.job.count({
    where: {
      userId:    user.id,
      createdAt: { gte: windowStart },
      type:      "GENERATE_ASSETS",
    },
  });
  const isThrottled = recentJobCount >= ABUSE_JOBS_THRESHOLD;

  return NextResponse.json({
    plan:                 org.plan,
    creditsUsed:          org.creditsUsed,
    creditLimit:          org.creditLimit,
    creditsRemaining,
    budgetCapCredits,
    budgetCapHit,
    estimatedSpentUSD:    +(org.creditsUsed * COST_PER_CREDIT_USD).toFixed(4),
    estimatedRemainingUSD:+(creditsRemaining * COST_PER_CREDIT_USD).toFixed(4),
    costPerCreditUSD:     COST_PER_CREDIT_USD,
    abuseDetection: {
      recentJobCount,
      windowMinutes:  ABUSE_WINDOW_MINUTES,
      threshold:      ABUSE_JOBS_THRESHOLD,
      isThrottled,
    },
  });
});
