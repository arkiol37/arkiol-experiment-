// packages/shared/src/plans.ts
// SINGLE SOURCE OF TRUTH for all plan limits, feature flags, credit costs, and top-up packs.
// Both Arkiol Core and Animation Studio MUST import from here — never define locally.
//
// LAUNCH CONFIGURATION (v1):
//   Two generation modes only:
//     • Normal Ads  (2D)      — 20 credits per generation
//     • Cinematic Ads (2.5D)  — 35 credits per generation
//   Free tier: 1 watermarked Normal Ad per day at no credit cost.
//   3D generation is NOT part of the launch product and has been removed.
//
// ENVIRONMENT ACCESS POLICY:
//   All runtime env access goes through getEnv() from ./env (validated, typed).
//   At import time (module init), NO env is read — helpers are called lazily.

import { getEnv } from './env';

export type PlanKey = 'FREE' | 'CREATOR' | 'PRO' | 'STUDIO';

export interface PlanConfig {
  credits: number;               // monthly credit grant (0 for FREE)
  priceUsd: number;              // monthly price USD
  members: number;               // max team members
  brands: number;                // max brand kits
  canUseStudioVideo: boolean;    // access to Animation Studio video generation
  canUseGifMotion: boolean;      // GIF motion export
  canBatchGenerate: boolean;     // batch asset generation
  canUseZipExport: boolean;      // ZIP bundle export
  canUseAutomation: boolean;     // content automation / API
  // ── Asset engine feature flags ─────────────────────────────────────────────
  canUseHqUpgrade: boolean;      // explicit HQ upgrade (user-selected, costs extra credits)
  hqCreditMultiplier: number;    // credit multiplier when HQ selected
  maxOnDemandAssets: number;     // max on-demand AI-generated sub-assets per job
  // ── Concurrency & queue ────────────────────────────────────────────────────
  maxConcurrency: number;
  queuePriority: number;         // Bull queue priority: 0=low 1=normal 2=high
  maxDailyVideoJobs: number;     // 0 = blocked; FREE=1 (free watermarked ad)
  maxFormatsPerRun: number;
  maxVariationsPerRun: number;
  maxExportResolution: string;
  freeWatermarkEnabled: boolean;
  freeDailyNormalAds: number;    // free Normal Ad renders per day (watermarked, no credits deducted)
  freeDailyCreditsPerDay: number; // daily credit bucket (0 for FREE — use freeDailyNormalAds instead)
  freeMonthlyCapCredits: number;
  rolloverPct: number;
}

