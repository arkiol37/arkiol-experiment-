/**
 * Renders API — Animation Studio
 * 
 * POST   /api/renders                            — Submit render job
 * GET    /api/renders                            — List renders (paginated)
 * GET    /api/renders/:id                        — Get job status + progress
 * POST   /api/renders/:id/cancel                 — Cancel active job (refunds credits)
 * POST   /api/renders/:id/retry                  — Retry failed job
 * GET    /api/renders/:id/download               — Signed download URL
 * POST   /api/renders/scenes/:sceneId/regenerate — Re-queue single scene
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { renderLimiter } from '../middleware/rateLimiter';
import { queueRender, renderQueue } from '../jobs/renderQueue';
import { refundStudioCredits } from '../billing/sharedCreditAdapter';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { getPresignedDownloadUrl } from '../services/storageService';
import { config } from '../config/env';
import { auditLog } from '../services/auditService';
import { v4 as uuidv4 } from 'uuid';
// Shared enforcement — replaces all local plan checks
import {
  checkStudioAccess,
  checkResolution,
  checkDailyVideoJobs,
  checkConcurrency,
  checkKillSwitch,
  checkGlobalMonthlySpend,
  getPlanConfig,
  resolvePlan,
} from '@arkiol/shared';

// Helper: load org enforcement snapshot from shared DB
async function loadOrgSnap(orgId: string) {
  // Use Knex (same DB, avoids second Prisma client in this module)
  const org = await db('Org').where({ id: orgId }).select(
    'plan', 'creditBalance', 'dailyCreditBalance',
    'subscriptionStatus', 'gracePeriodEndsAt', 'costProtectionBlocked'
  ).first();
  if (!org) throw new AppError('Organization not found', 404);
  return {
    orgId,
    plan:                  org.plan ?? 'FREE',
    creditBalance:         org.creditBalance ?? 0,
    dailyCreditBalance:    org.dailyCreditBalance ?? 0,
    subscriptionStatus:    org.subscriptionStatus ?? 'ACTIVE',
    gracePeriodEndsAt:     org.gracePeriodEndsAt ?? null,
    costProtectionBlocked: org.costProtectionBlocked ?? false,
  };
}

const router = Router();
router.use(authenticate);

// ── Validation schemas ─────────────────────────────────────────
const sceneSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().min(0).max(9),
  prompt: z.string().min(1).max(2000).trim(),
  voiceoverScript: z.string().max(1000).trim().optional(),
  role: z.enum(['hook', 'problem', 'solution', 'proof', 'cta', 'custom']),
  timing: z.object({}).passthrough().optional().default({}),
  visualConfig: z.object({}).passthrough().optional().default({}),
});

// Valid placement values from platformSpecs
const VALID_PLACEMENTS = [
  'youtube_instream', 'youtube_shorts',
  'facebook_feed', 'facebook_reel', 'facebook_story',
  'instagram_feed', 'instagram_reel', 'instagram_story',
  'tiktok_feed', 'tiktok_topview',
] as const;

const VALID_PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok'] as const;

const renderConfigSchema = z.object({
  aspectRatio: z.enum(['9:16', '1:1', '16:9']),
  // Launch modes: 'Normal Ad' and 'Cinematic Ad'. Legacy aliases accepted for backward compat.
  // Launch modes are 'Normal Ad' and 'Cinematic Ad'.
  // Legacy aliases are coerced to launch modes for backward-compat with old clients.
  renderMode: z.enum(['Normal Ad', 'Cinematic Ad', '2D Standard', '2D Extended', 'Premium Cinematic'])
    .transform((m) => {
      const LEGACY_MAP: Record<string, 'Normal Ad' | 'Cinematic Ad'> = {
        '2D Standard':      'Normal Ad',
        '2D Extended':      'Normal Ad',
        'Premium Cinematic':'Cinematic Ad',
      };
      return (LEGACY_MAP[m] ?? m) as 'Normal Ad' | 'Cinematic Ad';
    }),
  resolution: z.enum(['1080p', '4K']),
  mood: z.string().min(1).max(50),
  voice: z.object({
    gender: z.enum(['Male', 'Female', 'Neutral']),
    tone: z.string().min(1).max(50),
    accent: z.string().min(1).max(50),
    speed: z.enum(['Slow', 'Normal', 'Fast', 'Very Fast']),
  }),
  music: z.object({
    style: z.string().min(1).max(100),
    energyCurve: z.string().min(1).max(50),
    beatSync: z.boolean(),
  }),
  creditsToCharge: z.number().int().min(0).max(1000),  // 0 = free daily Normal Ad; max = 35cr × 10 scenes + extras
  // Platform targeting (optional)
  placement: z.enum(VALID_PLACEMENTS).optional(),
  platform: z.enum(VALID_PLATFORMS).optional(),
  hookType: z.string().max(50).optional(),
  ctaText: z.string().max(500).optional(),
});

const createRenderSchema = z.object({
  storyboardId: z.string().uuid(),
  scenes: z.array(sceneSchema).min(1).max(10),
  config: renderConfigSchema,
  idempotencyKey: z.string().max(128).optional(),
});

// ── POST /api/renders ──────────────────────────────────────────
router.post('/', renderLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createRenderSchema.parse(req.body);
    const workspaceId = req.user!.workspaceId!;

    // ── GLOBAL KILL-SWITCH (first check — no DB needed) ──────────────────
    // Hard-block before any DB reads or job creation. If active, return 503
    // with structured error so the client can surface a clear message.
    const killResult = checkKillSwitch();
    if (!killResult.allowed) {
      const r = killResult as any;
      throw new AppError(r.reason, r.httpStatus ?? 503, r.code ?? 'KILL_SWITCH_ACTIVE');
    }

    // Verify storyboard ownership
    const storyboard = await db('storyboards as sb')
      .join('projects as p', 'p.id', 'sb.project_id')
      .where({ 'sb.id': data.storyboardId, 'p.workspace_id': workspaceId })
      .select('sb.id')
      .first();

    if (!storyboard) throw new AppError('Storyboard not found or access denied', 404);

    // ── Backend plan enforcement (shared, not UI-only) ──────────────────────
    const orgSnap = await loadOrgSnap(workspaceId);

    // ── GLOBAL SPEND GUARD ────────────────────────────────────────────────
    // Hard-block if global monthly spend limit is hit or cannot be calculated.
    // Uses the live globalMonthlySpendUsd from the org snapshot. The worker also
    // re-checks with a fresh fetch — both layers must enforce this independently.
    // If checkGlobalMonthlySpend() returns denied (including on misconfiguration
    // or NaN spend), we throw immediately — no silent degradation.
    const spendResult = checkGlobalMonthlySpend((orgSnap as any).globalMonthlySpendUsd ?? 0);
    if (!spendResult.allowed) {
      const r = spendResult as any;
      throw new AppError(r.reason, r.httpStatus ?? 503, r.code ?? 'SPEND_GUARD_ACTIVE');
    }

    const studioCheck = checkStudioAccess(orgSnap);
    if (!studioCheck.allowed) throw new AppError((studioCheck as any).reason, (studioCheck as any).httpStatus, (studioCheck as any).code);

    if (data.config.resolution === '4K') {
      const resCheck = checkResolution(orgSnap, '4K');
      if (!resCheck.allowed) throw new AppError((resCheck as any).reason, (resCheck as any).httpStatus, (resCheck as any).code);
    }

    const activeCount = await db('render_jobs')
      .where({ workspace_id: workspaceId })
      .whereIn('status', ['queued', 'processing', 'scene_rendering', 'mixing'])
      .count('* as cnt').first();

    const concurrencyCheck = checkConcurrency(orgSnap, Number((activeCount as any)?.cnt ?? 0));
    if (!concurrencyCheck.allowed) throw new AppError((concurrencyCheck as any).reason, (concurrencyCheck as any).httpStatus, (concurrencyCheck as any).code);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayVideoCount = await db('render_jobs')
      .where({ workspace_id: workspaceId }).where('created_at', '>=', today)
      .count('* as cnt').first();

    const videoCapCheck = checkDailyVideoJobs(orgSnap, Number((todayVideoCount as any)?.cnt ?? 0));
    if (!videoCapCheck.allowed) throw new AppError((videoCapCheck as any).reason, (videoCapCheck as any).httpStatus, (videoCapCheck as any).code);
    // ── End enforcement ────────────────────────────────────────────────────

    const renderJobId = await queueRender({
      workspaceId,
      userId: req.user!.userId,
      storyboardId: data.storyboardId,
      scenes: data.scenes as any,
      config: data.config as any,
      idempotencyKey: data.idempotencyKey,
    });

    const estimatedMinutes = Math.ceil(data.scenes.length * 2);

    res.status(202).json({
      renderJobId,
      message: 'Render job queued',
      estimatedMinutes,
      statusUrl: `/api/renders/${renderJobId}`,
    });
  } catch (err) { next(err); }
});

// ── GET /api/renders ───────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let q = db('render_jobs').where({ workspace_id: req.user!.workspaceId });
    if (status) q = q.where({ status });

    const [jobs, [{ count }]] = await Promise.all([
      q.clone().select(
        'id', 'status', 'progress', 'current_step', 'scenes_total', 'scenes_complete',
        'output_video_url', 'output_thumbnail_url', 'output_formats', 'quality_report',
        'credits_charged', 'error_message', 'intelligence_report', 'created_at', 'completed_at', 'started_at'
      ).orderBy('created_at', 'desc').limit(Number(limit)).offset(offset),
      q.clone().count('* as count'),
    ]);

    res.json({ jobs, total: Number(count), page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
});

// ── GET /api/renders/:id ───────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await db('render_jobs as rj')
      .leftJoin('users as u', 'u.id', 'rj.user_id')
      .where({ 'rj.id': req.params.id, 'rj.workspace_id': req.user!.workspaceId })
      .select(
        'rj.id', 'rj.status', 'rj.progress', 'rj.current_step',
        'rj.scenes_total', 'rj.scenes_complete', 'rj.config',
        'rj.output_video_url', 'rj.output_thumbnail_url', 'rj.output_formats',
        'rj.platform_exports', 'rj.placement', 'rj.platform',
        'rj.hook_type', 'rj.cta_text', 'rj.ad_duration_sec',
        'rj.quality_report', 'rj.intelligence_report', 'rj.credits_charged', 'rj.error_message',
        'rj.created_at', 'rj.started_at', 'rj.completed_at', 'rj.bull_job_id',
        'u.first_name', 'u.last_name',
      )
      .first();

    if (!job) throw new AppError('Render job not found', 404);

    // Augment with live Bull progress for in-flight jobs
    let liveProgress = null;
    if (job.bull_job_id && ['queued', 'processing', 'scene_rendering', 'mixing'].includes(job.status)) {
      try {
        const bullJob = await renderQueue.getJob(job.bull_job_id);
        if (bullJob) {
          liveProgress = {
            progress: await bullJob.progress(),
            state: await bullJob.getState(),
            attemptsMade: bullJob.attemptsMade,
          };
        }
      } catch { /* live progress is best-effort */ }
    }

    res.json({ ...job, liveProgress });
  } catch (err) { next(err); }
});

