// src/app/api/admin/failures/route.ts
//
// GET /api/admin/failures?limit=50&stage=&reason=&workerMode=&since=<iso>
//
// Returns recent FAILED jobs with their full structured diagnostics
// bundle so ops can debug without grepping serverless logs. All filters
// are optional; default is the last 50 failures across any stage /
// reason / worker mode.
//
// Response shape:
//   {
//     failures: [{ id, userId, orgId, failedAt, createdAt, startedAt,
//                  attempts, maxAttempts, error, failReason, failStage,
//                  elapsedMs, workerMode, diagnostics }],
//     totals:   { byStage: {...}, byReason: {...}, byWorkerMode: {...} },
//     window:   { since, failuresInWindow }
//   }
//
// The `totals` block gives dashboards a direct histogram over the
// window — "45% of failures in the last hour happened in
// pipeline_render" is answerable in one request.
//
// Security: SUPER_ADMIN + ADMIN only.

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from "@arkiol/shared";
import { prisma }             from "../../../../lib/prisma";
import { getRequestUser }     from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../lib/error-handling";
import { ApiError }           from "../../../../lib/types";
import { readDiagnostics }    from "../../../../lib/jobDiagnostics";

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    throw new ApiError(403, "Admin access required");
  }

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const stageFilter    = url.searchParams.get("stage")      || null;
  const reasonFilter   = url.searchParams.get("reason")     || null;
  const workerFilter   = url.searchParams.get("workerMode") || null;
  const sinceParam     = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await prisma.job.findMany({
    where: {
      status:   "FAILED" as any,
      failedAt: { gte: since },
    },
    orderBy: { failedAt: "desc" },
    take:    limit,
    select: {
      id:          true,
      type:        true,
      userId:      true,
      orgId:       true,
      createdAt:   true,
      startedAt:   true,
      failedAt:    true,
      attempts:    true,
      maxAttempts: true,
      result:      true,
    },
  });

  // Map + filter in memory — these are capped to `limit` rows, so the
  // extra client-side pass is negligible and keeps the Prisma query
  // simple (the result JSON shape varies across rows).
  //
  // Row + Failure types declared explicitly because noImplicitAny
  // doesn't infer through Prisma's generated generics in CI builds.
  interface PrismaFailureRow {
    id:          string;
    type:        string;
    userId:      string;
    orgId:       string;
    createdAt:   Date;
    startedAt:   Date | null;
    failedAt:    Date | null;
    attempts:    number;
    maxAttempts: number;
    result:      unknown;
  }
  interface FailureView {
    id:          string;
    type:        string;
    userId:      string;
    orgId:       string;
    createdAt:   Date;
    startedAt:   Date | null;
    failedAt:    Date | null;
    attempts:    number;
    maxAttempts: number;
    error:       string | null;
    failReason:  string;
    failStage:   string;
    elapsedMs:   number;
    workerMode:  string;
    diagnostics: ReturnType<typeof readDiagnostics>;
  }

  const failures: FailureView[] = (rows as PrismaFailureRow[]).map((r: PrismaFailureRow): FailureView => {
    const res = (r.result ?? {}) as Record<string, unknown>;
    const diag = readDiagnostics(res);
    return {
      id:          r.id,
      type:        r.type,
      userId:      r.userId,
      orgId:       r.orgId,
      createdAt:   r.createdAt,
      startedAt:   r.startedAt,
      failedAt:    r.failedAt,
      attempts:    r.attempts,
      maxAttempts: r.maxAttempts,
      error:       (res.error as string) ?? null,
      failReason:  (res.failReason as string) ?? diag?.failStage ?? "unknown",
      failStage:   (res.failStage  as string) ?? diag?.failStage ?? "unknown",
      elapsedMs:   (res.elapsedMs  as number) ?? diag?.elapsedMs  ?? 0,
      workerMode:  (res.workerMode as string) ?? diag?.workerMode ?? "fire_and_forget",
      diagnostics: diag,
    };
  }).filter((f: FailureView) => {
    if (stageFilter  && f.failStage  !== stageFilter)  return false;
    if (reasonFilter && f.failReason !== reasonFilter) return false;
    if (workerFilter && f.workerMode !== workerFilter) return false;
    return true;
  });

  // Stage / reason / worker-mode histograms over the filtered window.
  // Surfaced so the dashboard can render "N failures broken down by
  // stage" without a second round-trip.
  const tally = (items: FailureView[], pick: (f: FailureView) => string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const f of items) out[pick(f)] = (out[pick(f)] ?? 0) + 1;
    return out;
  };

  return NextResponse.json({
    failures,
    totals: {
      byStage:      tally(failures, f => f.failStage),
      byReason:     tally(failures, f => f.failReason),
      byWorkerMode: tally(failures, f => f.workerMode),
    },
    window: {
      since:             since.toISOString(),
      failuresInWindow:  failures.length,
    },
  });
});
