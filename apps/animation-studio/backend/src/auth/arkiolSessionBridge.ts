// apps/animation-studio/backend/src/auth/arkiolSessionBridge.ts
// Allows Animation Studio API to validate a Arkiol NextAuth session token.
// Studio API calls must include "X-Arkiol-Session" header (the NextAuth JWT).
// This bridge verifies the JWT against the same Arkiol DB — single auth system.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config/env';

// NEXTAUTH_SECRET is required for validating Arkiol NextAuth JWTs.
// Read from the validated config object — never process.env directly.
// Falls back to empty string which will cause jwt.verify to throw (safe failure).
const ARKIOL_JWT_SECRET = config.NEXTAUTH_SECRET ?? '';

export interface ArkiolSession {
  id: string;
  email: string;
  orgId: string | null;
  role: string;
  plan: string;
  // Feature flags loaded from Org
  canUseStudioVideo: boolean;
}

// Middleware: verifies Arkiol session and attaches it to req.arkiol
export async function requireArkiolSession(
  req: Request & { arkiol?: ArkiolSession },
  res: Response,
  next: NextFunction,
) {
  const header = req.headers['x-arkiol-session'] as string | undefined;
  if (!header) {
    return next(new AppError('Missing Arkiol session', 401));
  }

  let token: any;
  try {
    // NextAuth JWTs are signed with NEXTAUTH_SECRET
    token = jwt.verify(header, ARKIOL_JWT_SECRET);
  } catch {
    return next(new AppError('Invalid Arkiol session', 401));
  }

  // Load org from shared DB
  const userId = token.id ?? token.sub;
  if (!userId) return next(new AppError('Invalid token payload', 401));

  const userRow = await db('User').where({ id: userId }).first();
  if (!userRow) return next(new AppError('User not found', 401));

  let orgMeta: any = {};
  if (userRow.orgId) {
    orgMeta = await db('Org').where({ id: userRow.orgId }).select('id', 'plan', 'canUseStudioVideo', 'creditBalance', 'subscriptionStatus').first() ?? {};
  }

  // Gate: only Pro/Studio orgs can use Animation Studio
  if (!orgMeta.canUseStudioVideo) {
    return next(new AppError('Animation Studio requires Pro or Studio plan', 403));
  }

  req.arkiol = {
    id:               userRow.id,
    email:            userRow.email,
    orgId:            userRow.orgId,
    role:             userRow.role,
    plan:             orgMeta.plan ?? 'FREE',
    canUseStudioVideo: !!orgMeta.canUseStudioVideo,
  };

  next();
}
