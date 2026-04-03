/**
 * Render Queue — Animation Studio v27
 *
 * Deterministic job state machine:
 *   queued → processing → scene_rendering → mixing → complete
 *                       ↘ failed → (dead_letter on max retries)
 *                                → credits refunded
 *
 * v27 CHANGES:
 * ─────────────────────────────────────────────────────────────────
 * • Internal Template Execution Engine is the SOLE rendering path
 *   for all 2D and 2.5D outputs. No external provider fallback.
 * • ProviderAdapter is NOT invoked for any 2D/2.5D render.
 * • Spec validation is BLOCKING — critical errors halt the render.
 * • GIF export is wired into the final result structure.
 * • Single orchestrator call (no duplicate).
 * • Thumbnail generated from internal frame render (no provider).
 * ─────────────────────────────────────────────────────────────────
 *
 * Idempotency: enforced via idempotency_key unique constraint
 * Credits: debited on submission, refunded on failure/cancel/dead-letter
 * Concurrency: configurable via RENDER_CONCURRENCY env var (default 3)
 */
import Bull, { Job } from 'bull';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { db } from '../config/database';
// All credit operations via shared adapter — no local billing service credits.
import {
  enforceStudioRenderCredits,
  debitStudioCredits,
  refundStudioCredits,
} from '../billing/sharedCreditAdapter';
// Kill-switch and spend guard from shared enforcement layer.
import {
  checkKillSwitch,
  checkGlobalMonthlySpend,
} from '@arkiol/shared';
import { auditLog, trackAnalytics } from '../services/auditService';
import { sendEmail } from '../services/emailService';
import { uploadRender } from '../services/storageService';
import {
  stitchAndMixPipeline,
  exportMultipleFormats,
  exportPlatformFormats,
} from '../services/ffmpeg/ffmpegPipeline';
import { generateAndUploadVoice, selectMusicTrack } from '../services/voice/voiceService';
import { generateSubtitles } from '../services/subtitle/subtitleService';
import { v4 as uuidv4 } from 'uuid';
import {
  PLACEMENT_SPECS,
  PLACEMENTS_BY_PLATFORM,
  type AdPlacement,
  type Platform,
} from '../services/platformSpecs';
// ── Engine integrations ─────────────────────────────────────────────
import { orchestrateAdGeneration } from '../engines/orchestrator/intelligenceOrchestrator';
import { deliverRenderCompleteWebhook } from '../engines/webhook/webhookDeliveryEngine';
import { learnTemplate } from '../engines/template/templateLearningEngine';
import { recordMetrics } from '../engines/learning/performanceOptimizer';
import { renderEventBus } from '../events/renderEvents';
// ── v27 Internal rendering (sole path for 2D/2.5D) ─────────────────
import { runInternalRender, bridgePipelineToRenderer, type InternalRenderOptions } from '../engines/renderer';
import { enforceInternalRendering } from '../engines/renderer/engineGate';
import { planJobRouting } from '../engines/renderer/hybridRouter';
import { buildRenderSpecs } from '../engines/renderer/schema/specBuilder';
// ── Self-Healing Reliability Layer v2 ──
import { classifyFailure, attemptRecovery, saveCheckpoint, getLatestCheckpoint, clearCheckpoints, registerHeartbeat, checkMemoryPressure, quarantineJob, isJobQuarantined, reportIncident, isCircuitOpen, recordCircuitSuccess, recordCircuitFailure, revalidateAssets, canAutoFixQC, getEscalationLevel, getRecentIncidents } from '../engines/self-healing';
// ── Memory Store for intelligence layers ──
import { recordRegeneration, inferRegenerationReason, updateTasteFromSelection, recordSessionFingerprint, computeFingerprint, recordOutputFingerprint } from '../engines/candidate';

// Aliases to preserve existing call sites below without further changes
const enforceCreditsForRender = async (p: { workspaceId: string; renderMode: string; sceneCount: number; addons: string[] }) => {
  const { db } = await import('../config/database');
  const running = await db('render_jobs')
    .where({ workspace_id: p.workspaceId })
    .whereIn('status', ['queued', 'processing', 'scene_rendering', 'mixing'])
    .count('* as cnt').first();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayVideo = await db('render_jobs')
    .where({ workspace_id: p.workspaceId })
    .where('created_at', '>=', today)
    .count('* as cnt').first();
  await enforceStudioRenderCredits({
    orgId: p.workspaceId,
    renderMode: p.renderMode,
    currentRunningJobs: Number((running as any)?.cnt ?? 0),
    todayVideoJobs: Number((todayVideo as any)?.cnt ?? 0),
  });
};

const debitCredits = async (p: { workspaceId: string; amount: number; renderJobId: string; description: string }) => {
  const { db } = await import('../config/database');
  const job = await db('render_jobs').where({ id: p.renderJobId }).select('config').first();
  const cfg = job?.config ? (typeof job.config === 'string' ? JSON.parse(job.config) : job.config) : {};
  await debitStudioCredits({ orgId: p.workspaceId, renderJobId: p.renderJobId, renderMode: cfg.renderMode ?? 'Normal Ad' });
};

const refundCredits = async (p: { workspaceId: string; amount: number; renderJobId: string; reason: string }) => {
  const { db } = await import('../config/database');
  const job = await db('render_jobs').where({ id: p.renderJobId }).select('config').first();
  const cfg = job?.config ? (typeof job.config === 'string' ? JSON.parse(job.config) : job.config) : {};
  await refundStudioCredits({ orgId: p.workspaceId, renderJobId: p.renderJobId, renderMode: cfg.renderMode ?? 'Normal Ad' });
};

// ── Types ──────────────────────────────────────────────────────
export interface RenderJobData {
  renderJobId: string;
  workspaceId: string;
  userId: string;
  storyboardId: string;
  scenes: SceneData[];
  config: RenderConfig;
  idempotencyKey: string;
  attempt?: number;
}

export interface SceneData {
  id: string;
  position: number;
  prompt: string;
  voiceoverScript?: string;
  role: string;
  timing: any;
  visualConfig: any;
}

