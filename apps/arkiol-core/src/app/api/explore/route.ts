// src/app/api/explore/route.ts
// Creative Exploration AI Engine — HTTP API Route
// ─────────────────────────────────────────────────────────────────────────────
//
// POST /api/explore
//
// Accepts an exploration request and returns a curated set of CandidateDesignPlans.
// Integrates with the existing auth, rate-limiting, and plan-gating middleware.
//
// Request body (ExploreRequestBody):
//   {
//     jobId:                string  — reference job (from /api/generate)
//     format:               string  — target format
//     poolSize?:            number  — candidate pool size (default: 48, max: 120)
//     targetResultCount?:   number  — final curated results (default: 12, max: 24)
//     highConfidenceRatio?: number  — 0–1 split (default: 0.6)
//     pipelineContext:      ExplorePipelineContext
//     priors?:              ExplorationPriors     — from client persistence
//     noveltyArchive?:      FeatureVector[]        — from client persistence
//     seed?:                string                 — override seed (for replay)
//   }
//
// Response (ExploreResponseBody):
//   {
//     runId:              string
//     seed:               string
//     highConfidence:     RankedCandidate[]
//     experimental:       RankedCandidate[]
//     clusters:           DiversityCluster[]
//     stats:              ExploreStats
//     noveltyArchiveDelta:FeatureVector[]
//   }

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from "next/server";
import { getRequestUser }             from "../../../lib/auth";
import { runExploration, deriveExploreSeed } from "../../../engines/exploration/engine";
import { buildDefaultPriors, migratePriors } from "../../../engines/exploration/learning-memory";
import { logger } from "../../../lib/logger";
import { rateLimit, rateLimitHeaders } from "../../../lib/rate-limit";
import { dbUnavailable } from "../../../lib/error-handling";
import type {
  ExplorePipelineContext,
  ExplorationPriors,
  FeatureVector,
  ExploreInput,
} from "../../../engines/exploration/types";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  REQUEST SCHEMA VALIDATION (lightweight — no Zod to keep bundle small)
// ─────────────────────────────────────────────────────────────────────────────

interface ExploreRequestBody {
  jobId:                string;
  format:               string;
  pipelineContext:      ExplorePipelineContext;
  poolSize?:            number;
  targetResultCount?:   number;
  highConfidenceRatio?: number;
  priors?:              unknown;
  noveltyArchive?:      unknown[];
  seed?:                string;
}

function validateRequest(body: unknown): { valid: true; data: ExploreRequestBody } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (!b.jobId || typeof b.jobId !== "string") {
    return { valid: false, error: "jobId is required and must be a string" };
  }
  if (!b.format || typeof b.format !== "string") {
    return { valid: false, error: "format is required and must be a string" };
  }
  if (!b.pipelineContext || typeof b.pipelineContext !== "object") {
    return { valid: false, error: "pipelineContext is required and must be an object" };
  }

  const poolSize = b.poolSize;
  if (poolSize !== undefined && (typeof poolSize !== "number" || poolSize < 8 || poolSize > 120)) {
    return { valid: false, error: "poolSize must be between 8 and 120" };
  }

  const targetCount = b.targetResultCount;
  if (targetCount !== undefined && (typeof targetCount !== "number" || targetCount < 4 || targetCount > 24)) {
    return { valid: false, error: "targetResultCount must be between 4 and 24" };
  }

  const hcRatio = b.highConfidenceRatio;
  if (hcRatio !== undefined && (typeof hcRatio !== "number" || hcRatio < 0 || hcRatio > 1)) {
    return { valid: false, error: "highConfidenceRatio must be between 0 and 1" };
  }

  return { valid: true, data: b as ExploreRequestBody };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2  ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  const requestStart = Date.now();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const _user = await getRequestUser(req).catch(() => null);
  const session = _user ? { user: { id: _user.id, email: _user.email, orgId: _user.orgId } } : null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Rate limiting ────────────────────────────────────────────────────────
  const rl = await rateLimit(session.user.id, "generate");
  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Too many exploration requests." },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Validate ──────────────────────────────────────────────────────────────
  const validation = validateRequest(rawBody);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const body = validation.data;
  const orgId = (session.user as any).orgId ?? session.user.id;

  // ── Migrate priors ────────────────────────────────────────────────────────
  const priors: ExplorationPriors = body.priors
    ? migratePriors(body.priors, orgId)
    : buildDefaultPriors(orgId);

  // ── Parse novelty archive (validate array of arrays) ─────────────────────
  const noveltyArchive: FeatureVector[] = Array.isArray(body.noveltyArchive)
    ? (body.noveltyArchive.filter(v => Array.isArray(v) && v.length === 12) as FeatureVector[])
    : [];

  // ── Build explore seed ────────────────────────────────────────────────────
  const seed = body.seed
    ?? deriveExploreSeed(body.jobId, body.format, body.pipelineContext.intent ?? "");

  // ── Build ExploreInput ────────────────────────────────────────────────────
  const exploreInput: ExploreInput = {
    runId:               `explore:${body.jobId}`,
    seed,
    format:              body.format,
    poolSize:            body.poolSize             ?? 48,
    targetResultCount:   body.targetResultCount    ?? 12,
    highConfidenceRatio: body.highConfidenceRatio  ?? 0.60,
    pipelineContext:     body.pipelineContext,
    priors,
    noveltyArchive,
    onEvent: (event) => {
      logger.info(
        { explore: event, userId: session.user.id, orgId, jobId: body.jobId },
        `[explore:obs] ${event.eventType}`
      );
    },
  };

  // ── Run exploration ───────────────────────────────────────────────────────
  let result;
  try {
    result = await runExploration(exploreInput);
  } catch (err: any) {
    logger.error(
      { err: err.message, jobId: body.jobId, userId: session.user.id },
      "[explore] Engine failed"
    );
    return NextResponse.json(
      { error: "Exploration engine failed. Please try again." },
      { status: 500 }
    );
  }

  const responseMs = Date.now() - requestStart;

  logger.info(
    {
      runId:            result.runId,
      userId:           session.user.id,
      orgId,
      format:           body.format,
      finalCurated:     result.stats.finalCurated,
      highConfidence:   result.highConfidence.length,
      experimental:     result.experimental.length,
      totalExploreMs:   result.stats.totalExploreMs,
      responseMs,
    },
    "[explore] Request complete"
  );

  // ── Response ──────────────────────────────────────────────────────────────
  return NextResponse.json({
    runId:               result.runId,
    seed:                result.seed,
    highConfidence:      result.highConfidence,
    experimental:        result.experimental,
    clusters:            result.clusters,
    stats:               result.stats,
    noveltyArchiveDelta: result.noveltyArchiveDelta,
  });
}
