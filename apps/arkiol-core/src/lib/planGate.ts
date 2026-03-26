// src/lib/planGate.ts
// Reusable helpers to load org snapshot and run plan enforcement in Next.js API routes.
// Wraps @arkiol/shared planEnforcer so route handlers stay clean.

import { detectCapabilities } from '@arkiol/shared';
import "server-only";
import { isOwnerRole, isFounderEmail, ownerSnapshot } from "./ownerAccess";
import { prisma } from "./prisma";
import {
  OrgEnforcementSnapshot,
  preflightJob,
  checkStudioAccess,
  checkZipExport,
  checkBatchGenerate,
  checkBatchSize,
  type CreditCostKey,
  type EnforcementResult,
} from "@arkiol/shared";
import { ApiError } from "./types";

// Load org enforcement snapshot (used by all route handlers)
// Pass userRole AND/OR userEmail to bypass all gating for the founder / SUPER_ADMIN.
// Email bypass is the safety net: if the JWT carried a stale role but the email
// matches FOUNDER_EMAIL, we still return the unlimited owner snapshot.
export async function loadOrgSnapshot(orgId: string, userRole?: string, userEmail?: string): Promise<OrgEnforcementSnapshot> {
  // ── Owner / founder bypass — skip all plan + credit checks ───────────────
  if (isOwnerRole(userRole) || isFounderEmail(userEmail)) return ownerSnapshot(orgId);

  if (!detectCapabilities().database) {
    // Return a permissive free-tier snapshot when DB not configured
    // Free plan canonical model (packages/shared/src/plans.ts):
    // 0 monthly credits, 1 free Normal Ad/day (freeDailyNormalAds), no credit deductions.
    return {
      orgId,
      plan:                  'FREE' as any,
      creditBalance:         0,
      dailyCreditBalance:    0,
      subscriptionStatus:    null,
      gracePeriodEndsAt:     null,
      costProtectionBlocked: false,
    };
  }
  const org = await prisma.org.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      id: true,
      plan: true,
      creditBalance: true,
      dailyCreditBalance: true,
      subscriptionStatus: true,
      gracePeriodEndsAt: true,
      costProtectionBlocked: true,
    },
  });
  return {
    orgId:                 org.id,
    plan:                  org.plan,
    creditBalance:         org.creditBalance,
    dailyCreditBalance:    org.dailyCreditBalance,
    subscriptionStatus:    org.subscriptionStatus,
    gracePeriodEndsAt:     org.gracePeriodEndsAt,
    costProtectionBlocked: org.costProtectionBlocked,
  };
}

// Throw ApiError if enforcement fails (call inside route handler)
export function assertEnforcement(result: EnforcementResult): void {
  if (!result.allowed) {
    throw new ApiError(
      (result as any).httpStatus ?? 403,
      result.reason
    );
  }
}

// Composite check for a generation job
export async function assertGenerationAllowed(params: {
  orgId:              string;
  formats:            string[];
  variations:         number;
  includeGif:         boolean;
  currentRunning:     number;
  userRole?:          string;  // pass to bypass for SUPER_ADMIN / ADMIN
  userEmail?:         string;  // founder email bypass — second line of defence
}): Promise<OrgEnforcementSnapshot> {
  const snap = await loadOrgSnapshot(params.orgId, params.userRole, params.userEmail);

  const reason: CreditCostKey = params.includeGif ? "gif" : "static";
  const result = preflightJob({
    org:                snap,
    reason,
    currentRunning:     params.currentRunning,
    requestedFormats:   params.formats.length,
    requestedVariations: params.variations,
  });
  assertEnforcement(result);

  return snap;
}

// Check for ZIP export
export async function assertZipExportAllowed(orgId: string, userRole?: string): Promise<void> {
  const snap = await loadOrgSnapshot(orgId, userRole);
  assertEnforcement(checkZipExport(snap));
}

// Check for Studio access
export async function assertStudioAccessAllowed(orgId: string, userRole?: string): Promise<void> {
  const snap = await loadOrgSnapshot(orgId, userRole);
  assertEnforcement(checkStudioAccess(snap));
}

// Count currently running+queued jobs for an org
export async function countOrgRunningJobs(orgId: string): Promise<number> {
  return prisma.job.count({
    where: {
      orgId,
      status: { in: ["QUEUED" as any, "RUNNING" as any, "PENDING" as any] },
    },
  });
}

// Count today's video jobs for an org
export async function countOrgTodayVideoJobs(orgId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return prisma.job.count({
    where: {
      orgId,
      type: { in: ["RENDER_GIF" as any, "RENDER_VIDEO_STD" as any, "RENDER_VIDEO_HQ" as any, "RENDER_NORMAL_AD" as any, "RENDER_CINEMATIC_AD" as any] },
      createdAt: { gte: today },
    },
  });
}

// Check for batch generation (plan flag + size cap)
export async function assertBatchAllowed(orgId: string, requestedJobs: number, userRole?: string): Promise<OrgEnforcementSnapshot> {
  const snap = await loadOrgSnapshot(orgId, userRole);
  assertEnforcement(checkBatchSize(snap, requestedJobs));
  return snap;
}
