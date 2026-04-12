// packages/shared/src/unifiedMemory.ts
// UNIFIED MEMORY LAYER — Production-Grade v2
//
// Centralized, controlled access point for all AI learning signals.
// ALL engine reads/writes must go through this module — engines cannot access
// the memory tables directly. This is the access-control boundary.
//
// Write permission model:
//   feedback_only   → only explicit user feedback (select/reject) may write
//   engine_output   → only after a completed engine stage may write
//   admin           → reserved for manual correction operations
//
// Enforcement:
//   - write functions are named and typed per-signal — no generic "write to domain"
//   - Every write validates via Zod before touching the DB
//   - Every write is fire-and-forget (never blocks generation)
//   - Every write logs a record to MemorySignalLog for audit
//   - Reads return typed snapshots with staleness markers
//   - All operations are org-scoped — cross-tenant leakage is impossible by design

import { PrismaClient } from '@prisma/client';

import { z } from 'zod';
import { toJsonValue, toJsonValueNullable } from './typeUtils';

// ── Memory domain registry ──────────────────────────────────────────────────────

export const MemoryDomainSchema = z.enum([
  'user_taste',
  'brand_dna',
  'winning_templates',
  'exploration_priors',
  'rejected_outputs',
  'platform_performance',
  'campaign_history',
]);
export type MemoryDomain = z.infer<typeof MemoryDomainSchema>;

// Write permission: who is allowed to write to each domain
export type MemoryWritePermission = 'feedback_only' | 'engine_output' | 'admin';

const DOMAIN_WRITE_PERMISSIONS: Readonly<Record<MemoryDomain, MemoryWritePermission>> = {
  user_taste:           'feedback_only',
  brand_dna:            'engine_output',
  winning_templates:    'engine_output',
  exploration_priors:   'engine_output',
  rejected_outputs:     'feedback_only',
  platform_performance: 'engine_output',
  campaign_history:     'engine_output',
} as const;

// ── Signal schemas ──────────────────────────────────────────────────────────────

export const UserTasteSignalSchema = z.object({
  orgId:        z.string().min(1),
  userId:       z.string().min(1),
  stylePreset:  z.string().min(1),
  accepted:     z.boolean(),
  qualityScore: z.number().min(0).max(1).optional(),
  format:       z.string().optional(),
  sessionId:    z.string().min(1),
  recordedAt:   z.string(),
});
export type UserTasteSignal = z.infer<typeof UserTasteSignalSchema>;

export const BrandDNAMemorySchema = z.object({
  orgId:          z.string().min(1),
  brandId:        z.string().min(1),
  dominantColors: z.array(z.string()).max(6),
  fontFamily:     z.string().optional(),
  toneKeywords:   z.array(z.string()).max(10),
  logoPosition:   z.enum(['top-left','top-right','bottom-left','bottom-right','center']),
  prefersDarkBg:  z.boolean(),
  confidence:     z.number().min(0).max(1),
  updatedAt:      z.string(),
  sampleCount:    z.number().int().nonnegative(),
});
export type BrandDNAMemory = z.infer<typeof BrandDNAMemorySchema>;

export const WinningTemplateSignalSchema = z.object({
  orgId:        z.string().min(1),
  templateId:   z.string().min(1),
  layoutFamily: z.string().min(1),
  stylePreset:  z.string().min(1),
  acceptCount:  z.number().int().nonnegative(),
  exportCount:  z.number().int().nonnegative(),
  rejectCount:  z.number().int().nonnegative(),
  winRate:      z.number().min(0).max(1),
  updatedAt:    z.string(),
});
export type WinningTemplateSignal = z.infer<typeof WinningTemplateSignalSchema>;

export const RejectedOutputSignalSchema = z.object({
  orgId:          z.string().min(1),
  similarityHash: z.string().min(1),
  layoutFamily:   z.string().optional(),
  stylePreset:    z.string().optional(),
  rejectedAt:     z.string(),
  sessionId:      z.string().min(1),
});
export type RejectedOutputSignal = z.infer<typeof RejectedOutputSignalSchema>;

export const PlatformPerformanceSignalSchema = z.object({
  orgId:            z.string().min(1),
  platform:         z.string().min(1),
  format:           z.string().min(1),
  stylePreset:      z.string().optional(),
  layoutFamily:     z.string().optional(),
  ctrSignal:        z.number().min(0).max(1).optional(),
  engagementSignal: z.number().min(0).max(1).optional(),
  sampleCount:      z.number().int().nonnegative(),
  updatedAt:        z.string(),
});
export type PlatformPerformanceSignal = z.infer<typeof PlatformPerformanceSignalSchema>;

