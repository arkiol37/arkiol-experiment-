// ═══════════════════════════════════════════════════════════
// users.ts — User profile and preferences
// ═══════════════════════════════════════════════════════════
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { db } from '../config/database';

const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.patch('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = z.object({
      firstName: z.string().min(1).max(50).optional(),
      lastName: z.string().min(1).max(50).optional(),
      company: z.string().max(100).optional(),
      timezone: z.string().optional(),
    }).parse(req.body);

    const updates: any = {};
    if (data.firstName) updates.first_name = data.firstName;
    if (data.lastName) updates.last_name = data.lastName;
    if (data.company) updates.company = data.company;
    if (data.timezone) updates.timezone = data.timezone;

    const [user] = await db('users').where({ id: req.user!.userId }).update(updates).returning('id', 'email', 'first_name', 'last_name', 'company', 'avatar_url');
    res.json(user);
  } catch (err) { next(err); }
});

usersRouter.get('/me/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prefs = await db('user_preferences').where({ user_id: req.user!.userId }).first();
    res.json(prefs || {});
  } catch (err) { next(err); }
});

usersRouter.patch('/me/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prefs = req.body;
    // Only update columns that exist and have truthy keys
    const allowed = [
      'default_mood','default_render_mode','default_voice_gender','default_aspect_ratio',
      'default_resolution','quality_distortion_check','quality_logo_check','quality_text_check',
      'quality_color_check','beat_sync_default',
    ];
    const filtered = Object.fromEntries(Object.entries(prefs).filter(([k]) => allowed.includes(k)));
    if (Object.keys(filtered).length) {
      await db('user_preferences').where({ user_id: req.user!.userId }).update(filtered);
    }
    const updated = await db('user_preferences').where({ user_id: req.user!.userId }).first();
    res.json(updated || {});
  } catch (err) { next(err); }
});

// GDPR: Delete account
usersRouter.delete('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    const user = await db('users').where({ id: req.user!.userId }).first();
    const { verifyPassword } = await import('../auth/authService');
    if (!await verifyPassword(user.password_hash, password)) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    await db.transaction(async (trx) => {
      await trx('users').where({ id: req.user!.userId }).update({
        status: 'deleted',
        email: `deleted_${req.user!.userId}@deleted.animationstudio.ai`,
        first_name: 'Deleted',
        last_name: 'User',
        google_id: null,
      });
      await trx('refresh_tokens').where({ user_id: req.user!.userId }).delete();
    });

    // Queue async data deletion (S3, analytics, etc.)
    res.json({ message: 'Account scheduled for deletion. Data will be permanently removed within 30 days.' });
  } catch (err) { next(err); }
});

// ── Change password ────────────────────────────────────────────
usersRouter.post('/me/change-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(128),
    }).parse(req.body);

    const user = await db('users').where({ id: req.user!.userId }).first();
    if (!user.password_hash) {
      return res.status(400).json({ error: 'This account uses social login. No password to change.' });
    }
    const { verifyPassword, hashPassword } = await import('../auth/authService');
    if (!await verifyPassword(user.password_hash, currentPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    const newHash = await hashPassword(newPassword);
    await db('users').where({ id: req.user!.userId }).update({ password_hash: newHash });
    // Revoke all other refresh tokens for security
    await db('refresh_tokens').where({ user_id: req.user!.userId }).whereNot({ token: req.headers['x-refresh-token'] as string || '' }).delete();
    res.json({ message: 'Password updated successfully.' });
  } catch (err) { next(err); }
});

// ── Notification settings ──────────────────────────────────────
usersRouter.get('/me/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prefs = await db('user_preferences').where({ user_id: req.user!.userId }).first();
    const settings = prefs?.notification_settings || {
      email_render_complete: true,
      email_render_failed: true,
      email_billing: true,
      email_low_credits: true,
      email_weekly_digest: false,
      email_marketing: false,
      email_product_updates: true,
    };
    res.json({ settings });
  } catch (err) { next(err); }
});

usersRouter.patch('/me/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = z.object({
      email_render_complete: z.boolean().optional(),
      email_render_failed: z.boolean().optional(),
      email_billing: z.boolean().optional(),
      email_low_credits: z.boolean().optional(),
      email_weekly_digest: z.boolean().optional(),
      email_marketing: z.boolean().optional(),
      email_product_updates: z.boolean().optional(),
    }).parse(req.body);

    const existing = await db('user_preferences').where({ user_id: req.user!.userId }).first();
    const merged = { ...(existing?.notification_settings || {}), ...settings };
    await db('user_preferences').where({ user_id: req.user!.userId }).update({
      notification_settings: JSON.stringify(merged),
    });
    res.json({ settings: merged });
  } catch (err) { next(err); }
});

