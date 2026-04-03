/**
 * Narrative Arc Engine — computes emotional arc and tension curves using
 * proven storytelling structures adapted for short-form video advertising.
 */
import type { DirectorIntent, NarrativeArc, SceneRole } from '../types';

type ArcTemplate = { name: string; peakEmotionAt: number; tensionCurve: (n: number) => number[]; resolutionAt: number; hookWindowFraction: number; };

const ARC_TEMPLATES: Record<string, ArcTemplate> = {
  classic_tension: { name: 'Classic Tension', peakEmotionAt: 0.65,
    tensionCurve: (n) => Array.from({ length: n }, (_, i) => { const t = i / Math.max(1, n - 1); return t <= 0.65 ? 0.3 + (t / 0.65) * 0.7 : 1.0 - ((t - 0.65) / 0.35) * 0.4; }),
    resolutionAt: 0.75, hookWindowFraction: 0.15 },
  aida: { name: 'AIDA', peakEmotionAt: 0.70,
    tensionCurve: (n) => Array.from({ length: n }, (_, i) => { const t = i / Math.max(1, n - 1); if (t <= 0.20) return 0.8; if (t <= 0.45) return 0.5 + t * 0.4; if (t <= 0.75) return 0.7 + (t - 0.45) * 1.0; return 0.9; }),
    resolutionAt: 0.80, hookWindowFraction: 0.12 },
  problem_agitate_solve: { name: 'PAS', peakEmotionAt: 0.50,
    tensionCurve: (n) => Array.from({ length: n }, (_, i) => { const t = i / Math.max(1, n - 1); if (t <= 0.25) return 0.5 + t * 1.2; if (t <= 0.50) return 0.8 + (t - 0.25) * 0.8; if (t <= 0.75) return 1.0 - (t - 0.50) * 1.6; return 0.5 + (t - 0.75) * 1.2; }),
    resolutionAt: 0.55, hookWindowFraction: 0.18 },
  shock_and_awe: { name: 'Shock', peakEmotionAt: 0.15,
    tensionCurve: (n) => Array.from({ length: n }, (_, i) => { const t = i / Math.max(1, n - 1); if (t <= 0.15) return 0.9 + t * 0.6; if (t <= 0.60) return 0.7; return 0.7 + (t - 0.60) * 0.75; }),
    resolutionAt: 0.85, hookWindowFraction: 0.10 },
  emotional_journey: { name: 'Emotional', peakEmotionAt: 0.55,
    tensionCurve: (n) => Array.from({ length: n }, (_, i) => { const t = i / Math.max(1, n - 1); return 0.3 + 0.7 * Math.sin(t * Math.PI * 0.85); }),
    resolutionAt: 0.70, hookWindowFraction: 0.20 },
};

function selectArc(intent: DirectorIntent): ArcTemplate {
  if (intent.platform === 'tiktok' || intent.placement.includes('story')) return ARC_TEMPLATES.shock_and_awe;
  if (intent.mood === 'Emotional' || intent.mood === 'Calm') return ARC_TEMPLATES.emotional_journey;
  if (intent.objective === 'conversion' || intent.objective === 'app_install') return ARC_TEMPLATES.problem_agitate_solve;
  if (intent.objective === 'awareness') return ARC_TEMPLATES.aida;
  return ARC_TEMPLATES.classic_tension;
}

export function computeNarrativeArc(intent: DirectorIntent): NarrativeArc {
  const template = selectArc(intent);
  const rawCurve = template.tensionCurve(intent.sceneCount);
  const maxVal = Math.max(...rawCurve, 0.01);
  const tensionCurve = rawCurve.map(v => Math.max(0, Math.min(1, v / maxVal)));
  const hookWindowMs = Math.round(intent.maxDurationSec * 1000 * template.hookWindowFraction);
  return { totalDurationSec: intent.maxDurationSec, peakEmotionAt: template.peakEmotionAt, tensionCurve, resolutionAt: template.resolutionAt, hookWindowMs: Math.max(1500, Math.min(hookWindowMs, 5000)) };
}

export function getArcSceneRoles(sceneCount: number, intent: DirectorIntent): SceneRole[] {
  if (sceneCount <= 2) return ['hook', 'cta'];
  if (sceneCount <= 3) return ['hook', 'solution', 'cta'];
  if (sceneCount <= 4) return ['hook', 'problem', 'solution', 'cta'];
  if (sceneCount <= 5) return ['hook', 'problem', 'solution', 'proof', 'cta'];
  if (sceneCount <= 6) return ['hook', 'problem', 'solution', 'proof', 'brand_reveal', 'cta'];
  const roles: SceneRole[] = ['hook', 'problem', 'solution', 'proof', 'brand_reveal', 'offer', 'cta'];
  while (roles.length < sceneCount) roles.splice(roles.length - 1, 0, 'proof');
  return roles.slice(0, sceneCount);
}
