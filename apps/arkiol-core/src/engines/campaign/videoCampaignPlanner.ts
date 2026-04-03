/**
 * Video Campaign Planner — extends the static campaign creative director
 * to plan multi-format video campaigns that span Animation Studio.
 */
import type { CampaignObjective } from './creative-director';

export interface VideoCampaignPlan {
  id: string;
  name: string;
  objective: CampaignObjective;
  formats: VideoCampaignFormat[];
  sharedIdentity: { palette: string[]; mood: string; hookStrategy: string; brandVoice: string };
  totalEstimatedCredits: number;
  estimatedProductionTimeMs: number;
}

export interface VideoCampaignFormat {
  platform: string;
  placement: string;
  aspectRatio: string;
  durationSec: number;
  sceneCount: number;
  renderMode: string;
  estimatedCredits: number;
  priority: number;
}

const FORMAT_MATRIX: Record<string, VideoCampaignFormat[]> = {
  awareness: [
    { platform: 'youtube', placement: 'instream', aspectRatio: '16:9', durationSec: 30, sceneCount: 5, renderMode: 'Cinematic Ad', estimatedCredits: 35, priority: 1 },
    { platform: 'instagram', placement: 'reel', aspectRatio: '9:16', durationSec: 15, sceneCount: 4, renderMode: 'Normal Ad', estimatedCredits: 20, priority: 2 },
    { platform: 'tiktok', placement: 'feed', aspectRatio: '9:16', durationSec: 15, sceneCount: 4, renderMode: 'Normal Ad', estimatedCredits: 20, priority: 3 },
  ],
  conversion: [
    { platform: 'instagram', placement: 'reel', aspectRatio: '9:16', durationSec: 15, sceneCount: 5, renderMode: 'Normal Ad', estimatedCredits: 20, priority: 1 },
    { platform: 'facebook', placement: 'feed', aspectRatio: '16:9', durationSec: 30, sceneCount: 5, renderMode: 'Normal Ad', estimatedCredits: 20, priority: 2 },
    { platform: 'tiktok', placement: 'feed', aspectRatio: '9:16', durationSec: 10, sceneCount: 3, renderMode: 'Normal Ad', estimatedCredits: 16, priority: 3 },
  ],
  engagement: [
    { platform: 'tiktok', placement: 'feed', aspectRatio: '9:16', durationSec: 15, sceneCount: 5, renderMode: 'Normal Ad', estimatedCredits: 20, priority: 1 },
    { platform: 'instagram', placement: 'reel', aspectRatio: '9:16', durationSec: 30, sceneCount: 6, renderMode: 'Cinematic Ad', estimatedCredits: 35, priority: 2 },
    { platform: 'youtube', placement: 'shorts', aspectRatio: '9:16', durationSec: 15, sceneCount: 4, renderMode: 'Normal Ad', estimatedCredits: 20, priority: 3 },
  ],
};

export function planVideoCampaign(input: {
  name: string; objective: CampaignObjective; mood: string; brandPalette: string[];
  hookStrategy: string; brandVoice: string; maxBudgetCredits?: number;
}): VideoCampaignPlan {
  const formats = (FORMAT_MATRIX[input.objective] || FORMAT_MATRIX.awareness).slice();
  let totalCredits = formats.reduce((s, f) => s + f.estimatedCredits, 0);
  const filteredFormats = input.maxBudgetCredits
    ? formats.filter(f => { totalCredits -= f.estimatedCredits; return totalCredits + f.estimatedCredits <= input.maxBudgetCredits!; })
    : formats;
  return {
    id: `vcp_${Date.now()}`, name: input.name, objective: input.objective,
    formats: filteredFormats,
    sharedIdentity: { palette: input.brandPalette, mood: input.mood, hookStrategy: input.hookStrategy, brandVoice: input.brandVoice },
    totalEstimatedCredits: filteredFormats.reduce((s, f) => s + f.estimatedCredits, 0),
    estimatedProductionTimeMs: filteredFormats.reduce((s, f) => s + f.durationSec * 3000, 0),
  };
}