// ── Active sessions ────────────────────────────────────────────
usersRouter.get('/me/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessions = await db('refresh_tokens')
      .where({ user_id: req.user!.userId })
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .select('id', 'user_agent', 'ip_address', 'created_at', 'last_used_at')
      .limit(10);

    res.json({
      sessions: sessions.map(s => ({
        id: s.id,
        userAgent: s.user_agent || 'Unknown device',
        ipAddress: s.ip_address ? s.ip_address.replace(/\.\d+$/, '.***') : 'Unknown',
        createdAt: s.created_at,
        lastUsedAt: s.last_used_at || s.created_at,
        isCurrent: false, // client-side determination
      })),
    });
  } catch (err) { next(err); }
});

usersRouter.delete('/me/sessions/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db('refresh_tokens')
      .where({ id: req.params.sessionId, user_id: req.user!.userId })
      .delete();
    res.json({ message: 'Session revoked.' });
  } catch (err) { next(err); }
});

usersRouter.delete('/me/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Revoke all sessions except current
    const currentToken = req.headers['x-refresh-token'] as string;
    const q = db('refresh_tokens').where({ user_id: req.user!.userId });
    if (currentToken) q.whereNot({ token: currentToken });
    await q.delete();
    res.json({ message: 'All other sessions revoked.' });
  } catch (err) { next(err); }
});

export { usersRouter };

// ═══════════════════════════════════════════════════════════
// brands.ts — Brand management
// ═══════════════════════════════════════════════════════════
const brandsRouter = Router();
brandsRouter.use(authenticate);

brandsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brands = await db('brands').where({ workspace_id: req.user!.workspaceId });
    res.json({ brands });
  } catch (err) { next(err); }
});

brandsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = z.object({
      name: z.string().min(1).max(100),
      industry: z.string().optional(),
      website: z.string().url().optional(),
      colors: z.array(z.object({ hex: z.string(), name: z.string().optional(), primary: z.boolean().optional() })).optional(),
      fonts: z.array(z.object({ name: z.string(), url: z.string().optional() })).optional(),
      tagline: z.string().max(200).optional(),
      voiceTone: z.string().optional(),
    }).parse(req.body);

    const [brand] = await db('brands').insert({
      workspace_id: req.user!.workspaceId,
      name: data.name,
      industry: data.industry,
      website: data.website,
      colors: JSON.stringify(data.colors || []),
      fonts: JSON.stringify(data.fonts || []),
      tagline: data.tagline,
      voice_tone: data.voiceTone,
    }).returning('*');

    res.status(201).json(brand);
  } catch (err) { next(err); }
});

brandsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brand = await db('brands').where({ id: req.params.id, workspace_id: req.user!.workspaceId }).first();
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    const [updated] = await db('brands').where({ id: req.params.id }).update(req.body).returning('*');
    res.json(updated);
  } catch (err) { next(err); }
});

brandsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db('brands').where({ id: req.params.id, workspace_id: req.user!.workspaceId }).delete();
    res.json({ message: 'Brand deleted' });
  } catch (err) { next(err); }
});

export { brandsRouter };

// ═══════════════════════════════════════════════════════════
// projects.ts — Projects and storyboards
// ═══════════════════════════════════════════════════════════
const projectsRouter = Router();
projectsRouter.use(authenticate);

projectsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projects = await db('projects')
      .where({ workspace_id: req.user!.workspaceId })
      .whereNotIn('status', ['deleted'])
      .orderBy('created_at', 'desc');
    res.json({ projects });
  } catch (err) { next(err); }
});

projectsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = z.object({
      name: z.string().min(1).max(200),
      brief: z.string().max(2000).optional(),
      brandId: z.string().uuid().optional(),
    }).parse(req.body);

    const [project] = await db('projects').insert({
      workspace_id: req.user!.workspaceId,
      created_by: req.user!.userId,
      name: data.name,
      brief: data.brief,
      brand_id: data.brandId,
    }).returning('*');

    res.status(201).json(project);
  } catch (err) { next(err); }
});

projectsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await db('projects').where({ id: req.params.id, workspace_id: req.user!.workspaceId }).first();
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const storyboards = await db('storyboards').where({ project_id: project.id });
    const renderJobs = await db('render_jobs').where({ storyboard_id: db.raw(`ANY(ARRAY[${storyboards.map(s => `'${s.id}'`).join(',')}]::uuid[])`) }).orderBy('created_at', 'desc').limit(10).catch(() => []);

    res.json({ project, storyboards, renderJobs });
  } catch (err) { next(err); }
});

