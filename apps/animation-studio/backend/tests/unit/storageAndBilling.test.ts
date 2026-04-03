/**
 * apps/animation-studio/backend/tests/unit/storageAndBilling.test.ts
 *
 * Unit tests for:
 *  - services/storageService.ts  → validateAssetUpload (pure function)
 *  - billing/billingService.ts   → PLANS, CREDIT_COSTS re-exports from @arkiol/shared
 *
 * No DB, no S3, no network.
 *
 * FIXES applied (v15-fix):
 *  - Removed import of non-existent ADDONS export (ADDONS does not exist in
 *    billingService or @arkiol/shared — removed the entire ADDONS describe block).
 *  - Fixed CREDIT_COSTS key lookups: shared plans.ts uses snake_case keys
 *    (normal_ad, cinematic_ad), not display-name strings ("Normal Ad", "Cinematic Ad").
 *  - Fixed self-comparison tautology: Cinematic < Cinematic is always false.
 *  - Fixed wrong inequality: Normal Ad IS 20cr, not < 20.
 *  - Fixed stale PLANS tests referencing non-existent fields (priceMonthly,
 *    priceYearly, features array, storageBytes, lowercase plan keys).
 *    The canonical PlanConfig from @arkiol/shared has priceUsd, credits, members,
 *    brands, canUseStudioVideo, maxConcurrency, etc.
 */

// ── Mock env config ────────────────────────────────────────────────────────────
jest.mock('../../../src/config/env', () => ({
  config: {
    AWS_REGION:              'us-east-1',
    AWS_ACCESS_KEY_ID:       'test-key-id',
    AWS_SECRET_ACCESS_KEY:   'test-secret',
    CDN_URL:                 'https://cdn.example.com',
    ENCRYPTION_KEY:          'a'.repeat(64),
    STRIPE_SECRET_KEY:       'sk_test_xxx',
    STRIPE_PRICE_PRO_MONTHLY:  'price_pro_m',
    STRIPE_PRICE_PRO_YEARLY:   'price_pro_y',
    STRIPE_PRICE_CREATOR:      'price_creator_m',
    STRIPE_PRICE_STUDIO:       'price_studio_m',
    FRONTEND_URL:            'http://localhost:3000',
    EMAIL_FROM:              'noreply@test.com',
    SENDGRID_API_KEY:        '',
    DATABASE_URL:            'postgresql://localhost/test',
    RATE_LIMIT_WINDOW_MS:    60000,
    RATE_LIMIT_MAX_REQUESTS: 100,
    RENDER_RATE_LIMIT_MAX:   10,
  },
}));