// ── POST /api/renders/:id/cancel ───────────────────────────────
router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await db('render_jobs')
      .where({ id: req.params.id, workspace_id: req.user!.workspaceId })
      .whereIn('status', ['queued', 'processing', 'scene_rendering', 'mixing'])
      .first();

    if (!job) throw new AppError('No active render job found with that ID', 404);

    // Remove from Bull queue if still pending
    if (job.bull_job_id) {
      try {
        const bullJob = await renderQueue.getJob(job.bull_job_id);
        if (bullJob) {
          const state = await bullJob.getState();
          if (state === 'waiting' || state === 'delayed') {
            await bullJob.remove();
          }
        }
      } catch { /* best-effort */ }
    }

    await db('render_jobs').where({ id: job.id }).update({
      status: 'failed',
      error_message: 'Cancelled by user',
      cancelled_at: new Date(),
      cancelled_by: req.user!.userId,
    });

    // Refund credits via shared ledger (queued jobs only — running jobs: no refund per policy)
    if (job.credits_charged > 0 && job.status === 'queued') {
      const cfg = job.config ? (typeof job.config === 'string' ? JSON.parse(job.config) : job.config) : {};
      await refundStudioCredits({
        orgId:       req.user!.workspaceId!,
        renderJobId: job.id,
        renderMode:  cfg.renderMode ?? 'Normal Ad',
      });
    }

    await auditLog({
      userId: req.user!.userId,
      workspaceId: req.user!.workspaceId,
      action: 'render.cancelled',
      resourceType: 'render_job',
      resourceId: job.id,
    });

    res.json({ message: 'Render cancelled and credits refunded', refundedCredits: job.credits_charged });
  } catch (err) { next(err); }
});

