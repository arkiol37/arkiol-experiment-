import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../config/database';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { auditLog } from '../services/auditService';
import { sendEmail } from '../services/emailService';

const googleClient = new OAuth2Client(config.GOOGLE_CLIENT_ID);

// ── JWT ────────────────────────────────────────────────────────
export function signAccessToken(payload: { userId: string; workspaceId?: string; role: string }) {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as any,
    issuer: 'animation-studio',
    audience: 'animation-studio-app',
  });
}

export function signRefreshToken(payload: { userId: string }) {
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN as any,
    issuer: 'animation-studio',
  });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, config.JWT_SECRET, {
    issuer: 'animation-studio',
    audience: 'animation-studio-app',
  }) as { userId: string; workspaceId?: string; role: string; iat: number; exp: number };
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, config.JWT_REFRESH_SECRET, {
    issuer: 'animation-studio',
  }) as { userId: string; iat: number; exp: number };
}

// ── Password ───────────────────────────────────────────────────
export async function hashPassword(password: string) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

// ── Register ───────────────────────────────────────────────────
export async function register(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  company?: string;
  ip?: string;
}) {
  const existing = await db('users').where({ email: data.email.toLowerCase() }).first();
  if (existing) throw new AppError('Email already registered', 409);

  const passwordHash = await hashPassword(data.password);

  return db.transaction(async (trx) => {
    const [user] = await trx('users').insert({
      email: data.email.toLowerCase(),
      password_hash: passwordHash,
      first_name: data.firstName,
      last_name: data.lastName,
      company: data.company,
    }).returning('*');

    // Create personal workspace
    const slug = `${data.firstName.toLowerCase()}-${user.id.slice(0, 8)}`;
    const [workspace] = await trx('workspaces').insert({
      name: `${data.firstName}'s Workspace`,
      slug,
      owner_id: user.id,
      plan: 'free',
      credits_balance: 0, // Free tier: 1 free Normal Ad/day (watermarked) — no starting credit balance
      credits_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }).returning('*');

    await trx('workspace_members').insert({
      workspace_id: workspace.id,
      user_id: user.id,
      role: 'owner',
    });

    // Create default preferences
    await trx('user_preferences').insert({ user_id: user.id });

    // Send verification email
    const verifyToken = crypto.randomBytes(32).toString('hex');
    await trx('email_tokens').insert({
      user_id: user.id,
      token_hash: crypto.createHash('sha256').update(verifyToken).digest('hex'),
      type: 'verify_email',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    // Fire and forget
    sendEmail({
      to: user.email,
      subject: 'Verify your Arkiol account',
      template: 'verify-email',
      data: { name: user.first_name, token: verifyToken },
    }).catch(err => logger.error('Email send failed:', err));

    await auditLog({
      userId: user.id,
      workspaceId: workspace.id,
      action: 'user.register',
      ipAddress: data.ip,
    }, trx);

    return { user, workspace };
  });
}

// ── Login ──────────────────────────────────────────────────────
export async function login(data: {
  email: string;
  password: string;
  deviceInfo?: string;
  ip?: string;
}) {
  const user = await db('users')
    .where({ email: data.email.toLowerCase(), status: 'active' })
    .first();

  if (!user || !user.password_hash) {
    throw new AppError('Invalid email or password', 401);
  }

  const valid = await verifyPassword(user.password_hash, data.password);
  if (!valid) {
    await auditLog({
      userId: user.id,
      action: 'user.login_failed',
      ipAddress: data.ip,
      success: false,
      errorMessage: 'Invalid password',
    });
    throw new AppError('Invalid email or password', 401);
  }

  return issueTokens(user, data.deviceInfo, data.ip);
}

// ── Google OAuth ───────────────────────────────────────────────
export async function googleAuth(data: {
  idToken: string;
  deviceInfo?: string;
  ip?: string;
}) {
  const ticket = await googleClient.verifyIdToken({
    idToken: data.idToken,
    audience: config.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload?.email) throw new AppError('Invalid Google token', 401);

  const { email, given_name, family_name, picture, sub: googleId } = payload;

  // Find or create user
  let user = await db('users').where({ email: email.toLowerCase() }).first();

  if (!user) {
    // New user via Google
    return db.transaction(async (trx) => {
      const [newUser] = await trx('users').insert({
        email: email.toLowerCase(),
        email_verified_at: new Date().toISOString(),
        first_name: given_name || 'User',
        last_name: family_name || '',
        avatar_url: picture,
        google_id: googleId,
      }).returning('*');

      const slug = `${(given_name || 'user').toLowerCase()}-${newUser.id.slice(0, 8)}`;
      const [workspace] = await trx('workspaces').insert({
        name: `${given_name || 'My'} Workspace`,
        slug,
        owner_id: newUser.id,
        plan: 'free',
        credits_balance: 0, // Free tier: no starting credits; daily Normal Ad gate via shared plans
        credits_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }).returning('*');

      await trx('workspace_members').insert({
        workspace_id: workspace.id,
        user_id: newUser.id,
        role: 'owner',
      });

      await trx('user_preferences').insert({ user_id: newUser.id });
      await auditLog({ userId: newUser.id, workspaceId: workspace.id, action: 'user.register_google', ipAddress: data.ip }, trx);

      return issueTokens(newUser, data.deviceInfo, data.ip, trx);
    });
  }

  // Update google_id if not set
  if (!user.google_id) {
    await db('users').where({ id: user.id }).update({ google_id: googleId, avatar_url: picture });
  }

  return issueTokens(user, data.deviceInfo, data.ip);
}

// ── Issue tokens ───────────────────────────────────────────────
async function issueTokens(user: any, deviceInfo?: string, ip?: string, trx?: any) {
  const conn = trx || db;

  const workspace = await conn('workspace_members as wm')
    .join('workspaces as w', 'w.id', 'wm.workspace_id')
    .where('wm.user_id', user.id)
    .orderBy('wm.joined_at', 'asc')
    .select('w.*', 'wm.role as member_role')
    .first();

  const accessToken = signAccessToken({
    userId: user.id,
    workspaceId: workspace?.id,
    role: user.role,
  });

  const refreshTokenRaw = crypto.randomBytes(48).toString('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');

  await conn('refresh_tokens').insert({
    user_id: user.id,
    token_hash: refreshTokenHash,
    device_info: deviceInfo,
    ip_address: ip,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  await conn('users').where({ id: user.id }).update({ last_login_at: new Date() });

  await auditLog({ userId: user.id, workspaceId: workspace?.id, action: 'user.login', ipAddress: ip }, conn);

  const { password_hash: _, ...safeUser } = user;

  return {
    user: safeUser,
    workspace,
    accessToken,
    refreshToken: refreshTokenRaw,
  };
}

// ── Refresh ────────────────────────────────────────────────────
export async function refreshSession(refreshTokenRaw: string) {
  const tokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');

  const token = await db('refresh_tokens')
    .where({ token_hash: tokenHash, revoked: false })
    .where('expires_at', '>', new Date())
    .first();

  if (!token) throw new AppError('Invalid or expired refresh token', 401);

  const user = await db('users').where({ id: token.user_id, status: 'active' }).first();
  if (!user) throw new AppError('User not found or suspended', 401);

  // Rotate refresh token
  await db('refresh_tokens').where({ id: token.id }).update({ revoked: true });

  return issueTokens(user, token.device_info, token.ip_address);
}

// ── Logout ─────────────────────────────────────────────────────
export async function logout(refreshTokenRaw: string, userId: string) {
  const tokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');
  await db('refresh_tokens').where({ token_hash: tokenHash, user_id: userId }).update({ revoked: true });
  await auditLog({ userId, action: 'user.logout' });
}

// ── Logout all ─────────────────────────────────────────────────
export async function logoutAll(userId: string) {
  await db('refresh_tokens').where({ user_id: userId }).update({ revoked: true });
  await auditLog({ userId, action: 'user.logout_all' });
}

// ── Password reset ─────────────────────────────────────────────
export async function requestPasswordReset(email: string) {
  const user = await db('users').where({ email: email.toLowerCase() }).first();
  if (!user) return; // Silent - don't reveal if email exists

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // Invalidate existing tokens
  await db('email_tokens').where({ user_id: user.id, type: 'reset_password' }).update({ used: true });

  await db('email_tokens').insert({
    user_id: user.id,
    token_hash: tokenHash,
    type: 'reset_password',
    expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
  });

  await sendEmail({
    to: user.email,
    subject: 'Reset your Arkiol password',
    template: 'reset-password',
    data: { name: user.first_name, token },
  });
}

export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const record = await db('email_tokens')
    .where({ token_hash: tokenHash, type: 'reset_password', used: false })
    .where('expires_at', '>', new Date())
    .first();

  if (!record) throw new AppError('Invalid or expired reset token', 400);

  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (trx) => {
    await trx('users').where({ id: record.user_id }).update({ password_hash: passwordHash });
    await trx('email_tokens').where({ id: record.id }).update({ used: true });
    await trx('refresh_tokens').where({ user_id: record.user_id }).update({ revoked: true });
  });

  await auditLog({ userId: record.user_id, action: 'user.password_reset' });
}

export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');

  const record = await db('email_tokens')
    .where({ token_hash: tokenHash, type: 'verify_email', used: false })
    .where('expires_at', '>', new Date())
    .first();

  if (!record) throw new AppError('Invalid or expired verification token', 400);

  await db.transaction(async (trx) => {
    await trx('users').where({ id: record.user_id }).update({ email_verified_at: new Date() });
    await trx('email_tokens').where({ id: record.id }).update({ used: true });
  });
}
