// src/app/api/org/route.ts
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { ApiError }          from "../../../lib/types";
import { z }                 from "zod";
import { PLANS, resolvePlan } from "@arkiol/shared";

// ── GET /api/org — get current org ────────────────────────────────────────
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user   = await getRequestUser(req);
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });
  if (!dbUser?.orgId) throw new ApiError(403, "You don't belong to an organization");

  const org = await prisma.org.findUnique({
    where:   { id: dbUser.orgId },
    include: {
      _count: { select: { members: true, brands: true, campaigns: true } },
    },
  });
  if (!org) throw new ApiError(404, "Organization not found");

  // Usage stats
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);
  const usageLast30d  = await prisma.usage.aggregate({
    _sum:  { credits: true },
    where: { createdAt: { gte: thirtyDaysAgo }, user: { orgId: dbUser.orgId } },
  });

  // Single source of truth: resolve via @arkiol/shared PLANS
  const planKey = resolvePlan(org.plan);
  const planCfg = PLANS[planKey];

  // Canonical credit fields
  const creditBalance   = org.creditBalance;
  const monthlyLimit    = planCfg.credits;
  const usagePct        = monthlyLimit > 0
    ? Math.round(((monthlyLimit - creditBalance) / monthlyLimit) * 100)
    : 0;

  return NextResponse.json({
    org: {
      id:           org.id,
      name:         org.name,
      slug:         org.slug,
      plan:         planKey,
      // Canonical credit fields (no legacy creditsUsed/creditLimit)
      creditBalance,
      dailyCreditBalance:   org.dailyCreditBalance,
      monthlyLimit,
      usagePct,
      currentCycleStart:    org.currentCycleStart,
      currentCycleEnd:      org.currentCycleEnd,
      // Flags
      ssoEnabled:   org.ssoEnabled,
      mfaRequired:  org.mfaRequired,
      counts:       org._count,
      usageLast30d: usageLast30d._sum.credits ?? 0,
      // Plan limits from shared — never hardcoded
      planLimits: {
        creditLimit:    planCfg.credits,
        maxMembers:     planCfg.members,
        maxBrands:      planCfg.brands,
        maxConcurrency: planCfg.maxConcurrency,
        priceUsd:       planCfg.priceUsd,
        rolloverPct:    planCfg.rolloverPct,
      },
      createdAt: org.createdAt,
    },
  });
});

// ── PATCH /api/org — update org name, settings ────────────────────────────
const UpdateOrgSchema = z.object({
  name:        z.string().min(2).max(100).optional(),
  ssoEnabled:  z.boolean().optional(),
  mfaRequired: z.boolean().optional(),
});

export const PATCH = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "MANAGE_BILLING");

  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });
  if (!dbUser?.orgId) throw new ApiError(403, "No organization");

  const body   = await req.json().catch(() => ({}));
  const parsed = UpdateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.org.update({
    where: { id: dbUser.orgId },
    data:  parsed.data,
  });

  return NextResponse.json({ org: { id: updated.id, name: updated.name, ssoEnabled: updated.ssoEnabled, mfaRequired: updated.mfaRequired } });
});
