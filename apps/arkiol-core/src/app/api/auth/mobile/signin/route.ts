// src/app/api/auth/mobile/signin/route.ts — Arkiol Mobile V2
// Mobile JWT signin endpoint.  Issues a long-lived JWT for the mobile client.
// Uses bcrypt password comparison (same hash stored by the NextAuth register route).

import { dbUnavailable } from "../../../../../lib/error-handling";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from 'next/server';
import { prisma }           from '../../../../../lib/prisma';
import { comparePassword }  from '../../../../../lib/auth/password';
import { signMobileToken }  from '../../../../../lib/auth/mobileToken';

export async function POST(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.email || !body.password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const { email, password } = body as { email: string; password: string };

    const user = await prisma.user.findUnique({
      where:  { email: email.toLowerCase().trim() },
      select: { id: true, name: true, email: true, role: true, orgId: true, passwordHash: true },
    });

    // Constant-time response for non-existent users (don't reveal existence)
    if (!user) {
      await comparePassword('noop', '$2b$12$invalidhashpaddingtomakeittakesametime00000000000000000');
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const token = await signMobileToken({
      userId: user.id,
      email:  user.email,
      role:   user.role,
    });

    return NextResponse.json({
      user:  { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId },
      token,
    });
  } catch (err) {
    console.error('[mobile/signin]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
