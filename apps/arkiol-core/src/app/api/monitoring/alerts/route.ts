// src/app/api/monitoring/alerts/route.ts
// POST /api/monitoring/alerts — run full monitoring checks and return alert summary
// GET  /api/monitoring/alerts — return recent alert audit entries
import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from "next/server";
import { getServerSession }          from "next-auth/next";
import { authOptions }               from "../../../../lib/auth";
import { prisma }                    from "../../../../lib/prisma";
import { logger }                    from "../../../../lib/logger";
import { generationQueue }           from "../../../../lib/queue";
import { dbUnavailable } from "../../../../lib/error-handling";
import {
  runMonitoringChecks,
} from "@arkiol/shared";

function isAuthorized(req: NextRequest, session: any): boolean {
  if (session?.user?.role === "SUPER_ADMIN") return true;
  const token = req.headers.get("x-monitoring-token");
  const secret = process.env.MONITORING_SECRET;
  return !!(secret && token === secret);
}

// POST — run all monitoring checks right now
export async function POST(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  const session = await getServerSession(authOptions);
  if (!isAuthorized(req, session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Get DLQ depth for the checks
    let dlqDepth = 0;
    try {
      dlqDepth = await generationQueue.getFailedCount();
    } catch { /* non-fatal */ }

    const result = await runMonitoringChecks(
      { prisma: prisma as any, logger },
      dlqDepth,
    );

    return NextResponse.json({
      ...result,
      alerts: result.alerts.map(a => ({
        ...a,
        windowStart: a.windowStart.toISOString(),
        windowEnd:   a.windowEnd.toISOString(),
        firedAt:     a.firedAt.toISOString(),
      })),
    });
  } catch (err: any) {
    logger.error({ err }, "[monitoring/alerts] Failed to run checks");
    return NextResponse.json({ error: "Monitoring run failed", detail: err.message }, { status: 500 });
  }
}

// GET — return recent alert log from audit table
export async function GET(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  const session = await getServerSession(authOptions);
  if (!isAuthorized(req, session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url     = new URL(req.url);
  const since   = url.searchParams.get("since");
  const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const alerts = await prisma.auditLog.findMany({
    where:   { action: { startsWith: "monitoring." }, createdAt: { gte: sinceDate } },
    orderBy: { createdAt: "desc" },
    take:    100,
    select:  { id: true, orgId: true, action: true, metadata: true, createdAt: true },
  });

  const snapshot = null; // getMonitoringSnapshot not available in this build

  return NextResponse.json({
    alerts:   alerts.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })),
    snapshot,
    sinceIso: sinceDate.toISOString(),
  });
}
