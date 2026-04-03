/**
 * Hook Optimizer — optimizes the hook scene for maximum attention capture using
 * platform-specific attention data and psychological triggers.
 */
import type { StoryboardScene, DirectorIntent, HookType } from '../types';

const HOOK_PSY: Record<HookType, { pattern: string; trigger: string; speed: number; contrast: number }> = {
  pain_point: { pattern: 'Relatable frustration, close-up reaction', trigger: 'Red/orange warning tones, frustrated gesture', speed: 1.0, contrast: 0.7 },
  curiosity_gap: { pattern: 'Intriguing visual demanding explanation', trigger: 'Partial reveal, mysterious silhouette', speed: 0.9, contrast: 0.8 },
  bold_claim: { pattern: 'Full-screen typography with dramatic reveal', trigger: 'Large bold text animation, number counter', speed: 1.2, contrast: 0.9 },
  social_proof: { pattern: 'Rapid montage of happy users', trigger: 'Grid of faces, star ratings scrolling up', speed: 1.3, contrast: 0.6 },
  direct_offer: { pattern: 'Price/deal reveal with slash effect', trigger: 'Price tag animation, savings callout', speed: 1.1, contrast: 0.85 },
  question: { pattern: 'Question text with thinking pause', trigger: 'Question mark animation, reveal moment', speed: 0.85, contrast: 0.65 },
  shocking_stat: { pattern: 'Big number reveal with impact', trigger: 'Counter animation, infographic style', speed: 1.15, contrast: 0.9 },
};
const HOOK_WINDOW: Record<string, number> = { tiktok: 1500, instagram: 2000, facebook: 3000, youtube: 5000 };

export function optimizeHook(hookScene: StoryboardScene, intent: DirectorIntent): StoryboardScene {
  const psy = HOOK_PSY[intent.hookType] || HOOK_PSY.pain_point;
  const hw = HOOK_WINDOW[intent.platform] || 3000;
  const enhancedPrompt = `${hookScene.prompt} Hook: ${psy.pattern}. Visual trigger: ${psy.trigger}. Capture attention within ${hw}ms. Contrast: ${Math.round(psy.contrast * 100)}%.${intent.platform === 'tiktok' ? ' Native TikTok energy.' : ''}${intent.platform === 'youtube' ? ' Skip-proof in 5s.' : ''}`;
  return { ...hookScene, prompt: enhancedPrompt, visualDirection: `${hookScene.visualDirection}. ${psy.trigger}. Maximum scroll-stopping.`, emotionTarget: Math.min(1, hookScene.emotionTarget * 1.15), cameraMove: psy.speed > 1 ? 'push_in' : hookScene.cameraMove };
}
