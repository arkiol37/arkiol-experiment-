// src/app/api/admin/ai-pipeline/route.ts
// AI Pipeline Observability — internal admin/API view.
//
// Exposes: pipeline scores, A/B results, brand-learning metrics,
//          stage traces (timing, decisions, fallback reasons), recent AI failures.
//
// Security contract:
//   - SUPER_ADMIN and ADMIN roles only.
//   - Every query is org-scoped: orgId is always a WHERE clause filter.
//   - No cross-tenant leakage: callers must supply orgId; "all orgs" views
//     are only available to SUPER_ADMIN without an orgId filter.
//   - Safe pagination: limit capped at per-section maximums.
//   - Time range: defaults to last 7 days; hard cap at 90 days.
//   - Brand Learning data is only returned when brandLearningEnabled=true on the org.

import { NextRequest, NextResponse } from 'next/server';
import {
  createCrashSafetyService,
  detectCapabilities,
  getAllEngines,
  getAssetLineage,
  isRegistryLocked,
  isRegistryValidated,
} from '@arkiol/shared';
import { prisma }            from '../../../../lib/prisma';
import { getRequestUser }       from '../../../../lib/auth';
import { withErrorHandling, dbUnavailable } from '../../../../lib/error-handling';
import { ApiError }          from '../../../../lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePage(raw: string | null, def = 1) {
  const n = parseInt(raw ?? `${def}`, 10);
  return Number.isFinite(n) && n >= 1 ? n : def;
}

function parseLimit(raw: string | null, def: number, max: number) {
  const n = parseInt(raw ?? `${def}`, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : def;
}

/**
 * Parse a UTC time range from ?from=ISO&to=ISO query params.
 * Defaults to last 7 days if omitted. Hard cap: 90 days.
 */
function parseTimeRange(url: URL): { from: Date; to: Date } {
  const maxMs = 90 * 24 * 60 * 60 * 1000;
  const now   = new Date();

  const toRaw   = url.searchParams.get('to');
  const fromRaw = url.searchParams.get('from');

  const to   = toRaw   ? new Date(toRaw)   : now;
  const from = fromRaw ? new Date(fromRaw) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Clamp range to 90 days
  const effectiveFrom = new Date(Math.max(from.getTime(), to.getTime() - maxMs));

  if (isNaN(to.getTime()) || isNaN(effectiveFrom.getTime())) {
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: d7, to: now };
  }

  return { from: effectiveFrom, to };
}

