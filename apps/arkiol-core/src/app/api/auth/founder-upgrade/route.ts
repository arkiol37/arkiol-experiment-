// src/app/api/auth/founder-upgrade/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER SELF-UPGRADE ENDPOINT
// Forces the founder account into the correct SUPER_ADMIN + STUDIO state.
//
// Why this exists:
//   The JWT callback auto-promotes on sign-in, but only when a fresh `user`
//   object is present (initial session creation). If arkiol37@gmail.com was
//   registered BEFORE FOUNDER_EMAIL was set in Vercel env vars, the DB row
//   already has role=DESIGNER and a FREE org. The JWT callback sees token.role
//   already set on refresh calls and skips re-promotion. This endpoint force-
//   corrects the DB directly, so the next sign-in (or token refresh) picks up
//   the correct SUPER_ADMIN role and STUDIO plan.
//
// Security:
//   - Only works when the authenticated session email matches FOUNDER_EMAIL.
//   - No additional secret required — the founder email itself is the gate.
//   - Server-only: FOUNDER_EMAIL is never exposed to the client.
//   - Idempotent — safe to call multiple times.
//
// Usage:
//   1. Sign in as arkiol37@gmail.com
//   2. POST https://your-app.vercel.app/api/auth/founder-upgrade
//   3. Sign out and sign back in to get a fresh JWT with SUPER_ADMIN role
//
// Or via curl (with session cookie):
//   curl -X POST https://your-app.vercel.app/api/auth/founder-upgrade \
//     -H "Cookie: next-auth.session-token=<your_token>"
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { detectCapabilities } = await import('@arkiol/shared');
  if (!detectCapabilities().database) {
    return NextResponse.json(
      { error: 'Database not configured.' },
      { status: 503 }
    );
  }

  const founderEmail = process.env.FOUNDER_EMAIL?.toLowerCase().trim();
  if (!founderEmail) {
    return NextResponse.json(
      { error: 'FOUNDER_EMAIL is not configured in environment variables.' },
      { status: 503 }
    );
  }

  // Verify the caller is the authenticated founder
  let sessionEmail: string | null = null;
  let sessionUserId: string | null = null;
  try {
    const { getServerSession } = await import('next-auth');
    const { authOptions }      = await import('../../../../lib/auth');
    const session              = await getServerSession(authOptions);
    sessionEmail  = (session?.user as any)?.email?.toLowerCase().trim() ?? null;
    sessionUserId = (session?.user as any)?.id ?? null;
  } catch {
    return NextResponse.json(
      { error: 'Authentication required. Sign in first.' },
      { status: 401 }
    );
  }

  if (!sessionEmail || !sessionUserId) {
    return NextResponse.json(
      { error: 'Authentication required. Sign in first.' },
      { status: 401 }
    );
  }

  if (sessionEmail !== founderEmail) {
    return NextResponse.json(
      { error: 'Access denied. This endpoint is only available to the founder account.' },
      { status: 403 }
    );
  }

  const { prisma } = await import('../../../../lib/prisma');

  // Look up current DB state
  const user = await prisma.user.findUnique({
    where:  { id: sessionUserId },
    select: { id: true, email: true, role: true, orgId: true },
  });

  if (!user) {
    return NextResponse.json(
      { error: 'User account not found in database.' },
      { status: 404 }
    );
  }

  // Force-set SUPER_ADMIN role
  await prisma.user.update({
    where: { id: user.id },
    data:  { role: 'SUPER_ADMIN' },
  });

  // Force-set org to STUDIO with full entitlements
  let orgResult: any = null;
  if (user.orgId) {
    orgResult = await prisma.org.update({
      where: { id: user.orgId },
      data: {
        plan:                'STUDIO',
        subscriptionStatus:  'ACTIVE',
        creditBalance:       999_999,
        dailyCreditBalance:  9_999,
        canUseStudioVideo:   true,
        canUseGifMotion:     true,
        canBatchGenerate:    true,
        canUseZipExport:     true,
        canUseAutomation:    true,
        maxConcurrency:      10,
        maxDailyVideoJobs:   100,
        maxFormatsPerRun:    9,
        maxVariationsPerRun: 5,
      },
      select: { id: true, plan: true, subscriptionStatus: true, creditBalance: true },
    });
  }

  console.info(`[founder-upgrade] Upgraded ${user.email} (${user.id}) to SUPER_ADMIN + STUDIO`);

  return NextResponse.json({
    success: true,
    message: '✓ Founder account upgraded. Sign out and sign back in to activate the new role in your session.',
    before:  { role: user.role },
    after:   { role: 'SUPER_ADMIN', plan: 'STUDIO', creditBalance: 999_999 },
    org:     orgResult,
    next:    'Sign out → Sign in. Your JWT will now carry SUPER_ADMIN and all gates will be bypassed.',
  });
}

// GET — friendly status check so you can verify the endpoint is live
export async function GET(req: NextRequest) {
  const founderEmail = process.env.FOUNDER_EMAIL;
  return NextResponse.json({
    endpoint:    '/api/auth/founder-upgrade',
    method:      'POST',
    configured:  !!founderEmail,
    description: 'POST to this endpoint while signed in as the founder to force-upgrade your account to SUPER_ADMIN + STUDIO plan.',
  });
}
