// packages/shared/src/brandLearning.ts
// V17: Brand Learning — org-scoped, passive, feature-flag gated.
//
// Design guarantees:
//   1. Feature flag enforced at every entry point — no flag = no signals.
//   2. All reads and writes are strictly orgId-scoped via WHERE clauses.
//   3. Passive only — never mutates plan, credit, or billing state.
//   4. No cross-tenant data usage — each org's signals are isolated.
//   5. Fire-and-forget writes — never delay or throw to the caller.
//   6. Deterministic fallbacks for every failure path.

import { z } from 'zod';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrandLearningDeps {
  prisma?: any;
  logger?: {
    warn(obj: unknown, msg: string): void;
    error(obj: unknown, msg: string): void;
  };
}

export const BrandLearningContextSchema = z.object({
  orgId:          z.string(),
  brandId:        z.string().optional(),
  sessionId:      z.string(),
  jobId:          z.string().optional(),
  assetId:        z.string().optional(),
  format:         z.string().optional(),
  stylePreset:    z.string().optional(),
  qualityScore:   z.number().min(0).max(1).optional(),
  accepted:       z.boolean().optional(),
  durationMs:     z.number().nonnegative().optional(),
});

export type BrandLearningContext = z.infer<typeof BrandLearningContextSchema>;

// ── Feature flag enforcement ──────────────────────────────────────────────────

/**
 * Check if Brand Learning is enabled for an org.
 * Returns false on any error — safe default.
 */
export async function isBrandLearningEnabled(
  orgId: string,
  deps: BrandLearningDeps
): Promise<boolean> {
  if (!deps.prisma) return false;
  try {
    const org = await deps.prisma.org?.findUnique?.({
      where:  { id: orgId },
      select: { brandLearningEnabled: true },
    });
    return org?.brandLearningEnabled === true;
  } catch (e: any) {
    deps.logger?.warn({ err: e.message, orgId }, '[brand-learning] Flag check failed, defaulting to false');
    return false;
  }
}

// ── Log brand learning signal ─────────────────────────────────────────────────

/**
 * Record a brand learning feedback signal.
 * This is a fire-and-forget write — NEVER throws or delays the caller.
 *
 * The orgId on the context is used as the strict scope key:
 *   - Written to AIFeedbackEvent with orgId filter.
 *   - Never reads or writes data from other orgs.
 *
 * The feature flag is checked BEFORE writing — if disabled, the call is a no-op.
 */