export interface RenderConfig {
  aspectRatio: '9:16' | '1:1' | '16:9';
  renderMode: 'Normal Ad' | 'Cinematic Ad';
  resolution: '1080p' | '4K';
  mood: string;
  voice: {
    gender: string;
    tone: string;
    accent: string;
    speed: string;
  };
  music: {
    style: string;
    energyCurve: string;
    beatSync: boolean;
  };
  creditsToCharge: number;
  adStyle?: 'normal' | 'cinematic';
  // v27: renderEngine is accepted but always enforced to 'internal' for 2D/2.5D
  renderEngine?: 'provider' | 'internal';
  placement?: string;
  platform?: string;
  hookType?: string;
  ctaText?: string;
  // v27: GIF export flag
  exportGif?: boolean;
  gifWidth?: number;
}

// ── Bull Queue configuration ───────────────────────────────────
const BULL_OPTS = {
  redis: config.REDIS_URL,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 10_000 },
    removeOnComplete: { count: 200, age: 7 * 24 * 3600 },
    removeOnFail: false,
    timeout: 45 * 60 * 1000, // 45 min hard timeout per job
  },
};

export const renderQueue = new Bull<RenderJobData>('render', BULL_OPTS);
export const deadLetterQueue = new Bull<any>('dead-letter', { redis: config.REDIS_URL });

// ── Utility ────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function cleanupWorkdir(workDir: string) {
  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch { /* no-op */ }
}

// ── Plan-based priority ────────────────────────────────────────
async function getRenderPriority(workspaceId: string): Promise<number> {
  try {
    const ws = await db('workspaces').where({ id: workspaceId }).select('plan').first();
    const { resolvePlan } = await import('@arkiol/shared');
    const plan = resolvePlan(ws?.plan || 'FREE');
    const map: Record<string, number> = { STUDIO: 1, PRO: 3, CREATOR: 4, FREE: 10 };
    return map[plan] ?? 5;
  } catch {
    return 5;
  }
}

// ── Prompt enhancement (platform-aware) ───────────────────────
function getScenePrompt(scene: any): string {
  return scene.enhancedPrompt || scene.prompt || '';
}

export function enhancePrompt(prompt: string, cfg: RenderConfig, sceneDurationSec?: number): string {
  const moodMods: Record<string, string> = {
    Luxury: 'cinematic, high-end, elegant, premium lighting, 8K detail',
    Energetic: 'dynamic, fast-paced, vibrant colors, kinetic energy',
    Minimal: 'clean, minimal, white space, modern design',
    Cinematic: 'cinematic depth of field, dramatic lighting, film grain',
    Playful: 'colorful, fun, animated, joyful, bright',
    Emotional: 'emotional, warm, intimate, genuine moments',
    Corporate: 'professional, clean, trustworthy, modern corporate',
    Bold: 'bold, high contrast, impactful typography',
    Tech: 'futuristic, digital, neural, holographic',
    Calm: 'serene, peaceful, soft light, gentle movement',
  };
  const mod = moodMods[cfg.mood] || 'professional quality';
  const isCinematic = (cfg.renderMode as string) === 'Cinematic Ad' || (cfg.renderMode as string) === 'Premium Cinematic' || cfg.adStyle === 'cinematic';

  let platformMod = '';
  if (cfg.placement) {
    const spec = PLACEMENT_SPECS[cfg.placement as AdPlacement];
    if (spec) {
      platformMod = spec.promptModifier + '. ';
    }
  }

  const durationStr = sceneDurationSec ? `${sceneDurationSec} seconds. ` : '';
  const qualityMod = isCinematic
    ? 'Multi-layer 2.5D depth composition, parallax depth, cinematic lighting, realistic brand treatment, premium commercial quality.'
    : 'Professional motion graphics, ad quality, 2D animation.';
  return `${prompt}. ${mod}. ${platformMod}${qualityMod} ${cfg.aspectRatio} aspect ratio. ${durationStr}`.trim();
}