jest.mock('../../../src/config/database', () => ({ db: jest.fn() }));
jest.mock('../../../src/config/logger',   () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock('../../../src/services/auditService', () => ({ auditLog: jest.fn(), trackAnalytics: jest.fn() }));
jest.mock('../../../src/services/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand:       jest.fn(),
  DeleteObjectCommand:    jest.fn(),
  DeleteObjectsCommand:   jest.fn(),
  GetObjectCommand:       jest.fn(),
  ListObjectsV2Command:   jest.fn(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));
jest.mock('@aws-sdk/s3-presigned-post',    () => ({ createPresignedPost: jest.fn() }));
jest.mock('sharp', () => jest.fn());

import { validateAssetUpload } from '../../../src/services/storageService';
// billingService re-exports PLANS and CREDIT_COSTS from @arkiol/shared.
// ADDONS does not exist in billingService or @arkiol/shared — do not import it.
import { PLANS, CREDIT_COSTS, type PlanKey } from '../../../src/billing/billingService';

// ══════════════════════════════════════════════════════════════════════════════
// validateAssetUpload
// ══════════════════════════════════════════════════════════════════════════════
describe('validateAssetUpload', () => {
  const MAX_BYTES = 500 * 1024 * 1024; // 500 MB

  // ── Valid types ─────────────────────────────────────────────────────────────
  const VALID_TYPES = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac',
  ];

  it('does not throw for valid MIME type and size', () => {
    expect(() => validateAssetUpload('image/jpeg', 1024)).not.toThrow();
  });

  it('accepts all 13 allowed MIME types', () => {
    for (const type of VALID_TYPES) {
      expect(() => validateAssetUpload(type, 1024)).not.toThrow();
    }
  });

  it('throws for disallowed MIME type', () => {
    expect(() => validateAssetUpload('application/pdf', 1024)).toThrow();
  });

  it('throws for disallowed MIME type with code INVALID_FILE_TYPE', () => {
    try {
      validateAssetUpload('application/zip', 1024);
      fail('Should have thrown');
    } catch (e: any) {
      expect(e.code).toBe('INVALID_FILE_TYPE');
    }
  });

  it('error message contains the invalid mime type', () => {
    try {
      validateAssetUpload('application/exe', 1024);
    } catch (e: any) {
      expect(e.message).toContain('application/exe');
    }
  });

  it('throws for file exceeding 500 MB', () => {
    expect(() => validateAssetUpload('image/jpeg', MAX_BYTES + 1)).toThrow();
  });

  it('throws FILE_TOO_LARGE for oversized file', () => {
    try {
      validateAssetUpload('image/png', MAX_BYTES + 1);
      fail('Should have thrown');
    } catch (e: any) {
      expect(e.code).toBe('FILE_TOO_LARGE');
    }
  });

  it('does not throw for file exactly at 500 MB limit', () => {
    expect(() => validateAssetUpload('image/jpeg', MAX_BYTES)).not.toThrow();
  });

  it('does not throw for 0-byte file of valid type', () => {
    expect(() => validateAssetUpload('image/png', 0)).not.toThrow();
  });

  it('throws for unknown type even with valid size', () => {
    expect(() => validateAssetUpload('text/html', 1)).toThrow();
  });

  it('throws with status 400 for invalid MIME type', () => {
    try {
      validateAssetUpload('model/gltf-binary', 1024);
    } catch (e: any) {
      expect(e.status ?? e.statusCode ?? e.httpStatus).toBe(400);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLANS constant — canonical launch plans: FREE, CREATOR, PRO, STUDIO
// Source of truth: packages/shared/src/plans.ts
// ══════════════════════════════════════════════════════════════════════════════
describe('PLANS', () => {
  // Canonical launch plan keys (from @arkiol/shared)
  const PLAN_KEYS: PlanKey[] = ['FREE', 'CREATOR', 'PRO', 'STUDIO'];

  it('has all 4 canonical plan tiers', () => {
    for (const key of PLAN_KEYS) {
      expect(PLANS[key]).toBeDefined();
    }
  });

  it('all plans have credits and priceUsd fields', () => {
    for (const key of PLAN_KEYS) {
      const plan = PLANS[key];
      expect(typeof plan.credits).toBe('number');
      expect(typeof plan.priceUsd).toBe('number');
    }
  });

  it('FREE plan has zero price', () => {
    expect(PLANS.FREE.priceUsd).toBe(0);
  });

  it('PRO plan has positive price', () => {
    expect(PLANS.PRO.priceUsd).toBeGreaterThan(0);
  });

  it('STUDIO plan is most expensive', () => {
    expect(PLANS.STUDIO.priceUsd).toBeGreaterThan(PLANS.PRO.priceUsd);
  });

  it('credits increase from FREE → CREATOR → PRO → STUDIO', () => {
    expect(PLANS.CREATOR.credits).toBeGreaterThanOrEqual(PLANS.FREE.credits);
    expect(PLANS.PRO.credits).toBeGreaterThan(PLANS.CREATOR.credits);
    expect(PLANS.STUDIO.credits).toBeGreaterThan(PLANS.PRO.credits);
  });

  it('FREE plan has freeDailyNormalAds=1 (free watermarked ad per day)', () => {
    expect(PLANS.FREE.freeDailyNormalAds).toBe(1);
  });

  it('STUDIO plan has highest concurrency', () => {
    expect(PLANS.STUDIO.maxConcurrency).toBeGreaterThan(PLANS.PRO.maxConcurrency);
  });

  it('FREE plan has canUseStudioVideo=false (teaser only)', () => {
    expect(PLANS.FREE.canUseStudioVideo).toBe(false);
  });

  it('CREATOR, PRO, STUDIO plans have canUseStudioVideo=true', () => {
    expect(PLANS.CREATOR.canUseStudioVideo).toBe(true);
    expect(PLANS.PRO.canUseStudioVideo).toBe(true);
    expect(PLANS.STUDIO.canUseStudioVideo).toBe(true);
  });

  it('FREE plan has freeWatermarkEnabled=true', () => {
    expect(PLANS.FREE.freeWatermarkEnabled).toBe(true);
  });

  it('paid plans have freeWatermarkEnabled=false', () => {
    expect(PLANS.CREATOR.freeWatermarkEnabled).toBe(false);
    expect(PLANS.PRO.freeWatermarkEnabled).toBe(false);
    expect(PLANS.STUDIO.freeWatermarkEnabled).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CREDIT_COSTS constant
// Source of truth: packages/shared/src/plans.ts → CREDIT_COSTS
// Keys are snake_case: normal_ad, cinematic_ad, static, gif, etc.
// Launch configuration: Normal Ads = 20cr, Cinematic Ads = 35cr.
// ══════════════════════════════════════════════════════════════════════════════
describe('CREDIT_COSTS', () => {
  it('has launch render mode keys normal_ad and cinematic_ad', () => {
    // Keys are snake_case — NOT display names like "Normal Ad"
    expect(CREDIT_COSTS['normal_ad']).toBeDefined();
    expect(CREDIT_COSTS['cinematic_ad']).toBeDefined();
  });

  it('all credit costs are positive integers', () => {
    for (const [, cost] of Object.entries(CREDIT_COSTS)) {
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThan(0);
    }
  });

  it('Normal Ad costs exactly 20 credits (launch config)', () => {
    expect(CREDIT_COSTS['normal_ad']).toBe(20);
  });

  it('Cinematic Ad costs exactly 35 credits (launch config)', () => {
    expect(CREDIT_COSTS['cinematic_ad']).toBe(35);
  });

  it('Cinematic Ad is more expensive than Normal Ad', () => {
    expect(CREDIT_COSTS['cinematic_ad']).toBeGreaterThan(CREDIT_COSTS['normal_ad']);
  });

  it('video_std maps to same cost as normal_ad (20cr)', () => {
    // video_std is an alias in CREDIT_COSTS for Normal Ad / 2D Standard
    expect(CREDIT_COSTS['video_std']).toBe(CREDIT_COSTS['normal_ad']);
  });

  it('video_hq maps to same cost as cinematic_ad (35cr)', () => {
    // video_hq is an alias in CREDIT_COSTS for Cinematic Ad / Premium Cinematic
    expect(CREDIT_COSTS['video_hq']).toBe(CREDIT_COSTS['cinematic_ad']);
  });
});
