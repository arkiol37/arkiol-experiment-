// apps/animation-studio/backend/src/auth/arkiolSessionBridge.ts
// Allows Animation Studio API to validate a Arkiol NextAuth session token.
// Studio API calls must include "X-Arkiol-Session" header (the NextAuth JWT).
// This bridge verifies the JWT against the same Arkiol DB — single auth system.
//
// FOUNDER BYPASS:
//   The founder (FOUNDER_EMAIL env var) and SUPER_ADMIN role always have full
//   Animation Studio access, even if the org's canUseStudioVideo flag has not
//   yet been synced by a Stripe/Paddle webhook. This mirrors ownerAccess.ts and
//   /api/billing in the core app — single consistent access model across both apps.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config/env';

// NEXTAUTH_SECRET is required for validating Arkiol NextAuth JWTs.
// Read from the validated config object — never process.env directly.
// Falls back to empty string which will cause jwt.verify to throw (safe failure).
const ARKIOL_JWT_SECRET = config.NEXTAUTH_SECRET ?? '';

// ── Founder / owner helpers — mirrors ownerAccess.ts in the core app ─────────
// Kept local to this file to avoid a cross-app import dependency.
function getFounderEmail(): string | null {
  const v = ((config as any).FOUNDER_EMAIL ?? process.env.FOUNDER_EMAIL ?? '')
    .toLowerCase()
    .trim();
  return v.length > 0 ? v : null;
}

function isFounderEmail(email: string | undefined | null): boolean {
  const founder = getFounderEmail();
  if (!founder || !email) return false;
  return email.toLowerCase().trim() === founder;
}

function isOwnerRole(role: string | undefined | null): boolean {
  return role === 'SUPER_ADMIN';
}

export interface ArkiolSession {
  id: string;
  email: string;
  orgId: string | null;
  role: string;
  plan: string;
  /** true for Creator, Pro, Studio plans and for the founder/SUPER_ADMIN bypass */
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

  // Load user from shared DB
  const userId = token.id ?? token.sub;
  if (!userId) return next(new AppError('Invalid token payload', 401));

  const userRow = await db('User').where({ id: userId }).first();
  if (!userRow) return next(new AppError('User not found', 401));

  const userEmail = (userRow.email ?? '').toLowerCase().trim();

  // ── Founder / SUPER_ADMIN bypass ────────────────────────────────────────────
  // The founder must always have access regardless of the org's canUseStudioVideo
  // flag — covers the window before first webhook fires and manual testing.
  if (isFounderEmail(userEmail) || isOwnerRole(userRow.role)) {
    req.arkiol = {
      id:                userRow.id,
      email:             userEmail,
      orgId:             userRow.orgId ?? null,
      role:              'SUPER_ADMIN',
      plan:              'STUDIO',
      canUseStudioVideo: true,
    };
    return next();
  }

  // ── Normal user: load org and check canUseStudioVideo ───────────────────────
  let orgMeta: any = {};
  if (userRow.orgId) {
    orgMeta = await db('Org')
      .where({ id: userRow.orgId })
      .select('id', 'plan', 'canUseStudioVideo', 'creditBalance', 'subscriptionStatus')
      .first() ?? {};
  }

  // Gate: Creator, Pro, and Studio orgs have canUseStudioVideo=true (set by billing webhooks).
  // Free plan has canUseStudioVideo=false — teaser only (1 watermarked Normal Ad/day via frontend).
  if (!orgMeta.canUseStudioVideo) {
    return next(new AppError(
      'Animation Studio requires a Creator, Pro, or Studio plan. Upgrade to unlock full video generation.',
      403,
    ));
  }

  req.arkiol = {
    id:                userRow.id,
    email:             userEmail,
    orgId:             userRow.orgId ?? null,
    role:              userRow.role,
    plan:              orgMeta.plan ?? 'FREE',
    canUseStudioVideo: true,
  };

  next();
}
