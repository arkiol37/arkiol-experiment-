// src/app/api/assets/quality/route.ts
// GET /api/assets/quality — Quality Score Dashboard
// ─────────────────────────────────────────────────────────────────────────────
//
// Returns structured quality metrics for one or more assets, suitable for
// rendering a "Quality: 94/100" badge and a detailed breakdown panel.
//
// Query params:
//   ?assetIds=id1,id2,id3   — up to 50 asset IDs (comma-separated)
//   ?jobId=xxx              — all assets produced by a specific job
//   ?campaignId=xxx         — all assets in a campaign (max 50 returned)
//
// Response per asset:
//   {
//     assetId, name, format,
//     scores: {
//       overall:           0-100 (rounded from 0–1 float × 100)
//       brandAlignment:    0-100
//       hierarchy:         0-100
//       densityFit:        0-100
//       contrastCompliance:0-100
//       violationPenalty:  0-100
//     },
//     badge:               "A+" | "A" | "B" | "C" | "D"   (letter grade)
//     hierarchyValid:      boolean
//     violationCount:      number
//     violations:          string[]
//     layoutFamily:        string | null
//     brandScore:          number (raw 0-100)
//     createdAt:           string
//   }
//
// Aggregate (when multiple assets):
//   {
//     avgOverall, topScore, bottomScore, passRate (% with overall >= 70)
//   }
//
// Quality data is stored in asset.metadata.overallQuality and related fields
// by the generation worker. Assets with no metadata return estimated scores
// from brandScore + hierarchyValid.

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse }         from "next/server";
import { prisma }                            from "../../../../lib/prisma";
import { getRequestUser }                    from "../../../../lib/auth";
import { withErrorHandling }                 from "../../../../lib/error-handling";
import { ApiError }                          from "../../../../lib/types";
import { dbUnavailable } from "../../../../lib/error-handling";

// ── Letter grade ────────────────────────────────────────────────────────────

