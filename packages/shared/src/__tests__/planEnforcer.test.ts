/**
 * packages/shared/src/__tests__/planEnforcer.test.ts
 *
 * Comprehensive unit tests for all plan enforcement functions.
 * No database, no network — pure synchronous logic only.
 *
 * ACCESS MODEL UNDER TEST:
 *   Animation Studio = Creator, Pro, Studio plans only.
 *   Free plan = TEASER ONLY: 1 free watermarked Normal Ad/day via isTeaserPath.
 *   checkStudioVideoAccess() ALWAYS denies Free plan for non-teaser video jobs.
 *
 * Covers:
 *  - Kill-switch
 *  - Global monthly spend guard (including fail-closed misconfiguration)
 *  - Per-user hourly / daily rate limits
 *  - Asset cap per plan
 *  - Subscription status (active, trialing, past_due with grace, canceled)
 *  - Feature flags (Studio video, GIF, ZIP, batch, HQ upgrade)
 *  - Concurrency cap
 *  - Daily video job cap
 *  - Format & variation caps
 *  - Resolution gating (4K)
 *  - Credit sufficiency
 *  - preflightJob composite — check ordering & short-circuit
 *  - Free plan teaser path (isTeaserPath=true)
 */

// Ensure getEnv() falls back to raw process.env (test env behaviour)
beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import {
  checkKillSwitch,
  checkGlobalMonthlySpend,
  checkUserHourlyRate,
  checkUserDailyRate,
  checkAssetCap,
  checkSubscriptionActive,
  checkStudioVideoAccess,
  checkGifAccess,
  checkZipExport,
  checkBatchGenerate,
  checkConcurrency,
  checkDailyVideoJobs,
  checkFormats,
  checkVariations,
  checkResolution,
  checkCredits,
  checkHqUpgrade,
  preflightJob,
  type OrgEnforcementSnapshot,
} from '../planEnforcer';

// ── Helpers ────────────────────────────────────────────────────────────────
function makeOrg(overrides: Partial<OrgEnforcementSnapshot> = {}): OrgEnforcementSnapshot {
  return {
    orgId:                   'org-test',
    plan:                    'PRO',
    creditBalance:           200,
    dailyCreditBalance:      200,
    subscriptionStatus:      'ACTIVE',
    gracePeriodEndsAt:       null,
    costProtectionBlocked:   false,
    userHourlyJobCount:      0,
    userDailyJobCount:       0,
    globalMonthlySpendUsd:   0,
    orgAssetCount:           0,
    ...overrides,
  };
}

function allowed(result: any): boolean {
  return result.allowed === true;
}
function denied(result: any): boolean {
  return result.allowed === false;
}