// ── Queue a new render job ─────────────────────────────────────
export async function queueRender(params: {
  workspaceId: string;
  userId: string;
  storyboardId: string;
  scenes: SceneData[];
  config: RenderConfig;
  idempotencyKey?: string;
}): Promise<string> {
  const idempotencyKey = params.idempotencyKey || uuidv4();

  // ── v27: Enforce internal engine at submission time ───────────────
  const gateResult = enforceInternalRendering(
    params.config.renderMode,
    params.config.renderEngine,
    'submission',
  );
  if (gateResult.warning) {
    logger.warn(`[Queue] Engine gate warning at submission: ${gateResult.warning}`);
  }

  // ── Idempotency check ────────────────────────────────────────────
  const existing = await db('render_jobs')
    .where({ idempotency_key: idempotencyKey })
    .whereNotIn('status', ['failed', 'dead_letter', 'cancelled'])
    .first();

  if (existing) {
    logger.info(`[Queue] Idempotent: returning existing job ${existing.id}`);
    return existing.id;
  }

  // ── Per-workspace concurrency cap ──────────────────────────────
  const activeCount = await db('render_jobs')
    .where({ workspace_id: params.workspaceId })
    .whereIn('status', ['queued', 'processing', 'scene_rendering', 'mixing'])
    .count('* as cnt')
    .first();

  const maxConcurrent = await getWorkspaceMaxConcurrent(params.workspaceId);
  if (Number((activeCount as any)?.cnt ?? 0) >= maxConcurrent) {
    throw new Error(`Concurrent render limit (${maxConcurrent}) reached. Wait for active renders to complete.`);
  }

  // ── Credit enforcement ─────────────────────────────────────────
  await enforceCreditsForRender({
    workspaceId: params.workspaceId,
    renderMode: params.config.renderMode,
    sceneCount: params.scenes.length,
    addons: ['Voice Engine', 'Music License'],
  });

  // ── GPU cost safeguard ─────────────────────────────────────────
  const estimatedGpuCost = estimateGpuCost(params.config.renderMode, params.scenes.length);
  const estimatedRevenue = params.config.creditsToCharge * 0.79;
  if (estimatedGpuCost > estimatedRevenue * 1.5) {
    logger.warn(`[Queue] Margin-negative render detected: gpu=${estimatedGpuCost} rev=${estimatedRevenue}`);
  }

  // ── Create DB record atomically ────────────────────────────────
  const [job] = await db('render_jobs').insert({
    workspace_id: params.workspaceId,
    storyboard_id: params.storyboardId,
    user_id: params.userId,
    status: 'queued',
    scenes_total: params.scenes.length,
    idempotency_key: idempotencyKey,
    config: JSON.stringify(params.config),
    credits_charged: params.config.creditsToCharge,
    gpu_cost_usd: estimatedGpuCost,
    revenue_usd: estimatedRevenue,
    placement: params.config.placement ?? null,
    platform:  params.config.platform ?? null,
    hook_type: params.config.hookType ?? null,
    cta_text:  params.config.ctaText ?? null,
  }).returning('*');

  // ── Debit credits immediately ──────────────────────────────────
  await debitCredits({
    workspaceId: params.workspaceId,
    amount: params.config.creditsToCharge,
    renderJobId: job.id,
    description: `${params.scenes.length}×${params.config.renderMode} render`,
  });

  // ── Enqueue Bull job ───────────────────────────────────────────
  const priority = await getRenderPriority(params.workspaceId);
  const bullJob = await renderQueue.add({
    renderJobId: job.id,
    workspaceId: params.workspaceId,
    userId: params.userId,
    storyboardId: params.storyboardId,
    scenes: params.scenes,
    config: params.config,
    idempotencyKey,
  }, {
    jobId: `render-${job.id}`,
    priority,
  });

  await db('render_jobs').where({ id: job.id }).update({ bull_job_id: bullJob.id.toString() });

  await auditLog({
    userId: params.userId,
    workspaceId: params.workspaceId,
    action: 'render.queued',
    resourceType: 'render_job',
    resourceId: job.id,
    after: { mode: params.config.renderMode, scenes: params.scenes.length, credits: params.config.creditsToCharge },
  });

  await trackAnalytics({
    workspaceId: params.workspaceId,
    userId: params.userId,
    event: 'render.queued',
    entityType: 'render_job',
    entityId: job.id,
    properties: { renderMode: params.config.renderMode, sceneCount: params.scenes.length, aspectRatio: params.config.aspectRatio, engine: 'internal' },
  });

  renderEventBus.emitRender('render.queued', { renderJobId: job.id, workspaceId: params.workspaceId, data: { renderMode: params.config.renderMode, sceneCount: params.scenes.length } });

  logger.info(`[Queue] Render ${job.id} queued (${params.scenes.length} scenes, priority=${priority}, engine=internal)`);
  return job.id;
}

async function getWorkspaceMaxConcurrent(workspaceId: string): Promise<number> {
  try {
    const ws = await db('workspaces').where({ id: workspaceId }).select('plan').first();
    const { resolvePlan } = await import('@arkiol/shared');
    const plan = resolvePlan(ws?.plan || 'FREE');
    const map: Record<string, number> = { FREE: 1, CREATOR: 2, PRO: 5, STUDIO: 15 };
    return map[plan] ?? 1;
  } catch { return 1; }
}