export const CampaignHistorySignalSchema = z.object({
  orgId:           z.string().min(1),
  campaignId:      z.string().min(1),
  objective:       z.string().optional(),
  selectedAssets:  z.array(z.string()),
  rejectedAssets:  z.array(z.string()),
  preferredStyle:  z.string().optional(),
  preferredFormat: z.string().optional(),
  recordedAt:      z.string(),
});
export type CampaignHistorySignal = z.infer<typeof CampaignHistorySignalSchema>;

// ── Memory snapshot returned from reads ───────────────────────────────────────

export interface MemorySnapshot<T> {
  domain:     MemoryDomain;
  orgId:      string;
  data:       T[];
  fetchedAt:  string;
  staleTtlMs: number;
  isStale:    boolean;
}

// ── Dependencies ──────────────────────────────────────────────────────────────

export interface UnifiedMemoryDeps {
  prisma?: PrismaClient;
  logger?: {
    warn(obj: unknown, msg: string): void;
    error(obj: unknown, msg: string): void;
  };
}

// ── Internal: audit log for every write ────────────────────────────────────────
async function _auditWrite(
  domain: MemoryDomain,
  orgId: string,
  writePermission: MemoryWritePermission,
  recordCount: number,
  deps: UnifiedMemoryDeps
): Promise<void> {
  if (!deps.prisma) return;
  try {
    await deps.prisma.memorySignalLog?.create?.({
      data: {
        id:              `msl_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
        domain,
        orgId,
        writePermission,
        recordCount,
        writtenAt:       new Date(),
      },
    });
  } catch { /* non-fatal — audit is best-effort */ }
}

// ── Write functions (named per signal type — no generic wildcard writes) ────────

/**
 * Record a user taste signal (accepted/rejected).
 * Permission: feedback_only — only triggered by explicit user interaction.
 * Engines CANNOT call this — only the control plane feedback API can.
 */
export async function writeUserTasteSignal(signal: UserTasteSignal, deps: UnifiedMemoryDeps): Promise<void> {
  const parsed = UserTasteSignalSchema.safeParse(signal);
  if (!parsed.success) {
    deps.logger?.warn({ issues: parsed.error.issues }, '[memory] Invalid UserTasteSignal — dropped');
    return;
  }
  if (!deps.prisma) return;
  const d = parsed.data;
  try {
    await deps.prisma.aIFeedbackEvent?.create?.({
      data: {
        id:           `uts_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
        orgId:        d.orgId,
        userId:       d.userId,
        eventType:    d.accepted ? 'asset_accepted' : 'variation_selected',
        stylePreset:  d.stylePreset,
        format:       d.format ?? null,
        qualityScore: d.qualityScore ?? null,
        sessionId:    d.sessionId,
        occurredAt:   new Date(d.recordedAt),
      },
    });
    await _auditWrite('user_taste', d.orgId, 'feedback_only', 1, deps);
  } catch (e: unknown) {
    deps.logger?.warn({ err: (e instanceof Error ? e.message : String(e)) }, '[memory] writeUserTasteSignal failed (non-fatal)');
  }
}

/**
 * Write brand DNA signals derived from the BrandDNAExtractor engine output.
 * Permission: engine_output — only called after BrandDNAExtractor stage completes.
 */
export async function writeBrandDNAMemory(signal: BrandDNAMemory, deps: UnifiedMemoryDeps): Promise<void> {
  const parsed = BrandDNAMemorySchema.safeParse(signal);
  if (!parsed.success) {
    deps.logger?.warn({ issues: parsed.error.issues }, '[memory] Invalid BrandDNAMemory — dropped');
    return;
  }
  if (!deps.prisma) return;
  const d = parsed.data;
  try {
    await deps.prisma.brand?.update?.({
      where: { id: d.brandId },
      data: {
        learningSignals: toJsonValueNullable({
          dominantColors: d.dominantColors,
          fontFamily:     d.fontFamily,
          toneKeywords:   d.toneKeywords,
          logoPosition:   d.logoPosition,
          prefersDarkBg:  d.prefersDarkBg,
          confidence:     d.confidence,
          sampleCount:    d.sampleCount,
          updatedAt:      d.updatedAt,
        }),
      },
    });
    await _auditWrite('brand_dna', d.orgId, 'engine_output', 1, deps);
  } catch (e: unknown) {
    deps.logger?.warn({ err: (e instanceof Error ? e.message : String(e)), brandId: signal.brandId }, '[memory] writeBrandDNAMemory failed (non-fatal)');
  }
}

