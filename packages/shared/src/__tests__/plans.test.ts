/**
 * packages/shared/src/__tests__/plans.test.ts
 *
 * Unit tests for the shared plans, credit costs, and plan-enforcement logic.
 * No database, no network — pure logic only.
 *
 * ACCESS MODEL UNDER TEST:
 *   Animation Studio = Creator, Pro, Studio plans (canUseStudioVideo=true).
 *   Free plan = teaser only (canUseStudioVideo=false).
 *   Credit costs: Normal Ads = 20 cr, Cinematic Ads = 35 cr.
 */

import {
  PLANS,
  CREDIT_COSTS,
  TOPUP_PACKS,
  STUDIO_RENDER_MODE_MAP,
  studioRenderModeToCreditKey,
  resolvePlan,
  getPlanConfig,
} from '../plans';

import {
  checkSubscriptionActive,
  checkStudioVideoAccess,
  preflightJob,
} from '../planEnforcer';

// ── Plan shape ────────────────────────────────────────────────────────────────
describe('PLANS — shape and ordering', () => {
  const CANONICAL = ['FREE', 'CREATOR', 'PRO', 'STUDIO'] as const;

  it('exports all four canonical plans', () => {
    for (const key of CANONICAL) {
      expect(PLANS[key]).toBeDefined();
    }
  });

  it('all plans have required fields', () => {
    for (const key of CANONICAL) {
      const p = PLANS[key];
      expect(typeof p.credits).toBe('number');
      expect(typeof p.maxConcurrency).toBe('number');
      expect(typeof p.maxDailyVideoJobs).toBe('number');
      expect(typeof p.canUseStudioVideo).toBe('boolean');
    }
  });

  it('credit allowance increases from FREE → STUDIO', () => {
    expect(PLANS.FREE.credits).toBeLessThanOrEqual(PLANS.CREATOR.credits);
    expect(PLANS.CREATOR.credits).toBeLessThanOrEqual(PLANS.PRO.credits);
    expect(PLANS.PRO.credits).toBeLessThanOrEqual(PLANS.STUDIO.credits);
  });

  it('FREE plan cannot use full Animation Studio (teaser only)', () => {
    expect(PLANS.FREE.canUseStudioVideo).toBe(false);
  });

  it('FREE plan has teaser: 1 free watermarked Normal Ad per day', () => {
    expect(PLANS.FREE.freeDailyNormalAds).toBe(1);
    expect(PLANS.FREE.freeWatermarkEnabled).toBe(true);
    expect(PLANS.FREE.maxDailyVideoJobs).toBe(1);
  });

  it('CREATOR, PRO, and STUDIO plans have full Animation Studio access', () => {
    expect(PLANS.CREATOR.canUseStudioVideo).toBe(true);
    expect(PLANS.PRO.canUseStudioVideo).toBe(true);
    expect(PLANS.STUDIO.canUseStudioVideo).toBe(true);
  });

  it('paid plans have no free daily Normal Ad allowance', () => {
    expect(PLANS.CREATOR.freeDailyNormalAds).toBe(0);
    expect(PLANS.PRO.freeDailyNormalAds).toBe(0);
    expect(PLANS.STUDIO.freeDailyNormalAds).toBe(0);
  });

  it('paid plans have no watermark', () => {
    expect(PLANS.CREATOR.freeWatermarkEnabled).toBe(false);
    expect(PLANS.PRO.freeWatermarkEnabled).toBe(false);
    expect(PLANS.STUDIO.freeWatermarkEnabled).toBe(false);
  });
});