export function estimateGpuCost(renderMode: string, scenes: number): number {
  // v27: internal render has lower GPU cost than external providers
  const costPerScene: Record<string, number> = {
    'Normal Ad':        0.08,   // 2D — internal engine (was 0.50 with providers)
    'Cinematic Ad':     0.25,   // 2.5D — internal engine (was 2.50 with providers)
    '2D Standard':      0.08,   // legacy alias
    '2D Extended':      0.08,   // legacy alias
    'Premium Cinematic':0.25,   // legacy alias
  };
  return (costPerScene[renderMode] ?? 0.08) * scenes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKER — Process render job (v27: internal-only path)
// ═══════════════════════════════════════════════════════════════════════════════

renderQueue.process(config.RENDER_CONCURRENCY, async (job: Job<RenderJobData>) => {
  const { renderJobId, workspaceId, scenes, config: renderConfig } = job.data;
  const workDir = path.join(os.tmpdir(), `anim-render-${renderJobId}`);

  const workerId = `worker_${process.pid}`;
  logger.info(`[Worker] Starting render ${renderJobId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);

  // ═══════════════════════════════════════════════════════════════════════════
  // SELF-HEALING: Pre-flight checks
  // ═══════════════════════════════════════════════════════════════════════════
  const mem = checkMemoryPressure();
  registerHeartbeat(workerId, renderJobId, 'starting', mem.usageMB);
  if (!mem.safe) { logger.error(`[Worker] CRITICAL memory: ${mem.usageMB}MB`); throw new Error(`Memory critical: ${mem.usageMB}MB`); }
  if (isJobQuarantined(renderJobId)) { logger.warn(`[Worker] Job quarantined: ${renderJobId}`); throw new Error('Job quarantined by self-healing'); }
  if (isCircuitOpen('render_pipeline')) { logger.warn(`[Worker] Circuit open`); throw new Error('Render circuit breaker open'); }
  const existingCp = getLatestCheckpoint(renderJobId);
  if (existingCp && job.attemptsMade > 0) logger.info(`[Worker] Resume from checkpoint: ${existingCp.id}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // v27 ENGINE GATE — enforce internal rendering for all 2D/2.5D
  // ═══════════════════════════════════════════════════════════════════════════
  const gateResult = enforceInternalRendering(
    renderConfig.renderMode,
    renderConfig.renderEngine,
    renderJobId,
  );
  if (gateResult.warning) {
    logger.warn(`[Worker] Engine gate: ${gateResult.warning}`, { renderJobId });
  }

  // ── BRAND ASSET ENRICHMENT ───────────────────────────────────────────────
  let enrichedScenes = scenes;
  if ((renderConfig as any).hasBrandAssets && (renderConfig as any).brandAssetIds?.length) {
    try {
      const { enrichScenesWithBrandAssets } = await import('../services/brandAssetRenderIntegration');
      enrichedScenes = await enrichScenesWithBrandAssets(
        scenes as any,
        {
          brandAssetIds: (renderConfig as any).brandAssetIds,
          brandPalette: (renderConfig as any).brandPalette,
          assetSlots: (renderConfig as any).assetSlots,
          hasBrandAssets: (renderConfig as any).hasBrandAssets,
        },
        renderJobId
      ) as any;
      logger.info(`[Worker] Brand assets injected into ${enrichedScenes.length} scenes`, { renderJobId });

      await db('render_jobs').where({ id: renderJobId }).update({
        brand_asset_ids: (renderConfig as any).brandAssetIds,
        brand_palette: JSON.stringify((renderConfig as any).brandPalette || []),
        asset_slots: JSON.stringify((renderConfig as any).assetSlots || {}),
      }).catch(() => {});
    } catch (err: any) {
      logger.warn(`[Worker] Brand asset enrichment failed (non-fatal): ${err.message}`, { renderJobId });
    }
  }

  // ── CINEMATIC MODE ENRICHMENT ────────────────────────────────────────────
  try {
    const { isCinematicMode, enrichScenesForCinematicMode } = await import('../services/cinematicMotionRenderer');
    if (isCinematicMode(renderConfig)) {
      const cinematicScenes = enrichScenesForCinematicMode(enrichedScenes as any, renderConfig);
      enrichedScenes = cinematicScenes as any;
      logger.info(`[Worker] Cinematic mode enrichment complete for ${enrichedScenes.length} scenes`, { renderJobId });
    }
  } catch (err: any) {
    logger.warn(`[Worker] Cinematic enrichment failed (non-fatal): ${err.message}`, { renderJobId });
  }

  // ── MEMORY: Record regeneration event if this is a re-generation ──────────
  try {
    const previousJobs = await db('render_jobs')
      .where({ workspace_id: workspaceId, storyboard_id: job.data.storyboardId })
      .whereNot({ id: renderJobId })
      .orderBy('created_at', 'desc')
      .limit(1)
      .select('id', 'config');
    if (previousJobs.length > 0) {
      const prevScenes = enrichedScenes;
      const reason = inferRegenerationReason(prevScenes as any[], renderConfig as any);
      recordRegeneration(job.data.userId, {
        timestamp: new Date(), jobId: renderJobId, userId: job.data.userId,
        previousFingerprint: previousJobs[0].id,
        inferredReason: reason.reason, reasonConfidence: reason.confidence,
        sequenceIndex: previousJobs.length,
      });
      logger.info(`[Worker] Regeneration recorded: reason=${reason.reason} (${Math.round(reason.confidence*100)}%)`, { renderJobId });
    }
  } catch (regenErr: any) {
    logger.debug(`[Worker] Regeneration tracking skipped: ${regenErr.message}`);
  }

  // ── AI ENGINE ENRICHMENT (single orchestrator call) ──────────────────────
  let pipelineCtx: any = null;
  try {
    pipelineCtx = await orchestrateAdGeneration({
      renderJobId, workspaceId, userId: job.data.userId,
      brief: (renderConfig as any).brief || `Ad for ${(renderConfig as any).brandName || 'brand'}`,
      brandName: (renderConfig as any).brandName || 'Brand',
      industry: (renderConfig as any).industry || 'Other',
      mood: renderConfig.mood, hookType: renderConfig.hookType,
      platform: renderConfig.platform || 'instagram',
      placement: renderConfig.placement || 'instagram_feed',
      sceneCount: enrichedScenes.length,
      aspectRatio: renderConfig.aspectRatio || '9:16',
      renderMode: renderConfig.renderMode || 'Normal Ad',
      maxDurationSec: (renderConfig as any).maxDurationSec || 30,
      brandAssetIds: (renderConfig as any).brandAssetIds,
      brandPalette: (renderConfig as any).brandPalette,
      targetAudience: (renderConfig as any).targetAudience,
      objective: (renderConfig as any).objective,
    });

    // Apply orchestrator enhancements to scenes
    if (pipelineCtx.storyboard && pipelineCtx.storyboard.length === enrichedScenes.length) {
      for (let i = 0; i < enrichedScenes.length; i++) {
        const enhanced = pipelineCtx.storyboard[i];
        (enrichedScenes[i] as any).enhancedPrompt = enhanced.prompt;
        if (enhanced.voiceoverScript) (enrichedScenes[i] as any).voiceoverScript = enhanced.voiceoverScript;
        if ((enhanced as any).cinematicKeyframes) (enrichedScenes[i] as any).cinematicKeyframes = (enhanced as any).cinematicKeyframes;
        if ((enhanced as any).cinematicGrade) (enrichedScenes[i] as any).cinematicGrade = (enhanced as any).cinematicGrade;
      }
    }
    logger.info(`[Worker] AI engine enrichment complete for ${enrichedScenes.length} scenes`, { renderJobId });
  } catch (err: any) {
    logger.warn(`[Worker] Orchestrator failed (using minimal context): ${err.message}`, { renderJobId });
    // Build minimal pipeline context so rendering can still proceed
    pipelineCtx = {
      renderJobId, workspaceId, userId: job.data.userId,
      intent: {
        objective: 'awareness', mood: renderConfig.mood || 'Corporate',
        hookType: 'bold_claim', platform: renderConfig.platform || 'instagram',
        aspectRatio: renderConfig.aspectRatio || '9:16',
        renderMode: renderConfig.renderMode,
        brand: { name: (renderConfig as any).brandName || 'Brand', brief: '', industry: '' },
        maxDurationSec: 30, sceneCount: enrichedScenes.length,
      },
      storyboard: enrichedScenes.map((s: any, i: number) => ({
        id: s.id || `scene_${i}`,
        position: i,
        role: s.role || (i === 0 ? 'hook' : i === enrichedScenes.length - 1 ? 'cta' : 'solution'),
        durationSec: s.timing?.durationSec || 5,
        prompt: s.prompt || '',
        voiceoverScript: s.voiceoverScript || '',
        visualDirection: '',
        onScreenText: s.visualConfig?.onScreenText || '',
        transitionIn: 'crossfade', transitionOut: 'crossfade',
        emotionTarget: 0.7, pacingBpm: 100, cameraMove: 'push_in',
        shotType: 'medium', depthLayers: [], audioSync: [],
        continuityTokens: [], qualityTarget: 80,
      })),
      timeline: [], qualityScores: [], stages: [], decisions: [],
      startedAt: new Date(), metadata: { ctaText: renderConfig.ctaText },
    };
  }

  // ── KILL-SWITCH CHECK ────────────────────────────────────────────────────
  const killResult = checkKillSwitch();
  if (!killResult.allowed) {
    const r = killResult as any;
    logger.warn({ renderJobId, reason: r.reason, code: r.code },
      '[render-worker] KILL_SWITCH_ACTIVE — aborting job');
    await db('render_jobs').where({ id: renderJobId }).update({
      status: 'failed', current_step: 'Kill-switch active',
      error_message: r.reason, failed_at: new Date(),
    }).catch(() => {});
    const jobRow = await db('render_jobs').where({ id: renderJobId })
      .select('workspace_id', 'config').first().catch(() => null);
    if (jobRow) {
      const cfg = jobRow.config ? (typeof jobRow.config === 'string' ? JSON.parse(jobRow.config) : jobRow.config) : {};
      refundStudioCredits({ orgId: jobRow.workspace_id, renderJobId, renderMode: cfg.renderMode ?? 'Normal Ad' })
        .catch((e: Error) => logger.warn({ renderJobId, err: e.message }, '[render-worker] Kill-switch credit refund failed'));
    }
    const err = new Error(r.reason);
    (err as any).code = r.code;
    (err as any).httpStatus = r.httpStatus ?? 503;
    throw err;
  }

  // ── SPEND GUARD CHECK ────────────────────────────────────────────────────
  {
    let globalMonthlySpendUsd = Infinity;
    try {
      const spendRow = await db('AIProviderCostLog')
        .where('createdAt', '>=', new Date(new Date().getFullYear(), new Date().getMonth(), 1))
        .sum('costUsd as total').first();
      const raw = parseFloat((spendRow as any)?.total ?? '0');
      globalMonthlySpendUsd = Number.isFinite(raw) ? raw : Infinity;
    } catch (spendErr: any) {
      logger.warn({ renderJobId, err: spendErr.message },
        '[render-worker] SPEND_GUARD_FETCH_FAILED — generation blocked (fail-closed)');
    }

    const spendResult = checkGlobalMonthlySpend(globalMonthlySpendUsd);
    if (!spendResult.allowed) {
      const r = spendResult as any;
      logger.warn({ renderJobId, reason: r.reason, code: r.code, globalMonthlySpendUsd },
        '[render-worker] SPEND_GUARD_ACTIVE — aborting job');
      await db('render_jobs').where({ id: renderJobId }).update({
        status: 'failed', current_step: 'Global spend guard active',
        error_message: r.reason, failed_at: new Date(),
      }).catch(() => {});
      const jobRow = await db('render_jobs').where({ id: renderJobId })
        .select('workspace_id', 'config').first().catch(() => null);
      if (jobRow) {
        const cfg = jobRow.config ? (typeof jobRow.config === 'string' ? JSON.parse(jobRow.config) : jobRow.config) : {};
        refundStudioCredits({ orgId: jobRow.workspace_id, renderJobId, renderMode: cfg.renderMode ?? 'Normal Ad' })
          .catch((e: Error) => logger.warn({ renderJobId, err: e.message }, '[render-worker] Spend-guard credit refund failed'));
      }
      const err = new Error(r.reason);
      (err as any).code = r.code ?? 'SPEND_GUARD_ACTIVE';
      (err as any).httpStatus = r.httpStatus ?? 503;
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // v27 INTERNAL RENDER — sole path for all 2D/2.5D
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    await fs.mkdir(workDir, { recursive: true });

    await db('render_jobs').where({ id: renderJobId }).update({
      status: 'processing',
      current_step: 'Internal render: initializing',
      started_at: new Date(),
      retry_count: job.attemptsMade,
      provider_primary: 'internal',
    });

    // ── Build routing plan (for analytics — always all_internal in v27) ────
    const routingPlan = planJobRouting(pipelineCtx, {
      explicitEngine: 'internal',
      renderMode: renderConfig.renderMode || 'Normal Ad',
      platform: renderConfig.platform || 'instagram',
    });

    // ── Build validated SceneSpecs (BLOCKING validation in v27) ────────────
    const brandPalette = (renderConfig as any).brandPalette || [];
    const bridgeBrandData = brandPalette.length >= 2 ? {
      primaryColor: brandPalette[0],
      secondaryColor: brandPalette[1] || brandPalette[0],
      accentColor: brandPalette[2] || brandPalette[0],
      backgroundColor: '#1a1a2e',
      logoUrl: (renderConfig as any).logoUrl,
      fontFamily: (renderConfig as any).fontFamily,
    } : undefined;

    const specResult = buildRenderSpecs({
      pipelineCtx,
      enrichedScenes: enrichedScenes as any,
      cinematicDescriptors: enrichedScenes.map((s: any) => s.cinematicDescriptor).filter(Boolean),
      brandData: bridgeBrandData,
      fps: 24,
      platform: renderConfig.platform || 'instagram',
    });

    // v27 BLOCKING VALIDATION: critical spec errors halt the render
    if (specResult.validationSummary.totalErrors > 0) {
      const criticalErrors = specResult.validationSummary.perScene
        .flatMap(s => s.errors)
        .filter(e => e.includes('Missing') || e.includes('Invalid') || e.includes('zero'));

      if (criticalErrors.length > 0) {
        logger.error(`[Worker] BLOCKING: ${criticalErrors.length} critical spec errors — render halted`, {
          renderJobId,
          errors: criticalErrors,
        });
        throw new Error(`Render spec validation failed with ${criticalErrors.length} critical errors: ${criticalErrors.slice(0, 3).join('; ')}`);
      }

      // Non-critical errors: log warning but proceed
      logger.warn(`[Worker] Spec validation has ${specResult.validationSummary.totalErrors} non-critical errors — proceeding`, {
        renderJobId,
        errors: specResult.validationSummary.perScene.flatMap(s => s.errors),
      });
    }

    await db('render_jobs').where({ id: renderJobId }).update({
      status: 'scene_rendering',
      current_step: 'Internal render: generating scenes',
    });
    await job.progress(10);

    // Self-Healing: checkpoint after spec validation
    saveCheckpoint({ jobId: renderJobId, stage: 'post_spec', sceneIndex: 0, specHash: `specs_${specResult.validationSummary.validScenes}`, retryCount: job.attemptsMade });
    registerHeartbeat(workerId, renderJobId, 'voice_gen', checkMemoryPressure().usageMB);

    // ── Generate voiceover ─────────────────────────────────────────────────
    const voiceResult = await generateAndUploadVoice({
      renderJobId, workspaceId, scenes: enrichedScenes as any,
      voiceConfig: renderConfig.voice,
    });
    const voiceUrl = voiceResult?.cdnUrl ?? null;
    await job.progress(25);

    // ── Select music ───────────────────────────────────────────────────────
    const musicStyle = renderConfig.music.style.replace(/^[^\w]+/, '').trim();
    const musicUrl = selectMusicTrack(renderConfig.mood, musicStyle);

    // ── Generate subtitles ─────────────────────────────────────────────────
    const subtitleCues = await generateSubtitles({
      scenes: enrichedScenes as any,
      totalDurationSeconds: enrichedScenes.reduce((s: number, sc: any) => s + (sc.timing?.durationSec || 5), 0),
      voiceId: voiceResult?.voiceId,
    });
    await job.progress(30);

    // ── Self-Healing: Revalidate assets before render ───────────────────────
    try {
      const assetUrls = enrichedScenes.flatMap((s: any) => [
        (s.visualConfig?.imageUrl || ''),
        ((renderConfig as any).logoUrl || ''),
      ].filter(Boolean).filter((u: string) => u.startsWith('http')));
      if (assetUrls.length > 0) {
        const assetCheck = await revalidateAssets(assetUrls);
        if (assetCheck.invalid.length > 0) {
          logger.warn(`[Worker] ${assetCheck.invalid.length} assets failed revalidation — render will use fallbacks`, { renderJobId });
        }
      }
    } catch (assetErr: any) {
      logger.debug(`[Worker] Asset revalidation skipped: ${assetErr.message}`);
    }

    // ── Run internal render using validated specs ───────────────────────────
    const shouldExportGif = renderConfig.exportGif !== false; // default true in v27
    const internalResult = await runInternalRender(
      {
        pipelineCtx,
        enrichedScenes: enrichedScenes as any,
        cinematicDescriptors: enrichedScenes.map((s: any) => s.cinematicDescriptor).filter(Boolean),
        brandData: bridgeBrandData,
      },
      {
        renderJobId,
        workspaceId,
        fps: 24,
        crf: 18,
        preset: 'medium',
        voiceUrl,
        musicUrl,
        subtitles: subtitleCues.length > 0 ? subtitleCues : undefined,
        voiceVolume: 1.0,
        musicVolume: 0.25,
        transitionType: 'crossfade',
        transitionDuration: 0.5,
        exportAllAspects: true,
        exportGif: shouldExportGif,
        gifWidth: renderConfig.gifWidth ?? 480,
        onProgress: (stage, pct) => {
          job.progress(30 + Math.round(pct * 55)).catch(() => {});
        },
      },
    );

    await job.progress(88);

    // ── Upload final video ──────────────────────────────────────────────────
    await db('render_jobs').where({ id: renderJobId }).update({ current_step: 'Uploading video' });

    const videoBuf = await fs.readFile(internalResult.stitchedPath);
    const { cdnUrl: videoUrl } = await uploadRender({
      workspaceId, renderId: renderJobId,
      buffer: videoBuf, mimeType: 'video/mp4', filename: 'final.mp4',
    });
    await job.progress(90);

    // ── Upload thumbnail (generated from internal frame) ────────────────────
    let thumbnailCdnUrl: string | undefined;
    try {
      // Use first clip's midpoint frame for thumbnail
      if (internalResult.clips.length > 0 && internalResult.clips[0].clipPath) {
        const { renderScenePreview } = await import('../engines/renderer');
        const { bridgePipelineToRenderer } = await import('../engines/renderer');
        const bridgeOutput = bridgePipelineToRenderer({
          pipelineCtx,
          enrichedScenes: enrichedScenes as any,
          cinematicDescriptors: enrichedScenes.map((s: any) => s.cinematicDescriptor).filter(Boolean),
          brandData: bridgeBrandData,
        });
        if (bridgeOutput.scenes.length > 0) {
          const thumbScene = bridgeOutput.scenes[0];
          const thumbPng = await renderScenePreview(
            thumbScene.template,
            thumbScene.bindings,
            Math.round(thumbScene.bindings.durationMs / 2),
          );
          const { cdnUrl } = await uploadRender({
            workspaceId, renderId: renderJobId,
            buffer: thumbPng, mimeType: 'image/png', filename: 'thumbnail.png',
          });
          thumbnailCdnUrl = cdnUrl;
        }
      }
    } catch (thumbErr: any) {
      logger.warn(`[Worker] Thumbnail generation failed (non-fatal): ${thumbErr.message}`);
    }

    // ── Upload exports for each aspect ratio ────────────────────────────────
    const outputFormats: Record<string, string> = {};
    outputFormats[renderConfig.aspectRatio] = videoUrl;

    for (const [aspect, exportPath] of Object.entries(internalResult.exports)) {
      if (!exportPath || aspect === renderConfig.aspectRatio) continue;
      try {
        const buf = await fs.readFile(exportPath);
        const { cdnUrl } = await uploadRender({
          workspaceId, renderId: renderJobId,
          buffer: buf, mimeType: 'video/mp4',
          filename: `export_${aspect.replace(':', 'x')}.mp4`,
        });
        outputFormats[aspect] = cdnUrl;
      } catch { /* non-fatal */ }
    }

    // ── Upload GIF export (v27: wired into final result) ────────────────────
    let gifUrl: string | undefined;
    if (internalResult.gifPath) {
      try {
        const gifBuf = await fs.readFile(internalResult.gifPath);
        const { cdnUrl } = await uploadRender({
          workspaceId, renderId: renderJobId,
          buffer: gifBuf, mimeType: 'image/gif', filename: 'preview.gif',
        });
        gifUrl = cdnUrl;
        logger.info(`[Worker] GIF uploaded: ${gifUrl}`, { renderJobId });
      } catch (gifErr: any) {
        logger.warn(`[Worker] GIF upload failed (non-fatal): ${gifErr.message}`);
      }
    }

    await job.progress(95);

    // ── Platform-specific exports ───────────────────────────────────────────
    let platformExports: Record<string, string> = {};
    if (renderConfig.placement) {
      await db('render_jobs').where({ id: renderJobId }).update({ current_step: 'Exporting platform formats' });

      const primaryPlacementId = renderConfig.placement as AdPlacement;
      const primarySpec = PLACEMENT_SPECS[primaryPlacementId];

      if (primarySpec) {
        const samePlatformPlacements = PLACEMENTS_BY_PLATFORM[primarySpec.platform] || [primaryPlacementId];
        const placementsToExport = samePlatformPlacements.map((pid: AdPlacement) => {
          const s = PLACEMENT_SPECS[pid];
          return {
            placement: pid,
            aspectRatio: s.aspectRatio,
            targetBitrateKbps: s.targetBitrateKbps,
            audioSampleRate: s.audioSampleRate,
          };
        });

        try {
          platformExports = await exportPlatformFormats({
            renderJobId, workspaceId,
            primaryVideoPath: internalResult.stitchedPath,
            primaryAspect: renderConfig.aspectRatio,
            placements: placementsToExport,
          });
          logger.info(`[Worker] Platform exports complete: ${Object.keys(platformExports).join(', ')}`);
        } catch (platformErr: any) {
          logger.warn(`[Worker] Platform export partial failure: ${platformErr.message}`);
        }
      }
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────
    await cleanupWorkdir(workDir);

    // ── Mark complete ───────────────────────────────────────────────────────
    const actualGpuCost = estimateGpuCost(renderConfig.renderMode, enrichedScenes.length);
    await db('render_jobs').where({ id: renderJobId }).update({
      status: 'complete',
      progress: 100,
      output_video_url: videoUrl,
      output_thumbnail_url: thumbnailCdnUrl || null,
      output_gif_url: gifUrl || null,
      output_formats: JSON.stringify(outputFormats),
      platform_exports: Object.keys(platformExports).length > 0 ? JSON.stringify(platformExports) : null,
      gpu_cost_usd: actualGpuCost,
      total_cost_usd: actualGpuCost * 1.1,
      completed_at: new Date(),
      current_step: 'Complete',
      // Intelligence metadata (consumed by frontend)
      intelligence_report: JSON.stringify({
        candidatePipeline: pipelineCtx?.metadata?.candidatePipeline || null,
        comparisonInsights: pipelineCtx?.metadata?.comparisonInsights || null,
        progressiveFeedback: pipelineCtx?.metadata?.progressiveFeedback || null,
        allCandidateScores: pipelineCtx?.metadata?.allCandidateScores || null,
        confidence: pipelineCtx?.metadata?.confidence || null,
      }),
    });

    await job.progress(100);

    // ── Notify user ─────────────────────────────────────────────────────────
    try {
      const jobRecord = await db('render_jobs as rj')
        .join('users as u', 'u.id', 'rj.user_id')
        .join('storyboards as sb', 'sb.id', 'rj.storyboard_id')
        .join('projects as p', 'p.id', 'sb.project_id')
        .where('rj.id', renderJobId)
        .select('u.email', 'u.first_name', 'p.name as project_name', 'p.id as project_id')
        .first();

      if (jobRecord?.email) {
        sendEmail({
          to: jobRecord.email,
          subject: `✅ Your video "${jobRecord.project_name}" is ready!`,
          template: 'render-complete',
          data: {
            name: jobRecord.first_name,
            projectName: jobRecord.project_name,
            projectId: jobRecord.project_id,
          },
        }).catch(err => logger.warn('[Worker] Email notification failed:', err.message));
      }
    } catch (notifyErr: any) {
      logger.warn('[Worker] Notification failed (non-fatal):', notifyErr.message);
    }

    // ── Analytics ───────────────────────────────────────────────────────────
    await trackAnalytics({
      workspaceId,
      event: 'render.complete',
      entityType: 'render_job',
      entityId: renderJobId,
      properties: {
        sceneCount: enrichedScenes.length,
        renderMode: renderConfig.renderMode,
        renderEngine: 'internal',
        renderTimeMs: internalResult.renderTimeMs,
        totalFrames: internalResult.totalFrames,
        routingStrategy: 'all_internal',
        specValidErrors: specResult.validationSummary.totalErrors,
        specValidWarnings: specResult.validationSummary.totalWarnings,
        hasGif: !!gifUrl,
        durationMs: Date.now() - (job.timestamp || Date.now()),
      },
    });

    // ── Template learning signal ────────────────────────────────────────────
    try {
      learnTemplate({ renderJobId, sceneCount: enrichedScenes.length, renderMode: renderConfig.renderMode, renderTimeMs: internalResult.renderTimeMs });
    } catch {}

    logger.info(`[Worker] ✅ Render ${renderJobId} complete in ${internalResult.renderTimeMs}ms (internal engine)`);
    // Self-Healing: record success, clear checkpoints, update memory stores
    recordCircuitSuccess('render_pipeline');
    clearCheckpoints(renderJobId);
    // Memory: record session fingerprint and output fingerprint
    const fp = computeFingerprint(enrichedScenes as any[], renderJobId);
    recordSessionFingerprint(job.data.userId, fp);
    recordOutputFingerprint(job.data.userId, fp.combinedHash);
    // Memory: update taste profile from this successful generation
    try {
      updateTasteFromSelection(job.data.userId, { scenes: enrichedScenes }, []);
      logger.debug(`[Worker] Taste profile updated for user ${job.data.userId}`);
    } catch (tasteErr: any) {
      logger.debug(`[Worker] Taste update skipped: ${tasteErr.message}`);
    }

    return { renderJobId, status: 'complete', outputUrl: videoUrl, gifUrl };

  } catch (err: any) {
    await cleanupWorkdir(workDir);
    // ── Self-Healing: classify, attempt recovery, report incident ──
    const failure = classifyFailure(err, { stage: 'render_worker', jobId: renderJobId, workerId });
    logger.error(`[Worker] ❌ Render ${renderJobId} failed [${failure.failureClass}]: ${err.message}`);
    const recovery = await attemptRecovery(failure, job.attemptsMade);
    reportIncident({ id: `inc_${renderJobId}_${job.attemptsMade}`, jobId: renderJobId, timestamp: new Date(),
      failureClass: failure.failureClass, originalError: err.message,
      selectedPolicy: recovery.recovered ? 'retry' : 'fail_safe', checkpointUsed: recovery.checkpointUsed,
      userMessage: recovery.userMessage, disposition: recovery.recovered ? 'recovered' : 'failed_safe' });
    if (!failure.retryable) quarantineJob(renderJobId, failure.description);
    // Self-Healing: check escalation level
    const escLevel = getEscalationLevel(getRecentIncidents(20));
    if (escLevel === 'critical') logger.error(`[Worker] ESCALATION CRITICAL: ${escLevel} — multiple recent failures`, { renderJobId });
    else if (escLevel === 'page') logger.warn(`[Worker] ESCALATION PAGE: repeated failures detected`, { renderJobId });
    await db('render_jobs').where({ id: renderJobId }).update({
      status: recovery.recovered ? 'queued' : 'failed', error_message: err.message,
      error_details: JSON.stringify({ stack: err.stack, attempt: job.attemptsMade + 1, failureClass: failure.failureClass, retryable: failure.retryable, recovery: recovery.action }),
      current_step: recovery.recovered ? 'Self-healing: retrying' : 'Failed',
    });
    throw err;
  }
});

// ── Dead letter handler ───────────────────────────────────────
renderQueue.on('failed', async (job: Job<RenderJobData>, err: Error) => {
  const maxAttempts = job.opts.attempts ?? 3;
  if (job.attemptsMade < maxAttempts) return;

  logger.error(`[Queue] 💀 Job ${job.id} dead-lettered after ${job.attemptsMade} attempts: ${err.message}`);

  try {
    await db('render_jobs').where({ id: job.data.renderJobId }).update({
      status: 'dead_letter',
      error_message: `Max retries exhausted: ${err.message}`,
      error_details: JSON.stringify({ finalAttempt: job.attemptsMade, error: err.message }),
    });

    await refundCredits({
      workspaceId: job.data.workspaceId,
      amount: job.data.config.creditsToCharge,
      renderJobId: job.data.renderJobId,
      reason: `Render failed after ${job.attemptsMade} attempts: ${err.message}`,
    });

    await deadLetterQueue.add({
      ...job.data,
      originalBullJobId: job.id,
      failedAt: new Date().toISOString(),
      finalError: err.message,
    }, { removeOnComplete: false });

    await auditLog({
      workspaceId: job.data.workspaceId,
      userId: job.data.userId,
      action: 'render.dead_letter',
      resourceType: 'render_job',
      resourceId: job.data.renderJobId,
      after: { attempts: job.attemptsMade, error: err.message },
      success: false,
      errorMessage: err.message,
    });
  } catch (handlerErr: any) {
    logger.error('[Queue] Dead letter handler error:', handlerErr.message);
  }
});

// ── Queue event logging ────────────────────────────────────────
renderQueue.on('completed', async (job) => {
  logger.info(`[Queue] ✓ Job ${job.id} completed`);
  const { renderJobId, workspaceId, config: cfg } = job.data;
  try { renderEventBus.emitRender('render.complete', { renderJobId, workspaceId, data: { scenesComplete: job.data.scenes?.length } }); } catch {}
  try { recordMetrics({ renderJobId, totalDurationMs: Date.now() - (job.processedOn || Date.now()), stageTimings: {}, providerLatencyMs: 0, cacheHitRate: 0 }); } catch {}
  try {
    const jobRecord = await db('render_jobs').where({ id: renderJobId }).first();
    if (jobRecord) await deliverRenderCompleteWebhook(workspaceId, renderJobId, 'complete', { outputUrl: jobRecord.output_video_url, platform: cfg.platform, creditsCharged: cfg.creditsToCharge });
  } catch (err: any) { logger.warn(`[Queue] Webhook delivery failed: ${err.message}`); }
});
renderQueue.on('error', (err) =>
  logger.error('[Queue] Bull error:', err)
);
renderQueue.on('stalled', async (job) => {
  const jobId = (job as any).data?.renderJobId;
  logger.warn(`[Queue] ⚠ Job ${job.id} stalled — self-healing recovery`);
  if (jobId) {
    const failure = classifyFailure(new Error('Stalled'), { stage: 'worker_stall', jobId });
    const recovery = await attemptRecovery(failure, 0);
    reportIncident({ id: `inc_stall_${jobId}`, jobId, timestamp: new Date(), failureClass: 'worker_crash_stall',
      originalError: 'Stalled', selectedPolicy: 'reclaim', checkpointUsed: recovery.checkpointUsed,
      userMessage: 'Recovering.', disposition: 'recovered' });
    db('render_jobs').where({ id: jobId }).update({ status: 'queued', current_step: 'Self-healed after stall' }).catch(() => {});
  }
});
renderQueue.on('active', (job) =>
  logger.info(`[Queue] → Job ${job.id} active (attempt ${job.attemptsMade + 1})`)
);
