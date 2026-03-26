/**
 * billing.test.ts — V15
 *
 * Uses @arkiol/shared as the SINGLE SOURCE OF TRUTH for all plan and credit constants.
 * No longer imports the deleted apps/animation-studio/backend/src/billing/billingService.ts.
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

  test('monthly credits increase with tier (FREE uses daily bucket)', () => {
    // FREE has 0 monthly credits — uses daily bucket (freeDailyCreditsPerDay)
    expect(PLANS.FREE.credits).toBe(0);
    expect(PLANS.FREE.freeDailyCreditsPerDay).toBeGreaterThan(0);
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

  test('video features gated at PRO and above', () => {
    expect(PLANS.FREE.canUseStudioVideo).toBe(false);
    expect(PLANS.CREATOR.canUseStudioVideo).toBe(false);
    expect(PLANS.PRO.canUseStudioVideo).toBe(true);
    expect(PLANS.STUDIO.canUseStudioVideo).toBe(true);
  });

  test('GIF motion gated at PRO and above', () => {
    expect(PLANS.FREE.canUseGifMotion).toBe(false);
    expect(PLANS.CREATOR.canUseGifMotion).toBe(false);
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

  test('ZIP export cost is low (batch convenience feature)', () => {
    expect(CREDIT_COSTS.export_zip).toBeGreaterThan(0);
    expect(CREDIT_COSTS.export_zip).toBeLessThan(CREDIT_COSTS.video_std);
  });
});

// ---------------------------------------------------------------------------
// Studio render mode → credit key mapping
// ---------------------------------------------------------------------------
describe('Studio render mode mapping', () => {
  const modeFixtures: Array<[string, keyof typeof CREDIT_COSTS]> = [
    ['Normal Ad',       'video_std'],
    ['2D Extended',       'video_std'],
    ['Cinematic Ad', 'video_hq'],
    ['Cinematic Ad',      'cinematic_ad'],
    ['Normal Ad',         'normal_ad'],
  ];

  test('all studio render modes map to a canonical credit key', () => {
    for (const [mode] of modeFixtures) {
      expect(STUDIO_RENDER_MODE_MAP[mode]).toBeDefined();
    }
  });

  test.each(modeFixtures)('"%s" maps to %s', (mode, expectedKey) => {
    expect(studioRenderModeToCreditKey(mode)).toBe(expectedKey);
  });

  test('unknown render mode falls back to video_std', () => {
    expect(studioRenderModeToCreditKey('Unknown Mode')).toBe('video_std');
  });

  test('Cinematic Ad (35cr) costs more than Normal Ad (20cr)', () => {
    expect(CREDIT_COSTS.cinematic_ad).toBeGreaterThan(CREDIT_COSTS.normal_ad);
    expect(CREDIT_COSTS.cinematic_ad).toBe(35);
    expect(CREDIT_COSTS.normal_ad).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Top-up packs
// ---------------------------------------------------------------------------
describe('Top-up packs', () => {
  test('at least one top-up pack is defined', () => {
    expect(TOPUP_PACKS.length).toBeGreaterThan(0);
  });

  test('all packs have required fields', () => {
    for (const pack of TOPUP_PACKS) {
      expect(typeof pack.id).toBe('string');
      expect(typeof pack.name).toBe('string');
      expect(pack.credits).toBeGreaterThan(0);
      expect(pack.priceUsd).toBeGreaterThan(0);
      expect(pack.priceCents).toBe(pack.priceUsd * 100);
      expect(['end_of_cycle', 'never']).toContain(pack.expiryPolicy);
    }
  });

  test('pack IDs are unique', () => {
    const ids = TOPUP_PACKS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('larger packs offer better value (credits per dollar)', () => {
    const sorted = [...TOPUP_PACKS].sort((a, b) => a.credits - b.credits);
    if (sorted.length >= 2) {
      const cheapest  = sorted[0].credits  / sorted[0].priceUsd;
      const expensive = sorted[sorted.length - 1].credits / sorted[sorted.length - 1].priceUsd;
      // Larger packs should be at least as good value per credit
      expect(expensive).toBeGreaterThanOrEqual(cheapest);
    }
  });
});

// ---------------------------------------------------------------------------
// Plan resolution (legacy alias handling)
// ---------------------------------------------------------------------------
describe('Plan resolution — legacy aliases', () => {
  const aliases: Array<[string, string]> = [
['free',       'FREE'],      // canonical lowercase
    ['pro',        'PRO'],
    // Legacy DB values — kept for migration safety, map to nearest canonical
    ['scale',      'STUDIO'],    // retired alias → STUDIO
    ['enterprise', 'STUDIO'],   // retired alias → STUDIO
    ['STARTER',    'CREATOR'],  // pre-v15 DB rows → CREATOR
    ['ENTERPRISE', 'STUDIO'],   // pre-v15 DB rows → STUDIO
    ['FREE',       'FREE'],
    ['CREATOR',    'CREATOR'],
    ['PRO',        'PRO'],
    ['STUDIO',     'STUDIO'],
  ];

  test.each(aliases)('resolvePlan("%s") → %s', (input, expected) => {
    expect(resolvePlan(input)).toBe(expected);
  });

  test('unknown plan resolves to FREE', () => {
    expect(resolvePlan('UNKNOWN_PLAN_XYZ')).toBe('FREE');
  });

  test('getPlanConfig returns correct config for resolved plan', () => {
    const cfg = getPlanConfig('STARTER');  // legacy DB value resolves to CREATOR via LEGACY_PLAN_MAP
    expect(cfg).toEqual(PLANS.CREATOR);
  });
});

// ---------------------------------------------------------------------------
// Margin analysis (sanity check on credit cost model)
// ---------------------------------------------------------------------------
describe('Margin analysis', () => {
  test('video_std render at PRO pricing covers variable cost', () => {
    const creditCost = CREDIT_COSTS.normal_ad;  // 20 credits (Normal Ad / 2D launch config)
    const pricePerCredit = PLANS.PRO.priceUsd / PLANS.PRO.credits; // $/credit at PRO
    const revenuePerRender = creditCost * pricePerCredit;
    // PRO: $79/1700 credits ≈ $0.0465/credit; 20 credits ≈ $0.93 revenue per Normal Ad
    // GPU cost for a 2D render should be well under $1
    const estimatedGpuCost = 0.50; // conservative $0.50 per render
    expect(revenuePerRender).toBeGreaterThan(estimatedGpuCost);
  });

  test('static generation is high margin at all paid tiers', () => {
    const creditCost = CREDIT_COSTS.static; // 1 credit
    for (const key of ['CREATOR', 'PRO', 'STUDIO'] as const) {
      const plan = PLANS[key];
      const pricePerCredit = plan.priceUsd / plan.credits;
      const revenue = creditCost * pricePerCredit;
      // Static gen GPU cost is near $0, so any positive revenue is margin-positive
      expect(revenue).toBeGreaterThan(0);
    }
  });
});
