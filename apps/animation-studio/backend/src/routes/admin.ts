/**
 * Admin API — Animation Studio
 * 
 * Requires admin or super_admin role.
 * Provides: dashboard stats, user management, credit adjustments,
 * queue diagnostics, force-fail/requeue tools, cost monitoring.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/authMiddleware';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { auditLog } from '../services/auditService';
import { refundStudioCredits as refundCredits } from '../billing/sharedCreditAdapter';

const router = Router();
router.use(authenticate, requireRole('admin', 'super_admin'));

// ── GET /api/admin/dashboard ───────────────────────────────────
router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400 * 1000);

    const [
      usersTotal, workspacesTotal, rendersTotal, activeSubscriptions,
      creditsConsumed30d, rendersFailed30d, rendersComplete30d,
      marginRiskyJobs, recentRenders, planDist, topWorkspaces,
    ] = await Promise.all([
      db('users').where({ status: 'active' }).count('* as n').first(),
      db('workspaces').count('* as n').first(),
      db('render_jobs').count('* as n').first(),
      db('workspaces').where({ subscription_status: 'active' }).count('* as n').first(),
      db('credit_transactions').where({ type: 'debit' }).where('created_at', '>=', d30)
        .sum('amount as total').first(),
      db('render_jobs').where({ status: 'failed' }).where('created_at', '>=', d30).count('* as n').first(),
      db('render_jobs').where({ status: 'complete' }).where('created_at', '>=', d30).count('* as n').first(),
      // Margin-risky: GPU cost > revenue * 1.4
      db('render_jobs')
        .whereRaw('gpu_cost_usd > revenue_usd * 1.4')
        .whereNotNull('gpu_cost_usd')
        .where('created_at', '>=', d30)
        .count('* as n').first(),
      db('render_jobs').orderBy('created_at', 'desc').limit(10)
        .select('id', 'status', 'workspace_id', 'credits_charged', 'gpu_cost_usd', 'created_at', 'error_message'),
      db('workspaces').groupBy('plan').select('plan', db.raw('count(*) as count')),
      db('workspaces as w')
        .join('render_jobs as rj', 'rj.workspace_id', 'w.id')
        .where('rj.created_at', '>=', d30)
        .groupBy('w.id', 'w.name', 'w.plan')
        .select('w.id', 'w.name', 'w.plan', db.raw('count(rj.id) as render_count'))
        .orderBy('render_count', 'desc')
        .limit(10),
    ]);

    res.json({
      stats: {
        usersActive: Number((usersTotal as any)?.n || 0),
        workspaces: Number((workspacesTotal as any)?.n || 0),
        rendersTotal: Number((rendersTotal as any)?.n || 0),
        activeSubscriptions: Number((activeSubscriptions as any)?.n || 0),
        creditsConsumed30d: Number((creditsConsumed30d as any)?.total || 0),
        rendersFailed30d: Number((rendersFailed30d as any)?.n || 0),
        rendersComplete30d: Number((rendersComplete30d as any)?.n || 0),
        marginRiskyJobs30d: Number((marginRiskyJobs as any)?.n || 0),
      },
      recentRenders,
      planDistribution: planDist,
      topWorkspaces,
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/users ───────────────────────────────────────
router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, status, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let q = db('users').select(
      'id', 'email', 'first_name', 'last_name', 'company',
      'role', 'status', 'created_at', 'last_login_at'
    );
    if (search) q = q.where('email', 'ilike', `%${search}%`);
    if (status) q = q.where({ status });

    const [users, [{ count }]] = await Promise.all([
      q.clone().orderBy('created_at', 'desc').limit(Number(limit)).offset(offset),
      q.clone().count('* as count'),
    ]);

    res.json({ users, total: Number(count), page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/users/:id ─────────────────────────────────
router.patch('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, role } = z.object({
      status: z.enum(['active', 'suspended', 'deleted']).optional(),
      role: z.enum(['user', 'admin', 'super_admin']).optional(),
    }).parse(req.body);

    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (role && req.user!.role === 'super_admin') updates.role = role;

    if (!Object.keys(updates).length) throw new AppError('Nothing to update', 400);

    const before = await db('users').where({ id: req.params.id }).first();
    await db('users').where({ id: req.params.id }).update(updates);

    await auditLog({
      userId: req.user!.userId,
      action: 'admin.user_updated',
      resourceType: 'user',
      resourceId: req.params.id,
      before,
      after: updates,
    });

    res.json({ message: 'User updated' });
  } catch (err) { next(err); }
});

// ── GET /api/admin/workspaces ──────────────────────────────────
router.get('/workspaces', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, plan, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let q = db('workspaces').select(
      'id', 'name', 'slug', 'plan', 'credits_balance', 'credits_used_this_period',
      'subscription_status', 'storage_used_bytes', 'stripe_customer_id', 'created_at'
    );
    if (search) q = q.where('name', 'ilike', `%${search}%`);
    if (plan) q = q.where({ plan });

    const [workspaces, [{ count }]] = await Promise.all([
      q.clone().orderBy('created_at', 'desc').limit(Number(limit)).offset(offset),
      q.clone().count('* as count'),
    ]);

    res.json({ workspaces, total: Number(count) });
  } catch (err) { next(err); }
});

// ── POST /api/admin/credits/adjust ────────────────────────────
router.post('/credits/adjust', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, amount, reason } = z.object({
      workspaceId: z.string().uuid(),
      amount: z.number().int().min(-10000).max(10000),
      reason: z.string().min(5).max(500),
    }).parse(req.body);

    const workspace = await db('workspaces').where({ id: workspaceId }).first();
    if (!workspace) throw new AppError('Workspace not found', 404);

    const newBalance = Math.max(0, workspace.credits_balance + amount);

    await db.transaction(async (trx) => {
      await trx('workspaces').where({ id: workspaceId }).update({ credits_balance: newBalance });
      await trx('credit_transactions').insert({
        workspace_id: workspaceId,
        type: 'adjustment',
        amount,
        balance_after: newBalance,
        description: `Admin adjustment by ${req.user!.userId}: ${reason}`,
      });
    });

    await auditLog({
      userId: req.user!.userId,
      workspaceId,
      action: 'admin.credits_adjusted',
      after: { amount, newBalance, reason },
    });

    res.json({ message: 'Credits adjusted', newBalance, adjusted: amount });
  } catch (err) { next(err); }
});

// ── GET /api/admin/render-queue ────────────────────────────────
router.get('/render-queue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { renderQueue } = await import('../jobs/renderQueue');
    const [waiting, active, completed, failed, delayed, deadLetters] = await Promise.all([
      renderQueue.getWaitingCount(),
      renderQueue.getActiveCount(),
      renderQueue.getCompletedCount(),
      renderQueue.getFailedCount(),
      renderQueue.getDelayedCount(),
      db('render_jobs').where({ status: 'dead_letter' }).count('* as n').first(),
    ]);

    const activeJobs = await renderQueue.getActive();
    const failedJobs = await renderQueue.getFailed(0, 10);

    res.json({
      counts: { waiting, active, completed, failed, delayed, deadLetters: Number((deadLetters as any)?.n || 0) },
      activeJobs: activeJobs.map(j => ({
        id: j.id, progress: j._progress, attemptsMade: j.attemptsMade,
        data: { renderJobId: j.data.renderJobId, workspaceId: j.data.workspaceId },
      })),
      recentFailures: failedJobs.map(j => ({
        id: j.id, attemptsMade: j.attemptsMade,
        data: { renderJobId: j.data.renderJobId },
        failedReason: j.failedReason,
      })),
    });
  } catch (err) { next(err); }
});

// ── POST /api/admin/renders/:id/force-fail ────────────────────
router.post('/renders/:id/force-fail', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await db('render_jobs').where({ id: req.params.id }).first();
    if (!job) throw new AppError('Render job not found', 404);

    const { reason = 'Admin force-failed' } = z.object({
      reason: z.string().max(500).optional(),
    }).parse(req.body);

    // Remove from Bull if present
    if (job.bull_job_id) {
      try {
        const { renderQueue } = await import('../jobs/renderQueue');
        const bullJob = await renderQueue.getJob(job.bull_job_id);
        if (bullJob) await bullJob.remove();
      } catch { /* best-effort */ }
    }

    await db('render_jobs').where({ id: job.id }).update({
      status: 'failed',
      error_message: `[Admin] ${reason}`,
    });

    if (job.credits_charged > 0) {
      await refundCredits({
        workspaceId: job.workspace_id,
        amount: job.credits_charged,
        renderJobId: job.id,
        reason: `Admin force-fail: ${reason}`,
      });
    }

    await auditLog({
      userId: req.user!.userId,
      workspaceId: job.workspace_id,
      action: 'admin.render_force_failed',
      resourceType: 'render_job',
      resourceId: job.id,
      after: { reason },
    });

    res.json({ message: 'Render force-failed and credits refunded' });
  } catch (err) { next(err); }
});

