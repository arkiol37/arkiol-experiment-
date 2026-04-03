// src/app/api/usage/route.ts
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }          from "../../../lib/prisma";
import { getRequestUser }     from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { ApiError }          from "../../../lib/types";

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);

  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: { org: true },
  });
  if (!dbUser?.org) throw new ApiError(403, "No organization");

  const url    = new URL(req.url);
  const period = url.searchParams.get("period") ?? "30d";

  const daysMap: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
  const days = daysMap[period] ?? 30;
  const from = new Date(Date.now() - days * 86400 * 1000);

  // Aggregate usage by action
  const usage = await prisma.usage.groupBy({
    by:      ["action"],
    where:   { userId: user.id, createdAt: { gte: from } },
    _sum:    { credits: true },
    _count:  { id: true },
    orderBy: { _sum: { credits: "desc" } },
  });

  // Daily breakdown for chart
  const dailyUsage = await prisma.$queryRaw<Array<{ date: string; credits: number }>>`
    SELECT
      DATE(created_at)::text as date,
      SUM(credits)::int as credits
    FROM "Usage"
    WHERE user_id = ${user.id}
      AND created_at >= ${from}
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  return NextResponse.json({
    org: {
      plan:        dbUser.org.plan,
      creditLimit: dbUser.org.creditLimit,
      creditsUsed: dbUser.org.creditsUsed,
      creditsRemaining: dbUser.org.creditLimit - dbUser.org.creditsUsed,
      usagePct:    Math.round((dbUser.org.creditsUsed / dbUser.org.creditLimit) * 100),
    },
    period,
    breakdown: usage.map(u => ({
      action:  u.action,
      credits: u._sum.credits ?? 0,
      count:   u._count.id,
    })),
    dailyUsage,
  });
});
