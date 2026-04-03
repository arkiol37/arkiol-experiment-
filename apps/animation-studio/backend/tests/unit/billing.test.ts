/**
 * billing.test.ts — V15
 *
 * Uses @arkiol/shared as the SINGLE SOURCE OF TRUTH for all plan and credit constants.
 *
 * ACCESS MODEL:
 *   Animation Studio = Creator, Pro, Studio plans (canUseStudioVideo=true).
 *   Free plan = TEASER ONLY (canUseStudioVideo=false).
 *   Normal Ads = 20 credits, Cinematic Ads = 35 credits. These are canonical and fixed.
 *
 * Covers:
 *  - Plan definitions (FREE / CREATOR / PRO / STUDIO)
 *  - Credit cost keys
 *  - Studio render mode → credit key mapping
 *  - Top-up pack definitions
 *  - Margin analysis
 *  - Plan resolution (legacy alias handling)
 */

import {
  PLANS,
  CREDIT_COSTS,
  TOPUP_PACKS,
  STUDIO_RENDER_MODE_MAP,
  studioRenderModeToCreditKey,
  resolvePlan,
  getPlanConfig,
} from '@arkiol/shared';

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------
describe('Plans — shape and ordering', () => {
  const planKeys = ['FREE', 'CREATOR', 'PRO', 'STUDIO'] as const;

  test('all canonical plans are exported', () => {
    for (const key of planKeys) {
      expect(PLANS[key]).toBeDefined();
    }
  });

  test('all plans have required fields', () => {
    for (const key of planKeys) {
      const plan = PLANS[key];
      expect(typeof plan.credits).toBe('number');
      expect(typeof plan.priceUsd).toBe('number');
      expect(typeof plan.members).toBe('number');
      expect(typeof plan.brands).toBe('number');
      expect(typeof plan.maxConcurrency).toBe('number');
      expect(typeof plan.canUseStudioVideo).toBe('boolean');
      expect(typeof plan.canUseGifMotion).toBe('boolean');
      expect(typeof plan.canUseZipExport).toBe('boolean');
      expect(typeof plan.rolloverPct).toBe('number');
    }
  });

  test('monthly credits increase from FREE → STUDIO', () => {
    // FREE has 0 monthly credits — access is via freeDailyNormalAds teaser (1 free watermarked Normal Ad/day)
    expect(PLANS.FREE.credits).toBe(0);
    expect(PLANS.FREE.freeDailyNormalAds).toBeGreaterThan(0);
    // Paid plans have increasing monthly grants
    expect(PLANS.CREATOR.credits).toBeGreaterThan(0);
    expect(PLANS.PRO.credits).toBeGreaterThan(PLANS.CREATOR.credits);
    expect(PLANS.STUDIO.credits).toBeGreaterThan(PLANS.PRO.credits);
  });

  test('price increases with tier', () => {
    expect(PLANS.FREE.priceUsd).toBe(0);
    expect(PLANS.CREATOR.priceUsd).toBeGreaterThan(0);
    expect(PLANS.PRO.priceUsd).toBeGreaterThan(PLANS.CREATOR.priceUsd);
    expect(PLANS.STUDIO.priceUsd).toBeGreaterThan(PLANS.PRO.priceUsd);
  });

  test('concurrency increases with tier', () => {
    expect(PLANS.FREE.maxConcurrency).toBeLessThanOrEqual(PLANS.CREATOR.maxConcurrency);
    expect(PLANS.CREATOR.maxConcurrency).toBeLessThanOrEqual(PLANS.PRO.maxConcurrency);
    expect(PLANS.PRO.maxConcurrency).toBeLessThanOrEqual(PLANS.STUDIO.maxConcurrency);
  });

  test('Animation Studio is accessible to Creator, Pro, and Studio only', () => {
    // Free plan is teaser-only — canUseStudioVideo must be false
    expect(PLANS.FREE.canUseStudioVideo).toBe(false);
    // Paid plans have full access
    expect(PLANS.CREATOR.canUseStudioVideo).toBe(true);
    expect(PLANS.PRO.canUseStudioVideo).toBe(true);
    expect(PLANS.STUDIO.canUseStudioVideo).toBe(true);
  });

  test('Free plan teaser: 1 watermarked Normal Ad per day, no credits required', () => {
    expect(PLANS.FREE.freeDailyNormalAds).toBe(1);
    expect(PLANS.FREE.freeWatermarkEnabled).toBe(true);
    expect(PLANS.FREE.maxDailyVideoJobs).toBe(1);
  });

  test('paid plans have no free daily Normal Ad allowance', () => {
    expect(PLANS.CREATOR.freeDailyNormalAds).toBe(0);
    expect(PLANS.PRO.freeDailyNormalAds).toBe(0);
    expect(PLANS.STUDIO.freeDailyNormalAds).toBe(0);
  });

  test('GIF motion export gated at Creator and above', () => {
    expect(PLANS.FREE.canUseGifMotion).toBe(false);
    expect(PLANS.CREATOR.canUseGifMotion).toBe(true);
    expect(PLANS.PRO.canUseGifMotion).toBe(true);
    expect(PLANS.STUDIO.canUseGifMotion).toBe(true);
  });

  test('ZIP export gated at CREATOR and above', () => {
    expect(PLANS.FREE.canUseZipExport).toBe(false);
    expect(PLANS.CREATOR.canUseZipExport).toBe(true);
    expect(PLANS.PRO.canUseZipExport).toBe(true);
    expect(PLANS.STUDIO.canUseZipExport).toBe(true);
  });

  test('rollover only applies to PRO and STUDIO', () => {
    expect(PLANS.FREE.rolloverPct).toBe(0);
    expect(PLANS.CREATOR.rolloverPct).toBe(0);
    expect(PLANS.PRO.rolloverPct).toBeGreaterThan(0);
    expect(PLANS.STUDIO.rolloverPct).toBeGreaterThanOrEqual(PLANS.PRO.rolloverPct);
  });

  test('watermark only on FREE plan', () => {
    expect(PLANS.FREE.freeWatermarkEnabled).toBe(true);
    expect(PLANS.CREATOR.freeWatermarkEnabled).toBe(false);
    expect(PLANS.PRO.freeWatermarkEnabled).toBe(false);
    expect(PLANS.STUDIO.freeWatermarkEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Credit costs
// ---------------------------------------------------------------------------
describe('Credit costs — canonical keys', () => {
  const expectedKeys: (keyof typeof CREDIT_COSTS)[] = [
    'static', 'gif', 'video_std', 'video_hq', 'normal_ad', 'cinematic_ad', 'export_zip',
  ];

  test('all canonical credit cost keys are present', () => {
    for (const key of expectedKeys) {
      expect(CREDIT_COSTS[key]).toBeGreaterThan(0);
    }
  });

  test('costs escalate: static < gif < video_std/normal_ad < video_hq/cinematic_ad', () => {
    expect(CREDIT_COSTS.static).toBeLessThan(CREDIT_COSTS.gif);
    expect(CREDIT_COSTS.gif).toBeLessThan(CREDIT_COSTS.video_std);
    expect(CREDIT_COSTS.video_std).toBeLessThan(CREDIT_COSTS.video_hq);
    // Launch modes: Normal Ads=20, Cinematic Ads=35
    expect(CREDIT_COSTS.normal_ad).toBe(20);
    expect(CREDIT_COSTS.cinematic_ad).toBe(35);
  });

  test('video_std aliases normal_ad exactly', () => {
    expect(CREDIT_COSTS.video_std).toBe(CREDIT_COSTS.normal_ad);
  });

  test('video_hq aliases cinematic_ad exactly', () => {
    expect(CREDIT_COSTS.video_hq).toBe(CREDIT_COSTS.cinematic_ad);
  });

  test('all credit costs are positive integers', () => {
    for (const [, val] of Object.entries(CREDIT_COSTS)) {
      expect(Number.isInteger(val)).toBe(true);
      expect(val).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Studio render mode → credit key mapping
// ---------------------------------------------------------------------------
describe('studioRenderModeToCreditKey', () => {
  test('maps Normal Ad to normal_ad', () => {
    expect(studioRenderModeToCreditKey('Normal Ad')).toBe('normal_ad');
  });

  test('maps Cinematic Ad to cinematic_ad', () => {
    expect(studioRenderModeToCreditKey('Cinematic Ad')).toBe('cinematic_ad');
  });

  test('maps legacy 2D Standard to normal_ad', () => {
    expect(studioRenderModeToCreditKey('2D Standard')).toBe('normal_ad');
  });

  test('maps legacy Premium Cinematic to cinematic_ad', () => {
    expect(studioRenderModeToCreditKey('Premium Cinematic')).toBe('cinematic_ad');
  });

  test('unknown render mode falls back to normal_ad without throwing', () => {
    expect(() => studioRenderModeToCreditKey('Unknown Mode')).not.toThrow();
    expect(studioRenderModeToCreditKey('Unknown Mode')).toBe('normal_ad');
  });

  test('all entries in STUDIO_RENDER_MODE_MAP resolve to valid credit cost keys', () => {
    for (const mode of Object.keys(STUDIO_RENDER_MODE_MAP)) {
      const key = studioRenderModeToCreditKey(mode);
      expect(CREDIT_COSTS[key]).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Top-up packs
// ---------------------------------------------------------------------------
describe('TOPUP_PACKS', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(TOPUP_PACKS)).toBe(true);
    expect(TOPUP_PACKS.length).toBeGreaterThan(0);
  });

  test('each pack has required fields with valid values', () => {
    for (const pack of TOPUP_PACKS) {
      expect(typeof pack.id).toBe('string');
      expect(pack.id.length).toBeGreaterThan(0);
      expect(typeof pack.credits).toBe('number');
      expect(pack.credits).toBeGreaterThan(0);
      expect(typeof pack.priceCents).toBe('number');
      expect(pack.priceCents).toBeGreaterThan(0);
      expect(typeof pack.priceUsd).toBe('number');
      expect(pack.priceUsd).toBeGreaterThan(0);
    }
  });

  test('top-up packs are ordered by credit amount ascending', () => {
    for (let i = 1; i < TOPUP_PACKS.length; i++) {
      expect(TOPUP_PACKS[i].credits).toBeGreaterThanOrEqual(TOPUP_PACKS[i - 1].credits);
    }
  });
});

// ---------------------------------------------------------------------------
// Plan resolution — legacy aliases
// ---------------------------------------------------------------------------
describe('resolvePlan — legacy alias handling', () => {
  test('resolves canonical uppercase keys', () => {
    expect(resolvePlan('FREE')).toBe('FREE');
    expect(resolvePlan('CREATOR')).toBe('CREATOR');
    expect(resolvePlan('PRO')).toBe('PRO');
    expect(resolvePlan('STUDIO')).toBe('STUDIO');
  });

  test('resolves lowercase aliases', () => {
    expect(resolvePlan('free')).toBe('FREE');
    expect(resolvePlan('creator')).toBe('CREATOR');
    expect(resolvePlan('pro')).toBe('PRO');
    expect(resolvePlan('studio')).toBe('STUDIO');
  });

  test('resolves retired aliases to correct canonical plans', () => {
    expect(resolvePlan('scale')).toBe('STUDIO');
    expect(resolvePlan('enterprise')).toBe('STUDIO');
    expect(resolvePlan('starter')).toBe('CREATOR');
    expect(resolvePlan('STARTER')).toBe('CREATOR');
    expect(resolvePlan('ENTERPRISE')).toBe('STUDIO');
  });

  test('unknown plan falls back to FREE', () => {
    expect(resolvePlan('unknown_plan_xyz')).toBe('FREE');
  });

  test('getPlanConfig returns correct config for known plan', () => {
    const cfg = getPlanConfig('PRO');
    expect(cfg).toEqual(PLANS.PRO);
    expect(cfg.canUseStudioVideo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Margin analysis — top-up packs vs subscription cost per credit
// ---------------------------------------------------------------------------
describe('Top-up pack pricing — cheaper than subscription on a per-credit basis', () => {
  test('pack_200 is cheaper per credit than Creator subscription', () => {
    const creatorCostPerCredit = PLANS.CREATOR.priceUsd / PLANS.CREATOR.credits;
    const pack = TOPUP_PACKS.find(p => p.id === 'pack_200');
    if (pack) {
      const packCostPerCredit = pack.priceUsd / pack.credits;
      expect(packCostPerCredit).toBeLessThan(creatorCostPerCredit);
    }
  });
});