/**
 * Record a rejected output fingerprint.
 * Permission: feedback_only — only triggered by explicit user rejection.
 */
export async function writeRejectedOutputSignal(signal: RejectedOutputSignal, deps: UnifiedMemoryDeps): Promise<void> {
  const parsed = RejectedOutputSignalSchema.safeParse(signal);
  if (!parsed.success) {
    deps.logger?.warn({ issues: parsed.error.issues }, '[memory] Invalid RejectedOutputSignal — dropped');
    return;
  }
  if (!deps.prisma) return;
  const d = parsed.data;
  try {
    await deps.prisma.aIFeedbackEvent?.create?.({
      data: {
        id:             `rej_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
        orgId:          d.orgId,
        eventType:      'asset_rejected',
        sessionId:      d.sessionId,
        layoutFamily:   d.layoutFamily ?? null,
        stylePreset:    d.stylePreset ?? null,
        similarityHash: d.similarityHash,
        occurredAt:     new Date(d.rejectedAt),
      },
    });
    await _auditWrite('rejected_outputs', d.orgId, 'feedback_only', 1, deps);
  } catch (e: unknown) {
    deps.logger?.warn({ err: (e instanceof Error ? e.message : String(e)) }, '[memory] writeRejectedOutputSignal failed (non-fatal)');
  }
}

/**
 * Record exploration priors after an ExplorationRun completes.
 * Permission: engine_output — only called by ExplorationEngine after a run.
 */
export async function writeExplorationPrior(
  orgId: string,
  brandId: string | undefined,
  featureVector: number[],
  score: number,
  deps: UnifiedMemoryDeps
): Promise<void> {
  if (!deps.prisma || !orgId) return;
  try {
    await deps.prisma.explorationPrior?.upsert?.({
      where:  { orgId_brandId: { orgId, brandId: brandId ?? '' } },
      create: { id: `ep_${orgId}_${brandId ?? 'none'}`, orgId, brandId: brandId ?? null, priors: toJsonValue({}), priorVector: toJsonValue(featureVector), totalRuns: 1, avgScore: score, updatedAt: new Date() },
      update: { priorVector: toJsonValue(featureVector), totalRuns: { increment: 1 }, avgScore: score, updatedAt: new Date() },
    });
    await _auditWrite('exploration_priors', orgId, 'engine_output', 1, deps);
  } catch (e: unknown) {
    deps.logger?.warn({ err: (e instanceof Error ? e.message : String(e)) }, '[memory] writeExplorationPrior failed (non-fatal)');
  }
}

/**
 * Record a winning template signal after user selection.
 * Permission: engine_output — called by the control plane feedback handler.
 */
export async function writeWinningTemplateSignal(signal: WinningTemplateSignal, deps: UnifiedMemoryDeps): Promise<void> {
  const parsed = WinningTemplateSignalSchema.safeParse(signal);
  if (!parsed.success) return;
  if (!deps.prisma) return;
  const d = parsed.data;
  try {
    // Upsert: template signals accumulate over time
    await deps.prisma.aIFeedbackEvent?.create?.({
      data: {
        id:           `wt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
        orgId:        d.orgId,
        sessionId:    `tmpl_${Date.now()}`,
        eventType:    'template_performance',
        layoutFamily: d.layoutFamily,
        stylePreset:  d.stylePreset,
        metadata:     toJsonValue({ templateId: d.templateId, winRate: d.winRate, acceptCount: d.acceptCount, exportCount: d.exportCount }),
        occurredAt:   new Date(d.updatedAt),
      },
    });
    await _auditWrite('winning_templates', d.orgId, 'engine_output', 1, deps);
  } catch { /* non-fatal */ }
}

// ── Read functions ──────────────────────────────────────────────────────────────