// ── CREDIT_COSTS ──────────────────────────────────────────────────────────────
describe('CREDIT_COSTS — all cost keys are positive integers', () => {
  it('has a static cost key', () => {
    expect(typeof CREDIT_COSTS.static).toBe('number');
    expect(CREDIT_COSTS.static).toBeGreaterThan(0);
  });

  it('video_std costs more than static', () => {
    expect(CREDIT_COSTS.video_std).toBeGreaterThan(CREDIT_COSTS.static);
  });

  it('launch modes have correct credit costs — canonical values', () => {
    expect(CREDIT_COSTS.normal_ad).toBe(20);     // Normal Ads (2D)
    expect(CREDIT_COSTS.cinematic_ad).toBe(35);  // Cinematic Ads (2.5D)
    expect(CREDIT_COSTS.video_std).toBe(20);     // maps to normal_ad
    expect(CREDIT_COSTS.video_hq).toBe(35);      // maps to cinematic_ad
  });

  it('all cost values are positive integers', () => {
    for (const [key, val] of Object.entries(CREDIT_COSTS)) {
      expect(Number.isInteger(val)).toBe(true);
      expect(val).toBeGreaterThan(0);
    }
  });
});

// ── resolvePlan / getPlanConfig ────────────────────────────────────────────────
describe('resolvePlan', () => {
  it('returns the plan for known keys', () => {
    expect(getPlanConfig('FREE')).toEqual(PLANS.FREE);
    expect(getPlanConfig('PRO')).toEqual(PLANS.PRO);
  });

  it('resolves legacy aliases without throwing', () => {
    const result = resolvePlan('pro');
    expect(result).toBeDefined();
  });
});

// ── studioRenderModeToCreditKey ────────────────────────────────────────────────
describe('studioRenderModeToCreditKey', () => {
  it('maps every entry in STUDIO_RENDER_MODE_MAP', () => {
    for (const mode of Object.keys(STUDIO_RENDER_MODE_MAP)) {
      const key = studioRenderModeToCreditKey(mode);
      expect(key).toBeDefined();
      expect(typeof CREDIT_COSTS[key as keyof typeof CREDIT_COSTS]).toBe('number');
    }
  });

  it('maps Normal Ad to normal_ad (20 cr)', () => {
    const key = studioRenderModeToCreditKey('Normal Ad');
    expect(key).toBe('normal_ad');
    expect(CREDIT_COSTS[key]).toBe(20);
  });

  it('maps Cinematic Ad to cinematic_ad (35 cr)', () => {
    const key = studioRenderModeToCreditKey('Cinematic Ad');
    expect(key).toBe('cinematic_ad');
    expect(CREDIT_COSTS[key]).toBe(35);
  });
});

// ── TOPUP_PACKS ───────────────────────────────────────────────────────────────
describe('TOPUP_PACKS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(TOPUP_PACKS)).toBe(true);
    expect(TOPUP_PACKS.length).toBeGreaterThan(0);
  });

  it('each pack has credits, priceCents, and id', () => {
    for (const pack of TOPUP_PACKS) {
      expect(typeof pack.credits).toBe('number');
      expect(pack.credits).toBeGreaterThan(0);
      expect(typeof pack.priceCents).toBe('number');
      expect(pack.priceCents).toBeGreaterThan(0);
    }
  });
});

// ── checkSubscriptionActive ───────────────────────────────────────────────────
describe('checkSubscriptionActive', () => {
  const base = {
    orgId: 'test-org', plan: 'PRO', creditBalance: 500, dailyCreditBalance: 0,
    gracePeriodEndsAt: null, costProtectionBlocked: false,
  };

  it('allows ACTIVE subscription', () => {
    expect(checkSubscriptionActive({ ...base, subscriptionStatus: 'ACTIVE' }).allowed).toBe(true);
  });

  it('blocks CANCELLED subscription', () => {
    expect(checkSubscriptionActive({ ...base, subscriptionStatus: 'CANCELED' }).allowed).toBe(false);
  });

  it('blocks PAST_DUE with expired grace period', () => {
    const snap = {
      ...base,
      subscriptionStatus: 'PAST_DUE',
      gracePeriodEndsAt: new Date(Date.now() - 1000),
    };
    expect(checkSubscriptionActive(snap).allowed).toBe(false);
  });

  it('allows PAST_DUE within active grace period', () => {
    const snap = {
      ...base,
      subscriptionStatus: 'PAST_DUE',
      gracePeriodEndsAt: new Date(Date.now() + 24 * 3600 * 1000),
    };
    expect(checkSubscriptionActive(snap).allowed).toBe(true);
  });
});

