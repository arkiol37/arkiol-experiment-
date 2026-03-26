// src/lib/auth/mobileToken.ts
// Safe mobile JWT — only works when MOBILE_JWT_SECRET is configured.
import { detectCapabilities } from '@arkiol/shared';

export interface MobileTokenPayload { userId: string; email: string; role: string; }

function getSecret(): Uint8Array {
  const raw = process.env.MOBILE_JWT_SECRET;
  if (!raw || raw.trim().length < 32) throw new Error('MOBILE_JWT_SECRET not configured or too short');
  return new TextEncoder().encode(raw.trim());
}

export async function signMobileToken(payload: MobileTokenPayload): Promise<string> {
  if (!detectCapabilities().mobileAuth) throw new Error('Mobile auth not configured');
  const { SignJWT } = require('jose');
  return new SignJWT({ ...payload }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(getSecret());
}

export async function verifyMobileToken(token: string): Promise<MobileTokenPayload | null> {
  if (!detectCapabilities().mobileAuth) return null;
  try {
    const { jwtVerify } = require('jose');
    const { payload } = await jwtVerify(token, getSecret());
    const { userId, email, role } = payload as Record<string, unknown>;
    if (typeof userId !== 'string' || typeof email !== 'string' || typeof role !== 'string') return null;
    return { userId, email, role };
  } catch { return null; }
}