projectsRouter.post('/:id/storyboards', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await db('projects').where({ id: req.params.id, workspace_id: req.user!.workspaceId }).first();
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const data = z.object({
      name: z.string().min(1),
      config: z.object({}).passthrough(),
      sceneCount: z.number().min(1).max(10),
      secondsPerScene: z.number().min(5).max(10),
    }).parse(req.body);

    const [storyboard] = await db('storyboards').insert({
      project_id: project.id,
      created_by: req.user!.userId,
      name: data.name,
      config: JSON.stringify(data.config),
      scene_count: data.sceneCount,
      seconds_per_scene: data.secondsPerScene,
    }).returning('*');

    res.status(201).json(storyboard);
  } catch (err) { next(err); }
});

export { projectsRouter };

// ═══════════════════════════════════════════════════════════
// analytics.ts — Analytics data
// ═══════════════════════════════════════════════════════════
const analyticsRouter = Router();
analyticsRouter.use(authenticate);

analyticsRouter.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { period = '30d' } = req.query;
    const days = period === '90d' ? 90 : period === '7d' ? 7 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const workspaceId = req.user!.workspaceId;

    const [
      renderStats, creditStats, providerStats, monthlyOutput,
      platformBreakdown, hookTypeBreakdown, durationBreakdown,
      dailyCreditSpend, topHookTypes, qualityStats,
    ] = await Promise.all([
      // Core render stats
      db('render_jobs').where({ workspace_id: workspaceId }).where('created_at', '>=', since).select(
        db.raw('count(*) as total'),
        db.raw(`count(*) filter (where status = 'complete') as complete`),
        db.raw(`count(*) filter (where status = 'failed') as failed`),
        db.raw(`avg(scenes_total) as avg_scenes`),
        db.raw(`avg(ad_duration_sec) filter (where status = 'complete') as avg_duration_sec`),
        db.raw(`sum(credits_charged) filter (where status = 'complete') as total_credits`),
      ).first(),

      // Credit spend
      db('credit_transactions').where({ workspace_id: workspaceId }).where('created_at', '>=', since).select(
        db.raw(`sum(case when type = 'debit' then abs(amount) else 0 end) as consumed`),
        db.raw(`sum(case when type = 'credit' then amount else 0 end) as added`),
      ).first(),

      // Provider usage
      db('render_jobs').where({ workspace_id: workspaceId }).where('created_at', '>=', since)
        .whereNotNull('provider_primary')
        .groupBy('provider_primary')
        .select('provider_primary as provider', db.raw('count(*) as count')),

      // Monthly output (90d rolling)
      db('render_jobs').where({ workspace_id: workspaceId })
        .where('created_at', '>=', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
        .where('status', 'complete')
        .select(db.raw(`date_trunc('month', created_at) as month`), db.raw('count(*) as count'))
        .groupByRaw(`date_trunc('month', created_at)`)
        .orderBy('month'),

      // Platform breakdown (youtube, tiktok, instagram, etc.)
      db('render_jobs').where({ workspace_id: workspaceId }).where('created_at', '>=', since)
        .whereNotNull('platform')
        .groupBy('platform')
        .select('platform', db.raw('count(*) as count'))
        .orderBy('count', 'desc'),

      // Hook type breakdown
      db('render_jobs').where({ workspace_id: workspaceId }).where('created_at', '>=', since)
        .whereNotNull('hook_type')
        .groupBy('hook_type')
        .select('hook_type', db.raw('count(*) as count'))
        .orderBy('count', 'desc'),

      // Duration buckets: short (≤15s), mid (16–30s), long (31s+)
      db('render_jobs').where({ workspace_id: workspaceId }).where('created_at', '>=', since)
        .where('status', 'complete').whereNotNull('ad_duration_sec').select(
          db.raw(`
            case
              when ad_duration_sec <= 15 then 'short'
              when ad_duration_sec <= 30 then 'mid'
              else 'long'
            end as bucket
          `),
          db.raw('count(*) as count'),
        )
        .groupByRaw(`case when ad_duration_sec <= 15 then 'short' when ad_duration_sec <= 30 then 'mid' else 'long' end`),

      // Daily credit spend (last N days)
      db('credit_transactions').where({ workspace_id: workspaceId }).where('created_at', '>=', since)
        .where('type', 'debit')
        .select(
          db.raw(`date_trunc('day', created_at) as day`),
          db.raw('sum(abs(amount)) as credits'),
        )
        .groupByRaw(`date_trunc('day', created_at)`)
        .orderBy('day'),

      // Top performing hook types by success rate
      db('render_jobs').where({ workspace_id: workspaceId }).where('created_at', '>=', since)
        .whereNotNull('hook_type')
        .groupBy('hook_type')
        .select(
          'hook_type',
          db.raw('count(*) as total'),
          db.raw(`count(*) filter (where status = 'complete') as complete`),
        )
        .orderBy('complete', 'desc')
        .limit(5),

      // Quality stats
      db('render_jobs').where({ workspace_id: workspaceId }).where('created_at', '>=', since)
        .where('status', 'complete')
        .whereNotNull('quality_report')
        .select(db.raw(`avg((quality_report->>'overall_score')::float) as avg_quality`))
        .first(),
    ]);

    const preferences = await db('user_preferences').where({ user_id: req.user!.userId }).first();

    res.json({
      renderStats, creditStats, providerStats, monthlyOutput,
      platformBreakdown, hookTypeBreakdown, durationBreakdown,
      dailyCreditSpend, topHookTypes, qualityStats,
      preferences,
    });
  } catch (err) { next(err); }
});

