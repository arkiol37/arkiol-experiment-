/**
 * Render Queue — Animation Studio
 * 
 * Deterministic job state machine:
 *   queued → processing → scene_rendering → mixing → complete
 *                       ↘ failed → (dead_letter on max retries)
 *                                → credits refunded
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
import { ProviderAdapter } from '../providers/providerAdapter';
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

// Aliases to preserve existing call sites below without further changes
const enforceCreditsForRender = async (p: { workspaceId: string; renderMode: string; sceneCount: number; addons: string[] }) => {
  // Map workspace → org: Studio uses workspaces, shared uses orgs.
  // workspaceId IS the orgId in the unified schema (same row, same DB).
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
  // Determine renderMode from the job record so we use the correct credit cost
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
// adScriptEngine: buildEnhancedPrompt available for scene-level prompt augmentation if needed

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
  renderMode: 'Normal Ad' | 'Cinematic Ad'   // Launch modes. Legacy aliases ('2D Standard' | '2D Extended' | 'Premium Cinematic') accepted via GPU-cost map.
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
  // Ad style selector: 'normal' = standard 2D renderer, 'cinematic' = Cinematic Motion Renderer
  adStyle?: 'normal' | 'cinematic';
  // Platform targeting (optional — falls back to aspectRatio-based export)
  placement?: string;       // e.g. 'youtube_instream', 'tiktok_feed'
  platform?: string;        // e.g. 'youtube', 'tiktok'
  hookType?: string;        // hook psychology type
  ctaText?: string;         // CTA text for final scene
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
    // Use resolvePlan so any legacy DB values (scale, enterprise, STARTER) are normalised
    const { resolvePlan } = await import('@arkiol/shared');
    const plan = resolvePlan(ws?.plan || 'FREE');
    const map: Record<string, number> = { STUDIO: 1, PRO: 3, CREATOR: 4, FREE: 10 };
    return map[plan] ?? 5;
  } catch {
    return 5;
  }
}

// ── Prompt enhancement (platform-aware) ───────────────────────
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

  // When a named placement is provided, inject its platform modifier
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

// ── Scene generation with polling ─────────────────────────────
async function generateScene(
  provider: ProviderAdapter,
  scene: SceneData,
  cfg: RenderConfig,
  renderJobId: string
): Promise<{ videoUrl: string; provider: string }> {
  // Mark scene as rendering
  await db('scenes')
    .where({ id: scene.id })
    .update({ status: 'rendering', render_job_id: renderJobId, error: null });

  // Determine scene duration: use scene.timing.durationSec if set (from adScriptEngine),
  // then fall back to placement spec, then default 7s
  let sceneDurationSec = 7;
  if ((scene as any).timing?.durationSec) {
    sceneDurationSec = (scene as any).timing.durationSec;
  } else if (cfg.placement) {
    const placementSpec = PLACEMENT_SPECS[cfg.placement as AdPlacement];
    if (placementSpec) sceneDurationSec = placementSpec.secPerScene;
  }

  const result = await provider.generateWithFallback({
    prompt: enhancePrompt(scene.prompt, cfg, sceneDurationSec),
    durationSeconds: sceneDurationSec,
    aspectRatio: cfg.aspectRatio,
    renderMode: cfg.renderMode,
  });

  // Poll with exponential backoff + hard timeout
  const deadline = Date.now() + config.SCENE_POLL_TIMEOUT_MS;
  let pollResult = result;
  let pollInterval = config.SCENE_POLL_INTERVAL_MS;

  while (pollResult.status === 'queued' || pollResult.status === 'processing') {
    if (Date.now() > deadline) {
      // Attempt to cancel the remote job
      provider.cancelJob(pollResult.jobId, pollResult.provider).catch(() => {});
      throw new Error(`Scene ${scene.id} timed out after ${config.SCENE_POLL_TIMEOUT_MS / 1000}s`);
    }
    await sleep(pollInterval);
    pollInterval = Math.min(pollInterval * 1.5, 30_000); // cap at 30s
    pollResult = await provider.pollResult(pollResult.jobId, pollResult.provider);
  }

  if (pollResult.status === 'failed' || !pollResult.videoUrl) {
    throw new Error(`Scene generation failed: ${pollResult.error || 'No video URL returned'}`);
  }

  await db('scenes').where({ id: scene.id }).update({
    status: 'complete',
    video_url: pollResult.videoUrl,
    provider_used: pollResult.provider,
  });

  return { videoUrl: pollResult.videoUrl, provider: pollResult.provider };
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

  // ── Idempotency check (skip failed/dead_letter so retries work) ──
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
    // Log but don't block — admin can review via dashboard
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
    // Platform targeting fields (nullable — populated when user picks a platform)
    placement: params.config.placement ?? null,
    platform:  params.config.platform ?? null,
    hook_type: params.config.hookType ?? null,
    cta_text:  params.config.ctaText ?? null,
  }).returning('*');

  // ── Debit credits immediately (refunded on failure) ───────────
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
    properties: { renderMode: params.config.renderMode, sceneCount: params.scenes.length, aspectRatio: params.config.aspectRatio },
  });

  logger.info(`[Queue] Render ${job.id} queued (${params.scenes.length} scenes, priority=${priority})`);
  return job.id;
}

async function getWorkspaceMaxConcurrent(workspaceId: string): Promise<number> {
  try {
    const ws = await db('workspaces').where({ id: workspaceId }).select('plan').first();
    // Use resolvePlan so any legacy DB values (scale, enterprise, STARTER) are normalised
    const { resolvePlan } = await import('@arkiol/shared');
    const plan = resolvePlan(ws?.plan || 'FREE');
    const map: Record<string, number> = { FREE: 1, CREATOR: 2, PRO: 5, STUDIO: 15 };
    return map[plan] ?? 1;
  } catch { return 1; }
}

export function estimateGpuCost(renderMode: string, scenes: number): number {
  // GPU cost per scene. Legacy aliases kept for existing DB job records.
  const costPerScene: Record<string, number> = {
    'Normal Ad':        0.50,   // 2D  — launch mode
    'Cinematic Ad':     2.50,   // 2.5D — launch mode
    '2D Standard':      0.50,   // legacy alias
    '2D Extended':      0.50,   // legacy alias
    'Premium Cinematic':2.50,   // legacy alias
  };
  return (costPerScene[renderMode] ?? 0.50) * scenes;
}

// ── Process render job ─────────────────────────────────────────
renderQueue.process(config.RENDER_CONCURRENCY, async (job: Job<RenderJobData>) => {
  const { renderJobId, workspaceId, scenes, config: renderConfig } = job.data;
  const workDir = path.join(os.tmpdir(), `anim-render-${renderJobId}`);

  logger.info(`[Worker] Starting render ${renderJobId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);

  // ── BRAND ASSET ENRICHMENT ───────────────────────────────────────────────
  // If the render has brand assets, inject them into scenes before processing
  let enrichedScenes = scenes;
  if (renderConfig.hasBrandAssets && renderConfig.brandAssetIds?.length) {
    try {
      const { enrichScenesWithBrandAssets } = await import('../services/brandAssetRenderIntegration');
      enrichedScenes = await enrichScenesWithBrandAssets(
        scenes as any,
        {
          brandAssetIds: renderConfig.brandAssetIds,
          brandPalette: renderConfig.brandPalette,
          assetSlots: renderConfig.assetSlots,
          hasBrandAssets: renderConfig.hasBrandAssets,
        },
        renderJobId
      ) as any;
      logger.info(`[Worker] Brand assets injected into ${enrichedScenes.length} scenes`, { renderJobId });

      // Store brand asset metadata in render job
      await db('render_jobs').where({ id: renderJobId }).update({
        brand_asset_ids: renderConfig.brandAssetIds,
        brand_palette: JSON.stringify(renderConfig.brandPalette || []),
        asset_slots: JSON.stringify(renderConfig.assetSlots || {}),
      }).catch(() => {}); // Non-fatal if columns don't exist yet
    } catch (err: any) {
      logger.warn(`[Worker] Brand asset enrichment failed (non-fatal): ${err.message}`, { renderJobId });
      // Continue with original scenes — graceful degradation
    }
  }

  // ── CINEMATIC MODE ENRICHMENT ────────────────────────────────────────────
  // When adStyle=cinematic or renderMode=Premium Cinematic, upgrade scene
  // prompts and attach CinematicSceneDescriptor to each scene for the renderer.
  // This is purely a rendering-layer upgrade — no AI engines are changed.
  try {
    const { isCinematicMode, enrichScenesForCinematicMode } = await import('../services/cinematicMotionRenderer');
    if (isCinematicMode(renderConfig)) {
      const cinematicScenes = enrichScenesForCinematicMode(
        enrichedScenes as any,
        renderConfig,
      );
      enrichedScenes = cinematicScenes as any;
      logger.info(`[Worker] Cinematic mode enrichment complete for ${enrichedScenes.length} scenes`, { renderJobId });
      await db('render_jobs').where({ id: renderJobId }).update({
        current_step: 'Cinematic depth composition ready',
      }).catch(() => {});
    }
  } catch (err: any) {
    logger.warn(`[Worker] Cinematic enrichment failed (non-fatal, falling back to normal): ${err.message}`, { renderJobId });
    // Graceful degradation — continue with normal render
  }

  logger.info(`[Worker] Starting render ${renderJobId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);

  // ── KILL-SWITCH CHECK (fail-fast, before any DB write or AI call) ────────
  // Defensive re-check in the worker. The route handler already checks on job
  // submission, but the kill-switch may have been activated while the job was
  // queued. Hard-fail with a structured error — refund is triggered in the
  // catch block below via the standard job failure path.
  const killResult = checkKillSwitch();
  if (!killResult.allowed) {
    const r = killResult as any;
    logger.warn({ renderJobId, reason: r.reason, code: r.code },
      '[render-worker] KILL_SWITCH_ACTIVE — aborting job before any processing');
    // Mark job failed immediately, then throw so Bull's retry/DLQ logic fires.
    await db('render_jobs').where({ id: renderJobId }).update({
      status: 'failed',
      current_step: 'Kill-switch active',
      error_message: r.reason,
      failed_at: new Date(),
    }).catch(() => {});
    // Try to refund credits that were debited at submission time.
    const jobRow = await db('render_jobs').where({ id: renderJobId })
      .select('workspace_id', 'config').first().catch(() => null);
    if (jobRow) {
      const cfg = jobRow.config
        ? (typeof jobRow.config === 'string' ? JSON.parse(jobRow.config) : jobRow.config)
        : {};
      refundStudioCredits({ orgId: jobRow.workspace_id, renderJobId, renderMode: cfg.renderMode ?? 'Normal Ad' })
        .catch((e: Error) => logger.warn({ renderJobId, err: e.message }, '[render-worker] Kill-switch credit refund failed'));
    }
    const err = new Error(r.reason);
    (err as any).code = r.code;
    (err as any).httpStatus = r.httpStatus ?? 503;
    throw err;
  }

  // ── SPEND GUARD CHECK (fail-fast, before any DB write or AI call) ────────
  // The route handler checks spend at submission time. The worker re-checks
  // with the live global spend so that a limit hit during queue wait is caught.
  // Spend is fetched fail-closed: if the query fails, we use Infinity so the
  // guard denies generation rather than silently allowing it.
  {
    let globalMonthlySpendUsd = Infinity; // fail-closed sentinel
    try {
      const spendRow = await db('AIProviderCostLog')
        .where('createdAt', '>=', new Date(new Date().getFullYear(), new Date().getMonth(), 1))
        .sum('costUsd as total')
        .first();
      const raw = parseFloat((spendRow as any)?.total ?? '0');
      globalMonthlySpendUsd = Number.isFinite(raw) ? raw : Infinity;
    } catch (spendErr: any) {
      logger.warn({ renderJobId, err: spendErr.message },
        '[render-worker] SPEND_GUARD_FETCH_FAILED: cannot calculate global monthly spend — generation blocked (fail-closed)');
      // globalMonthlySpendUsd stays Infinity — guard will deny below
    }

    const spendResult = checkGlobalMonthlySpend(globalMonthlySpendUsd);
    if (!spendResult.allowed) {
      const r = spendResult as any;
      logger.warn({ renderJobId, reason: r.reason, code: r.code, globalMonthlySpendUsd },
        '[render-worker] SPEND_GUARD_ACTIVE — aborting job, refunding credits');
      await db('render_jobs').where({ id: renderJobId }).update({
        status: 'failed',
        current_step: 'Global spend guard active',
        error_message: r.reason,
        failed_at: new Date(),
      }).catch(() => {});
      const jobRow = await db('render_jobs').where({ id: renderJobId })
        .select('workspace_id', 'config').first().catch(() => null);
      if (jobRow) {
        const cfg = jobRow.config
          ? (typeof jobRow.config === 'string' ? JSON.parse(jobRow.config) : jobRow.config)
          : {};
        refundStudioCredits({ orgId: jobRow.workspace_id, renderJobId, renderMode: cfg.renderMode ?? 'Normal Ad' })
          .catch((e: Error) => logger.warn({ renderJobId, err: e.message }, '[render-worker] Spend-guard credit refund failed'));
      }
      const err = new Error(r.reason);
      (err as any).code = r.code ?? 'SPEND_GUARD_ACTIVE';
      (err as any).httpStatus = r.httpStatus ?? 503;
      throw err;
    }
  }

  const provider = new ProviderAdapter(workspaceId);

  try {
    await fs.mkdir(workDir, { recursive: true });

    await db('render_jobs').where({ id: renderJobId }).update({
      status: 'processing',
      current_step: 'Initializing',
      started_at: new Date(),
      retry_count: job.attemptsMade,
    });

    // ── Step 1: Scene generation (batched, parallel) ─────────────
    const sceneResults: Array<{ videoUrl: string; provider: string } | null> = [];
    const BATCH_SIZE = 3;

    for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
      const batch = scenes.slice(i, i + BATCH_SIZE);
      const batchEnd = Math.min(i + BATCH_SIZE, scenes.length);

      await db('render_jobs').where({ id: renderJobId }).update({
        status: 'scene_rendering',
        current_step: `Generating scenes ${i + 1}–${batchEnd} of ${scenes.length}`,
      });
      await job.progress(Math.round((i / scenes.length) * 55));

      const settled = await Promise.allSettled(
        batch.map(scene => generateScene(provider, scene, renderConfig, renderJobId))
      );

      let batchSuccess = 0;
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j];
        if (r.status === 'fulfilled') {
          sceneResults.push(r.value);
          batchSuccess++;
        } else {
          logger.error(`[Worker] Scene ${batch[j].id} failed: ${r.reason?.message}`);
          await db('scenes').where({ id: batch[j].id }).update({
            status: 'failed',
            error: r.reason?.message || 'Generation failed',
          });
          sceneResults.push(null);
        }
      }

      const complete = sceneResults.filter(Boolean).length;
      await db('render_jobs').where({ id: renderJobId }).update({ scenes_complete: complete });
    }

    // Require at least one scene
    const validScenes = sceneResults.filter((r): r is { videoUrl: string; provider: string } => r !== null);
    if (validScenes.length === 0) {
      throw new Error('All scenes failed to generate. No video content available.');
    }

    const primaryProvider = validScenes[0].provider;
    await db('render_jobs').where({ id: renderJobId }).update({ provider_primary: primaryProvider });

    // ── Step 2: Voiceover ────────────────────────────────────────
    await db('render_jobs').where({ id: renderJobId }).update({ current_step: 'Generating voiceover', status: 'mixing' });
    await job.progress(60);

    const voiceResult = await generateAndUploadVoice({
      renderJobId,
      workspaceId,
      scenes,
      voiceConfig: renderConfig.voice,
    });
    const voiceUrl = voiceResult?.cdnUrl ?? null;
    const voiceId = voiceResult?.voiceId;

    // ── Step 3: Music track selection ────────────────────────────
    await db('render_jobs').where({ id: renderJobId }).update({ current_step: 'Selecting music' });
    await job.progress(65);

    const musicStyle = renderConfig.music.style.replace(/^[^\w]+/, '').trim(); // strip emoji
    const musicUrl = selectMusicTrack(renderConfig.mood, musicStyle);

    // ── Step 4: Subtitle generation ──────────────────────────────
    await db('render_jobs').where({ id: renderJobId }).update({ current_step: 'Generating subtitles' });
    await job.progress(68);

    const estimatedDuration = scenes.length * 7;
    const subtitleCues = await generateSubtitles({
      scenes,
      totalDurationSeconds: estimatedDuration,
      voiceId,
    });

    // ── Step 5: FFmpeg stitch, mix, subtitle ─────────────────────
    await db('render_jobs').where({ id: renderJobId }).update({ current_step: 'Stitching & mixing video' });
    await job.progress(72);

    // Extract cinematic FFmpeg filters from enriched scenes (if cinematic mode)
    let cinematicFilters: string[] | undefined;
    try {
      const { isCinematicMode } = await import('../services/cinematicMotionRenderer');
      if (isCinematicMode(renderConfig)) {
        const allFilters = (enrichedScenes as any[])
          .flatMap((s: any) => s.cinematicDescriptor?.ffmpegFilters || []);
        // Deduplicate — use only unique filter expressions
        const uniqueFilters = [...new Set(allFilters)] as string[];
        if (uniqueFilters.length > 0) cinematicFilters = uniqueFilters;
      }
    } catch { /* non-fatal */ }

    const { finalVideoPath, thumbnailPath, quality } = await stitchAndMixPipeline({
      renderJobId,
      workspaceId,
      sceneVideoUrls: validScenes.map(s => s.videoUrl),
      voiceUrl,
      musicUrl,
      subtitlesData: subtitleCues.length > 0 ? subtitleCues : undefined,
      aspectRatio: renderConfig.aspectRatio,
      resolution: renderConfig.resolution,
      transitionType: 'crossfade',
      transitionDuration: 0.5,
      voiceVolume: 1.0,
      musicVolume: 0.25,
      extraVideoFilters: cinematicFilters,
    });

    // ── Step 6: Quality validation ────────────────────────────────
    await job.progress(88);
    if (!quality.pass) {
      logger.warn(`[Worker] Quality warning for ${renderJobId}: ${JSON.stringify(quality)}`);
      // Warn but don't fail — quality data is stored for review
    }

    // ── Step 7: Upload thumbnail ──────────────────────────────────
    await db('render_jobs').where({ id: renderJobId }).update({ current_step: 'Uploading thumbnail' });
    await job.progress(90);

    const thumbBuffer = await fs.readFile(thumbnailPath);
    const { cdnUrl: thumbnailCdnUrl } = await uploadRender({
      workspaceId,
      renderId: renderJobId,
      buffer: thumbBuffer,
      mimeType: 'image/jpeg',
      filename: 'thumbnail.jpg',
    });

    // ── Step 8: Multi-format export + platform-specific exports ──
    await db('render_jobs').where({ id: renderJobId }).update({ current_step: 'Exporting all formats' });
    await job.progress(93);

    // Always produce the 3 generic aspect ratio exports (backwards compatible)
    const outputFormats = await exportMultipleFormats({
      renderJobId,
      workspaceId,
      primaryVideoPath: finalVideoPath,
      primaryAspect: renderConfig.aspectRatio,
    });

    const finalVideoUrl = outputFormats[renderConfig.aspectRatio];

    // ── Platform-specific exports (when placement is specified) ────
    // Produce one correctly-encoded file per selected platform placement,
    // using that platform's bitrate, audio sample rate, and aspect ratio.
    let platformExports: Record<string, string> = {};
    if (renderConfig.placement) {
      await db('render_jobs').where({ id: renderJobId }).update({ current_step: 'Exporting platform formats' });

      // Build the list of placements to export:
      //   - Always include the primary selected placement
      //   - Include all other placements on the same platform (same aspect ratio = free reuse)
      const primaryPlacementId = renderConfig.placement as AdPlacement;
      const primarySpec = PLACEMENT_SPECS[primaryPlacementId];

      if (primarySpec) {
        // Gather all placements on the same platform
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
            renderJobId,
            workspaceId,
            primaryVideoPath: finalVideoPath,
            primaryAspect: renderConfig.aspectRatio,
            placements: placementsToExport,
          });
          logger.info(`[Worker] Platform exports complete: ${Object.keys(platformExports).join(', ')}`);
        } catch (platformErr: any) {
          // Platform export failure is non-fatal — primary export already succeeded
          logger.warn(`[Worker] Platform export partial failure: ${platformErr.message}`);
        }
      }
    }

    // ── Step 9: Cleanup temp files ────────────────────────────────
    await cleanupWorkdir(workDir);

    // ── Step 10: Mark complete ────────────────────────────────────
    const actualGpuCost = estimateGpuCost(renderConfig.renderMode, validScenes.length);
    await db('render_jobs').where({ id: renderJobId }).update({
      status: 'complete',
      progress: 100,
      output_video_url: finalVideoUrl,
      output_thumbnail_url: thumbnailCdnUrl,
      output_formats: JSON.stringify(outputFormats),
      platform_exports: Object.keys(platformExports).length > 0 ? JSON.stringify(platformExports) : null,
      quality_report: JSON.stringify(quality),
      gpu_cost_usd: actualGpuCost,
      total_cost_usd: actualGpuCost * 1.2, // 20% overhead
      completed_at: new Date(),
      current_step: 'Complete',
    });

    await job.progress(100);

    // ── Notify user ───────────────────────────────────────────────
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

    await trackAnalytics({
      workspaceId,
      event: 'render.complete',
      entityType: 'render_job',
      entityId: renderJobId,
      properties: {
        sceneCount: validScenes.length,
        renderMode: renderConfig.renderMode,
        durationMs: Date.now() - (job.timestamp || Date.now()),
      },
    });

    logger.info(`[Worker] ✅ Render ${renderJobId} complete`);
    return { renderJobId, status: 'complete', outputUrl: finalVideoUrl };

  } catch (err: any) {
    await cleanupWorkdir(workDir);

    logger.error(`[Worker] ❌ Render ${renderJobId} failed (attempt ${job.attemptsMade + 1}): ${err.message}`);

    await db('render_jobs').where({ id: renderJobId }).update({
      status: 'failed',
      error_message: err.message,
      error_details: JSON.stringify({ stack: err.stack, attempt: job.attemptsMade + 1 }),
    });

    // Re-throw so Bull handles retries
    throw err;
  }
});

