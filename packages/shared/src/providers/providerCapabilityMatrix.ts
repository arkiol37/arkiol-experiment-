/**
 * Provider Capability Matrix — maps video generation providers to their
 * capabilities, limits, and quality tiers for intelligent provider selection.
 */
export interface ProviderCapability {
  name: string;
  supportedResolutions: string[];
  maxDurationSec: number;
  supportsCameraControl: boolean;
  supportsImageReference: boolean;
  supportsMotionControl: boolean;
  qualityTier: 'standard' | 'high' | 'ultra';
  avgLatencyMs: number;
  costPerSecond: number;
  supportedStyles: string[];
  maxConcurrent: number;
}

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapability> = {
  runway: {
    name: 'Runway Gen-3', supportedResolutions: ['1280x768', '768x1280', '1024x1024'],
    maxDurationSec: 10, supportsCameraControl: true, supportsImageReference: true,
    supportsMotionControl: true, qualityTier: 'ultra', avgLatencyMs: 45000,
    costPerSecond: 0.05, supportedStyles: ['realistic', 'cinematic', 'animated'], maxConcurrent: 3,
  },
  pika: {
    name: 'Pika Labs', supportedResolutions: ['1024x576', '576x1024', '1024x1024'],
    maxDurationSec: 4, supportsCameraControl: true, supportsImageReference: true,
    supportsMotionControl: false, qualityTier: 'high', avgLatencyMs: 30000,
    costPerSecond: 0.03, supportedStyles: ['stylized', 'animated', 'realistic'], maxConcurrent: 5,
  },
  sora: {
    name: 'OpenAI Sora', supportedResolutions: ['1920x1080', '1080x1920', '1080x1080'],
    maxDurationSec: 20, supportsCameraControl: true, supportsImageReference: false,
    supportsMotionControl: true, qualityTier: 'ultra', avgLatencyMs: 60000,
    costPerSecond: 0.08, supportedStyles: ['photorealistic', 'cinematic', 'artistic'], maxConcurrent: 2,
  },
};

export function selectProvider(requirements: {
  minDurationSec: number; needsCameraControl: boolean;
  needsImageReference: boolean; qualityTier: string; maxBudgetPerSec?: number;
}): string {
  const candidates = Object.entries(PROVIDER_CAPABILITIES)
    .filter(([_, cap]) => {
      if (cap.maxDurationSec < requirements.minDurationSec) return false;
      if (requirements.needsCameraControl && !cap.supportsCameraControl) return false;
      if (requirements.needsImageReference && !cap.supportsImageReference) return false;
      if (requirements.maxBudgetPerSec && cap.costPerSecond > requirements.maxBudgetPerSec) return false;
      return true;
    })
    .sort(([_a, a], [_b, b]) => {
      const tierOrder = { ultra: 3, high: 2, standard: 1 };
      if (requirements.qualityTier === 'ultra') return (tierOrder[b.qualityTier] || 0) - (tierOrder[a.qualityTier] || 0);
      return a.avgLatencyMs - b.avgLatencyMs; // Otherwise prefer fastest
    });
  return candidates[0]?.[0] || 'runway'; // Default fallback
}

export function getProviderCapability(name: string): ProviderCapability | undefined {
  return PROVIDER_CAPABILITIES[name];
}
