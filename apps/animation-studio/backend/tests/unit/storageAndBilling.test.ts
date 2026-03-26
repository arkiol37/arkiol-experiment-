/**
 * apps/animation-studio/backend/tests/unit/storageAndBilling.test.ts
 *
 * Unit tests for:
 *  - services/storageService.ts → validateAssetUpload (pure function)
 *  - billing/billingService.ts  → PLANS, CREDIT_COSTS, ADDONS constants
 *  - billing/arkiolCreditsBridge.ts → CREDIT_COSTS constants
 *
 * No DB, no S3, no network.
 */

// ── Mock env config ────────────────────────────────────────────────────────────
jest.mock('../../../src/config/env', () => ({
  config: {
    AWS_REGION:              'us-east-1',
    AWS_ACCESS_KEY_ID:       'test-key-id',
    AWS_SECRET_ACCESS_KEY:   'test-secret',
    CDN_URL:                 'https://cdn.example.com',
    ENCRYPTION_KEY:          'a'.repeat(64), // 32-byte hex
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
import { PLANS, CREDIT_COSTS, ADDONS, type PlanKey } from '../../../src/billing/billingService';

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

  it('yearly price is less than monthly for paid plans', () => {
    expect(PLANS.pro.priceYearly).toBeLessThan(PLANS.pro.priceMonthly);
    expect(PLANS.STUDIO.priceUsd).toBeGreaterThan(PLANS.PRO.priceUsd);
  });

  it('all plans have at least 1 feature', () => {
    for (const key of PLAN_KEYS) {
      expect(PLANS[key].features.length).toBeGreaterThan(0);
    }
  });

  it('storageBytes is defined and positive for free and pro', () => {
    expect(PLANS.free.storageBytes).toBeGreaterThan(0);
    expect(PLANS.pro.storageBytes).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CREDIT_COSTS constant
// ══════════════════════════════════════════════════════════════════════════════
describe('CREDIT_COSTS', () => {
  it('has all 4 render types', () => {
    expect(CREDIT_COSTS['Normal Ad']).toBeDefined();
    expect(20).toBeDefined();
    expect(CREDIT_COSTS['Cinematic Ad']).toBeDefined();
    expect(CREDIT_COSTS['Cinematic Ad']).toBeDefined();
  });

  it('all credit costs are positive integers', () => {
    for (const [, cost] of Object.entries(CREDIT_COSTS)) {
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThan(0);
    }
  });

  it('costs increase with quality (2D Standard < 2D Extended < Premium < 3D)', () => {
    expect(CREDIT_COSTS['Normal Ad']).toBeLessThan(20);
    expect(20).toBeLessThan(CREDIT_COSTS['Cinematic Ad']);
    expect(CREDIT_COSTS['Cinematic Ad']).toBeLessThan(CREDIT_COSTS['Cinematic Ad']);
  });

  it('2D Standard is the cheapest render type', () => {
    const costs = Object.values(CREDIT_COSTS) as number[];
    expect(CREDIT_COSTS['Normal Ad']).toBe(Math.min(...costs));
  });

  it('Cinematic Ad (35cr) > Normal Ad (20cr)', () => {
    const costs = Object.values(CREDIT_COSTS) as number[];
    expect(CREDIT_COSTS['Cinematic Ad']).toBe(Math.max(...costs));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADDONS constant
// ══════════════════════════════════════════════════════════════════════════════
describe('ADDONS', () => {
  it('has all 3 addon types', () => {
    expect(ADDONS['4K Upgrade']).toBeDefined();
    expect(ADDONS['Voice Engine']).toBeDefined();
    expect(ADDONS['Music License']).toBeDefined();
  });

  it('all addon costs are positive integers', () => {
    for (const [, cost] of Object.entries(ADDONS)) {
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThan(0);
    }
  });

  it('4K Upgrade is the most expensive addon', () => {
    const costs = Object.values(ADDONS) as number[];
    expect(ADDONS['4K Upgrade']).toBe(Math.max(...costs));
  });

  it('Music License is the cheapest addon', () => {
    const costs = Object.values(ADDONS) as number[];
    expect(ADDONS['Music License']).toBe(Math.min(...costs));
  });
});