export async function recordBrandSignal(
  ctx: BrandLearningContext,
  deps: BrandLearningDeps
): Promise<void> {
  if (!deps.prisma) return;

  try {
    // Validate input
    const parsed = BrandLearningContextSchema.safeParse(ctx);
    if (!parsed.success) {
      deps.logger?.warn({ issues: parsed.error.issues }, '[brand-learning] Invalid context, skipping write');
      return;
    }

    const d = parsed.data;

    // Enforce feature flag — no flag = silent no-op
    const enabled = await isBrandLearningEnabled(d.orgId, deps);
    if (!enabled) return;

    // Write feedback event — always scoped to the org
    const eventType = d.accepted === true  ? 'asset_accepted'  :
                      d.accepted === false ? 'asset_rejected'  :
                      'generation_completed';

    await deps.prisma.aIFeedbackEvent?.create?.({
      data: {
        id:           `bf_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        orgId:        d.orgId,              // strict org scope
        sessionId:    d.sessionId,
        jobId:        d.jobId    ?? null,
        assetId:      d.assetId  ?? null,
        eventType,
        format:       d.format      ?? null,
        planKey:      d.stylePreset ?? null,
        durationMs:   d.durationMs  ?? null,
        qualityScore: d.qualityScore ?? null,
        metadata:     { brandId: d.brandId ?? null },
        occurredAt:   new Date(),
      },
    });
  } catch (e: any) {
    // Fire-and-forget — swallow errors, never surface to caller
    deps.logger?.warn({ err: e.message }, '[brand-learning] Signal write failed (non-fatal)');
  }
}

// ── Load per-org brand learning context ───────────────────────────────────────

export interface BrandLearningSnapshot {
  enabled:        boolean;
  orgId:          string;
  styleScores:    Array<{ stylePreset: string; avgQualityScore: number; sampleCount: number; trend: string }>;
  formatScores:   Array<{ format: string; avgQualityScore: number; fallbackRate: number }>;
  recentSignals:  Array<{ eventType: string; qualityScore: number | null; occurredAt: Date }>;
  acceptRate:     number | null;
  avgQualScore:   number | null;
}

const EMPTY_SNAPSHOT = (orgId: string, enabled: boolean): BrandLearningSnapshot => ({
  enabled,
  orgId,
  styleScores:   [],
  formatScores:  [],
  recentSignals: [],
  acceptRate:    null,
  avgQualScore:  null,
});

/**
 * Load a read-only brand learning snapshot for an org.
 * Returns an empty snapshot if the feature is disabled or on any error.
 * All queries are strictly orgId-scoped.
 */
export async function loadBrandLearningSnapshot(
  orgId: string,
  deps:  BrandLearningDeps
): Promise<BrandLearningSnapshot> {
  if (!deps.prisma) return EMPTY_SNAPSHOT(orgId, false);

  try {
    const enabled = await isBrandLearningEnabled(orgId, deps);
    if (!enabled) return EMPTY_SNAPSHOT(orgId, false);

    const [styles, formats, recentEvents] = await Promise.all([
      deps.prisma.aIStylePerformance?.findMany?.({
        where:   { orgId },                 // strict org scope
        orderBy: { avgQualityScore: 'desc' },
        select:  { stylePreset: true, avgQualityScore: true, sampleCount: true, trend: true },
      }) ?? [],
      deps.prisma.aIFormatPerformance?.findMany?.({
        where:   { orgId },                 // strict org scope
        orderBy: { avgQualityScore: 'desc' },
        select:  { format: true, avgQualityScore: true, fallbackRate: true },
      }) ?? [],
      deps.prisma.aIFeedbackEvent?.findMany?.({
        where:   { orgId },                 // strict org scope
        orderBy: { occurredAt: 'desc' },
        take:    50,
        select:  { eventType: true, qualityScore: true, occurredAt: true },
      }) ?? [],
    ]);

    // Compute aggregate stats from recent signals
    const events = recentEvents as Array<{ eventType: string; qualityScore: number | null }>;
    const accepted = events.filter(e => e.eventType === 'asset_accepted').length;
    const rejected = events.filter(e => e.eventType === 'asset_rejected').length;
    const total    = accepted + rejected;
    const scores   = events.filter(e => e.qualityScore != null).map(e => e.qualityScore as number);

    return {
      enabled:       true,
      orgId,
      styleScores:   styles  as BrandLearningSnapshot['styleScores'],
      formatScores:  formats as BrandLearningSnapshot['formatScores'],
      recentSignals: recentEvents as BrandLearningSnapshot['recentSignals'],
      acceptRate:    total > 0 ? Math.round((accepted / total) * 1000) / 1000 : null,
      avgQualScore:  scores.length > 0
        ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length * 1000) / 1000
        : null,
    };
  } catch (e: any) {
    deps.logger?.warn({ err: e.message, orgId }, '[brand-learning] Snapshot load failed, returning empty');
    return EMPTY_SNAPSHOT(orgId, false);
  }
}

// ── Toggle helpers (for SUPER_ADMIN use via admin API) ────────────────────────

export async function enableBrandLearning(
  orgId: string,
  deps:  BrandLearningDeps
): Promise<void> {
  if (!deps.prisma) return;
  await deps.prisma.org?.update?.({
    where: { id: orgId },
    data:  { brandLearningEnabled: true },
  });
}

export async function disableBrandLearning(
  orgId: string,
  deps:  BrandLearningDeps
): Promise<void> {
  if (!deps.prisma) return;
  await deps.prisma.org?.update?.({
    where: { id: orgId },
    data:  { brandLearningEnabled: false },
  });
}