// ── POST /api/renders/:id/retry ────────────────────────────────
router.post('/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await db('render_jobs')
      .where({ id: req.params.id, workspace_id: req.user!.workspaceId })
      .whereIn('status', ['failed', 'dead_letter'])
      .first();

    if (!job) throw new AppError('No failed render job found with that ID', 404);

    const jobConfig = typeof job.config === 'string' ? JSON.parse(job.config) : job.config;
    const scenes = await db('scenes').where({ storyboard_id: job.storyboard_id }).orderBy('position');

    if (!scenes.length) throw new AppError('No scenes found for this render', 400);

    const newJobId = await queueRender({
      workspaceId: req.user!.workspaceId!,
      userId: req.user!.userId,
      storyboardId: job.storyboard_id,
      scenes: scenes as any,
      config: jobConfig,
      idempotencyKey: uuidv4(), // New key — intentional re-submit
    });

    res.json({ renderJobId: newJobId, message: 'Render retry queued' });
  } catch (err) { next(err); }
});

// ── POST /api/renders/scenes/:sceneId/regenerate ──────────────
// Re-queues a single scene for regeneration without re-running the whole render.
// Useful when one scene fails quality checks or the user wants a variation.
// Deducts 1 credit (same as video_std cost) from the workspace.
router.post('/scenes/:sceneId/regenerate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sceneId } = req.params;
    const workspaceId = req.user!.workspaceId!;
    const userId      = req.user!.userId;

    // Validate optional prompt override
    const bodySchema = z.object({
      promptOverride: z.string().max(2000).optional(),
      mood:           z.string().max(64).optional(),
    });
    const body = bodySchema.parse(req.body ?? {});

    // Load scene + its parent render job (must belong to this workspace)
    const scene = await db('scenes as s')
      .join('storyboards as sb', 'sb.id', 's.storyboard_id')
      .join('render_jobs as rj', 'rj.storyboard_id', 'sb.id')
      .where({ 's.id': sceneId, 'rj.workspace_id': workspaceId })
      .select(
        's.id',
        's.prompt',
        's.voiceover_script',
        's.role',
        's.position',
        's.storyboard_id',
        'rj.id as render_job_id',
        'rj.config',
        'rj.status as render_status',
      )
      .first();

    if (!scene) throw new AppError('Scene not found or access denied', 404);

    // Block regeneration on actively running jobs to avoid collisions
    if (['queued', 'processing', 'scene_rendering', 'mixing'].includes(scene.render_status)) {
      throw new AppError('Cannot regenerate a scene while its render job is active. Wait for it to complete or cancel it first.', 409);
    }

    // Mark scene as pending for re-render
    await db('scenes').where({ id: sceneId }).update({
      status:    'pending',
      video_url: null,
      updated_at: db.fn.now(),
    });

    // Merge prompt override into scene data
    const sceneData = {
      role:            scene.role,
      position:        scene.position,
      prompt:          body.promptOverride || scene.prompt,
      voiceoverScript: scene.voiceover_script,
    };

    // Parse existing render config and apply optional mood override
    const renderConfig = typeof scene.config === 'string'
      ? JSON.parse(scene.config)
      : (scene.config ?? {});

    if (body.mood) renderConfig.mood = body.mood;

    // Queue a single-scene render using the parent render's config
    const newJobId = await queueRender({
      workspaceId,
      userId,
      storyboardId: scene.storyboard_id,
      scenes:       [sceneData as any],
      config:       renderConfig,
      idempotencyKey: `scene-regen-${sceneId}-${Date.now()}`,
    });

    await auditLog({
      userId,
      workspaceId,
      action:     'scene.regenerate',
      resourceType: 'scene',
      resourceId: sceneId,
      metadata:   { newJobId, promptOverride: !!body.promptOverride },
    });

    res.json({
      renderJobId: newJobId,
      sceneId,
      message:     'Scene regeneration queued',
    });
  } catch (err) { next(err); }
});

