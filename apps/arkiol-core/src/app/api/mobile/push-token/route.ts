// backend-additions/src/app/api/mobile/push-token/route.ts
// Store and remove Expo push tokens for server-side push delivery. — Arkiol Mobile V2

import { dbUnavailable } from "../../../../lib/error-handling";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { getMobileUser } from '../../../../lib/auth/mobileMiddleware';

export async function POST(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  try {
    const user = await getMobileUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { token, platform } = await req.json();
    if (!token || !['ios', 'android'].includes(platform)) {
      return NextResponse.json({ error: 'token and platform (ios|android) required' }, { status: 400 });
    }

    await prisma.mobilePushToken.upsert({
      where:  { token },
      create: { token, platform, userId: user.id },
      update: { userId: user.id, platform, updatedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[mobile/push-token POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getMobileUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await prisma.mobilePushToken.deleteMany({ where: { userId: user.id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[mobile/push-token DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
