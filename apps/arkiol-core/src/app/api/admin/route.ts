// src/app/api/admin/route.ts
// Internal admin API — SUPER_ADMIN / ADMIN only.
// Sections: overview, orgs, users, ai-health, pipeline-scores, ab-results, brand-learning, stage-traces
// NO direct process.env — all config via env module.
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../lib/prisma";
import { getRequestUser }       from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { ApiError }          from "../../../lib/types";
import { getEnv, getActiveBillingProvider } from "@arkiol/shared";

// ── GET /api/admin — system overview (SUPER_ADMIN / ADMIN only) ────────────
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    throw new ApiError(403, "Admin access required");
  }

  const url      = new URL(req.url);
  const section  = url.searchParams.get("section") ?? "overview";

  // ── overview ─────────────────────────────────────────────────────────────
  if (section === "overview") {
    const [
      totalUsers, totalOrgs, totalAssets, totalCampaigns,
      totalJobs, failedJobs, pendingJobs,
      recentUsage,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.org.count(),
      prisma.asset.count(),
      prisma.campaign.count(),
      prisma.job.count(),
      prisma.job.count({ where: { status: "FAILED" } }),
      prisma.job.count({ where: { status: "PENDING" } }),
      prisma.usage.aggregate({
        _sum: { credits: true },
        where: { createdAt: { gte: new Date(Date.now() - 30 * 86400 * 1000) } },
      }),
    ]);

    const topOrgs = await prisma.org.findMany({
      orderBy: { creditsUsed: "desc" },
      take:    10,
      select:  { id: true, name: true, plan: true, creditLimit: true, creditsUsed: true, createdAt: true },
    });

    const recentErrors = await prisma.job.findMany({
      where:   { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take:    10,
      select:  { id: true, type: true, result: true, updatedAt: true, userId: true },
    });

    return NextResponse.json({
      stats: {
        totalUsers,
        totalOrgs,
        totalAssets,
        totalCampaigns,
        jobs: { total: totalJobs, failed: failedJobs, pending: pendingJobs },
        creditsUsed30d: recentUsage._sum.credits ?? 0,
      },
      topOrgs,
      recentErrors,
    });
  }

  // ── orgs ──────────────────────────────────────────────────────────────────
  if (section === "orgs") {
    const page  = parseInt(url.searchParams.get("page") ?? "1");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);

    const orgs = await prisma.org.findMany({
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * limit,
      take:    limit,
      include: { _count: { select: { members: true, campaigns: true, brands: true } } },
    });
    const total = await prisma.org.count();
    return NextResponse.json({ orgs, total, page, limit });
  }

  // ── users ─────────────────────────────────────────────────────────────────
  if (section === "users") {
    const page  = parseInt(url.searchParams.get("page") ?? "1");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);
    const q     = url.searchParams.get("q");

    const users = await prisma.user.findMany({
      where:   q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {},
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * limit,
      take:    limit,
      select: {
        id: true, email: true, name: true, role: true,
        orgId: true, createdAt: true,
        _count: { select: { assets: true, jobs: true } },
      },
    });
    const total = await prisma.user.count();
    return NextResponse.json({ users, total, page, limit });
  }

  // ── ai-health — real-time AI system health snapshot ───────────────────────
  // Shows kill-switch state, global spend, billing provider, stage failure rates.
  if (section === "ai-health") {
    const env = getEnv();
    const killSwitchActive = (env.GENERATION_KILL_SWITCH ?? '').toLowerCase() === 'true'
      || (env.GENERATION_KILL_SWITCH ?? '') === '1';
    const globalSpendLimit = env.GLOBAL_MONTHLY_SPEND_LIMIT_USD
      ? parseFloat(env.GLOBAL_MONTHLY_SPEND_LIMIT_USD)
      : 10_000;
    const billingProvider = getActiveBillingProvider();

    // Recent pipeline health (last 24h)
    const since24h = new Date(Date.now() - 86400 * 1000);
    const [recentJobs, failedJobs, recentBenchmarks] = await Promise.all([
      prisma.job.count({ where: { createdAt: { gte: since24h } } }),
      prisma.job.count({ where: { status: "FAILED", createdAt: { gte: since24h } } }),
      (prisma as any).aIBenchmarkRecord?.findMany?.({
        where:   { renderedAt: { gte: since24h } },
        orderBy: { renderedAt: 'desc' },
        take:    200,
        select:  { overallScore: true, anyFallback: true, pipelineMs: true, violationCount: true },
      }) ?? [],
    ]);

    const benchmarkArr = recentBenchmarks as Array<{ overallScore: number; anyFallback: boolean; pipelineMs: number; violationCount: number }>;
    const avgScore    = benchmarkArr.length ? benchmarkArr.reduce((s, r) => s + r.overallScore, 0) / benchmarkArr.length : 0;
    const fallbackPct = benchmarkArr.length ? benchmarkArr.filter(r => r.anyFallback).length / benchmarkArr.length : 0;
    const avgPipeMs   = benchmarkArr.length ? benchmarkArr.reduce((s, r) => s + r.pipelineMs, 0) / benchmarkArr.length : 0;
    const violRate    = benchmarkArr.length ? benchmarkArr.reduce((s, r) => s + r.violationCount, 0) / benchmarkArr.length : 0;

    // Stage failure rates from recent stage traces
    const stageFailures = await (prisma as any).aIStageTrace?.groupBy?.({
      by:     ['stageId'],
      where:  { createdAt: { gte: since24h }, fallback: true },
      _count: { fallback: true },
      orderBy: { _count: { fallback: 'desc' } },
    }).catch(() => []) ?? [];

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      systemHealth: {
        killSwitchActive,
        billingProvider,
        globalSpendLimitUsd: globalSpendLimit,
        paddleEnv: env.PADDLE_ENVIRONMENT ?? 'sandbox',
      },
      pipeline24h: {
        totalJobs:     recentJobs,
        failedJobs,
        failRate:      recentJobs > 0 ? failedJobs / recentJobs : 0,
        assetCount:    benchmarkArr.length,
        avgQualScore:  Math.round(avgScore * 1000) / 1000,
        fallbackPct:   Math.round(fallbackPct * 1000) / 1000,
        avgPipelineMs: Math.round(avgPipeMs),
        avgViolations: Math.round(violRate * 10) / 10,
      },
      worstStages: (stageFailures as any[]).slice(0, 10).map((s: any) => ({
        stageId:      s.stageId,
        fallbackCount: s._count?.fallback ?? 0,
      })),
    });
  }

  // ── pipeline-scores — recent job quality scores ────────────────────────────
  if (section === "pipeline-scores") {
    const page  = parseInt(url.searchParams.get("page") ?? "1");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
    const orgId = url.searchParams.get("orgId");

    const where = orgId ? { orgId } : {};
    const [jobs, total] = await Promise.all([
      (prisma as any).aIJobSummary?.findMany?.({
        where,
        orderBy: { completedAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }) ?? [],
      (prisma as any).aIJobSummary?.count?.({ where }) ?? 0,
    ]);

    return NextResponse.json({ jobs, total, page, limit });
  }

  // ── ab-results — A/B experiment performance ────────────────────────────────
  if (section === "ab-results") {
    const orgId          = url.searchParams.get("orgId");
    const experimentName = url.searchParams.get("experiment");

    const where: Record<string, unknown> = {};
    if (orgId)          where.orgId          = orgId;
    if (experimentName) where.experimentName = experimentName;

    const results = await (prisma as any).aIABResult?.findMany?.({
      where,
      orderBy: [{ experimentName: 'asc' }, { avgQualityScore: 'desc' }],
      take:    200,
    }) ?? [];

    // Group by experiment, find winner per experiment
    const byExperiment: Record<string, any[]> = {};
    for (const r of results as any[]) {
      if (!byExperiment[r.experimentName]) byExperiment[r.experimentName] = [];
      byExperiment[r.experimentName].push(r);
    }

    const summary = Object.entries(byExperiment).map(([name, variants]) => {
      const sorted = [...variants].sort((a, b) => b.avgQualityScore - a.avgQualityScore);
      return {
        experimentName: name,
        winner:         sorted[0]?.variant,
        winnerScore:    sorted[0]?.avgQualityScore,
        variants:       sorted,
      };
    });

    return NextResponse.json({ experiments: summary, rawResults: results });
  }

  // ── brand-learning — per-org style & format performance ────────────────────
  // NOTE: Enhanced version with time-range filtering available at /api/admin/ai-pipeline?section=brand-learning
  if (section === "brand-learning") {
    const orgId = url.searchParams.get("orgId");
    if (!orgId) throw new ApiError(400, "orgId query param required for brand-learning section");

    // V17: enforce Brand Learning feature flag — never return data if disabled
    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { id: true, brandLearningEnabled: true } });
    if (!org) throw new ApiError(404, "Organization not found");
    if (!(org as any).brandLearningEnabled) {
      return NextResponse.json({
        orgId,
        brandLearningEnabled: false,
        message: "Brand Learning is not enabled for this organization.",
        stylePerformance: [], formatPerformance: [], recentAssets: [],
      });
    }

    const [styles, formats, recentBenchmarks] = await Promise.all([
      (prisma as any).aIStylePerformance?.findMany?.({
        where:   { orgId },
        orderBy: { avgQualityScore: 'desc' },
      }) ?? [],
      (prisma as any).aIFormatPerformance?.findMany?.({
        where:   { orgId },
        orderBy: { avgQualityScore: 'desc' },
      }) ?? [],
      (prisma as any).aIBenchmarkRecord?.findMany?.({
        where:   { orgId },
        orderBy: { renderedAt: 'desc' },
        take:    20,
        select:  { assetId: true, format: true, stylePreset: true, overallScore: true, anyFallback: true, pipelineMs: true, renderedAt: true },
      }) ?? [],
    ]);

    return NextResponse.json({
      orgId,
      stylePerformance:  styles,
      formatPerformance: formats,
      recentAssets:      recentBenchmarks,
    });
  }

  // ── stage-traces — per-stage execution traces ──────────────────────────────
  if (section === "stage-traces") {
    const jobId   = url.searchParams.get("jobId");
    const assetId = url.searchParams.get("assetId");
    const orgId   = url.searchParams.get("orgId");
    const fallbackOnly = url.searchParams.get("fallbackOnly") === "true";
    const page    = parseInt(url.searchParams.get("page") ?? "1");
    const limit   = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);

    const where: Record<string, unknown> = {};
    if (jobId)        where.jobId   = jobId;
    if (assetId)      where.assetId = assetId;
    if (orgId)        where.orgId   = orgId;
    if (fallbackOnly) where.fallback = true;

    const [traces, total] = await Promise.all([
      (prisma as any).aIStageTrace?.findMany?.({
        where,
        orderBy: [{ createdAt: 'desc' }, { stageIdx: 'asc' }],
        skip:    (page - 1) * limit,
        take:    limit,
      }) ?? [],
      (prisma as any).aIStageTrace?.count?.({ where }) ?? 0,
    ]);

    return NextResponse.json({ traces, total, page, limit });
  }

  // ── recent-failures — recent FAILED jobs with structured error info ─────────
  if (section === "recent-failures") {
    const page    = parseInt(url.searchParams.get("page") ?? "1");
    const limit   = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
    const orgId   = url.searchParams.get("orgId");
    const code    = url.searchParams.get("code"); // filter by error code e.g. KILL_SWITCH_ACTIVE

    const where: Record<string, unknown> = { status: "FAILED" };
    if (orgId) where.orgId = orgId;

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { failedAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
        select: {
          id: true, type: true, orgId: true, userId: true,
          status: true, result: true, failedAt: true, createdAt: true,
          attempts: true, creditDeducted: true, creditRefunded: true,
        },
      }),
      prisma.job.count({ where }),
    ]);

    // Optionally filter by error code from the JSON result field
    const filtered = code
      ? jobs.filter((j: (typeof jobs)[number]) => (j.result as any)?.code === code)
      : jobs;

    // Summarize error codes
    const codeCounts: Record<string, number> = {};
    for (const j of jobs) {
      const c = (j.result as any)?.code ?? "UNKNOWN";
      codeCounts[c] = (codeCounts[c] ?? 0) + 1;
    }

    return NextResponse.json({
      jobs:        filtered,
      total,
      page,
      limit,
      codeSummary: codeCounts,
    });
  }

  throw new ApiError(400, `Unknown section: "${section}". Valid: overview, orgs, users, ai-health, pipeline-scores, ab-results, brand-learning, stage-traces, recent-failures. Enhanced AI observability with time-range filtering: /api/admin/ai-pipeline`);
});

// ── PATCH /api/admin — update org plan / credit limit / kill-switch ─────────
export const PATCH = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  if (!["SUPER_ADMIN"].includes(user.role)) {
    throw new ApiError(403, "Super admin access required");
  }

  const body = await req.json().catch(() => ({}));
  const { orgId, plan, creditLimit, creditsUsed } = body;

  if (!orgId) throw new ApiError(400, "orgId required");

  const org = await prisma.org.findUnique({ where: { id: orgId } });
  if (!org) throw new ApiError(404, "Organization not found");

  const updated = await prisma.org.update({
    where: { id: orgId },
    data: {
      ...(plan        ? { plan }        : {}),
      ...(creditLimit ? { creditLimit } : {}),
      ...(creditsUsed !== undefined ? { creditsUsed } : {}),
    },
  });

  return NextResponse.json({ org: updated });
});


// ── GET /api/admin — system overview (SUPER_ADMIN / ADMIN only) ────────────