export const PLANS: Record<PlanKey, PlanConfig> = {
  FREE: {
    credits: 0,
    priceUsd: 0,
    members: 1,
    brands: 1,
    canUseStudioVideo: false,
    canUseGifMotion: false,
    canBatchGenerate: false,
    canUseZipExport: false,
    canUseAutomation: false,
    canUseHqUpgrade: false,
    hqCreditMultiplier: 1.0,
    maxOnDemandAssets: 2,
    maxConcurrency: 1,
    queuePriority: 0,
    maxDailyVideoJobs: 1,          // 1 free watermarked Normal Ad per day
    maxFormatsPerRun: 1,
    maxVariationsPerRun: 1,
    maxExportResolution: '1080p',
    freeWatermarkEnabled: true,
    freeDailyNormalAds: 1,         // 1 free Normal Ad/day; no credit deduction
    freeDailyCreditsPerDay: 0,
    freeMonthlyCapCredits: 0,
    rolloverPct: 0,
  },
  CREATOR: {
    credits: 500,
    priceUsd: 25,
    members: 3,
    brands: 2,
    canUseStudioVideo: true,
    canUseGifMotion: true,
    canBatchGenerate: false,
    canUseZipExport: true,
    canUseAutomation: false,
    canUseHqUpgrade: true,
    hqCreditMultiplier: 1.0,
    maxOnDemandAssets: 4,
    maxConcurrency: 2,
    queuePriority: 1,
    maxDailyVideoJobs: 10,
    maxFormatsPerRun: 3,
    maxVariationsPerRun: 3,
    maxExportResolution: '1080p',
    freeWatermarkEnabled: false,
    freeDailyNormalAds: 0,
    freeDailyCreditsPerDay: 0,
    freeMonthlyCapCredits: 0,
    rolloverPct: 0,
  },
  PRO: {
    credits: 1700,
    priceUsd: 79,
    members: 10,
    brands: 5,
    canUseStudioVideo: true,
    canUseGifMotion: true,
    canBatchGenerate: true,
    canUseZipExport: true,
    canUseAutomation: false,
    canUseHqUpgrade: true,
    hqCreditMultiplier: 3.0,
    maxOnDemandAssets: 10,
    maxConcurrency: 5,
    queuePriority: 1,
    maxDailyVideoJobs: 10,
    maxFormatsPerRun: 8,
    maxVariationsPerRun: 5,
    maxExportResolution: '4K',
    freeWatermarkEnabled: false,
    freeDailyNormalAds: 0,
    freeDailyCreditsPerDay: 0,
    freeMonthlyCapCredits: 0,
    rolloverPct: 25,
  },
  STUDIO: {
    credits: 6000,
    priceUsd: 249,
    members: 50,
    brands: 20,
    canUseStudioVideo: true,
    canUseGifMotion: true,
    canBatchGenerate: true,
    canUseZipExport: true,
    canUseAutomation: true,
    canUseHqUpgrade: true,
    hqCreditMultiplier: 3.0,
    maxOnDemandAssets: 25,
    maxConcurrency: 15,
    queuePriority: 2,
    maxDailyVideoJobs: 50,
    maxFormatsPerRun: 20,
    maxVariationsPerRun: 10,
    maxExportResolution: '4K',
    freeWatermarkEnabled: false,
    freeDailyNormalAds: 0,
    freeDailyCreditsPerDay: 0,
    freeMonthlyCapCredits: 0,
    rolloverPct: 50,
  },
};

// ── Legacy plan name aliases ──────────────────────────────────────────────────
// DB rows written before v15 may contain old plan strings; map to canonical keys.
// Retired names (scale, enterprise, starter) are resolved here so that resolvePlan()
// is the single normalisation point — no other file should branch on these strings.
export const LEGACY_PLAN_MAP: Record<string, string> = {
  // Canonical lowercase aliases (used by Animation Studio API)
  free:       'FREE',
  creator:    'CREATOR',
  pro:        'PRO',
  studio:     'STUDIO',
  // Retired lowercase aliases
  scale:      'STUDIO',   // retired — was Animation Studio's old top tier
  enterprise: 'STUDIO',   // retired — was the old enterprise tier
  starter:    'CREATOR',  // retired — was the old entry paid plan (pre-v15)
  // Retired uppercase aliases (PostgreSQL enum tombstones still present in DB)
  STARTER:    'CREATOR',
  ENTERPRISE: 'STUDIO',
};

export function resolvePlan(plan: string): PlanKey {
  return (LEGACY_PLAN_MAP[plan] ?? LEGACY_PLAN_MAP[plan?.toLowerCase()] ?? 'FREE') as PlanKey;
}

export function getPlanConfig(plan: string): PlanConfig {
  return PLANS[resolvePlan(plan)];
}

// ── Credit costs — canonical, launch configuration ────────────────────────────
// ONLY these values are valid. No file may define credit costs locally.
//
// Launch modes:
//   normal_ad    — Normal Ads (2D):      20 credits per generation
//   cinematic_ad — Cinematic Ads (2.5D): 35 credits per generation
//
// Free tier:
//   FREE plan users get 1 free Normal Ad per day (watermarked).
//   Free daily Normal Ads do NOT deduct credits — enforced by freeDailyNormalAds gate.
//   All other generations (including Cinematic) deduct credits normally.
export const CREDIT_COSTS = {
  normal_ad:          20,   // Normal Ads (2D) — primary generation mode
  cinematic_ad:       35,   // Cinematic Ads (2.5D) — premium generation mode
  static:             1,    // standard static image generation (Arkiol Core)
  static_hq:          3,    // HQ-upgraded static image (explicit user choice, plan-gated)
  gif:                5,    // GIF motion export
  asset_on_demand:    1,    // per on-demand AI sub-asset (standard quality)
  asset_on_demand_hq: 3,    // per on-demand AI sub-asset, HQ quality (Pro/Studio only)
  video_std:          20,   // Studio: Normal Ad / 2D Standard (maps to normal_ad)
  video_hq:           35,   // Studio: Cinematic Ad / Premium Cinematic (maps to cinematic_ad)
  export_zip:         2,    // ZIP bundle export
} as const;

