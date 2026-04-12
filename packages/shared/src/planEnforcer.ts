// packages/shared/src/planEnforcer.ts
// BACKEND PLAN ENFORCEMENT — must be called at the API/route level in both apps.
// UI gating is never sufficient; every job submission goes through preflightJob().
// Checklist §3.2, §7.1–7.4
//
// ACCESS MODEL:
//   Animation Studio is available to Creator, Pro, and Studio plans only.
//   Free plan is TEASER ONLY: 1 free watermarked Normal Ad per day, no full Studio access.
//   checkStudioVideoAccess() enforces this at the backend for all video jobs.
//   The free teaser path bypasses checkStudioVideoAccess() via checkCredits() + freeDailyNormalAds.
//
// ENVIRONMENT ACCESS POLICY:
//   All env var access routes through getEnv() — no direct process.env usage.
//   checkKillSwitch() and checkGlobalMonthlySpend() are called at request-time,
//   after validateSharedEnv() has run at application startup.

import { getPlanConfig, CREDIT_COSTS, CreditCostKey } from './plans';
import { getEnv } from './env';

// Minimal snapshot of what we need per enforcement check.
// Both apps populate this from their respective DB queries.
export interface OrgEnforcementSnapshot {
  orgId: string;
  plan: string;
  creditBalance: number;
  dailyCreditBalance: number;
  subscriptionStatus: string;
  gracePeriodEndsAt?: Date | null;
  costProtectionBlocked: boolean;
  // Per-user rate limiting fields (populated from User row)
  userHourlyJobCount?: number;   // jobs started in the past 60 min for this user
  userDailyJobCount?: number;    // jobs started since midnight UTC for this user
  // Global monthly spend (populated from system-level billing aggregate)
  globalMonthlySpendUsd?: number;
  // Asset count for per-plan cap enforcement
  orgAssetCount?: number;
}

// ── Per-plan asset caps ──────────────────────────────────────────────────────
const PLAN_ASSET_CAPS: Record<string, number> = {
  FREE:    50,
  CREATOR: 500,
  PRO:     5_000,
  STUDIO:  Infinity,
};

export type EnforcementResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: string; httpStatus: number };

function deny(reason: string, code: string, httpStatus = 403): EnforcementResult {
  return { allowed: false, reason, code, httpStatus };
}
const ok: EnforcementResult = { allowed: true };

// ── Emergency kill-switch ────────────────────────────────────────────────────
// Set GENERATION_KILL_SWITCH=true to halt all new job submissions globally.
// Routed through getEnv() — no direct process.env.
export function checkKillSwitch(): EnforcementResult {
  const flag = (getEnv().GENERATION_KILL_SWITCH ?? '').toLowerCase();
  if (flag === 'true' || flag === '1') {
    return deny(
      'Generation is temporarily disabled for system maintenance. Please try again later.',
      'KILL_SWITCH_ACTIVE', 503
    );
  }
  return ok;
}

// ── Global monthly spend failsafe ─────────────────────────────────────────────
// GLOBAL_MONTHLY_SPEND_LIMIT_USD env var sets a hard ceiling on total API cost.
// FAIL-CLOSED: if the env var is present but cannot be parsed as a valid positive
// number, asset generation is DENIED (not permitted). This prevents a misconfigured
// guard from silently allowing unlimited spend.
// Default when env var is absent: $10,000/month.
const DEFAULT_GLOBAL_MONTHLY_LIMIT_USD = 10_000;

export function checkGlobalMonthlySpend(currentSpendUsd: number): EnforcementResult {
  const limitStr = getEnv().GLOBAL_MONTHLY_SPEND_LIMIT_USD;

  let limit: number;
  if (limitStr === undefined || limitStr === '') {
    // Not configured — use safe default
    limit = DEFAULT_GLOBAL_MONTHLY_LIMIT_USD;
  } else {
    const parsed = parseFloat(limitStr);
    if (isNaN(parsed) || parsed < 0) {
      // FAIL-CLOSED: misconfigured spend guard — deny generation to protect billing integrity.
      return deny(
        'Global monthly spend limit is misconfigured. Generation is paused until the configuration is corrected.',
        'SPEND_GUARD_MISCONFIGURED', 503
      );
    }
    limit = parsed;
  }

  if (limit === 0) return ok; // explicitly disabled

  // If currentSpendUsd cannot be calculated (caller passes NaN), fail closed.
  if (!isFinite(currentSpendUsd) || isNaN(currentSpendUsd)) {
    return deny(
      'Global monthly spend could not be calculated. Generation is paused to protect billing integrity.',
      'SPEND_CALCULATION_FAILED', 503
    );
  }

  if (currentSpendUsd >= limit) {
    return deny(
      `Global monthly spend limit ($${limit.toFixed(2)}) reached. New generations are paused until the limit is raised.`,
      'GLOBAL_SPEND_LIMIT', 503
    );
  }
  return ok;
}

