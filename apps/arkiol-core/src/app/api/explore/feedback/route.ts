// src/app/api/explore/feedback/route.ts
// Creative Exploration AI Engine — Feedback Signal API Route
// ─────────────────────────────────────────────────────────────────────────────
//
// POST /api/explore/feedback
//
// Records user interaction signals and returns updated ExplorationPriors.
// The caller is responsible for persisting the returned priors (localStorage,
// DB, or any external store) — this route is stateless.
//
// Request body:
//   {
//     signals: FeedbackSignal[]  — 1–20 signals per batch
//     currentPriors?: ExplorationPriors  — existing priors to update
//     orgId: string
//     brandId?: string
//   }
//
// Response:
//   {
//     updatedPriors: ExplorationPriors
//     diagnostic: PriorsDiagnostic
//     signalsProcessed: number
//   }

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse }     from "next/server";
import { getServerSession }              from "next-auth";
import { authOptions }                   from "../../../../lib/auth";
import {
  buildDefaultPriors,
  migratePriors,
  applyFeedbackBatch,
  buildPriorsDiagnostic,
  buildFeedbackSignal,
} from "../../../../engines/exploration/learning-memory";
import { logger } from "../../../../lib/logger";
import type { FeedbackSignalType, DesignGenome, EvaluationScores } from "../../../../engines/exploration/types";
import { dbUnavailable } from "../../../../lib/error-handling";

interface FeedbackRequestItem {
  candidateId: string;
  genome: DesignGenome;
  scores: EvaluationScores;
  signalType: FeedbackSignalType;
  format: string;
  campaignId?: string;
  brandId?: string;
}

interface FeedbackRequestBody {
  signals: FeedbackRequestItem[];
  currentPriors?: unknown;
  orgId?: string;
  brandId?: string;
}

export async function POST(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  const _ru = await getRequestUser(req).catch(() => null);
  const session = _ru ? { user: { id: _ru.id, email: _ru.email, orgId: _ru.orgId, role: _ru.role } } : null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = rawBody as FeedbackRequestBody;

  if (!Array.isArray(body.signals) || body.signals.length === 0) {
    return NextResponse.json({ error: "signals must be a non-empty array" }, { status: 400 });
  }

  if (body.signals.length > 20) {
    return NextResponse.json({ error: "Maximum 20 signals per batch" }, { status: 400 });
  }

  const userId = session.user.id;
  const orgId  = body.orgId ?? (session.user as any).orgId ?? userId;
  const brandId = body.brandId;

  // Migrate or initialise priors
  const priors = body.currentPriors
    ? migratePriors(body.currentPriors, orgId, brandId)
    : buildDefaultPriors(orgId, brandId);

  // Build typed feedback signals
  const feedbackSignals = body.signals.map(item =>
    buildFeedbackSignal({
      userId,
      orgId,
      brandId:     item.brandId ?? brandId,
      campaignId:  item.campaignId,
      candidateId: item.candidateId,
      genome:      item.genome,
      scores:      item.scores,
      signalType:  item.signalType,
      format:      item.format,
    })
  );

  // Apply feedback batch
  const updatedPriors = applyFeedbackBatch(priors, feedbackSignals);
  const diagnostic    = buildPriorsDiagnostic(updatedPriors);

  logger.info(
    {
      userId,
      orgId,
      signalCount:     feedbackSignals.length,
      totalSignals:    updatedPriors.totalSignals,
      temperature:     updatedPriors.explorationTemperature,
    },
    "[explore:feedback] Priors updated"
  );

  return NextResponse.json({
    updatedPriors,
    diagnostic,
    signalsProcessed: feedbackSignals.length,
  });
}
