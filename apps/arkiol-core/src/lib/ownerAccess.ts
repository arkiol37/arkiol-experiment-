// src/lib/ownerAccess.ts
// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER / OWNER ACCESS — single source of truth
// ─────────────────────────────────────────────────────────────────────────────
// Security model:
//   - FOUNDER_EMAIL env var: the canonical founder email address.
//     Set this in Vercel environment variables.
//   - On register: if email matches FOUNDER_EMAIL → account created as SUPER_ADMIN
//     with STUDIO plan and unlimited credits. No password hardcoded anywhere.
//   - On every sign-in: if email matches FOUNDER_EMAIL → DB role is verified and
//     corrected to SUPER_ADMIN if needed. Token always reflects SUPER_ADMIN.
//   - All plan/credit/subscription gates check isOwnerRole() and pass through.
//   - Normal users are never assigned elevated roles — SUPER_ADMIN is only for
//     the founder email and explicit DB promotions.
//   - FOUNDER_EMAIL is server-only, never sent to the client.
// ─────────────────────────────────────────────────────────────────────────────
"server-only";

/** The canonical owner roles that bypass all plan/credit gates. */
const OWNER_ROLES = new Set(["SUPER_ADMIN"]);

/**
 * The founder email from environment. Returns lowercase trimmed string or null.
 * Never call this client-side.
 */
export function getFounderEmail(): string | null {
  const v = process.env.FOUNDER_EMAIL?.toLowerCase().trim();
  return v && v.length > 0 ? v : null;
}

/**
 * Returns true if this email is the founder's email.
 * Case-insensitive. Server-only.
 */
export function isFounderEmail(email: string | undefined | null): boolean {
  const founder = getFounderEmail();
  if (!founder || !email) return false;
  return email.toLowerCase().trim() === founder;
}

/**
 * Returns true if this role should bypass all plan/credit/subscription gates.
 * Only SUPER_ADMIN gets this treatment — ADMIN role is for team admins with
 * normal plan restrictions.
 */
export function isOwnerRole(role: string | undefined | null): boolean {
  if (!role) return false;
  return OWNER_ROLES.has(role);
}

/**
 * Returns true if this user has full owner access — either by role OR by being
 * the founder email (pre-promotion fallback).
 */
export function hasOwnerAccess(params: {
  role?: string | null;
  email?: string | null;
}): boolean {
  return isOwnerRole(params.role) || isFounderEmail(params.email);
}

/**
 * Returns an unlimited enforcement snapshot for owner users.
 * STUDIO plan, max credits, always active.
 */
export function ownerSnapshot(orgId: string): import("@arkiol/shared").OrgEnforcementSnapshot {
  return {
    orgId,
    plan:                  "STUDIO" as any,
    creditBalance:         999_999_999,
    dailyCreditBalance:    999_999_999,
    subscriptionStatus:    "ACTIVE" as any,
    gracePeriodEndsAt:     null,
    costProtectionBlocked: false,
    userHourlyJobCount:    0,
    userDailyJobCount:     0,
    globalMonthlySpendUsd: 0,
    orgAssetCount:         0,
  };
}

// Legacy aliases — keeps existing callers working without changes
export const isOwnerEmail = isFounderEmail;