// ── Per-user hourly rate limit ─────────────────────────────────────────────────
// Default: 30 jobs per hour per user. Override via PER_USER_HOURLY_LIMIT env var.
const DEFAULT_HOURLY_LIMIT = 30;
export function checkUserHourlyRate(hourlyJobCount: number): EnforcementResult {
  const raw = getEnv().PER_USER_HOURLY_LIMIT;
  const limit = raw ? parseInt(raw, 10) : DEFAULT_HOURLY_LIMIT;
  if (hourlyJobCount >= limit) {
    return deny(
      `Hourly generation limit (${limit} jobs/hour) reached. Wait before submitting more.`,
      'USER_HOURLY_LIMIT', 429
    );
  }
  return ok;
}

// ── Per-user daily rate limit ─────────────────────────────────────────────────
// Default: 200 jobs per day per user. Override via PER_USER_DAILY_LIMIT env var.
const DEFAULT_DAILY_LIMIT = 200;
export function checkUserDailyRate(dailyJobCount: number): EnforcementResult {
  const raw = getEnv().PER_USER_DAILY_LIMIT;
  const limit = raw ? parseInt(raw, 10) : DEFAULT_DAILY_LIMIT;
  if (dailyJobCount >= limit) {
    return deny(
      `Daily generation limit (${limit} jobs/day) reached. Resets at midnight UTC.`,
      'USER_DAILY_LIMIT', 429
    );
  }
  return ok;
}

// ── Per-plan asset cap ─────────────────────────────────────────────────────────
export function checkAssetCap(org: OrgEnforcementSnapshot): EnforcementResult {
  const cap = PLAN_ASSET_CAPS[org.plan.toUpperCase()] ?? PLAN_ASSET_CAPS['FREE'];
  const current = org.orgAssetCount ?? 0;
  if (current >= cap) {
    return deny(
      `Asset limit (${cap}) for your ${org.plan} plan reached. Delete unused assets or upgrade your plan.`,
      'ASSET_CAP_REACHED', 402
    );
  }
  return ok;
}

// ── Subscription liveness ──────────────────────────────────────────────────
export function checkSubscriptionActive(org: OrgEnforcementSnapshot): EnforcementResult {
  const s = org.subscriptionStatus?.toUpperCase();
  if (s === 'ACTIVE' || s === 'TRIALING') return ok;

  if (s === 'PAST_DUE' || s === 'UNPAID') {
    if (org.gracePeriodEndsAt && new Date() < org.gracePeriodEndsAt) return ok;
    return deny('Payment failed. Please update your billing details.', 'PAYMENT_FAILED', 402);
  }
  if (s === 'CANCELED') return deny('Subscription canceled. Please resubscribe.', 'SUBSCRIPTION_CANCELED', 402);
  return deny('Subscription inactive.', 'SUBSCRIPTION_INACTIVE', 402);
}

// ── Feature flags ─────────────────────────────────────────────────────────
// Animation Studio is a paid feature: Creator, Pro, and Studio plans only.
// Free plan is teaser-only: the free daily Normal Ad path bypasses this check
// via checkCredits() + freeDailyNormalAds gate, handled separately in preflightJob().
export function checkStudioVideoAccess(org: OrgEnforcementSnapshot): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (!plan.canUseStudioVideo) {
    return deny(
      'Animation Studio requires a Creator, Pro, or Studio plan. Upgrade to unlock full video generation.',
      'PLAN_FEATURE_BLOCKED'
    );
  }
  if (org.costProtectionBlocked) {
    return deny(
      'Daily cost protection limit reached. Video jobs are blocked until tomorrow.',
      'COST_PROTECTION_BLOCKED'
    );
  }
  return ok;
}

export function checkGifAccess(org: OrgEnforcementSnapshot): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (!plan.canUseGifMotion) {
    return deny('GIF motion export requires a Creator, Pro, or Studio plan.', 'PLAN_FEATURE_BLOCKED');
  }
  return ok;
}

export function checkZipExport(org: OrgEnforcementSnapshot): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (!plan.canUseZipExport) {
    return deny('ZIP export requires a Creator plan or higher.', 'PLAN_FEATURE_BLOCKED');
  }
  return ok;
}