export type CreditCostKey = keyof typeof CREDIT_COSTS;

// ── Studio render mode → credit key mapping ───────────────────────────────────
// Animation Studio sends renderMode strings; map them to canonical credit cost keys.
// Only two launch modes are valid. Any other renderMode string is rejected.
export const STUDIO_RENDER_MODE_MAP: Record<string, CreditCostKey> = {
  'Normal Ad':        'normal_ad',
  'Cinematic Ad':     'cinematic_ad',
  // Legacy aliases kept for DB records written before the rename
  '2D Standard':      'normal_ad',
  '2D Extended':      'normal_ad',
  'Premium Cinematic':'cinematic_ad',
};

export function studioRenderModeToCreditKey(renderMode: string): CreditCostKey {
  const key = STUDIO_RENDER_MODE_MAP[renderMode];
  if (!key) {
    // Unknown mode — default to normal_ad and log; never throw from this utility
    return 'normal_ad';
  }
  return key;
}

// ── Top-up packs — canonical definitions ────────────────────────────────────
export interface TopupPack {
  id:        string;
  name:      string;
  credits:   number;
  priceUsd:  number;
  priceCents: number;
  expiryPolicy: 'end_of_cycle' | 'never';
}

export const TOPUP_PACKS: TopupPack[] = [
  // $0.040/cr — cheaper than Creator subscription ($0.050/cr)
  { id: 'pack_200',  name: '200 Credits',  credits: 200,  priceUsd: 8,   priceCents: 800,   expiryPolicy: 'end_of_cycle' },
  // $0.037/cr — cheaper than Pro subscription ($0.047/cr)
  { id: 'pack_600',  name: '600 Credits',  credits: 600,  priceUsd: 22,  priceCents: 2200,  expiryPolicy: 'end_of_cycle' },
  // $0.035/cr — cheaper than Studio subscription ($0.042/cr)
  { id: 'pack_2000', name: '2000 Credits', credits: 2000, priceUsd: 69,  priceCents: 6900,  expiryPolicy: 'end_of_cycle' },
];

export function getTopupPack(id: string): TopupPack | undefined {
  return TOPUP_PACKS.find(p => p.id === id);
}

// Stripe Price IDs for top-up packs — read from validated env at call time
export function getTopupStripePriceId(packId: string): string | undefined {
  const e = getEnv();
  const map: Record<string, string | undefined> = {
    pack_250:  e.STRIPE_PRICE_TOPUP_250,
    pack_750:  e.STRIPE_PRICE_TOPUP_750,
    pack_2500: e.STRIPE_PRICE_TOPUP_2500,
  };
  return map[packId];
}

// Stripe Subscription Price IDs — read from validated env at call time
export function getSubscriptionStripePriceId(planKey: PlanKey): string | undefined {
  const e = getEnv();
  const map: Record<PlanKey, string | undefined> = {
    FREE:    undefined,
    CREATOR: e.STRIPE_PRICE_CREATOR,
    PRO:     e.STRIPE_PRICE_PRO,
    STUDIO:  e.STRIPE_PRICE_STUDIO,
  };
  return map[planKey];
}

// ── Paddle Price IDs ──────────────────────────────────────────────────────────
export function getPaddleSubscriptionPriceId(planKey: PlanKey): string | undefined {
  const e = getEnv();
  const map: Record<PlanKey, string | undefined> = {
    FREE:    undefined,
    CREATOR: e.PADDLE_PRICE_CREATOR,
    PRO:     e.PADDLE_PRICE_PRO,
    STUDIO:  e.PADDLE_PRICE_STUDIO,
  };
  return map[planKey];
}