// ── GET /api/admin/audit-logs ──────────────────────────────────
router.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId, action, page = 1, limit = 100 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let q = db('audit_logs').orderBy('created_at', 'desc');
    if (workspaceId) q = q.where({ workspace_id: workspaceId });
    if (userId) q = q.where({ user_id: userId });
    if (action) q = q.where('action', 'ilike', `%${action}%`);

    const [logs, [{ count }]] = await Promise.all([
      q.clone().limit(Number(limit)).offset(offset),
      q.clone().count('* as count'),
    ]);

    res.json({ logs, total: Number(count) });
  } catch (err) { next(err); }
});

// ── GET /api/admin/cost-report ─────────────────────────────────
router.get('/cost-report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query.days as string || '30', 10);
    const since = new Date(Date.now() - days * 86400 * 1000);

    const [gpuCosts, creditRevenue, marginByMode] = await Promise.all([
      db('render_jobs').where({ status: 'complete' }).where('created_at', '>=', since)
        .select(
          db.raw('sum(gpu_cost_usd) as total_gpu_cost'),
          db.raw('sum(total_cost_usd) as total_cost'),
          db.raw('sum(revenue_usd) as total_revenue'),
          db.raw('count(*) as render_count'),
        ).first(),
      db('credit_transactions').where({ type: 'debit' }).where('created_at', '>=', since)
        .sum('amount as credits_debited').first(),
      db('render_jobs').where({ status: 'complete' }).where('created_at', '>=', since)
        .select(
          db.raw("config->>'renderMode' as render_mode"),
          db.raw('count(*) as count'),
          db.raw('sum(gpu_cost_usd) as gpu_cost'),
          db.raw('sum(revenue_usd) as revenue'),
          db.raw('avg(gpu_cost_usd / NULLIF(revenue_usd, 0)) as cost_ratio'),
        )
        .groupByRaw("config->>'renderMode'"),
    ]);

    res.json({ period: `${days}d`, gpuCosts, creditRevenue, marginByMode });
  } catch (err) { next(err); }
});

export default router;
