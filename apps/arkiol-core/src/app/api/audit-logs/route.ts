// src/app/api/audit-logs/route.ts
// Audit log query endpoint — ADMIN+ only.
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getAuthUser, requirePermission } from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { prisma } from "../../../lib/prisma";
import { ApiError } from "../../../lib/types";

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getAuthUser();
  requirePermission(user.role, "MANAGE_BILLING");

  const url    = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
  const action = url.searchParams.get("action") ?? undefined;
  const orgId  = url.searchParams.get("orgId") ?? undefined;
  const since  = url.searchParams.get("since") ? new Date(url.searchParams.get("since")!) : undefined;

  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });
  if (!dbUser?.orgId) throw new ApiError(403, "No organization");

  // SUPER_ADMIN can query any org; ADMIN limited to their own org
  const targetOrgId = user.role === "SUPER_ADMIN" ? (orgId ?? undefined) : dbUser.orgId;

  const logs = await prisma.auditLog.findMany({
    where: {
      ...(targetOrgId ? { orgId: targetOrgId } : {}),
      ...(action ? { action: { contains: action } } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take:    limit,
  });

  return NextResponse.json({ logs, total: logs.length });
});