export function checkBatchGenerate(org: OrgEnforcementSnapshot): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (!plan.canBatchGenerate) {
    return deny('Batch generation requires a Pro or Studio plan.', 'PLAN_FEATURE_BLOCKED');
  }
  return ok;
}

// Per-plan max jobs in a single bulk request
const BATCH_JOB_LIMITS: Record<string, number> = {
  FREE:    0,
  CREATOR: 0,
  PRO:     20,
  STUDIO:  50,
};

export function checkBatchSize(org: OrgEnforcementSnapshot, requestedJobs: number): EnforcementResult {
  const batchAllowed = checkBatchGenerate(org);
  if (!batchAllowed.allowed) return batchAllowed;

  const planKey  = org.plan.toUpperCase();
  const maxJobs  = BATCH_JOB_LIMITS[planKey] ?? BATCH_JOB_LIMITS[org.plan.toUpperCase()] ?? 0;

  if (requestedJobs < 1) {
    return deny('Batch must contain at least 1 job.', 'BATCH_TOO_SMALL', 400);
  }
  if (requestedJobs > maxJobs) {
    return deny(
      `Your plan allows at most ${maxJobs} jobs per batch request. You requested ${requestedJobs}.`,
      'BATCH_SIZE_EXCEEDED', 400
    );
  }
  return ok;
}

export function checkStudioAccess(org: OrgEnforcementSnapshot): EnforcementResult {
  const sub = checkSubscriptionActive(org);
  if (!sub.allowed) return sub;
  return checkStudioVideoAccess(org);
}

// ── Concurrency cap ────────────────────────────────────────────────────────
export function checkConcurrency(org: OrgEnforcementSnapshot, currentRunning: number): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (currentRunning >= plan.maxConcurrency) {
    return deny(
      `Concurrent job limit (${plan.maxConcurrency}) reached for your plan. Wait for a job to finish.`,
      'CONCURRENCY_LIMIT', 429
    );
  }
  return ok;
}

// ── Daily video job cap ────────────────────────────────────────────────────
export function checkDailyVideoJobs(org: OrgEnforcementSnapshot, todayVideoCount: number): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (plan.maxDailyVideoJobs === 0) {
    return deny('Video jobs are not available on your plan.', 'PLAN_FEATURE_BLOCKED');
  }
  if (todayVideoCount >= plan.maxDailyVideoJobs) {
    return deny(
      `Daily video limit (${plan.maxDailyVideoJobs}) reached. Resets at midnight UTC.`,
      'DAILY_VIDEO_CAP', 429
    );
  }
  return ok;
}

// ── Format and variation caps ──────────────────────────────────────────────
export function checkFormats(org: OrgEnforcementSnapshot, count: number): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (count > plan.maxFormatsPerRun) {
    return deny(`Your plan allows max ${plan.maxFormatsPerRun} formats per run.`, 'FORMAT_LIMIT');
  }
  return ok;
}

export function checkVariations(org: OrgEnforcementSnapshot, count: number): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (count > plan.maxVariationsPerRun) {
    return deny(`Your plan allows max ${plan.maxVariationsPerRun} variations per run.`, 'VARIATION_LIMIT');
  }
  return ok;
}

// ── Resolution cap ─────────────────────────────────────────────────────────
export function checkResolution(org: OrgEnforcementSnapshot, resolution: string): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (resolution === '4K' && plan.maxExportResolution !== '4K') {
    return deny('4K export requires a Pro or Studio plan.', 'RESOLUTION_BLOCKED');
  }
  return ok;
}

// ── Credit sufficiency ─────────────────────────────────────────────────────
// For Free plan teaser: the 1 free daily Normal Ad bypasses credit check entirely.
// All other plan/mode combinations require a sufficient credit balance.
export function checkCredits(
  org: OrgEnforcementSnapshot,
  reason: CreditCostKey,
  todayNormalAdCount?: number,  // how many free Normal Ads this org has used today
): EnforcementResult {
  const cost = CREDIT_COSTS[reason];
  const plan = getPlanConfig(org.plan);

  // ── Free daily Normal Ad teaser gate ───────────────────────────────────────
  // FREE plan: 1 watermarked Normal Ad per day at no credit cost.
  // If within the daily free allowance, skip credit check entirely.
  // This is the ONLY Animation Studio access Free users have.
  const isNormalAd = reason === 'normal_ad' || reason === 'video_std';
  if (isNormalAd && plan.freeDailyNormalAds > 0) {
    const usedToday = todayNormalAdCount ?? 0;
    if (usedToday < plan.freeDailyNormalAds) {
      return ok; // Free daily teaser Normal Ad — no credits deducted
    }
  }

  if (org.creditBalance < cost) {
    return deny(
      `Insufficient credits: need ${cost}, have ${org.creditBalance}. Purchase more credits to continue.`,
      'INSUFFICIENT_CREDITS', 402
    );
  }
  return ok;
}

