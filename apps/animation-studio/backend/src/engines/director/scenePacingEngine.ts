/**
 * Scene Pacing Engine — adjusts scene durations based on platform attention data,
 * narrative arc, and emotion intensity.
 */
import type { StoryboardScene, DirectorIntent, NarrativeArc } from '../types';

const PP: Record<string, { minS: number; maxS: number; hookMax: number; ctaMin: number }> = {
  tiktok: { minS: 2, maxS: 8, hookMax: 3, ctaMin: 3 }, instagram: { minS: 2, maxS: 10, hookMax: 4, ctaMin: 3 },
  facebook: { minS: 3, maxS: 15, hookMax: 5, ctaMin: 4 }, youtube: { minS: 3, maxS: 15, hookMax: 6, ctaMin: 4 },
};

export function planScenePacing(scenes: StoryboardScene[], intent: DirectorIntent, arc?: NarrativeArc): StoryboardScene[] {
  const p = PP[intent.platform] || PP.youtube;
  return scenes.map((scene, i) => {
    let d = scene.durationSec;
    if (scene.role === 'hook') d = Math.min(d, p.hookMax);
    else if (scene.role === 'cta') d = Math.max(d, p.ctaMin);
    d = Math.max(p.minS, Math.min(p.maxS, d));
    const t = arc?.tensionCurve[i] ?? 0.5;
    if (t > 0.7) d = Math.max(p.minS, d * 0.85);
    if (t < 0.3) d = Math.min(p.maxS, d * 1.15);
    return { ...scene, durationSec: Math.round(d), pacingBpm: Math.round(80 + t * 60) };
  });
}
