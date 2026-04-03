/**
 * Usage Policy — credit costs, plan limits, and billing enforcement rules
 * shared across both generation pipelines.
 */
export interface UsageCost {
  action: string;
  baseCredits: number;
  perSceneCredits: number;
  cinematicMultiplier: number;
  description: string;
}

export const USAGE_COSTS: Record<string, UsageCost> = {
  normal_render: { action: 'normal_render', baseCredits: 10, perSceneCredits: 2, cinematicMultiplier: 1.0, description: 'Normal Ad render' },
  cinematic_render: { action: 'cinematic_render', baseCredits: 15, perSceneCredits: 4, cinematicMultiplier: 1.75, description: 'Cinematic Ad render' },
  static_design: { action: 'static_design', baseCredits: 5, perSceneCredits: 0, cinematicMultiplier: 1.0, description: 'Static design generation' },
  voiceover: { action: 'voiceover', baseCredits: 3, perSceneCredits: 1, cinematicMultiplier: 1.0, description: 'AI voiceover generation' },
  music_license: { action: 'music_license', baseCredits: 2, perSceneCredits: 0, cinematicMultiplier: 1.0, description: 'Royalty-free music' },
  export_4k: { action: 'export_4k', baseCredits: 5, perSceneCredits: 0, cinematicMultiplier: 1.0, description: '4K export upgrade' },
};

export function calculateRenderCost(renderMode: string, sceneCount: number, addons: string[] = []): number {
  const base = renderMode === 'Cinematic Ad' ? USAGE_COSTS.cinematic_render : USAGE_COSTS.normal_render;
  let cost = base.baseCredits + (base.perSceneCredits * sceneCount);
  if (renderMode === 'Cinematic Ad') cost = Math.ceil(cost * base.cinematicMultiplier);
  for (const addon of addons) {
    const addonCost = USAGE_COSTS[addon.toLowerCase().replace(/ /g, '_')];
    if (addonCost) cost += addonCost.baseCredits + (addonCost.perSceneCredits * sceneCount);
  }
  return cost;
}

export interface PlanLimits {
  maxRendersPerDay: number;
  maxScenesPerRender: number;
  maxConcurrentRenders: number;
  cinematicEnabled: boolean;
  maxStorageGb: number;
  watermarkRequired: boolean;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { maxRendersPerDay: 1, maxScenesPerRender: 3, maxConcurrentRenders: 1, cinematicEnabled: false, maxStorageGb: 1, watermarkRequired: true },
  creator: { maxRendersPerDay: 10, maxScenesPerRender: 6, maxConcurrentRenders: 2, cinematicEnabled: true, maxStorageGb: 10, watermarkRequired: false },
  pro: { maxRendersPerDay: 50, maxScenesPerRender: 8, maxConcurrentRenders: 5, cinematicEnabled: true, maxStorageGb: 50, watermarkRequired: false },
  studio: { maxRendersPerDay: 200, maxScenesPerRender: 10, maxConcurrentRenders: 10, cinematicEnabled: true, maxStorageGb: 200, watermarkRequired: false },
};

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan.toLowerCase()] || PLAN_LIMITS.free;
}

export function enforceLimit(plan: string, check: keyof PlanLimits, value: number): { allowed: boolean; limit: number; message?: string } {
  const limits = getPlanLimits(plan);
  const limit = limits[check] as number;
  if (typeof limit !== 'number') return { allowed: true, limit: 0 };
  if (value > limit) return { allowed: false, limit, message: `${check}: ${value} exceeds ${plan} plan limit of ${limit}` };
  return { allowed: true, limit };
}
