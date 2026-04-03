/**
 * Emotion Curve Engine — per-scene emotion targets (intensity, valence, arousal)
 * that drive visual treatment, motion speed, color grading, and audio energy.
 */
import type { DirectorIntent, NarrativeArc, EmotionPoint, SceneRole, Mood } from '../types';

interface EmotionTarget { intensity: number; valence: number; arousal: number; label: string; }

const ROLE_EMOTIONS: Record<SceneRole, EmotionTarget> = {
  hook:         { intensity: 0.85, valence: 0.1,  arousal: 0.90, label: 'attention_grab' },
  problem:      { intensity: 0.70, valence: -0.5, arousal: 0.60, label: 'frustration' },
  solution:     { intensity: 0.80, valence: 0.6,  arousal: 0.75, label: 'relief_excitement' },
  proof:        { intensity: 0.65, valence: 0.5,  arousal: 0.55, label: 'trust_building' },
  cta:          { intensity: 0.90, valence: 0.7,  arousal: 0.85, label: 'urgency_action' },
  brand_reveal: { intensity: 0.75, valence: 0.8,  arousal: 0.65, label: 'brand_warmth' },
  offer:        { intensity: 0.80, valence: 0.6,  arousal: 0.80, label: 'desire_urgency' },
  close:        { intensity: 0.50, valence: 0.7,  arousal: 0.40, label: 'satisfaction' },
  end:          { intensity: 0.35, valence: 0.5,  arousal: 0.30, label: 'completion' },
};

const MOOD_MODS: Record<Mood, { iMul: number; vShift: number; aMul: number }> = {
  Luxury: { iMul: 0.85, vShift: 0.15, aMul: 0.70 }, Energetic: { iMul: 1.15, vShift: 0.10, aMul: 1.30 },
  Minimal: { iMul: 0.70, vShift: 0.05, aMul: 0.60 }, Playful: { iMul: 1.00, vShift: 0.25, aMul: 1.10 },
  Cinematic: { iMul: 1.10, vShift: 0.00, aMul: 0.90 }, Emotional: { iMul: 1.20, vShift: -0.05, aMul: 0.80 },
  Corporate: { iMul: 0.75, vShift: 0.10, aMul: 0.65 }, Bold: { iMul: 1.25, vShift: 0.05, aMul: 1.20 },
  Calm: { iMul: 0.60, vShift: 0.20, aMul: 0.50 }, Tech: { iMul: 0.90, vShift: 0.00, aMul: 0.85 },
};

function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

function buildRoleSeq(n: number): SceneRole[] {
  if (n <= 2) return ['hook', 'cta'];
  if (n <= 3) return ['hook', 'solution', 'cta'];
  if (n <= 4) return ['hook', 'problem', 'solution', 'cta'];
  if (n <= 5) return ['hook', 'problem', 'solution', 'proof', 'cta'];
  if (n <= 6) return ['hook', 'problem', 'solution', 'proof', 'brand_reveal', 'cta'];
  const r: SceneRole[] = ['hook','problem','solution','proof','brand_reveal','offer','cta'];
  while (r.length < n) r.splice(r.length - 1, 0, 'proof');
  return r.slice(0, n);
}

export function computeEmotionCurve(intent: DirectorIntent, arc?: NarrativeArc): EmotionPoint[] {
  const mod = MOOD_MODS[intent.mood] || MOOD_MODS.Energetic;
  const roles = buildRoleSeq(intent.sceneCount);
  const tension = arc?.tensionCurve || roles.map(() => 0.5);
  const points: EmotionPoint[] = [];
  let cumMs = 0;
  const secPerScene = intent.maxDurationSec / intent.sceneCount;
  for (let i = 0; i < intent.sceneCount; i++) {
    const base = ROLE_EMOTIONS[roles[i]] || ROLE_EMOTIONS.proof;
    const t = tension[i] ?? 0.5;
    const intensity = clamp(base.intensity * mod.iMul * (0.6 + t * 0.4), 0, 1);
    const valence = clamp(base.valence + mod.vShift, -1, 1);
    const arousal = clamp(base.arousal * mod.aMul * (0.5 + t * 0.5), 0, 1);
    points.push({ timeMs: Math.round(cumMs + secPerScene * 500), intensity, valence, arousal, label: base.label });
    cumMs += secPerScene * 1000;
  }
  return points;
}

export function getEmotionForScene(role: SceneRole, mood: Mood): EmotionTarget {
  const base = ROLE_EMOTIONS[role] || ROLE_EMOTIONS.proof;
  const mod = MOOD_MODS[mood] || MOOD_MODS.Energetic;
  return { intensity: clamp(base.intensity * mod.iMul, 0, 1), valence: clamp(base.valence + mod.vShift, -1, 1), arousal: clamp(base.arousal * mod.aMul, 0, 1), label: base.label };
}

export function emotionContrast(a: EmotionPoint, b: EmotionPoint): number {
  return (Math.abs(a.intensity - b.intensity) + Math.abs(a.valence - b.valence) / 2 + Math.abs(a.arousal - b.arousal)) / 3;
}
