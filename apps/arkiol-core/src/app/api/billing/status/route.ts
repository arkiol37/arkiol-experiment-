// src/app/api/billing/status/route.ts
// GET /api/billing/status — current account billing info.
// Supports both NextAuth session (web) and mobile Bearer JWT (mobile companion).
//
// FREE plan model (canonical — from packages/shared/src/plans.ts):
//   - 0 monthly credits (credits: 0, freeDailyCreditsPerDay: 0)
//   - 1 free watermarked Normal Ad per day (freeDailyNormalAds: 1)
//   - No creditLimit — free users are gated by maxDailyVideoJobs, not credits
//
// Mobile reads: creditsRemaining / plan / cycleEndsAt
// Web reads:    full shape including subscriptionStatus and hasActivePaddle

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities, PLANS } from '@arkiol/shared';
import { getRequestUser }    from "../../../../lib/auth";
import { isFounderEmail }    from "../../../../lib/ownerAccess";
import { prisma }            from "../../../../lib/prisma";
import { withErrorHandling, dbUnavailable } from "../../../../lib/error-handling";
import { ApiError }          from "../../../../lib/types";

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);

  // ── Founder bypass — return unlimited snapshot without hitting DB ─────────
  const _statusEmail = req.headers.get("x-user-email")?.toLowerCase().trim()
    || ((user as any).email as string | undefined)?.toLowerCase().trim()
    || "";
  if (isFounderEmail(_statusEmail) || user.role === "SUPER_ADMIN") {
    return NextResponse.json({
      plan:               "STUDIO",
      subscriptionStatus: "ACTIVE",
      creditsRemaining:   999_999,
      monthlyCredits:     6000,
      freeAdsPerDay:      0,
      cycleEndsAt:        null,
      creditBalance:      999_999,
      currentCycleEnd:    null,
      hasActivePaddle:    false,
      _founderBypass:     true,
    });
  }

  // For mobile JWT users, orgId may be null in the token — resolve from DB
  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: {
      org: {
        select: {
          plan:                 true,
          subscriptionStatus:   true,
          creditBalance:        true,
          currentCycleEnd:      true,
          paddleSubscriptionId: true,
        },
      },
    },
  });

  if (!dbUser) throw new ApiError(401, "User not found");

  // Users without an org get a synthetic free-tier status matching plans.ts FREE config
  if (!dbUser.org) {
    const freePlan = PLANS.FREE;
    return NextResponse.json({
      plan:               "FREE",
      subscriptionStatus: "NONE",
      // Free plan: no credits — gated by 1 free Normal Ad/day instead
      creditsRemaining:   0,
      monthlyCredits:     freePlan.credits,          // 0
      freeAdsPerDay:      freePlan.freeDailyNormalAds ?? 1,
      cycleEndsAt:        null,
      // Web-only fields
      creditBalance:      0,
      currentCycleEnd:    null,
      hasActivePaddle:    false,
    });
  }

  const org        = dbUser.org;
  const planConfig = PLANS[org.plan as keyof typeof PLANS] ?? PLANS.FREE;

  return NextResponse.json({
    // Mobile-friendly field names
    plan:               org.plan,
    subscriptionStatus: org.subscriptionStatus,
    creditsRemaining:   Math.max(0, org.creditBalance ?? 0),
    monthlyCredits:     planConfig.credits,
    freeAdsPerDay:      planConfig.freeDailyNormalAds ?? 0,
    cycleEndsAt:        org.currentCycleEnd?.toISOString() ?? null,
    // Web dashboard fields (superset)
    creditBalance:      org.creditBalance,
    currentCycleEnd:    org.currentCycleEnd?.toISOString() ?? null,
    hasActivePaddle:    !!org.paddleSubscriptionId,
  });
});