function letterGrade(score: number): "A+" | "A" | "B" | "C" | "D" {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

// ── Extract quality fields from asset.metadata ────────────────────────────────
// metadata is a JSON column set by the generation worker via orchestrated.benchmark

interface QualityMetadata {
  overallQuality?:    number;  // 0–1 float
  brandScore?:        number;  // 0–100 (legacy field in metadata)
  hierarchyValid?:    boolean;
  violations?:        string[];
  violationCount?:    number;
  brandAlignment?:    number;
  hierarchyIntegrity?: number;
  densityFit?:        number;
  contrastCompliance?: number;
  violationPenalty?:  number;
}

function extractQuality(asset: {
  brandScore:     number;
  hierarchyValid: boolean;
  metadata:       unknown;
}): {
  overall:            number;
  brandAlignment:     number;
  hierarchy:          number;
  densityFit:         number;
  contrastCompliance: number;
  violationPenalty:   number;
  violations:         string[];
  violationCount:     number;
} {
  const meta = (asset.metadata as QualityMetadata) ?? {};

  // Prefer structured benchmark data if available
  const overall = meta.overallQuality != null
    ? Math.round(meta.overallQuality * 100)
    : Math.round(
        // Estimate from available fields when benchmark not present
        (asset.brandScore * 0.35) +
        (asset.hierarchyValid ? 100 : 40) * 0.25 +
        75 * 0.20 +   // density — assume average
        80 * 0.20     // contrast — assume average
      );

  return {
    overall:            Math.min(100, Math.max(0, overall)),
    brandAlignment:     meta.brandAlignment     != null ? Math.round(meta.brandAlignment * 100)     : Math.round(asset.brandScore),
    hierarchy:          meta.hierarchyIntegrity != null ? Math.round(meta.hierarchyIntegrity * 100)  : (asset.hierarchyValid ? 95 : 35),
    densityFit:         meta.densityFit         != null ? Math.round(meta.densityFit * 100)         : 75,
    contrastCompliance: meta.contrastCompliance  != null ? Math.round(meta.contrastCompliance * 100) : 80,
    violationPenalty:   meta.violationPenalty    != null ? Math.round(meta.violationPenalty * 100)   : (asset.hierarchyValid ? 95 : 50),
    violations:         meta.violations ?? [],
    violationCount:     meta.violationCount ?? meta.violations?.length ?? 0,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user   = await getRequestUser(req);
  const url    = new URL(req.url);

  // ── Resolve which assets to score ─────────────────────────────────────────
  let assetIds: string[] = [];

  const assetIdsParam = url.searchParams.get("assetIds");
  const jobId         = url.searchParams.get("jobId");
  const campaignId    = url.searchParams.get("campaignId");

  if (assetIdsParam) {
    assetIds = assetIdsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 50);
  } else if (jobId) {
    const job = await prisma.job.findFirst({
      where:  { id: jobId, userId: user.id },
      select: { result: true },
    });
    if (!job) throw new ApiError(404, "Job not found");
    const r = job.result as Record<string, unknown> | null;
    assetIds = (r?.assetIds as string[] | null) ?? [];
  } else if (campaignId) {
    const campaignAssets = await prisma.asset.findMany({
      where:   { campaignId, userId: user.id },
      select:  { id: true },
      orderBy: { createdAt: "desc" },
      take:    50,
    });
    assetIds = campaignAssets.map((a: { id: string }) => a.id);
  } else {
    throw new ApiError(400, "Provide one of: assetIds (comma-separated), jobId, or campaignId");
  }

  if (assetIds.length === 0) {
    return NextResponse.json({ assets: [], aggregate: null });
  }

  // ── Load assets ────────────────────────────────────────────────────────────
  const assets = await prisma.asset.findMany({
    where: {
      id:     { in: assetIds },
      userId: user.id,     // ownership check
    },
    select: {
      id:             true,
      name:           true,
      format:         true,
      category:       true,
      brandScore:     true,
      hierarchyValid: true,
      metadata:       true,
      layoutFamily:   true,
      createdAt:      true,
    },
  });

  if (assets.length === 0) {
    throw new ApiError(404, "No accessible assets found for the given IDs");
  }

  // ── Build per-asset quality records ───────────────────────────────────────
  const assetQuality = assets.map(asset => {
    const q = extractQuality({
      brandScore:     asset.brandScore,
      hierarchyValid: asset.hierarchyValid,
      metadata:       asset.metadata,
    });
    const meta = (asset.metadata as QualityMetadata) ?? {};
    return {
      assetId:      asset.id,
      name:         asset.name,
      format:       asset.format,
      category:     asset.category,
      layoutFamily: asset.layoutFamily ?? null,
      scores: {
        overall:            q.overall,
        brandAlignment:     q.brandAlignment,
        hierarchy:          q.hierarchy,
        densityFit:         q.densityFit,
        contrastCompliance: q.contrastCompliance,
        violationPenalty:   q.violationPenalty,
      },
      badge:         letterGrade(q.overall),
      hierarchyValid: asset.hierarchyValid,
      violationCount: q.violationCount,
      violations:    q.violations.slice(0, 20),  // cap to 20 for the response
      brandScore:    Math.round(asset.brandScore),
      // metadata source indicator for clients
      dataSource:    meta.overallQuality != null ? "benchmark" : "estimated",
      createdAt:     asset.createdAt.toISOString(),
    };
  });

  // ── Aggregate stats ────────────────────────────────────────────────────────
  const scores      = assetQuality.map(a => a.scores.overall);
  const total       = scores.length;
  const avgOverall  = total > 0 ? Math.round(scores.reduce((s, x) => s + x, 0) / total) : 0;
  const topScore    = total > 0 ? Math.max(...scores) : 0;
  const bottomScore = total > 0 ? Math.min(...scores) : 0;
  const passCount   = scores.filter(s => s >= 70).length;
  const passRate    = total > 0 ? Math.round((passCount / total) * 100) : 0;

  const gradeDistribution = { "A+": 0, A: 0, B: 0, C: 0, D: 0 };
  for (const a of assetQuality) {
    gradeDistribution[a.badge]++;
  }

  const aggregate = {
    totalAssets:       total,
    avgOverall,
    topScore,
    bottomScore,
    passRate,             // % with overall >= 70
    gradeDistribution,
    avgBrandAlignment:    Math.round(assetQuality.reduce((s, a) => s + a.scores.brandAlignment,     0) / total),
    avgHierarchy:         Math.round(assetQuality.reduce((s, a) => s + a.scores.hierarchy,          0) / total),
    avgDensityFit:        Math.round(assetQuality.reduce((s, a) => s + a.scores.densityFit,         0) / total),
    avgContrastCompliance:Math.round(assetQuality.reduce((s, a) => s + a.scores.contrastCompliance, 0) / total),
    totalViolations:      assetQuality.reduce((s, a) => s + a.violationCount, 0),
    hierarchyPassRate:    Math.round((assetQuality.filter(a => a.hierarchyValid).length / total) * 100),
  };

  return NextResponse.json({ assets: assetQuality, aggregate });
});
