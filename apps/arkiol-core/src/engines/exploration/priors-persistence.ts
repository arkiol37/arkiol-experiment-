// src/engines/exploration/priors-persistence.ts
// Exploration Priors Persistence Bridge
// ─────────────────────────────────────────────────────────────────────────────
//
// Provides DB-backed persistence for ExplorationPriors and NoveltyArchive.
// Called by the feedback API route and the explore route to load/save priors.
//
// Execution contract:
//   ✓ All functions are async-safe — never throw, return defaults on failure
//   ✓ Priors upsert is idempotent — same data produces same DB state
//   ✓ Novelty archive is capped per org/format to prevent unbounded growth
//   ✓ All DB operations use try/catch — failures degrade gracefully

import { createHash } from "crypto";
import { buildDefaultPriors, migratePriors } from "./learning-memory";
import type { ExplorationPriors, FeatureVector } from "./types";

const MAX_NOVELTY_ARCHIVE_PER_FORMAT = 500;

function priorsId(orgId: string, brandId?: string): string {
  return createHash("sha256").update(`priors:${orgId}:${brandId ?? ""}`).digest("hex").slice(0, 24);
}

/**
 * Loads priors from DB, falling back to defaults if not found or on error.
 * Caller must pass a prisma-compatible client.
 */
export async function loadPriors(
  db: any,
  orgId: string,
  brandId?: string
): Promise<ExplorationPriors> {
  try {
    const id  = priorsId(orgId, brandId);
    const row = await db.explorationPriors?.findUnique?.({ where: { id } });
    return row ? migratePriors(row, orgId, brandId) : buildDefaultPriors(orgId, brandId);
  } catch {
    return buildDefaultPriors(orgId, brandId);
  }
}

/**
 * Saves priors to DB. Idempotent — upserts by (orgId, brandId) key.
 */
export async function savePriors(
  db: any,
  priors: ExplorationPriors
): Promise<void> {
  try {
    const id = priorsId(priors.orgId, priors.brandId);
    const data = {
      orgId:                     priors.orgId,
      brandId:                   priors.brandId,
      layoutFamilyWeights:       priors.layoutFamilyWeights       as any,
      archetypeWeights:          priors.archetypeWeights          as any,
      presetWeights:             priors.presetWeights             as any,
      hookStrategyWeights:       priors.hookStrategyWeights       as any,
      compositionPatternWeights: priors.compositionPatternWeights as any,
      densityProfileWeights:     priors.densityProfileWeights     as any,
      explorationTemperature:    priors.explorationTemperature,
      totalSignals:              priors.totalSignals,
      schemaVersion:             priors.schemaVersion,
      updatedAt:                 new Date(),
    };
    await db.explorationPriors?.upsert?.({
      where:  { id },
      create: { id, ...data },
      update: data,
    });
  } catch {
    // Best-effort; do not propagate
  }
}

/**
 * Loads the novelty archive for a given org+format.
 * Returns an empty array on failure.
 */
export async function loadNoveltyArchive(
  db: any,
  orgId: string,
  format: string
): Promise<FeatureVector[]> {
  try {
    const rows = await db.noveltyArchiveEntry?.findMany?.({
      where:   { orgId, format },
      orderBy: { createdAt: "desc" },
      take:    MAX_NOVELTY_ARCHIVE_PER_FORMAT,
      select:  { featureVector: true },
    }) ?? [];
    return rows.map((r: any) => r.featureVector as FeatureVector).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Appends new feature vectors to the novelty archive.
 * Automatically prunes old entries if over the cap.
 */
export async function appendNoveltyArchive(
  db: any,
  orgId: string,
  format: string,
  newVectors: FeatureVector[],
  candidateIds: string[]
): Promise<void> {
  if (newVectors.length === 0) return;
  try {
    const entries = newVectors.map((fv, i) => ({
      id:            createHash("sha256").update(`novelty:${orgId}:${format}:${candidateIds[i] ?? i}:${Date.now()}`).digest("hex").slice(0, 24),
      orgId,
      format,
      featureVector: fv as any,
      candidateId:   candidateIds[i] ?? String(i),
    }));

    await db.noveltyArchiveEntry?.createMany?.({ data: entries, skipDuplicates: true });

    // Prune oldest if over cap
    const count = await db.noveltyArchiveEntry?.count?.({ where: { orgId, format } }) ?? 0;
    if (count > MAX_NOVELTY_ARCHIVE_PER_FORMAT) {
      const excess = count - MAX_NOVELTY_ARCHIVE_PER_FORMAT;
      const oldest = await db.noveltyArchiveEntry?.findMany?.({
        where:   { orgId, format },
        orderBy: { createdAt: "asc" },
        take:    excess,
        select:  { id: true },
      }) ?? [];
      if (oldest.length > 0) {
        await db.noveltyArchiveEntry?.deleteMany?.({
          where: { id: { in: oldest.map((o: any) => o.id) } },
        });
      }
    }
  } catch {
    // Best-effort
  }
}
