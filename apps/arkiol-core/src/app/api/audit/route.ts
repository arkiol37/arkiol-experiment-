// src/app/api/audit/route.ts
//
// Audit log API — GET /api/audit
//
// Returns paginated, filterable audit log entries for the caller's org.
// Requires VIEW_ANALYTICS permission.
//
// Query params:
//   page      — page number (default: 1)
//   limit     — entries per page, max 100 (default: 50)
//   actorId   — filter by user ID
//   action    — filter by action string (exact match)
//   targetId  — filter by target resource ID
//   targetType— filter by resource type (user, brand, campaign, etc.)
//   from      — ISO 8601 start date
//   to        — ISO 8601 end date

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../lib/prisma";
import { getAuthUser, requirePermission } from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { ApiError }          from "../../../lib/types";

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getAuthUser();
  requirePermission(user.role, "VIEW_ANALYTICS");

  const dbUser = await prisma.user.findUnique({
    where:  { id: user.id },
    select: { orgId: true },
  });
  if (!dbUser?.orgId) throw new ApiError(403, "No organization");

  const url        = new URL(req.url);
  const page       = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1"));
  const limit      = Math.min(100, parseInt(url.searchParams.get("limit") ?? "50"));
  const actorId    = url.searchParams.get("actorId")    ?? undefined;
  const action     = url.searchParams.get("action")     ?? undefined;
  const targetId   = url.searchParams.get("targetId")   ?? undefined;
  const targetType = url.searchParams.get("targetType") ?? undefined;
  const from       = url.searchParams.get("from")       ?? undefined;
  const to         = url.searchParams.get("to")         ?? undefined;

  const where = {
    orgId: dbUser.orgId,
    ...(actorId    ? { actorId }    : {}),
    ...(action     ? { action }     : {}),
    ...(targetId   ? { targetId }   : {}),
    ...(targetType ? { targetType } : {}),
    ...(from || to ? {
      createdAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to)   } : {}),
      },
    } : {}),
  };

  const [entries, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * limit,
      take:    limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({
    entries,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
});
