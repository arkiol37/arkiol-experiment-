/**
 * Animation Director — top-level facade for the Director engine group.
 * Coordinates intent→narrative→storyboard→shots into complete creative direction.
 */
import { logger } from '../../config/logger';
import type { DirectorIntent, StoryboardScene, NarrativeArc, EmotionPoint, ShotPlan } from '../types';
import { translateIntent } from './intentTranslator';
import { computeNarrativeArc, getArcSceneRoles } from './narrativeArcEngine';
import { computeEmotionCurve } from './emotionCurveEngine';
import { planStoryboard } from './storyboardPlanner';
import { planScenePacing } from './scenePacingEngine';
import { planShots } from './shotPlanner';
import { computeCameraIntelligence } from './cameraIntelligence';
import { optimizeHook } from './hookOptimizer';
import { optimizeCta } from './ctaOptimizer';
import { buildAudienceProfile } from './audienceEngine';

export interface DirectorOutput {
  intent: DirectorIntent; narrativeArc: NarrativeArc; emotionCurve: EmotionPoint[];
  storyboard: StoryboardScene[]; shotPlans: ShotPlan[];
  cameraSequences: ReturnType<typeof computeCameraIntelligence>;
}

export async function direct(input: {
  brief: string; brandName: string; industry: string; mood?: string; hookType?: string;
  platform: string; placement: string; sceneCount: number; aspectRatio: string;
  renderMode: string; maxDurationSec: number; brandAssetIds?: string[];
  brandPalette?: string[]; targetAudience?: string; objective?: string;
}): Promise<DirectorOutput> {
  logger.info('[Director] Starting creative direction', { platform: input.platform, sceneCount: input.sceneCount });
  const intent = translateIntent({ ...input, platform: input.platform as any, aspectRatio: input.aspectRatio as any, renderMode: input.renderMode as any });
  intent.audience = buildAudienceProfile(intent);
  const narrativeArc = computeNarrativeArc(intent);
  const emotionCurve = computeEmotionCurve(intent, narrativeArc);
  let storyboard = planStoryboard(intent, narrativeArc, emotionCurve);
  storyboard = planScenePacing(storyboard, intent, narrativeArc);
  const hi = storyboard.findIndex(s => s.role === 'hook'); if (hi >= 0) storyboard[hi] = optimizeHook(storyboard[hi], intent);
  const ci = storyboard.findIndex(s => s.role === 'cta'); if (ci >= 0) storyboard[ci] = optimizeCta(storyboard[ci], intent);
  const shotPlans = planShots(storyboard, intent);
  const cameraSequences = computeCameraIntelligence(storyboard, intent);
  logger.info('[Director] Complete', { scenes: storyboard.length, totalDur: storyboard.reduce((s, sc) => s + sc.durationSec, 0) });
  return { intent, narrativeArc, emotionCurve, storyboard, shotPlans, cameraSequences };
}

export { translateIntent, computeNarrativeArc, computeEmotionCurve, planStoryboard, planScenePacing, planShots, computeCameraIntelligence, optimizeHook, optimizeCta, buildAudienceProfile };