// ── Composite pre-flight check — call this before ANY job submission ────────
// Order of checks is deliberate:
//   1. Kill-switch / global failsafes first (fastest rejection, no DB needed)
//   2. Per-user rate limits
//   3. Subscription + plan checks
//   4. Credit/asset checks
//
// FREE plan video job path:
//   - checkStudioVideoAccess() WILL deny the job (canUseStudioVideo=false).
//   - The only way a Free user can generate is via the teaser path:
//     caller must pass todayNormalAdCount < 1, reason='normal_ad', and the
//     route handler must skip checkStudioVideoAccess for the teaser path.
//     The teaser route is a separate, lightweight endpoint in the backend.
export function preflightJob(params: {
  org: OrgEnforcementSnapshot;
  reason: CreditCostKey;
  currentRunning: number;
  todayVideoJobs?: number;
  todayNormalAdCount?: number;   // for free-tier teaser Normal Ad gate
  requestedFormats?: number;
  requestedVariations?: number;
  resolution?: string;
  isTeaserPath?: boolean;        // true only for the Free plan free-daily-ad teaser route
}): EnforcementResult {
  const {
    org, reason, currentRunning,
    todayVideoJobs = 0, todayNormalAdCount = 0,
    requestedFormats = 1, requestedVariations = 1,
    resolution,
    isTeaserPath = false,
  } = params;

  // Launch modes: Normal Ads (2D) and Cinematic Ads (2.5D) only
  const isVideoJob = ['video_std', 'video_hq', 'normal_ad', 'cinematic_ad'].includes(reason);
  const isGifJob   = reason === 'gif';
  const isZipJob   = reason === 'export_zip';

  const checks: EnforcementResult[] = [
    // ── Global / system-level guards (no org context needed) ───────────────
    checkKillSwitch(),
    checkGlobalMonthlySpend(org.globalMonthlySpendUsd ?? 0),

    // ── Per-user rate limits ───────────────────────────────────────────────
    checkUserHourlyRate(org.userHourlyJobCount ?? 0),
    checkUserDailyRate(org.userDailyJobCount ?? 0),

    // ── Plan / subscription checks ─────────────────────────────────────────
    checkSubscriptionActive(org),
    checkCredits(org, reason, todayNormalAdCount),
    checkConcurrency(org, currentRunning),
    checkFormats(org, requestedFormats),
    checkVariations(org, requestedVariations),

    // ── Asset cap ──────────────────────────────────────────────────────────
    checkAssetCap(org),
  ];

  if (isVideoJob) {
    // Teaser path: Free plan's free-daily-ad route skips the Studio access check.
    // All other video jobs (including Free plan jobs beyond the free teaser) must pass it.
    if (!isTeaserPath) {
      checks.push(checkStudioVideoAccess(org));
    }
    checks.push(checkDailyVideoJobs(org, todayVideoJobs));
  }
  if (isGifJob)    checks.push(checkGifAccess(org));
  if (isZipJob)    checks.push(checkZipExport(org));
  if (resolution)  checks.push(checkResolution(org, resolution));

  return checks.find(c => !c.allowed) ?? ok;
}

// ── HQ upgrade enforcement ────────────────────────────────────────────────────
export function checkHqUpgrade(org: OrgEnforcementSnapshot): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (plan.canUseHqUpgrade) return ok;
  return deny('HQ upgrade requires a Creator, Pro, or Studio plan.', 'HQ_UPGRADE_NOT_ALLOWED', 403);
}


// ── On-demand asset count enforcement ────────────────────────────────────────
export function checkOnDemandAssetCount(org: OrgEnforcementSnapshot, count: number): EnforcementResult {
  const plan = getPlanConfig(org.plan);
  if (count > plan.maxOnDemandAssets) {
    return deny(
      `Plan allows ${plan.maxOnDemandAssets} on-demand assets per job (requested ${count}).`,
      'ON_DEMAND_ASSET_LIMIT', 402
    );
  }
  return ok;
}