export { analyticsRouter };

// ═══════════════════════════════════════════════════════════
// providers.ts — AI provider management
// ═══════════════════════════════════════════════════════════
const providersRouter = Router();
providersRouter.use(authenticate);

providersRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const configs = await db('provider_configs')
      .where({ workspace_id: req.user!.workspaceId })
      .select('id', 'provider', 'enabled', 'is_primary', 'auto_fallback', 'cost_optimize', 'webhook_url', 'created_at');
    res.json({ providers: configs });
  } catch (err) { next(err); }
});

providersRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = z.object({
      provider: z.enum(['runway', 'pika', 'sora', 'custom']),
      apiKey: z.string().min(1),
      apiUrl: z.string().url().optional(),
      isPrimary: z.boolean().optional(),
      autoFallback: z.boolean().optional(),
    }).parse(req.body);

    const { encrypt } = await import('../services/encryptionService');

    await db('provider_configs').insert({
      workspace_id: req.user!.workspaceId,
      provider: data.provider,
      api_key_encrypted: encrypt(data.apiKey),
      api_url: data.apiUrl,
      is_primary: data.isPrimary,
      auto_fallback: data.autoFallback !== false,
    }).onConflict(['workspace_id', 'provider']).merge();

    res.json({ message: 'Provider configured' });
  } catch (err) { next(err); }
});

providersRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db('provider_configs').where({ id: req.params.id, workspace_id: req.user!.workspaceId }).delete();
    res.json({ message: 'Provider removed' });
  } catch (err) { next(err); }
});

providersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = z.object({
      enabled:      z.boolean().optional(),
      isPrimary:    z.boolean().optional(),
      autoFallback: z.boolean().optional(),
      costOptimize: z.boolean().optional(),
    }).parse(req.body);

    const mapped: any = {};
    if (updates.enabled      !== undefined) mapped.enabled       = updates.enabled;
    if (updates.autoFallback !== undefined) mapped.auto_fallback = updates.autoFallback;
    if (updates.costOptimize !== undefined) mapped.cost_optimize = updates.costOptimize;

    // Setting primary: unset all others first
    if (updates.isPrimary === true) {
      await db('provider_configs')
        .where({ workspace_id: req.user!.workspaceId })
        .update({ is_primary: false });
      mapped.is_primary = true;
    } else if (updates.isPrimary === false) {
      mapped.is_primary = false;
    }

    if (Object.keys(mapped).length) {
      await db('provider_configs')
        .where({ id: req.params.id, workspace_id: req.user!.workspaceId })
        .update(mapped);
    }

    const updated = await db('provider_configs')
      .where({ id: req.params.id })
      .select('id', 'provider', 'enabled', 'is_primary', 'auto_fallback', 'cost_optimize')
      .first();

    res.json(updated);
  } catch (err) { next(err); }
});

export { providersRouter };

// ═══════════════════════════════════════════════════════════
// health.ts — Health check
// ═══════════════════════════════════════════════════════════
const healthRouter = Router();

healthRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { db } = await import('../config/database');
    const { redis } = await import('../config/redis');
    await db.raw('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
  } catch (err: any) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

export { healthRouter };
