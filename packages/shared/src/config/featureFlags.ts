/**
 * Feature Flags — runtime feature toggling for gradual rollout.
 */
export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
  rolloutPercentage: number;  // 0-100
  allowedWorkspaces: string[];  // empty = all
  addedAt: string;
}

const FLAGS: Record<string, FeatureFlag> = {
  ANIMATION_STUDIO_V2: { key: 'ANIMATION_STUDIO_V2', enabled: true, description: 'Animation Studio AI engines', rolloutPercentage: 100, allowedWorkspaces: [], addedAt: '2026-03-01' },
  CINEMATIC_MODE: { key: 'CINEMATIC_MODE', enabled: true, description: 'Cinematic render mode (premium)', rolloutPercentage: 100, allowedWorkspaces: [], addedAt: '2026-02-15' },
  AI_QUALITY_GATE: { key: 'AI_QUALITY_GATE', enabled: true, description: 'AI-driven quality gate enforcement', rolloutPercentage: 80, allowedWorkspaces: [], addedAt: '2026-03-15' },
  MULTI_PROVIDER_FALLBACK: { key: 'MULTI_PROVIDER_FALLBACK', enabled: true, description: 'Cross-provider failover', rolloutPercentage: 100, allowedWorkspaces: [], addedAt: '2026-02-01' },
  BRAND_MEMORY: { key: 'BRAND_MEMORY', enabled: true, description: 'Brand learning from past generations', rolloutPercentage: 50, allowedWorkspaces: [], addedAt: '2026-03-20' },
  AB_TESTING: { key: 'AB_TESTING', enabled: false, description: 'Creative A/B test variants', rolloutPercentage: 0, allowedWorkspaces: [], addedAt: '2026-03-25' },
  EXPORT_4K: { key: 'EXPORT_4K', enabled: false, description: '4K video export', rolloutPercentage: 0, allowedWorkspaces: [], addedAt: '2026-03-28' },
};

export function isFeatureEnabled(key: string, workspaceId?: string): boolean {
  const flag = FLAGS[key];
  if (!flag || !flag.enabled) return false;
  if (flag.allowedWorkspaces.length > 0 && workspaceId && !flag.allowedWorkspaces.includes(workspaceId)) return false;
  if (flag.rolloutPercentage < 100) {
    if (!workspaceId) return flag.rolloutPercentage > 50;
    const hash = Array.from(workspaceId).reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0x7fffffff, 0);
    return (hash % 100) < flag.rolloutPercentage;
  }
  return true;
}

export function getAllFlags(): FeatureFlag[] { return Object.values(FLAGS); }
export function getFlag(key: string): FeatureFlag | undefined { return FLAGS[key]; }
