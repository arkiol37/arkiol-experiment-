// src/app/api/admin/diagnostics/route.ts
// Engine Diagnostics Admin API
// ─────────────────────────────────────────────────────────────────────────────
//
// GET /api/admin/diagnostics
//     Returns full system diagnostics including engine health, metrics,
//     recent errors, and active queue status.
//
// GET /api/admin/diagnostics?engine=<engineName>
//     Returns health snapshot for a specific engine.
//
// Security: SUPER_ADMIN and ADMIN only.

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from "next/server";
import { getRequestUser }               from "../../../../lib/auth";
import { withErrorHandling }         from "../../../../lib/error-handling";
import { ApiError }                  from "../../../../lib/types";
import {
  buildFullDiagnosticsReport,
  buildEngineHealthSnapshot,
  metrics,
} from "../../../../lib/observability";
import { prisma }                    from "../../../../lib/prisma";
import { dbUnavailable } from "../../../../lib/error-handling";

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    throw new ApiError(403, "Admin access required");
  }

  const url    = new URL(req.url);
  const engine = url.searchParams.get("engine");
  const section = url.searchParams.get("section") ?? "full";

  if (engine) {
    return NextResponse.json({
      engine: buildEngineHealthSnapshot(engine),
    });
  }

  if (section === "metrics") {
    return NextResponse.json({
      metrics:   metrics.snapshot(),
      timestamp: new Date().toISOString(),
    });
  }

  if (section === "queue") {
    // Fetch recent job stats from DB
    const [pendingJobs, runningJobs, failedJobs] = await Promise.all([
      prisma.job.count({ where: { status: "PENDING" } }),
      prisma.job.count({ where: { status: "RUNNING" } }),
      prisma.job.count({ where: { status: "FAILED", failedAt: { gte: new Date(Date.now() - 3600_000) } } }),
    ]);

    const recentJobs = await prisma.job.findMany({
      where: { status: { in: ["RUNNING", "PENDING"] } },
      select: {
        id:        true,
        type:      true,
        status:    true,
        userId:    true,
        orgId:     true,
        createdAt: true,
        attempts:  true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      section:    "queue",
      queue: {
        pending:    pendingJobs,
        running:    runningJobs,
        failedLastHour: failedJobs,
        recentJobs,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Full diagnostics report
  const report = buildFullDiagnosticsReport();
  return NextResponse.json(report);
});
