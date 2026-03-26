/**
 * Auth Routes — Animation Studio
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimiter';
import {
  register, login, refreshSession, logout,
  verifyEmail, requestPasswordReset, resetPassword, googleAuth,
} from '../auth/authService';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { auditLog } from '../services/auditService';
import { config } from '../config/env';

const router = Router();

// ── Register ───────────────────────────────────────────────────
router.post('/register', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = z.object({
      email: z.string().email().toLowerCase().trim(),
      password: z.string().min(8).max(128),
      firstName: z.string().min(1).max(50).trim(),
      lastName: z.string().min(1).max(50).trim(),
      company: z.string().max(100).trim().optional(),
    }).parse(req.body);

    const result = await register(data);

    await auditLog({
      userId: result.user.id,
      action: 'user.registered',
      resourceType: 'user',
      resourceId: result.user.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.status(201).json({
      message: 'Account created. Please check your email to verify.',
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        workspaceId: result.workspaceId,
      },
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) { next(err); }
});

// ── Login ──────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = z.object({
      email: z.string().email().toLowerCase().trim(),
      password: z.string().min(1),
    }).parse(req.body);

    const result = await login({ ...data, ip: req.ip, userAgent: req.get('user-agent') });

    await auditLog({
      userId: result.user.id,
      action: 'user.login',
      resourceType: 'user',
      resourceId: result.user.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json(result);
  } catch (err) { next(err); }
});

// ── Refresh token ──────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
    const result = await refreshSession(refreshToken);
    res.json(result);
  } catch (err) { next(err); }
});

// ── Logout ─────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string().optional() }).parse(req.body);
    if (refreshToken) await logout(refreshToken, req.user!.userId);
    res.json({ message: 'Logged out' });
  } catch (err) { next(err); }
});

// ── Verify email ───────────────────────────────────────────────
router.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
    await verifyEmail(token);
    res.json({ message: 'Email verified successfully' });
  } catch (err) { next(err); }
});

// ── Forgot password ────────────────────────────────────────────
router.post('/forgot-password', passwordResetLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = z.object({ email: z.string().email().toLowerCase() }).parse(req.body);
    await requestPasswordReset(email);
    res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (err) { next(err); }
});

// ── Reset password ─────────────────────────────────────────────
router.post('/reset-password', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = z.object({
      token: z.string().min(1),
      newPassword: z.string().min(8).max(128),
    }).parse(req.body);
    await resetPassword(token, newPassword);
    res.json({ message: 'Password reset successfully. Please log in.' });
  } catch (err) { next(err); }
});

// ── Google OAuth ───────────────────────────────────────────────
router.get('/google', (req: Request, res: Response) => {
  if (!config.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' });
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: config.GOOGLE_CALLBACK_URL || `${config.API_URL}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, error } = req.query as { code?: string; error?: string };
    if (error) throw new AppError(`Google OAuth: ${error}`, 400);
    if (!code) throw new AppError('Missing authorization code', 400);
    const result = await googleAuth({ code });
    const params = new URLSearchParams({
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    });
    res.redirect(`${config.FRONTEND_URL}/auth/callback?${params}`);
  } catch (err) { next(err); }
});

// ── Get current user ───────────────────────────────────────────
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db('users as u')
      .leftJoin('workspace_members as wm', function() {
        this.on('wm.user_id', '=', 'u.id').andOn(db.raw("wm.is_primary = 'true'"));
      })
      .leftJoin('workspaces as w', 'w.id', 'wm.workspace_id')
      .where('u.id', req.user!.userId)
      .select(
        'u.id', 'u.email', 'u.first_name', 'u.last_name', 'u.role',
        'u.email_verified_at', 'u.avatar_url', 'u.company', 'u.timezone', 'u.created_at',
        'w.id as workspace_id', 'w.name as workspace_name', 'w.plan', 'w.slug',
        'w.credits_balance', 'w.credits_used_this_period',
        'w.subscription_status', 'wm.role as member_role',
      )
      .first();

    if (!row) throw new AppError('User not found', 404);

    res.json({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role,
      avatarUrl: row.avatar_url,
      company: row.company,
      timezone: row.timezone,
      emailVerified: !!row.email_verified_at,
      createdAt: row.created_at,
      workspace: row.workspace_id ? {
        id: row.workspace_id,
        name: row.workspace_name,
        slug: row.slug,
        plan: row.plan,
        creditsBalance: row.credits_balance,
        creditsUsedThisPeriod: row.credits_used_this_period,
        subscriptionStatus: row.subscription_status,
        memberRole: row.member_role,
      } : null,
    });
  } catch (err) { next(err); }
});

export default router;
