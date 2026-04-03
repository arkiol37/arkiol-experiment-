import type { StoryboardScene, AspectRatio } from '../types';
export interface CompositionGuide { sceneId: string; focalPoints: { x: number; y: number; weight: number }[]; safeZone: { top: number; bottom: number; left: number; right: number }; hierarchy: string[]; }
const SZ: Record<AspectRatio, { top: number; bottom: number; left: number; right: number }> = { '16:9': { top: 5, bottom: 5, left: 5, right: 5 }, '9:16': { top: 10, bottom: 15, left: 5, right: 5 }, '1:1': { top: 5, bottom: 10, left: 5, right: 5 } };
const HIER: Record<string, string[]> = { hook: ['headline_text','visual_hook','brand_accent'], problem: ['problem_visual','empathy_text'], solution: ['product_hero','value_text','brand_mark'], proof: ['testimonial','stats_callout'], cta: ['cta_button','offer_text','brand_logo'], brand_reveal: ['brand_logo','tagline'], offer: ['offer_text','price','brand_logo'] };
export function computeComposition(scene: StoryboardScene, aspect: AspectRatio): CompositionGuide {
  const fp = scene.role === 'hook' ? [{ x: 50, y: 40, weight: 1 }] : scene.role === 'cta' ? [{ x: 50, y: 55, weight: 1 }] : [{ x: 33.33, y: 33.33, weight: 0.7 }];
  return { sceneId: scene.id, focalPoints: fp, safeZone: SZ[aspect] || SZ['16:9'], hierarchy: HIER[scene.role] || ['primary_content','brand_element'] };
}
