/**
 * Animation Studio Bridge — connects arkiol-core (static design) with
 * the animation-studio app for seamless design-to-video workflows.
 */

export interface DesignToAnimationPayload {
  projectId: string;
  workspaceId: string;
  userId: string;
  sourceDesignId: string;
  brief: string;
  brandName: string;
  industry: string;
  mood: string;
  palette: string[];
  targetPlatforms: { platform: string; placement: string }[];
  maxDurationSec: number;
  renderMode: string;
}

export interface AnimationStudioResponse {
  success: boolean;
  renderJobIds: string[];
  estimatedCredits: number;
  estimatedCompletionMs: number;
  error?: string;
}

const ANIMATION_STUDIO_API = process.env.ANIMATION_STUDIO_URL || 'http://localhost:4000/api';

export async function submitToAnimationStudio(payload: DesignToAnimationPayload): Promise<AnimationStudioResponse> {
  try {
    const response = await fetch(`${ANIMATION_STUDIO_API}/v1/animation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brief: payload.brief,
        brandName: payload.brandName,
        industry: payload.industry,
        mood: payload.mood,
        platform: payload.targetPlatforms[0]?.platform || 'instagram',
        placement: payload.targetPlatforms[0]?.placement || 'reel',
        sceneCount: 5,
        aspectRatio: '9:16',
        renderMode: payload.renderMode,
        maxDurationSec: payload.maxDurationSec,
        brandPalette: payload.palette,
      }),
    });
    if (!response.ok) throw new Error(`Animation Studio responded ${response.status}`);
    const data = await response.json();
    return {
      success: true,
      renderJobIds: [data.renderJobId],
      estimatedCredits: data.scenes?.length ? data.scenes.length * 4 : 20,
      estimatedCompletionMs: 60000,
    };
  } catch (err: any) {
    return { success: false, renderJobIds: [], estimatedCredits: 0, estimatedCompletionMs: 0, error: err.message };
  }
}

export function canConvertToAnimation(designFormat: string): boolean {
  const supported = ['social_post', 'banner', 'ad', 'story', 'thumbnail'];
  return supported.includes(designFormat.toLowerCase());
}

export function estimateAnimationCredits(platforms: { platform: string; placement: string }[], renderMode: string): number {
  const basePerPlatform = renderMode === 'Cinematic Ad' ? 35 : 20;
  return platforms.length * basePerPlatform;
}