// ══════════════════════════════════════════════════════════════════════════════
// Kill-switch
// ══════════════════════════════════════════════════════════════════════════════
describe('checkKillSwitch', () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('allows when GENERATION_KILL_SWITCH is not set', () => {
    delete process.env.GENERATION_KILL_SWITCH;
    expect(allowed(checkKillSwitch())).toBe(true);
  });

  it('allows when GENERATION_KILL_SWITCH=false', () => {
    process.env.GENERATION_KILL_SWITCH = 'false';
    expect(allowed(checkKillSwitch())).toBe(true);
  });

  it('denies when GENERATION_KILL_SWITCH=true', () => {
    process.env.GENERATION_KILL_SWITCH = 'true';
    const r = checkKillSwitch();
    expect(denied(r)).toBe(true);
    if (!r.allowed) {
      expect(r.code).toBe('KILL_SWITCH_ACTIVE');
      expect(r.httpStatus).toBe(503);
    }
  });

  it('denies when GENERATION_KILL_SWITCH=1', () => {
    process.env.GENERATION_KILL_SWITCH = '1';
    expect(denied(checkKillSwitch())).toBe(true);
  });

  it('is case-insensitive (TRUE, True)', () => {
    for (const val of ['TRUE', 'True']) {
      process.env.GENERATION_KILL_SWITCH = val;
      expect(denied(checkKillSwitch())).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Global monthly spend guard
// ══════════════════════════════════════════════════════════════════════════════
describe('checkGlobalMonthlySpend', () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('allows when spend is below default limit', () => {
    delete process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD;
    expect(allowed(checkGlobalMonthlySpend(100))).toBe(true);
  });

  it('allows when spend equals exactly 0', () => {
    delete process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD;
    expect(allowed(checkGlobalMonthlySpend(0))).toBe(true);
  });

  it('denies when spend reaches configured limit', () => {
    process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD = '500';
    const r = checkGlobalMonthlySpend(500);
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('GLOBAL_SPEND_LIMIT');
  });

  it('denies when spend exceeds configured limit', () => {
    process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD = '500';
    expect(denied(checkGlobalMonthlySpend(501))).toBe(true);
  });

  it('allows when limit=0 (disabled)', () => {
    process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD = '0';
    expect(allowed(checkGlobalMonthlySpend(999_999))).toBe(true);
  });

  it('FAIL-CLOSED: denies when limit env var is invalid string', () => {
    process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD = 'not-a-number';
    const r = checkGlobalMonthlySpend(0);
    expect(denied(r)).toBe(true);
    if (!r.allowed) {
      expect(r.code).toBe('SPEND_GUARD_MISCONFIGURED');
      expect(r.httpStatus).toBe(503);
    }
  });

  it('FAIL-CLOSED: denies when limit is negative', () => {
    process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD = '-100';
    expect(denied(checkGlobalMonthlySpend(0))).toBe(true);
  });

  it('FAIL-CLOSED: denies when currentSpend is NaN', () => {
    delete process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD;
    const r = checkGlobalMonthlySpend(NaN);
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('SPEND_CALCULATION_FAILED');
  });

  it('FAIL-CLOSED: denies when currentSpend is Infinity', () => {
    delete process.env.GLOBAL_MONTHLY_SPEND_LIMIT_USD;
    expect(denied(checkGlobalMonthlySpend(Infinity))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Per-user rate limits
// ══════════════════════════════════════════════════════════════════════════════
describe('checkUserHourlyRate', () => {
  const origEnv = process.env;
  afterEach(() => { process.env = { ...origEnv }; });

  it('allows when count is below default (30)', () => {
    delete process.env.PER_USER_HOURLY_LIMIT;
    expect(allowed(checkUserHourlyRate(29))).toBe(true);
  });

  it('denies when count reaches default limit (30)', () => {
    delete process.env.PER_USER_HOURLY_LIMIT;
    const r = checkUserHourlyRate(30);
    expect(denied(r)).toBe(true);
    if (!r.allowed) {
      expect(r.code).toBe('USER_HOURLY_LIMIT');
      expect(r.httpStatus).toBe(429);
    }
  });

  it('respects custom PER_USER_HOURLY_LIMIT', () => {
    process.env.PER_USER_HOURLY_LIMIT = '5';
    expect(allowed(checkUserHourlyRate(4))).toBe(true);
    expect(denied(checkUserHourlyRate(5))).toBe(true);
  });

  it('allows 0 jobs (fresh user)', () => {
    expect(allowed(checkUserHourlyRate(0))).toBe(true);
  });
});

describe('checkUserDailyRate', () => {
  const origEnv = process.env;
  afterEach(() => { process.env = { ...origEnv }; });

  it('allows when count is below default (200)', () => {
    delete process.env.PER_USER_DAILY_LIMIT;
    expect(allowed(checkUserDailyRate(199))).toBe(true);
  });

  it('denies when count reaches default limit (200)', () => {
    delete process.env.PER_USER_DAILY_LIMIT;
    const r = checkUserDailyRate(200);
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('USER_DAILY_LIMIT');
  });

  it('respects custom PER_USER_DAILY_LIMIT', () => {
    process.env.PER_USER_DAILY_LIMIT = '10';
    expect(allowed(checkUserDailyRate(9))).toBe(true);
    expect(denied(checkUserDailyRate(10))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Asset cap
// ══════════════════════════════════════════════════════════════════════════════
describe('checkAssetCap', () => {
  it('allows FREE plan under 50 assets', () => {
    expect(allowed(checkAssetCap(makeOrg({ plan: 'FREE', orgAssetCount: 49 })))).toBe(true);
  });

  it('denies FREE plan at 50 assets', () => {
    const r = checkAssetCap(makeOrg({ plan: 'FREE', orgAssetCount: 50 }));
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('ASSET_CAP_REACHED');
  });

  it('allows CREATOR plan under 500 assets', () => {
    expect(allowed(checkAssetCap(makeOrg({ plan: 'CREATOR', orgAssetCount: 499 })))).toBe(true);
  });

  it('denies CREATOR plan at 500 assets', () => {
    expect(denied(checkAssetCap(makeOrg({ plan: 'CREATOR', orgAssetCount: 500 })))).toBe(true);
  });

  it('allows PRO plan under 5000 assets', () => {
    expect(allowed(checkAssetCap(makeOrg({ plan: 'PRO', orgAssetCount: 4_999 })))).toBe(true);
  });

  it('STUDIO plan has no asset cap (Infinity)', () => {
    expect(allowed(checkAssetCap(makeOrg({ plan: 'STUDIO', orgAssetCount: 100_000 })))).toBe(true);
  });

  it('unknown plan falls back to FREE cap', () => {
    const r = checkAssetCap(makeOrg({ plan: 'UNKNOWN', orgAssetCount: 51 }));
    expect(denied(r)).toBe(true);
  });

  it('treats undefined orgAssetCount as 0', () => {
    const org = makeOrg({ plan: 'FREE' });
    delete (org as any).orgAssetCount;
    expect(allowed(checkAssetCap(org))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Subscription status
// ══════════════════════════════════════════════════════════════════════════════
describe('checkSubscriptionActive', () => {
  it('allows ACTIVE subscription', () => {
    expect(allowed(checkSubscriptionActive(makeOrg({ subscriptionStatus: 'ACTIVE' })))).toBe(true);
  });

  it('allows TRIALING subscription', () => {
    expect(allowed(checkSubscriptionActive(makeOrg({ subscriptionStatus: 'TRIALING' })))).toBe(true);
  });

  it('allows PAST_DUE within grace period', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);
    expect(allowed(checkSubscriptionActive(makeOrg({
      subscriptionStatus: 'PAST_DUE',
      gracePeriodEndsAt:   future,
    })))).toBe(true);
  });

  it('denies PAST_DUE after grace period', () => {
    const past = new Date(Date.now() - 1000);
    const r = checkSubscriptionActive(makeOrg({
      subscriptionStatus: 'PAST_DUE',
      gracePeriodEndsAt:   past,
    }));
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('PAYMENT_FAILED');
  });

  it('denies PAST_DUE with no grace period', () => {
    const r = checkSubscriptionActive(makeOrg({ subscriptionStatus: 'PAST_DUE', gracePeriodEndsAt: null }));
    expect(denied(r)).toBe(true);
  });

  it('denies CANCELED subscription', () => {
    const r = checkSubscriptionActive(makeOrg({ subscriptionStatus: 'CANCELED' }));
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('SUBSCRIPTION_CANCELED');
  });

  it('denies UNPAID subscription', () => {
    expect(denied(checkSubscriptionActive(makeOrg({ subscriptionStatus: 'UNPAID' })))).toBe(true);
  });

  it('denies unknown subscription status', () => {
    expect(denied(checkSubscriptionActive(makeOrg({ subscriptionStatus: 'UNKNOWN' })))).toBe(true);
  });

  it('is case-insensitive (active, Active)', () => {
    expect(allowed(checkSubscriptionActive(makeOrg({ subscriptionStatus: 'active' })))).toBe(true);
    expect(allowed(checkSubscriptionActive(makeOrg({ subscriptionStatus: 'Active' })))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Feature flag checks — Animation Studio access model
// ══════════════════════════════════════════════════════════════════════════════
describe('checkStudioVideoAccess — Creator/Pro/Studio only', () => {
  it('allows CREATOR plan', () => {
    expect(allowed(checkStudioVideoAccess(makeOrg({ plan: 'CREATOR' })))).toBe(true);
  });

  it('allows PRO plan', () => {
    expect(allowed(checkStudioVideoAccess(makeOrg({ plan: 'PRO' })))).toBe(true);
  });

  it('allows STUDIO plan', () => {
    expect(allowed(checkStudioVideoAccess(makeOrg({ plan: 'STUDIO' })))).toBe(true);
  });

  it('denies FREE plan — teaser path handled separately', () => {
    const r = checkStudioVideoAccess(makeOrg({ plan: 'FREE', subscriptionStatus: 'ACTIVE' }));
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('PLAN_FEATURE_BLOCKED');
  });

  it('denies PRO plan when costProtectionBlocked', () => {
    const r = checkStudioVideoAccess(makeOrg({ plan: 'PRO', costProtectionBlocked: true }));
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('COST_PROTECTION_BLOCKED');
  });
});

describe('checkGifAccess', () => {
  it('allows CREATOR, PRO and STUDIO plans', () => {
    expect(allowed(checkGifAccess(makeOrg({ plan: 'CREATOR' })))).toBe(true);
    expect(allowed(checkGifAccess(makeOrg({ plan: 'PRO' })))).toBe(true);
    expect(allowed(checkGifAccess(makeOrg({ plan: 'STUDIO' })))).toBe(true);
  });

  it('denies FREE plan', () => {
    expect(denied(checkGifAccess(makeOrg({ plan: 'FREE' })))).toBe(true);
  });
});

describe('checkZipExport', () => {
  it('allows CREATOR and above', () => {
    for (const plan of ['CREATOR', 'PRO', 'STUDIO']) {
      expect(allowed(checkZipExport(makeOrg({ plan })))).toBe(true);
    }
  });

  it('denies FREE plan', () => {
    expect(denied(checkZipExport(makeOrg({ plan: 'FREE' })))).toBe(true);
  });
});

describe('checkBatchGenerate', () => {
  it('allows PRO and STUDIO', () => {
    expect(allowed(checkBatchGenerate(makeOrg({ plan: 'PRO' })))).toBe(true);
    expect(allowed(checkBatchGenerate(makeOrg({ plan: 'STUDIO' })))).toBe(true);
  });

  it('denies FREE and CREATOR', () => {
    expect(denied(checkBatchGenerate(makeOrg({ plan: 'FREE' })))).toBe(true);
    expect(denied(checkBatchGenerate(makeOrg({ plan: 'CREATOR' })))).toBe(true);
  });
});

describe('checkHqUpgrade', () => {
  it('allows CREATOR, PRO and STUDIO', () => {
    expect(allowed(checkHqUpgrade(makeOrg({ plan: 'CREATOR' })))).toBe(true);
    expect(allowed(checkHqUpgrade(makeOrg({ plan: 'PRO' })))).toBe(true);
    expect(allowed(checkHqUpgrade(makeOrg({ plan: 'STUDIO' })))).toBe(true);
  });

  it('denies FREE plan', () => {
    expect(denied(checkHqUpgrade(makeOrg({ plan: 'FREE' })))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Concurrency cap
// ══════════════════════════════════════════════════════════════════════════════
describe('checkConcurrency', () => {
  it('allows when running count is below plan limit', () => {
    expect(allowed(checkConcurrency(makeOrg({ plan: 'PRO' }), 0))).toBe(true);
    expect(allowed(checkConcurrency(makeOrg({ plan: 'PRO' }), 2))).toBe(true);
  });

  it('denies when running count reaches plan limit', () => {
    const r = checkConcurrency(makeOrg({ plan: 'FREE' }), 1);
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('CONCURRENCY_LIMIT');
  });

  it('STUDIO plan has highest concurrency', () => {
    expect(allowed(checkConcurrency(makeOrg({ plan: 'STUDIO' }), 4))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Daily video job cap
// ══════════════════════════════════════════════════════════════════════════════
describe('checkDailyVideoJobs', () => {
  it('allows when today count is below plan limit', () => {
    expect(allowed(checkDailyVideoJobs(makeOrg({ plan: 'PRO' }), 0))).toBe(true);
  });

  it('denies FREE plan at 0 jobs (maxDailyVideoJobs=1, teaser is 1)', () => {
    // FREE plan maxDailyVideoJobs=1; once 1 teaser is used, they are denied
    const r = checkDailyVideoJobs(makeOrg({ plan: 'FREE' }), 1);
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('DAILY_VIDEO_CAP');
  });

  it('allows FREE plan first teaser slot (todayCount=0, maxDailyVideoJobs=1)', () => {
    // The first (and only) teaser slot
    expect(allowed(checkDailyVideoJobs(makeOrg({ plan: 'FREE' }), 0))).toBe(true);
  });

  it('denies when count reaches PRO daily limit', () => {
    const r = checkDailyVideoJobs(makeOrg({ plan: 'PRO' }), 10);
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('DAILY_VIDEO_CAP');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Format & variation caps
// ══════════════════════════════════════════════════════════════════════════════
describe('checkFormats', () => {
  it('allows 1 format on all plans', () => {
    for (const plan of ['FREE', 'CREATOR', 'PRO', 'STUDIO']) {
      expect(allowed(checkFormats(makeOrg({ plan }), 1))).toBe(true);
    }
  });

  it('denies when count exceeds plan maxFormatsPerRun', () => {
    const r = checkFormats(makeOrg({ plan: 'FREE' }), 10);
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('FORMAT_LIMIT');
  });

  it('STUDIO plan allows more formats than FREE', () => {
    expect(allowed(checkFormats(makeOrg({ plan: 'STUDIO' }), 3))).toBe(true);
  });
});

describe('checkVariations', () => {
  it('allows 1 variation on all plans', () => {
    for (const plan of ['FREE', 'CREATOR', 'PRO', 'STUDIO']) {
      expect(allowed(checkVariations(makeOrg({ plan }), 1))).toBe(true);
    }
  });

  it('denies excessive variations on FREE', () => {
    const r = checkVariations(makeOrg({ plan: 'FREE' }), 20);
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('VARIATION_LIMIT');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Resolution gating
// ══════════════════════════════════════════════════════════════════════════════
describe('checkResolution', () => {
  it('allows 1080p on all plans', () => {
    for (const plan of ['FREE', 'CREATOR', 'PRO', 'STUDIO']) {
      expect(allowed(checkResolution(makeOrg({ plan }), '1080p'))).toBe(true);
    }
  });

  it('denies 4K on FREE plan', () => {
    const r = checkResolution(makeOrg({ plan: 'FREE' }), '4K');
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('RESOLUTION_BLOCKED');
  });

  it('denies 4K on CREATOR plan', () => {
    expect(denied(checkResolution(makeOrg({ plan: 'CREATOR' }), '4K'))).toBe(true);
  });

  it('allows 4K on PRO plan', () => {
    expect(allowed(checkResolution(makeOrg({ plan: 'PRO' }), '4K'))).toBe(true);
  });

  it('allows 4K on STUDIO plan', () => {
    expect(allowed(checkResolution(makeOrg({ plan: 'STUDIO' }), '4K'))).toBe(true);
  });

  it('allows undefined resolution (omitted)', () => {
    expect(allowed(checkResolution(makeOrg({ plan: 'FREE' }), undefined as any))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Credit sufficiency
// ══════════════════════════════════════════════════════════════════════════════
describe('checkCredits', () => {
  it('allows when balance exceeds cost', () => {
    expect(allowed(checkCredits(makeOrg({ creditBalance: 100 }), 'video_std'))).toBe(true);
  });

  it('denies when balance is below cost', () => {
    const r = checkCredits(makeOrg({ creditBalance: 0, dailyCreditBalance: 0 }), 'video_std');
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('INSUFFICIENT_CREDITS');
  });

  it('FREE plan teaser: first Normal Ad of day passes with 0 credits (todayNormalAdCount=0)', () => {
    const freeOrg = makeOrg({ plan: 'FREE', creditBalance: 0, dailyCreditBalance: 0 });
    expect(allowed(checkCredits(freeOrg, 'normal_ad', 0))).toBe(true);
  });

  it('FREE plan teaser: second Normal Ad of day is denied — no credits', () => {
    const freeOrg = makeOrg({ plan: 'FREE', creditBalance: 0, dailyCreditBalance: 0 });
    const r = checkCredits(freeOrg, 'normal_ad', 1);
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('INSUFFICIENT_CREDITS');
  });

  it('FREE plan: Cinematic Ad always requires credits (no free teaser for cinematic)', () => {
    const freeOrg = makeOrg({ plan: 'FREE', creditBalance: 0, dailyCreditBalance: 0 });
    const r = checkCredits(freeOrg, 'cinematic_ad', 0);
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('INSUFFICIENT_CREDITS');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// preflightJob — composite check ordering
// ══════════════════════════════════════════════════════════════════════════════
describe('preflightJob — composite checks', () => {
  const origEnv = process.env;
  afterEach(() => { process.env = { ...origEnv }; });

  const healthyOrg = () => makeOrg({
    plan:                 'PRO',
    creditBalance:        200,
    dailyCreditBalance:   200,
    subscriptionStatus:   'ACTIVE',
    costProtectionBlocked: false,
    userHourlyJobCount:   0,
    userDailyJobCount:    0,
    globalMonthlySpendUsd: 0,
    orgAssetCount:        10,
  });

  it('allows a fully healthy PRO org video job submission', () => {
    expect(allowed(preflightJob({
      org:            healthyOrg(),
      reason:         'video_std',
      currentRunning: 0,
    }))).toBe(true);
  });

  it('kill-switch takes priority over everything else', () => {
    process.env.GENERATION_KILL_SWITCH = 'true';
    const r = preflightJob({
      org:            healthyOrg(),
      reason:         'video_std',
      currentRunning: 0,
    });
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('KILL_SWITCH_ACTIVE');
  });

  it('insufficient credits blocks even with valid subscription', () => {
    const r = preflightJob({
      org:            makeOrg({ creditBalance: 0, dailyCreditBalance: 0 }),
      reason:         'video_std',
      currentRunning: 0,
    });
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('INSUFFICIENT_CREDITS');
  });

  it('canceled subscription blocks job', () => {
    const r = preflightJob({
      org:            makeOrg({ subscriptionStatus: 'CANCELED' }),
      reason:         'video_std',
      currentRunning: 0,
    });
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('SUBSCRIPTION_CANCELED');
  });

  it('concurrency cap blocks additional jobs', () => {
    const r = preflightJob({
      org:            makeOrg({ plan: 'FREE', creditBalance: 100, dailyCreditBalance: 100, subscriptionStatus: 'ACTIVE' }),
      reason:         'video_std',
      currentRunning: 1,
    });
    expect(denied(r)).toBe(true);
  });

  it('4K resolution gating is checked when resolution provided', () => {
    const r = preflightJob({
      org:            makeOrg({ plan: 'FREE', creditBalance: 100, dailyCreditBalance: 100 }),
      reason:         'video_std',
      currentRunning: 0,
      resolution:     '4K',
    });
    expect(denied(r)).toBe(true);
  });

  it('format cap is checked', () => {
    const r = preflightJob({
      org:              healthyOrg(),
      reason:           'video_std',
      currentRunning:   0,
      requestedFormats: 100,
    });
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('FORMAT_LIMIT');
  });

  it('variation cap is checked', () => {
    const r = preflightJob({
      org:                  healthyOrg(),
      reason:               'video_std',
      currentRunning:       0,
      requestedVariations:  100,
    });
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('VARIATION_LIMIT');
  });

  it('returns first denial and does not accumulate multiple errors', () => {
    process.env.GENERATION_KILL_SWITCH = 'true';
    const r = preflightJob({
      org:            makeOrg({ subscriptionStatus: 'CANCELED', creditBalance: 0, dailyCreditBalance: 0 }),
      reason:         'video_std',
      currentRunning: 99,
    });
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('KILL_SWITCH_ACTIVE');
  });

  it('FREE plan video job (non-teaser path) is denied — PLAN_FEATURE_BLOCKED', () => {
    const r = preflightJob({
      org:            makeOrg({ plan: 'FREE', creditBalance: 100, dailyCreditBalance: 100 }),
      reason:         'video_std',
      currentRunning: 0,
      todayVideoJobs: 0,
      isTeaserPath:   false,
    });
    expect(denied(r)).toBe(true);
    if (!r.allowed) expect(r.code).toBe('PLAN_FEATURE_BLOCKED');
  });

  it('FREE plan teaser path (isTeaserPath=true) is allowed for first Normal Ad', () => {
    const r = preflightJob({
      org:               makeOrg({ plan: 'FREE', creditBalance: 0, dailyCreditBalance: 0 }),
      reason:            'normal_ad',
      currentRunning:    0,
      todayVideoJobs:    0,
      todayNormalAdCount: 0,
      isTeaserPath:      true,
    });
    expect(allowed(r)).toBe(true);
  });

  it('FREE plan teaser path is denied once teaser quota is exhausted', () => {
    // todayVideoJobs=1 means the 1 allowed teaser has already been used
    const r = preflightJob({
      org:               makeOrg({ plan: 'FREE', creditBalance: 0, dailyCreditBalance: 0 }),
      reason:            'normal_ad',
      currentRunning:    0,
      todayVideoJobs:    1,
      todayNormalAdCount: 1,
      isTeaserPath:      true,
    });
    expect(denied(r)).toBe(true);
  });

  it('CREATOR plan video job is allowed with sufficient credits', () => {
    const r = preflightJob({
      org:            makeOrg({ plan: 'CREATOR', creditBalance: 200, dailyCreditBalance: 200 }),
      reason:         'normal_ad',
      currentRunning: 0,
      todayVideoJobs: 0,
    });
    expect(allowed(r)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EnforcementResult shape guarantee
// ══════════════════════════════════════════════════════════════════════════════
describe('EnforcementResult — shape guarantee', () => {
  it('allowed result has exactly { allowed: true }', () => {
    const r = checkUserHourlyRate(0);
    expect(r.allowed).toBe(true);
    expect((r as any).reason).toBeUndefined();
  });

  it('denied result has reason, code, and httpStatus', () => {
    process.env.GENERATION_KILL_SWITCH = 'true';
    const r = checkKillSwitch();
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(0);
      expect(typeof r.code).toBe('string');
      expect(r.code.length).toBeGreaterThan(0);
      expect(typeof r.httpStatus).toBe('number');
      expect(r.httpStatus).toBeGreaterThanOrEqual(400);
    }
    delete process.env.GENERATION_KILL_SWITCH;
  });

  it('all denial codes are SCREAMING_SNAKE_CASE', () => {
    process.env.GENERATION_KILL_SWITCH = 'true';
    const killResult = checkKillSwitch();
    delete process.env.GENERATION_KILL_SWITCH;

    for (const r of [killResult, checkUserHourlyRate(999), checkUserDailyRate(999)]) {
      if (!r.allowed) {
        expect(r.code).toMatch(/^[A-Z0-9_]+$/);
      }
    }
  });
});