// ── GET /api/admin/ai-pipeline ────────────────────────────────────────────────
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  if (!['SUPER_ADMIN', 'ADMIN'].includes(user.role)) {
    throw new ApiError(403, 'Admin access required');
  }

  const url     = new URL(req.url);
  const section = url.searchParams.get('section') ?? 'summary';
  const orgId   = url.searchParams.get('orgId') ?? undefined;

  // SUPER_ADMIN can query without orgId (platform-wide view).
  // ADMIN must always supply an orgId.
  if (user.role === 'ADMIN' && !orgId) {
    throw new ApiError(400, 'orgId is required for ADMIN-level queries');
  }

  const { from, to } = parseTimeRange(url);

  // ── summary ────────────────────────────────────────────────────────────────
  if (section === 'summary') {
    const jobWhere: Record<string, unknown> = {
      createdAt: { gte: from, lte: to },
    };
    if (orgId) jobWhere.orgId = orgId;

    const benchWhere: Record<string, unknown> = {
      renderedAt: { gte: from, lte: to },
    };
    if (orgId) benchWhere.orgId = orgId;

    const [totalJobs, failedJobs, benchmarks, stageFailureSummary] = await Promise.all([
      prisma.job.count({ where: jobWhere }),
      prisma.job.count({ where: { ...jobWhere, status: 'FAILED' } }),
      (prisma as any).aIBenchmarkRecord?.findMany?.({
        where:   benchWhere,
        select:  { overallScore: true, anyFallback: true, pipelineMs: true, violationCount: true },
        take:    5000,
      }) ?? [],
      (prisma as any).aIStageTrace?.groupBy?.({
        by:      ['stageId'],
        where:   { createdAt: { gte: from, lte: to }, fallback: true, ...(orgId ? { orgId } : {}) },
        _count:  { fallback: true },
        orderBy: { _count: { fallback: 'desc' } },
        take:    10,
      }).catch(() => []) ?? [],
    ]);

    const bench = benchmarks as Array<{ overallScore: number; anyFallback: boolean; pipelineMs: number; violationCount: number }>;
    const avgScore    = bench.length ? bench.reduce((s: number, r: { overallScore: number }) => s + r.overallScore, 0) / bench.length : 0;
    const fallbackPct = bench.length ? bench.filter((r: { anyFallback: boolean }) => r.anyFallback).length / bench.length : 0;
    const avgPipeMs   = bench.length ? bench.reduce((s: number, r: { pipelineMs: number }) => s + r.pipelineMs, 0) / bench.length : 0;

    return NextResponse.json({
      section:   'summary',
      orgId:     orgId ?? null,
      timeRange: { from: from.toISOString(), to: to.toISOString() },
      pipeline: {
        totalJobs,
        failedJobs,
        failRate:      totalJobs > 0 ? Math.round((failedJobs / totalJobs) * 1000) / 1000 : 0,
        assetCount:    bench.length,
        avgQualScore:  Math.round(avgScore * 1000) / 1000,
        fallbackPct:   Math.round(fallbackPct * 1000) / 1000,
        avgPipelineMs: Math.round(avgPipeMs),
      },
      worstStages: (stageFailureSummary as any[]).map((s: any) => ({
        stageId:       s.stageId,
        fallbackCount: s._count?.fallback ?? 0,
      })),
    });
  }

  // ── pipeline-scores ────────────────────────────────────────────────────────
  if (section === 'pipeline-scores') {
    const page  = parsePage(url.searchParams.get('page'));
    const limit = parseLimit(url.searchParams.get('limit'), 50, 200);

    const where: Record<string, unknown> = {
      createdAt: { gte: from, lte: to },
    };
    if (orgId) where.orgId = orgId;

    const [jobs, total] = await Promise.all([
      (prisma as any).aIJobMetadata?.findMany?.({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        select: {
          jobId:              true,
          orgId:              true,
          overallScore:       true,
          totalAssets:        true,
          totalFallbacks:     true,
          totalViolations:    true,
          totalPipelineMs:    true,
          killSwitchActive:   true,
          globalSpendBlocked: true,
          estimatedProviderCostUsd: true,
          actualProviderCostUsd:    true,
          fallbackTriggers:   true,
          createdAt:          true,
        },
      }) ?? [],
      (prisma as any).aIJobMetadata?.count?.({ where }) ?? 0,
    ]);

    return NextResponse.json({ section: 'pipeline-scores', jobs, total, page, limit });
  }

  // ── ab-results ─────────────────────────────────────────────────────────────
  if (section === 'ab-results') {
    const experimentName = url.searchParams.get('experiment') ?? undefined;

    const where: Record<string, unknown> = {
      lastUpdated: { gte: from, lte: to },
    };
    if (orgId) where.orgId = orgId;
    if (experimentName) where.experimentName = experimentName;

    const results = await (prisma as any).aIABResult?.findMany?.({
      where,
      orderBy: [{ experimentName: 'asc' }, { avgQualityScore: 'desc' }],
      take:    500,
    }) ?? [];

    // Group by experiment, compute winner per experiment
    const byExperiment: Record<string, any[]> = {};
    for (const r of results as any[]) {
      if (!byExperiment[r.experimentName]) byExperiment[r.experimentName] = [];
      byExperiment[r.experimentName].push(r);
    }

    const experiments = Object.entries(byExperiment).map(([name, variants]) => {
      const sorted = [...variants].sort((a, b) => b.avgQualityScore - a.avgQualityScore);
      return {
        experimentName: name,
        winner:         sorted[0]?.variant,
        winnerScore:    sorted[0]?.avgQualityScore,
        sampleCount:    sorted.reduce((s: number, v: any) => s + (v.sampleCount ?? 0), 0),
        variants:       sorted.map((v: any) => ({
          variant:         v.variant,
          sampleCount:     v.sampleCount,
          avgQualityScore: v.avgQualityScore,
          avgPipelineMs:   v.avgPipelineMs,
        })),
      };
    });

    return NextResponse.json({ section: 'ab-results', experiments, orgId: orgId ?? null });
  }

  // ── brand-learning ─────────────────────────────────────────────────────────
  // Returns brand learning data ONLY when the org has brandLearningEnabled=true.
  // This enforces the feature flag at the API layer as well as the service layer.
  if (section === 'brand-learning') {
    if (!orgId) throw new ApiError(400, 'orgId is required for brand-learning section');

    // Verify org exists AND has the feature enabled
    const org = await prisma.org.findUnique({
      where:  { id: orgId },
      select: { id: true, name: true, plan: true, brandLearningEnabled: true },
    });
    if (!org) throw new ApiError(404, 'Organization not found');
    if (!(org as any).brandLearningEnabled) {
      return NextResponse.json({
        section:             'brand-learning',
        orgId,
        brandLearningEnabled: false,
        message:             'Brand Learning is not enabled for this organization.',
        styles:              [],
        formats:             [],
        recentAssets:        [],
        feedbackSummary:     null,
      });
    }

    const benchWhere = { orgId, renderedAt: { gte: from, lte: to } };
    const feedbackWhere = { orgId, occurredAt: { gte: from, lte: to } };

    const [styles, formats, recentAssets, feedbackEvents] = await Promise.all([
      (prisma as any).aIStylePerformance?.findMany?.({
        where:   { orgId },
        orderBy: { avgQualityScore: 'desc' },
      }) ?? [],
      (prisma as any).aIFormatPerformance?.findMany?.({
        where:   { orgId },
        orderBy: { avgQualityScore: 'desc' },
      }) ?? [],
      (prisma as any).aIBenchmarkRecord?.findMany?.({
        where:   benchWhere,
        orderBy: { renderedAt: 'desc' },
        take:    30,
        select:  {
          assetId:      true,
          format:       true,
          stylePreset:  true,
          overallScore: true,
          anyFallback:  true,
          pipelineMs:   true,
          renderedAt:   true,
        },
      }) ?? [],
      (prisma as any).aIFeedbackEvent?.findMany?.({
        where:   feedbackWhere,
        select:  { eventType: true, qualityScore: true, format: true, occurredAt: true },
        take:    1000,
        orderBy: { occurredAt: 'desc' },
      }) ?? [],
    ]);

    // Aggregate feedback summary
    const events = feedbackEvents as Array<{ eventType: string; qualityScore: number | null; format: string | null }>;
    const accepted = events.filter((e: any) => e.eventType === 'asset_accepted').length;
    const rejected = events.filter((e: any) => e.eventType === 'asset_rejected').length;
    const total    = accepted + rejected;
    const scores   = events.filter((e: any) => e.qualityScore != null).map((e: any) => e.qualityScore as number);
    const avgQual  = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;

    return NextResponse.json({
      section:              'brand-learning',
      orgId,
      brandLearningEnabled: true,
      timeRange:            { from: from.toISOString(), to: to.toISOString() },
      stylePerformance:     styles,
      formatPerformance:    formats,
      recentAssets,
      feedbackSummary: {
        totalEvents:     events.length,
        accepted,
        rejected,
        acceptRate:      total > 0 ? Math.round((accepted / total) * 1000) / 1000 : null,
        avgQualityScore: Math.round(avgQual * 1000) / 1000,
      },
    });
  }

  // ── stage-traces ───────────────────────────────────────────────────────────
  if (section === 'stage-traces') {
    const page        = parsePage(url.searchParams.get('page'));
    const limit       = parseLimit(url.searchParams.get('limit'), 100, 500);
    const jobId       = url.searchParams.get('jobId') ?? undefined;
    const assetId     = url.searchParams.get('assetId') ?? undefined;
    const stageId     = url.searchParams.get('stageId') ?? undefined;
    const fallbackOnly = url.searchParams.get('fallbackOnly') === 'true';

    const where: Record<string, unknown> = {
      createdAt: { gte: from, lte: to },
    };
    // orgId is always required for stage-traces to prevent accidental cross-tenant reads
    if (!orgId) throw new ApiError(400, 'orgId is required for stage-traces section');
    where.orgId = orgId;
    if (jobId)        where.jobId   = jobId;
    if (assetId)      where.assetId = assetId;
    if (stageId)      where.stageId = stageId;
    if (fallbackOnly) where.fallback = true;

    const [traces, total] = await Promise.all([
      (prisma as any).aIStageTrace?.findMany?.({
        where,
        orderBy: [{ createdAt: 'desc' }, { stageIdx: 'asc' }],
        skip:    (page - 1) * limit,
        take:    limit,
        select: {
          id:              true,
          jobId:           true,
          assetId:         true,
          orgId:           true,
          stageId:         true,
          stageIdx:        true,
          durationMs:      true,
          ok:              true,
          fallback:        true,
          fallbackReason:  true,
          decision:        true,
          outputSummary:   true,
          errorMessage:    true,
          estimatedCostUsd: true,
          actualCostUsd:    true,
          createdAt:       true,
        },
      }) ?? [],
      (prisma as any).aIStageTrace?.count?.({ where }) ?? 0,
    ]);

    return NextResponse.json({ section: 'stage-traces', traces, total, page, limit });
  }

  // ── job-metadata ───────────────────────────────────────────────────────────
  if (section === 'job-metadata') {
    const jobId = url.searchParams.get('jobId');
    if (!jobId) throw new ApiError(400, 'jobId is required for job-metadata section');
    if (!orgId) throw new ApiError(400, 'orgId is required for job-metadata section');

    const meta = await (prisma as any).aIJobMetadata?.findUnique?.({
      where: { jobId },
    });

    // Enforce org scope — never return data from another tenant
    if (!meta) throw new ApiError(404, 'Job metadata not found');
    if (meta.orgId !== orgId) throw new ApiError(403, 'Forbidden: job does not belong to the specified org');

    return NextResponse.json({ section: 'job-metadata', meta });
  }

  // ── recent-failures ────────────────────────────────────────────────────────
  if (section === 'recent-failures') {
    const page  = parsePage(url.searchParams.get('page'));
    const limit = parseLimit(url.searchParams.get('limit'), 50, 200);
    const code  = url.searchParams.get('code') ?? undefined;

    const where: Record<string, unknown> = {
      status:    'FAILED',
      failedAt:  { gte: from, lte: to },
    };
    if (orgId) where.orgId = orgId;

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { failedAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        select: {
          id:             true,
          type:           true,
          orgId:          true,
          userId:         true,
          status:         true,
          result:         true,
          failedAt:       true,
          createdAt:      true,
          attempts:       true,
          creditDeducted: true,
          creditRefunded: true,
          actualProviderCostUsd: true,
        },
      }),
      prisma.job.count({ where }),
    ]);

    // Optionally filter by structured error code from result JSON
    const filtered = code
      ? jobs.filter((j: (typeof jobs)[number]) => (j.result as any)?.code === code)
      : jobs;

    // Summarize error codes across all jobs in the window
    const codeCounts: Record<string, number> = {};
    for (const j of jobs) {
      const c = (j.result as any)?.code ?? 'UNKNOWN';
      codeCounts[c] = (codeCounts[c] ?? 0) + 1;
    }

    return NextResponse.json({
      section:     'recent-failures',
      jobs:        filtered,
      total,
      page,
      limit,
      codeSummary: codeCounts,
      timeRange:   { from: from.toISOString(), to: to.toISOString() },
    });
  }

  // ── feedback-events ────────────────────────────────────────────────────────
  if (section === 'feedback-events') {
    if (!orgId) throw new ApiError(400, 'orgId is required for feedback-events section');
    const page      = parsePage(url.searchParams.get('page'));
    const limit     = parseLimit(url.searchParams.get('limit'), 100, 500);
    const eventType = url.searchParams.get('eventType') ?? undefined;

    const where: Record<string, unknown> = {
      orgId,
      occurredAt: { gte: from, lte: to },
    };
    if (eventType) where.eventType = eventType;

    const [events, total] = await Promise.all([
      (prisma as any).aIFeedbackEvent?.findMany?.({
        where,
        orderBy: { occurredAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }) ?? [],
      (prisma as any).aIFeedbackEvent?.count?.({ where }) ?? 0,
    ]);

    return NextResponse.json({ section: 'feedback-events', events, total, page, limit });
  }

  // ── routing-plans ──────────────────────────────────────────────────────────
  // Shows the immutable routing plan audit trail — what was decided BEFORE each
  // pipeline execution and why. Essential for debugging "why did engine X not run?"
  if (section === 'routing-plans') {
    if (!orgId) throw new ApiError(400, 'orgId is required for routing-plans section');
    const page  = parsePage(url.searchParams.get('page'));
    const limit = parseLimit(url.searchParams.get('limit'), 50, 200);
    const mode  = url.searchParams.get('mode') ?? undefined;
    const jobId = url.searchParams.get('jobId') ?? undefined;

    const where: Record<string, unknown> = {
      orgId,
      routedAt: { gte: from, lte: to },
    };
    if (mode)  where.mode  = mode;
    if (jobId) where.jobId = jobId;

    const [plans, total] = await Promise.all([
      (prisma as any).routingPlanLog?.findMany?.({
        where,
        orderBy: { routedAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        select: {
          id:                  true,
          jobId:               true,
          orgId:               true,
          mode:                true,
          enabledEngines:      true,
          disabledEngines:     true,
          explorationParallel: true,
          budgetMs:            true,
          budgetUsd:           true,
          rationale:           true,
          routedAt:            true,
        },
      }) ?? [],
      (prisma as any).routingPlanLog?.count?.({ where }) ?? 0,
    ]);

    // Mode distribution for this time window
    const modeBreakdown = await (prisma as any).routingPlanLog?.groupBy?.({
      by:      ['mode'],
      where:   { orgId, routedAt: { gte: from, lte: to } },
      _count:  { mode: true },
      orderBy: { _count: { mode: 'desc' } },
    }).catch(() => []) ?? [];

    return NextResponse.json({
      section:       'routing-plans',
      orgId,
      plans,
      total,
      page,
      limit,
      modeBreakdown: (modeBreakdown as any[]).map((r: any) => ({ mode: r.mode, count: r._count?.mode ?? 0 })),
      timeRange:     { from: from.toISOString(), to: to.toISOString() },
    });
  }

  // ── registry ───────────────────────────────────────────────────────────────
  // Shows all registered engine contracts and their boot-time integrity records.
  // SUPER_ADMIN only — exposes full internal engine contract details.
  if (section === 'registry') {
    if (user.role !== 'SUPER_ADMIN') throw new ApiError(403, 'SUPER_ADMIN required for registry section');

    const registrations = await (prisma as any).engineRegistration?.findMany?.({
      orderBy: [{ name: 'asc' }, { registeredAt: 'desc' }],
      take:    200,
    }) ?? [];

    // Live registry state from in-process module (most current)
    const liveEngines = getAllEngines().map(e => ({
      name:             e.name,
      version:          e.version,
      executionStage:   e.executionStage,
      costClass:        e.costClass,
      alwaysRun:        e.alwaysRun,
      featureGated:     e.featureGated,
      featureFlagKey:   e.featureFlagKey ?? null,
      latencyTargetMs:  e.latencyTargetMs,
      fallbackStrategy: e.fallbackStrategy,
      parallelSafe:     e.parallelSafe,
      idempotent:       e.idempotent,
    }));

    return NextResponse.json({
      section:          'registry',
      locked:           isRegistryLocked(),
      validated:        isRegistryValidated(),
      liveEngineCount:  liveEngines.length,
      liveEngines,
      persistedRegistrations: registrations,
    });
  }

  // ── worker-health ─────────────────────────────────────────────────────────
  // Real-time worker health snapshots from WorkerHealthSnapshot table.
  // SUPER_ADMIN only.
  if (section === 'worker-health') {
    if (user.role !== 'SUPER_ADMIN') throw new ApiError(403, 'SUPER_ADMIN required for worker-health section');

    const workers = await (prisma as any).workerHealthSnapshot?.findMany?.({
      orderBy: { lastHeartbeatAt: 'desc' },
      take:    50,
    }) ?? [];

    // Flag workers that haven't sent a heartbeat in > 2 minutes
    const staleThresholdMs = 120_000;
    const now = Date.now();
    const annotated = (workers as any[]).map((w: any) => ({
      workerId:           w.workerId,
      queueName:          w.queueName,
      status:             w.status,
      activeJobs:         w.activeJobs,
      completedLast5Min:  w.completedLast5Min,
      failedLast5Min:     w.failedLast5Min,
      avgJobDurationMs:   w.avgJobDurationMs,
      lastHeartbeatAt:    w.lastHeartbeatAt,
      isStale:            now - new Date(w.lastHeartbeatAt).getTime() > staleThresholdMs,
      staleFor:           Math.round((now - new Date(w.lastHeartbeatAt).getTime()) / 1000),
    }));

    return NextResponse.json({
      section:      'worker-health',
      workerCount:  annotated.length,
      unhealthy:    annotated.filter((w: any) => w.status === 'unhealthy' || w.isStale).length,
      workers:      annotated,
      timestamp:    new Date().toISOString(),
    });
  }

  // ── job-diagnostics ───────────────────────────────────────────────────────
  // Full crash-safety diagnostics for a single job: FSM state, checkpoint,
  // credit status, stuck detection, retry eligibility.
  if (section === 'job-diagnostics') {
    const jobId = url.searchParams.get('jobId');
    if (!jobId)  throw new ApiError(400, 'jobId is required for job-diagnostics section');
    if (!orgId)  throw new ApiError(400, 'orgId is required for job-diagnostics section');

    const crashSafety = createCrashSafetyService({ prisma, logger: console as any });
    const diagnostics = await crashSafety.getDiagnostics(jobId);

    if (!diagnostics) throw new ApiError(404, 'Job not found or no diagnostics available');
    if (diagnostics.orgId !== orgId) throw new ApiError(403, 'Job does not belong to the specified org');

    // Also fetch the routing plan for this job
    const routingPlan = await (prisma as any).routingPlanLog?.findFirst?.({
      where:   { jobId, orgId },
      orderBy: { routedAt: 'desc' },
      select:  { mode: true, enabledEngines: true, disabledEngines: true, budgetMs: true, rationale: true, routedAt: true },
    }).catch(() => null);

    return NextResponse.json({
      section:     'job-diagnostics',
      jobId,
      orgId,
      diagnostics,
      routingPlan: routingPlan ?? null,
    });
  }

  // ── dead-letter ───────────────────────────────────────────────────────────
  // Persistent dead-letter records from DeadLetterJob table.
  // More durable than BullMQ's ephemeral DLQ — survives Redis restarts.
  if (section === 'dead-letter') {
    const page         = parsePage(url.searchParams.get('page'));
    const limit        = parseLimit(url.searchParams.get('limit'), 50, 200);
    const errorCode    = url.searchParams.get('errorCode')   ?? undefined;
    const failureClass = url.searchParams.get('failureClass') ?? undefined;

    const where: Record<string, unknown> = {
      deadLetteredAt: { gte: from, lte: to },
    };
    if (orgId)        where.orgId        = orgId;
    if (errorCode)    where.errorCode    = errorCode;
    if (failureClass) where.failureClass = failureClass;

    const [jobs, total] = await Promise.all([
      (prisma as any).deadLetterJob?.findMany?.({
        where,
        orderBy: { deadLetteredAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        select: {
          id:             true,
          jobId:          true,
          orgId:          true,
          userId:         true,
          jobType:        true,
          errorCode:      true,
          errorMessage:   true,
          failureClass:   true,
          attemptCount:   true,
          creditCost:     true,
          creditRefunded: true,
          replayedAt:     true,
          replayedBy:     true,
          deadLetteredAt: true,
        },
      }) ?? [],
      (prisma as any).deadLetterJob?.count?.({ where }) ?? 0,
    ]);

    // Error code breakdown for this window
    const codeBreakdown = await (prisma as any).deadLetterJob?.groupBy?.({
      by:      ['errorCode'],
      where:   { ...(orgId ? { orgId } : {}), deadLetteredAt: { gte: from, lte: to } },
      _count:  { errorCode: true },
      orderBy: { _count: { errorCode: 'desc' } },
      take:    10,
    }).catch(() => []) ?? [];

    return NextResponse.json({
      section:       'dead-letter',
      jobs,
      total,
      page,
      limit,
      codeBreakdown: (codeBreakdown as any[]).map((r: any) => ({ errorCode: r.errorCode, count: r._count?.errorCode ?? 0 })),
      timeRange:     { from: from.toISOString(), to: to.toISOString() },
    });
  }

  // ── memory-audit ──────────────────────────────────────────────────────────
  // Shows write audit trail for the unified memory layer — who wrote to which
  // domain, when, and with what permission level.
  if (section === 'memory-audit') {
    if (!orgId) throw new ApiError(400, 'orgId is required for memory-audit section');

    const domain = url.searchParams.get('domain') ?? undefined;
    const page   = parsePage(url.searchParams.get('page'));
    const limit  = parseLimit(url.searchParams.get('limit'), 100, 500);

    const where: Record<string, unknown> = {
      orgId,
      writtenAt: { gte: from, lte: to },
    };
    if (domain) where.domain = domain;

    const [logs, total] = await Promise.all([
      (prisma as any).memorySignalLog?.findMany?.({
        where,
        orderBy: { writtenAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }) ?? [],
      (prisma as any).memorySignalLog?.count?.({ where }) ?? 0,
    ]);

    // Domain breakdown
    const domainBreakdown = await (prisma as any).memorySignalLog?.groupBy?.({
      by:      ['domain'],
      where:   { orgId, writtenAt: { gte: from, lte: to } },
      _count:  { domain: true },
      _sum:    { recordCount: true },
      orderBy: { _count: { domain: 'desc' } },
    }).catch(() => []) ?? [];

    return NextResponse.json({
      section:         'memory-audit',
      orgId,
      logs,
      total,
      page,
      limit,
      domainBreakdown: (domainBreakdown as any[]).map((r: any) => ({
        domain:      r.domain,
        writeCount:  r._count?.domain   ?? 0,
        recordCount: r._sum?.recordCount ?? 0,
      })),
      timeRange: { from: from.toISOString(), to: to.toISOString() },
    });
  }

  // ── asset-lineage ─────────────────────────────────────────────────────────
  // Shows explicit graph edges for a specific asset from AssetRelationship table.
  if (section === 'asset-lineage') {
    const assetId = url.searchParams.get('assetId');
    if (!assetId) throw new ApiError(400, 'assetId is required for asset-lineage section');
    if (!orgId)   throw new ApiError(400, 'orgId is required for asset-lineage section');

    const lineage = await getAssetLineage(assetId, orgId, { prisma });

    if (!lineage) throw new ApiError(404, 'Asset not found or does not belong to specified org');

    return NextResponse.json({
      section: 'asset-lineage',
      assetId,
      orgId,
      lineage,
    });
  }

  throw new ApiError(
    400,
    `Unknown section: "${section}". Valid values: summary, pipeline-scores, ab-results, brand-learning, stage-traces, job-metadata, recent-failures, feedback-events, routing-plans, registry, worker-health, job-diagnostics, dead-letter, memory-audit, asset-lineage`
  );
});

// ── PATCH /api/admin/ai-pipeline — manage org Brand Learning toggle ────────────
// Only SUPER_ADMIN can toggle this flag.
export const PATCH = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  if (user.role !== 'SUPER_ADMIN') {
    throw new ApiError(403, 'Super admin access required to modify AI pipeline settings');
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { orgId, action } = body;

  if (!orgId || typeof orgId !== 'string') throw new ApiError(400, 'orgId is required');
  if (!action || typeof action !== 'string') throw new ApiError(400, 'action is required');

  const org = await prisma.org.findUnique({ where: { id: orgId } });
  if (!org) throw new ApiError(404, 'Organization not found');

  // ── Brand Learning toggle ─────────────────────────────────────────────────
  if (action === 'enable-brand-learning' || action === 'disable-brand-learning') {
    const enabled = action === 'enable-brand-learning';
    const updated = await prisma.org.update({
      where: { id: orgId },
      data:  { brandLearningEnabled: enabled } as any,
      select: { id: true, name: true, brandLearningEnabled: true },
    });

    return NextResponse.json({
      ok:     true,
      orgId,
      action,
      result: updated,
      note:   enabled
        ? 'Brand Learning enabled. Signals are passive and strictly scoped to this org.'
        : 'Brand Learning disabled. No new signals will be collected or applied.',
    });
  }

  throw new ApiError(400, `Unknown action: "${action}". Valid: enable-brand-learning, disable-brand-learning`);
});