// ── Dead letter handler (called after max retries exhausted) ───
renderQueue.on('failed', async (job: Job<RenderJobData>, err: Error) => {
  const maxAttempts = job.opts.attempts ?? 3;
  if (job.attemptsMade < maxAttempts) return; // More retries remain

  logger.error(`[Queue] 💀 Job ${job.id} dead-lettered after ${job.attemptsMade} attempts: ${err.message}`);

  try {
    await db('render_jobs').where({ id: job.data.renderJobId }).update({
      status: 'dead_letter',
      error_message: `Max retries exhausted: ${err.message}`,
      error_details: JSON.stringify({ finalAttempt: job.attemptsMade, error: err.message }),
    });

    // Refund credits
    await refundCredits({
      workspaceId: job.data.workspaceId,
      amount: job.data.config.creditsToCharge,
      renderJobId: job.data.renderJobId,
      reason: `Render failed after ${job.attemptsMade} attempts: ${err.message}`,
    });

    // Archive to dead letter queue for manual review
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
renderQueue.on('completed', (job) =>
  logger.info(`[Queue] ✓ Job ${job.id} completed`)
);
renderQueue.on('error', (err) =>
  logger.error('[Queue] Bull error:', err)
);
renderQueue.on('stalled', (job) => {
  logger.warn(`[Queue] ⚠ Job ${job.id} stalled — will be retried`);
  db('render_jobs').where({ id: (job as any).data?.renderJobId })
    .update({ status: 'queued', current_step: 'Requeued after stall' })
    .catch(() => {});
});
renderQueue.on('active', (job) =>
  logger.info(`[Queue] → Job ${job.id} active (attempt ${job.attemptsMade + 1})`)
);