// ── GET /api/renders/:id/download ─────────────────────────────
router.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await db('render_jobs')
      .where({ id: req.params.id, workspace_id: req.user!.workspaceId, status: 'complete' })
      .first();

    if (!job) throw new AppError('Completed render not found', 404);

    const formats = (typeof job.output_formats === 'string'
      ? JSON.parse(job.output_formats)
      : job.output_formats) || {};

    // Support both aspect ratio keys ('16:9') and placement keys ('youtube_instream')
    const requestedFormat = (req.query.format as string) || '16:9';

    // Check platform_exports first (placement-specific), then fall back to output_formats
    const platformExports = (typeof job.platform_exports === 'string'
      ? JSON.parse(job.platform_exports)
      : job.platform_exports) || {};

    const videoUrl = platformExports[requestedFormat]
      || formats[requestedFormat]
      || job.output_video_url;

    if (!videoUrl) throw new AppError('No video output available for this render', 404);

    // Extract S3 key from CDN URL
    const cdnBase = config.CDN_URL.replace(/\/$/, '');
    const s3Key = videoUrl.startsWith(cdnBase)
      ? videoUrl.slice(cdnBase.length + 1)
      : null;

    if (s3Key) {
      const signedUrl = await getPresignedDownloadUrl(s3Key, config.S3_BUCKET_RENDERS, 3600);
      res.json({ url: signedUrl, expiresIn: 3600, format: requestedFormat });
    } else {
      // Fallback: direct CDN URL
      res.json({ url: videoUrl, expiresIn: null, format: requestedFormat });
    }
  } catch (err) { next(err); }
});

export default router;
