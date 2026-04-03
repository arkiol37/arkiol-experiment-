import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { config } from '../config/env';

// Key generators
const workspaceKey = (req: Request) => req.user?.workspaceId || req.ip || 'unknown';
const userKey = (req: Request) => req.user?.userId || req.ip || 'unknown';

export const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
});

// Auth endpoints: strict 10/15min per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again in 15 minutes.', code: 'AUTH_RATE_LIMITED' },
});

// Render submissions: 10/hour per workspace (plan-based enforcement in queue layer)
export const renderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: config.RENDER_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: workspaceKey,
  message: { error: 'Render rate limit exceeded. Maximum 10 renders per hour.', code: 'RENDER_RATE_LIMITED' },
});

// Asset uploads: 50/hour per workspace
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: workspaceKey,
  message: { error: 'Upload rate limit exceeded. Maximum 50 uploads per hour.', code: 'UPLOAD_RATE_LIMITED' },
});

// Password reset: 3/hour per IP
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts.', code: 'RESET_RATE_LIMITED' },
});

// API keys: 600/min per key
export const apiKeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-api-key'] as string || req.ip || 'unknown',
  message: { error: 'API rate limit exceeded.', code: 'API_RATE_LIMITED' },
});
