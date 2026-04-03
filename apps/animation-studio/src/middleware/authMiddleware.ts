import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../auth/authService';
import { db } from '../config/database';
import { AppError } from './errorHandler';
import crypto from 'crypto';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        workspaceId?: string;
        role: string;
        workspace?: any;
        memberRole?: string;
      };
      requestId?: string;
    }
  }
}

// ── Authenticate JWT ───────────────────────────────────────────
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('Authorization token required', 401));
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      role: payload.role,
    };
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') return next(new AppError('Token expired', 401));
    if (err.name === 'JsonWebTokenError') return next(new AppError('Invalid token', 401));
    next(new AppError('Authentication failed', 401));
  }
};

// ── Optional auth (for public routes that benefit from auth) ───
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();

  try {
    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token);
    req.user = {
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      role: payload.role,
    };
  } catch {}
  next();
};

// ── Require roles ──────────────────────────────────────────────
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
};

// ── Require workspace membership with role ─────────────────────
export const requireWorkspaceAccess = (minRole: 'viewer' | 'editor' | 'admin' | 'owner' = 'viewer') => {
  const roleHierarchy = { viewer: 0, editor: 1, admin: 2, owner: 3 };

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401));

    // Super admin bypass
    if (req.user.role === 'super_admin') return next();

    const workspaceId = req.params.workspaceId || req.user.workspaceId || req.headers['x-workspace-id'] as string;
    if (!workspaceId) return next(new AppError('Workspace ID required', 400));

    const member = await db('workspace_members as wm')
      .join('workspaces as w', 'w.id', 'wm.workspace_id')
      .where({ 'wm.workspace_id': workspaceId, 'wm.user_id': req.user.userId })
      .select('wm.role', 'w.*')
      .first();

    if (!member) return next(new AppError('Not a member of this workspace', 403));

    if (roleHierarchy[member.role as keyof typeof roleHierarchy] < roleHierarchy[minRole]) {
      return next(new AppError(`Requires ${minRole} role or higher`, 403));
    }

    req.user.workspaceId = workspaceId;
    req.user.workspace = member;
    req.user.memberRole = member.role;
    next();
  };
};

// ── API Key auth ───────────────────────────────────────────────
export const authenticateApiKey = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) return next(new AppError('API key required', 401));

  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const key = await db('api_keys as ak')
    .join('workspaces as w', 'w.id', 'ak.workspace_id')
    .where({ 'ak.key_hash': keyHash, 'ak.revoked': false })
    .where(q => q.whereNull('ak.expires_at').orWhere('ak.expires_at', '>', new Date()))
    .select('ak.*', 'w.plan', 'w.subscription_status')
    .first();

  if (!key) return next(new AppError('Invalid API key', 401));

  // Update usage stats (async, don't await)
  db('api_keys').where({ id: key.id })
    .update({ last_used_at: new Date(), requests_count: db.raw('requests_count + 1') })
    .catch(console.error);

  req.user = {
    userId: key.workspace_id, // use workspace as identity for API keys
    workspaceId: key.workspace_id,
    role: 'api_client',
  };

  next();
};
