/**
 * CTA Optimizer — optimizes the CTA scene for maximum conversion.
 */
import type { StoryboardScene, DirectorIntent, AdObjective } from '../types';

const CTA: Record<AdObjective, { text: (b: string) => string; urgency: number; vis: string; btn: string }> = {
  awareness:     { text: (b) => `Learn more about ${b}`, urgency: 0.3, vis: 'Clean brand lockup, subtle animation', btn: 'Soft CTA button' },
  consideration: { text: (b) => `Explore ${b} today`, urgency: 0.5, vis: 'Product showcase with brand frame', btn: 'Medium CTA button' },
  conversion:    { text: (b) => `Get ${b} now — limited time`, urgency: 0.9, vis: 'Bold price/offer callout, urgency', btn: 'Large pulsing CTA button' },
  retention:     { text: (b) => `Welcome back to ${b}`, urgency: 0.3, vis: 'Warm loyalty messaging', btn: 'Friendly re-engagement button' },
  app_install:   { text: (b) => `Download ${b} free`, urgency: 0.85, vis: 'App store badges, phone mockup', btn: 'Download button' },
};

export function optimizeCta(ctaScene: StoryboardScene, intent: DirectorIntent): StoryboardScene {
  const s = CTA[intent.objective] || CTA.awareness;
  const ep = `${ctaScene.prompt} CTA: "${s.text(intent.brand.name)}". Visual: ${s.vis}. Button: ${s.btn}. Urgency: ${Math.round(s.urgency * 100)}%.`;
  return { ...ctaScene, prompt: ep, voiceoverScript: s.text(intent.brand.name), onScreenText: s.text(intent.brand.name), emotionTarget: Math.min(1, 0.7 + s.urgency * 0.3), cameraMove: s.urgency > 0.7 ? 'push_in' : 'static_lock' };
}
