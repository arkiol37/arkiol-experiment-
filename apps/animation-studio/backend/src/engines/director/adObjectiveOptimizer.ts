/**
 * Ad Objective Optimizer — fine-tunes intent based on objective (awareness, conversion, etc.)
 */
import type { DirectorIntent, AdObjective } from '../types';

interface ObjProfile { hookWeight: number; ctaUrgency: number; proofWeight: number; emotionalDepth: number; pacingMul: number; }

const PROFILES: Record<AdObjective, ObjProfile> = {
  awareness:     { hookWeight: 0.9, ctaUrgency: 0.3, proofWeight: 0.4, emotionalDepth: 0.7, pacingMul: 0.95 },
  consideration: { hookWeight: 0.7, ctaUrgency: 0.5, proofWeight: 0.8, emotionalDepth: 0.6, pacingMul: 1.0 },
  conversion:    { hookWeight: 0.8, ctaUrgency: 0.95, proofWeight: 0.7, emotionalDepth: 0.4, pacingMul: 1.1 },
  retention:     { hookWeight: 0.5, ctaUrgency: 0.4, proofWeight: 0.9, emotionalDepth: 0.8, pacingMul: 0.9 },
  app_install:   { hookWeight: 0.85, ctaUrgency: 0.9, proofWeight: 0.6, emotionalDepth: 0.3, pacingMul: 1.15 },
};

export function optimizeAdObjective(intent: DirectorIntent): Partial<DirectorIntent> { return { ...intent }; }
export function getObjectiveProfile(objective: AdObjective): ObjProfile { return PROFILES[objective] || PROFILES.awareness; }
export function scoreObjectiveAlignment(scenes: { role: string; durationSec: number }[], objective: AdObjective): number {
  const p = PROFILES[objective]; let s = 0.5;
  if (scenes.some(sc => sc.role === 'hook')) s += 0.15 * p.hookWeight;
  if (scenes.some(sc => sc.role === 'cta')) s += 0.15 * p.ctaUrgency;
  if (scenes.some(sc => sc.role === 'proof')) s += 0.1 * p.proofWeight;
  return Math.min(1, Math.max(0, s));
}
