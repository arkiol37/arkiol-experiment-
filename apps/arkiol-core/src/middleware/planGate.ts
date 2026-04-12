// apps/arkiol-core/src/middleware/planGate.ts
// Reusable Next.js API route wrappers that enforce plan feature flags.
// Import canAccessStudio, checkConcurrency etc from @arkiol/shared.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../lib/auth';
import { prisma } from '../lib/prisma';
// v12 fix: use the correct exported function names from @arkiol/shared planEnforcer.
// Previous imports (canAccessStudio, canUseGifMotion, canUseStudioVideo, canUseZipExport)
// were field names on PlanConfig, not exported enforcement functions.
// checkGifAccess, checkStudioVideoAccess, checkZipExport are re-exported here for
// callers that need them without importing directly from @arkiol/shared.
import { checkStudioAccess, checkGifAccess, checkStudioVideoAccess, checkZipExport } from '@arkiol/shared';
export { checkGifAccess, checkStudioVideoAccess, checkZipExport };

type OrgMeta = {
  id: string;
  plan: string;
  creditBalance: number;
  dailyCreditBalance: number;
  subscriptionStatus: string;
  gracePeriodEndsAt: Date | null;
  costProtectionBlocked: boolean;
};

export async function getOrgMeta(req: NextRequest): Promise<OrgMeta | null> {
  const session = await (getServerSession as any)(authOptions);
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      org: {
        select: {
          id: true, plan: true, creditBalance: true, dailyCreditBalance: true,
          subscriptionStatus: true, gracePeriodEndsAt: true, costProtectionBlocked: true,
        },
      },
    },
  });

  return user?.org ?? null;
}

/** Returns 403 if the session org cannot access Animation Studio */
export async function requireStudioAccess(req: NextRequest): Promise<NextResponse | null> {
  const org = await getOrgMeta(req);
  if (!org) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = checkStudioAccess({
    orgId: org.id,
    plan: org.plan,
    creditBalance: org.creditBalance,
    dailyCreditBalance: org.dailyCreditBalance,
    subscriptionStatus: org.subscriptionStatus,
    gracePeriodEndsAt: org.gracePeriodEndsAt,
    costProtectionBlocked: org.costProtectionBlocked,
  });

  if (!result.allowed) {
    return NextResponse.json({ error: result.reason, code: result.code }, { status: 403 });
  }
  return null;
}