// ── checkStudioVideoAccess ────────────────────────────────────────────────────
describe('checkStudioVideoAccess', () => {
  const makeSnap = (plan: string) => ({
    orgId: 'o', plan, creditBalance: 500, dailyCreditBalance: 0,
    subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null, costProtectionBlocked: false,
  });

  it('denies FREE plan — teaser only, not full Studio access', () => {
    expect(checkStudioVideoAccess(makeSnap('FREE')).allowed).toBe(false);
  });

  it('allows CREATOR plan', () => {
    expect(checkStudioVideoAccess(makeSnap('CREATOR')).allowed).toBe(true);
  });

  it('allows PRO plan', () => {
    expect(checkStudioVideoAccess(makeSnap('PRO')).allowed).toBe(true);
  });

  it('allows STUDIO plan', () => {
    expect(checkStudioVideoAccess(makeSnap('STUDIO')).allowed).toBe(true);
  });
});

// ── preflightJob ──────────────────────────────────────────────────────────────
describe('preflightJob', () => {
  const proSnap = {
    orgId: 'o', plan: 'PRO', creditBalance: 500, dailyCreditBalance: 0,
    subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null, costProtectionBlocked: false,
  };

  it('allows a valid static job on PRO', () => {
    const r = preflightJob({ org: proSnap, reason: 'static', currentRunning: 0 });
    expect(r.allowed).toBe(true);
  });

  it('blocks when concurrency cap is reached', () => {
    const plan = getPlanConfig('PRO');
    const r = preflightJob({ org: proSnap, reason: 'static', currentRunning: plan.maxConcurrency });
    expect(r.allowed).toBe(false);
    expect((r as any).code).toMatch(/concurrency/i);
  });

  it('blocks when cost protection is active (video jobs only)', () => {
    const blocked = { ...proSnap, costProtectionBlocked: true };
    const video   = preflightJob({ org: blocked, reason: 'video_std', currentRunning: 0, todayVideoJobs: 0 });
    expect(video.allowed).toBe(false);
    expect((video as any).code).toBe('COST_PROTECTION_BLOCKED');
    const stat = preflightJob({ org: blocked, reason: 'static', currentRunning: 0 });
    expect(stat.allowed).toBe(true);
  });

  it('blocks when credit balance is insufficient', () => {
    const broke = { ...proSnap, creditBalance: 0, dailyCreditBalance: 0 };
    const r = preflightJob({ org: broke, reason: 'video_std', currentRunning: 0, todayVideoJobs: 0 });
    expect(r.allowed).toBe(false);
  });

  it('FREE plan teaser: 1 free watermarked Normal Ad per day via isTeaserPath', () => {
    const freeSnap = {
      orgId: 'o', plan: 'FREE', creditBalance: 0, dailyCreditBalance: 0,
      subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null, costProtectionBlocked: false,
    };
    // First Normal Ad of the day: allowed via teaser path
    const r1 = preflightJob({
      org: freeSnap, reason: 'normal_ad', currentRunning: 0,
      todayVideoJobs: 0, todayNormalAdCount: 0, isTeaserPath: true,
    });
    expect(r1.allowed).toBe(true);

    // Free user trying full Studio (non-teaser): blocked
    const r2 = preflightJob({
      org: freeSnap, reason: 'normal_ad', currentRunning: 0,
      todayVideoJobs: 0, todayNormalAdCount: 0, isTeaserPath: false,
    });
    expect(r2.allowed).toBe(false);
    expect((r2 as any).code).toBe('PLAN_FEATURE_BLOCKED');
  });

  it('studioRenderModeToCreditKey maps Normal Ad and Cinematic Ad correctly', () => {
    const key = studioRenderModeToCreditKey('Normal Ad');
    expect(key).toBe('normal_ad');
    const keyCinematic = studioRenderModeToCreditKey('Cinematic Ad');
    expect(keyCinematic).toBe('cinematic_ad');
  });
});