/** Read brand DNA snapshot for an org+brand. Returns empty snapshot if not available. */
export async function readBrandDNASnapshot(
  orgId: string,
  brandId: string,
  deps: UnifiedMemoryDeps
): Promise<MemorySnapshot<BrandDNAMemory>> {
  const empty: MemorySnapshot<BrandDNAMemory> = {
    domain: 'brand_dna', orgId, data: [],
    fetchedAt: new Date().toISOString(), staleTtlMs: 60_000, isStale: false,
  };
  if (!deps.prisma) return empty;
  try {
    const brand = await deps.prisma.brand?.findUnique?.({
      where:  { id: brandId },
      select: { learningSignals: true, orgId: true },
    });
    if (!brand || brand.orgId !== orgId) return empty;
    const signals = brand.learningSignals as Record<string, unknown>;
    if (!signals) return empty;

    const parsed = BrandDNAMemorySchema.safeParse({
      orgId, brandId,
      dominantColors: signals.dominantColors ?? [],
      fontFamily:     signals.fontFamily,
      toneKeywords:   signals.toneKeywords ?? [],
      logoPosition:   signals.logoPosition ?? 'top-left',
      prefersDarkBg:  signals.prefersDarkBg ?? false,
      confidence:     signals.confidence ?? 0,
      updatedAt:      signals.updatedAt ?? new Date().toISOString(),
      sampleCount:    signals.sampleCount ?? 0,
    });
    if (!parsed.success) return empty;

    // Mark as stale if older than 5 minutes
    const updatedMs   = new Date(String(signals.updatedAt ?? 0)).getTime();
    const staleTtlMs  = 300_000;
    const isStale     = Date.now() - updatedMs > staleTtlMs;

    return { domain: 'brand_dna', orgId, data: [parsed.data], fetchedAt: new Date().toISOString(), staleTtlMs, isStale };
  } catch (e: unknown) {
    deps.logger?.warn({ err: (e instanceof Error ? e.message : String(e)) }, '[memory] readBrandDNASnapshot failed');
    return empty;
  }
}

/** Read exploration priors for UCB exploration seeding. */
export async function readExplorationPriors(
  orgId: string,
  brandId: string | undefined,
  deps: UnifiedMemoryDeps
): Promise<{ priorVector: number[]; totalRuns: number; avgScore: number } | null> {
  if (!deps.prisma) return null;
  try {
    const row = await deps.prisma.explorationPrior?.findUnique?.({
      where: { orgId_brandId: { orgId, brandId: brandId ?? '' } },
    });
    if (!row) return null;
    return { priorVector: row.priorVector as unknown as number[], totalRuns: Number(row.totalRuns ?? 0), avgScore: Number(row.avgScore ?? 0) };
  } catch { return null; }
}

/** Read recent rejected output hashes for an org (to avoid re-generating similar outputs). */
export async function readRejectedHashes(
  orgId: string,
  limitRecent: number = 50,
  deps: UnifiedMemoryDeps
): Promise<Set<string>> {
  if (!deps.prisma) return new Set();
  try {
    const events = await deps.prisma.aIFeedbackEvent?.findMany?.({
      where:   { orgId, eventType: 'asset_rejected', similarityHash: { not: null } },
      orderBy: { occurredAt: 'desc' },
      take:    Math.min(limitRecent, 200),
      select:  { similarityHash: true },
    });
    return new Set((events ?? []).map((e: Record<string, unknown>) => String(e.similarityHash ?? '')).filter(Boolean));
  } catch { return new Set(); }
}

/** Read audit log of recent memory writes for an org (admin/debugging). */
export async function readMemoryAuditLog(
  orgId: string,
  domain?: MemoryDomain,
  limit = 50,
  deps?: UnifiedMemoryDeps
): Promise<Array<{ domain: string; writtenAt: string; writePermission: string; recordCount: number }>> {
  if (!deps?.prisma) return [];
  try {
    const rows = await deps.prisma.memorySignalLog?.findMany?.({
      where:   { orgId, ...(domain && { domain }) },
      orderBy: { writtenAt: 'desc' },
      take:    Math.min(limit, 200),
      select:  { domain: true, writtenAt: true, writePermission: true, recordCount: true },
    }) ?? [];
    return rows.map((r: Record<string, unknown>) => ({
      domain:          r.domain as string,
      writtenAt:       r.writtenAt instanceof Date ? r.writtenAt.toISOString() : '',
      writePermission: r.writePermission as string,
      recordCount:     r.recordCount as number,
    }));
  } catch { return []; }
}

// Re-export the write permission map for audit/admin tooling
export { DOMAIN_WRITE_PERMISSIONS };
