// src/app/api/cost-protection/budget/route.ts
// PATCH /api/cost-protection/budget — set/clear monthly budget cap (C3)
// GET   /api/cost-protection/budget — fetch current budget cap

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getRequestUser, requirePermission } from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../lib/error-handling";
import { ApiError }          from "../../../../lib/types";
import { prisma }            from "../../../../lib/prisma";
import { z }                 from "zod";

const COST_PER_CREDIT_USD = 0.008;

const BudgetSchema = z.object({
  // null = remove cap; number = set cap in credits
  budgetCapCredits: z.number().int().min(1).nullable(),
});

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user   = await getRequestUser(req);
  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: { org: true },
  });
  if (!dbUser?.org) throw new ApiError(403, "No organization");

  const budgetCapCredits = dbUser.org.budgetCapCredits ?? null;

  return NextResponse.json({
    budgetCapCredits,
    estimatedBudgetUSD: budgetCapCredits !== null
      ? +(budgetCapCredits * COST_PER_CREDIT_USD).toFixed(2)
      : null,
    creditsUsed:  dbUser.org.creditsUsed,
    creditLimit:  dbUser.org.creditLimit,
  });
});

export const PATCH = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "EDIT_BRAND"); // manager+ only

  const body   = await req.json().catch(() => null);
  if (!body) throw new ApiError(400, "Request body required");

  const parsed = BudgetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const dbUser = await prisma.user.findUnique({
    where:  { id: user.id },
    select: { orgId: true },
  });
  if (!dbUser?.orgId) throw new ApiError(403, "No organization");

  const updated = await prisma.org.update({
    where: { id: dbUser.orgId },
    data:  { budgetCapCredits: parsed.data.budgetCapCredits },
    select: { budgetCapCredits: true, creditsUsed: true, creditLimit: true },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      orgId:      dbUser.orgId,
      actorId:    user.id,
      action:     "SET_BUDGET_CAP",
      targetType: "Org",
      targetId:   dbUser.orgId,
      metadata:   { budgetCapCredits: parsed.data.budgetCapCredits },
    },
  }).catch(() => {}); // non-fatal

  return NextResponse.json({
    updated:          true,
    budgetCapCredits: updated.budgetCapCredits,
    estimatedBudgetUSD: updated.budgetCapCredits !== null
      ? +(updated.budgetCapCredits * COST_PER_CREDIT_USD).toFixed(2)
      : null,
    message: updated.budgetCapCredits === null
      ? "Budget cap removed — unlimited spend"
      : `Budget cap set to ${updated.budgetCapCredits} credits (~$${(updated.budgetCapCredits * COST_PER_CREDIT_USD).toFixed(2)})`,
  });
});
