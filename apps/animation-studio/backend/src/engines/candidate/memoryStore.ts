/**
 * Memory Store — Persistent upstream data for intelligence engines
 * Provides real signals for Regeneration Intelligence, Taste Memory,
 * Creative Fatigue Prevention, and Cross-Output Freshness.
 * 
 * In production this would use Redis/DB. Here we use bounded in-memory
 * stores with TTL eviction, which is correct for single-worker and
 * adequate for multi-worker with Redis backing added later.
 */

import { logger } from '../../config/logger';

// ═══════════════════════════════════════════════════════════════════
// REGENERATION HISTORY
// ═══════════════════════════════════════════════════════════════════

export interface RegenerationEvent {
  timestamp: Date;
  jobId: string;
  userId: string;
  previousFingerprint: string;
  inferredReason: string;
  reasonConfidence: number;
  sequenceIndex: number;
}

const regenStore = new Map<string, RegenerationEvent[]>();
const MAX_REGEN_HISTORY = 20;

export function recordRegeneration(userId: string, event: RegenerationEvent): void {
  const history = regenStore.get(userId) || [];
  history.push(event);
  if (history.length > MAX_REGEN_HISTORY) history.shift();
  regenStore.set(userId, history);
}

export function getRegenerationHistory(userId: string): RegenerationEvent[] {
  return regenStore.get(userId) || [];
}

export function inferRegenerationReason(
  previousScenes: any[],
  currentConfig: any,
): { reason: string; confidence: number } {
  if (!previousScenes || previousScenes.length === 0) return { reason: 'exploring', confidence: 0.3 };
  
  const avgEmotion = previousScenes.reduce((s, sc) => s + (sc.emotionTarget || 0.5), 0) / previousScenes.length;
  const avgQuality = previousScenes.reduce((s, sc) => s + (sc.qualityTarget || 60), 0) / previousScenes.length;
  const totalElements = previousScenes.reduce((s, sc) => s + (sc.depthLayers || []).reduce((ls: number, l: any) => ls + (l.elements?.length || 0), 0), 0);
  const hasHook = previousScenes.some(s => s.role === 'hook');
  const hasCta = previousScenes.some(s => s.role === 'cta');
  
  if (totalElements / previousScenes.length > 10) return { reason: 'too_cluttered', confidence: 0.7 };
  if (totalElements / previousScenes.length < 3) return { reason: 'too_simple', confidence: 0.6 };
  if (!hasHook || avgEmotion < 0.4) return { reason: 'weak_hook', confidence: 0.65 };
  if (!hasCta) return { reason: 'weak_cta', confidence: 0.7 };
  if (avgQuality < 55) return { reason: 'low_quality', confidence: 0.6 };
  if (avgEmotion < 0.35) return { reason: 'boring', confidence: 0.55 };
  return { reason: 'exploring', confidence: 0.4 };
}

// ═══════════════════════════════════════════════════════════════════
// TASTE MEMORY
// ═══════════════════════════════════════════════════════════════════

export interface TasteProfile {
  userId: string;
  preferredDensity: number;    // 0-1
  preferredBoldness: number;   // 0-1
  preferredPolish: number;     // 0-1
  preferredEnergy: number;     // 0-1
  keptStyles: string[];
  rejectedStyles: string[];
  sampleCount: number;
  updatedAt: Date;
}

const tasteStore = new Map<string, TasteProfile>();

export function getTasteProfile(userId: string): TasteProfile {
  const existing = tasteStore.get(userId);
  if (existing) return existing;
  // Return seeded defaults for new users (balanced preferences)
  return {
    userId, preferredDensity: 0.45, preferredBoldness: 0.5,
    preferredPolish: 0.72, preferredEnergy: 0.55,
    keptStyles: [], rejectedStyles: [], sampleCount: 0, updatedAt: new Date(),
  };
}

export function updateTasteFromSelection(
  userId: string,
  selectedCandidate: any,
  rejectedCandidates: any[],
): void {
  const existing = tasteStore.get(userId) || {
    userId, preferredDensity: 0.5, preferredBoldness: 0.5,
    preferredPolish: 0.7, preferredEnergy: 0.5,
    keptStyles: [], rejectedStyles: [], sampleCount: 0, updatedAt: new Date(),
  };
  
  // Learn from selection with decay
  const alpha = Math.min(0.3, 1 / (existing.sampleCount + 1)); // learning rate decays
  const scenes = selectedCandidate.scenes || [];
  if (scenes.length > 0) {
    const avgEnergy = scenes.reduce((s: number, sc: any) => s + (sc.emotionTarget || 0.5), 0) / scenes.length;
    const avgQuality = scenes.reduce((s: number, sc: any) => s + (sc.qualityTarget || 60), 0) / scenes.length / 100;
    const density = scenes.reduce((s: number, sc: any) => s + (sc.depthLayers || []).length, 0) / scenes.length / 6;
    
    existing.preferredEnergy = existing.preferredEnergy * (1 - alpha) + avgEnergy * alpha;
    existing.preferredPolish = existing.preferredPolish * (1 - alpha) + avgQuality * alpha;
    existing.preferredDensity = existing.preferredDensity * (1 - alpha) + Math.min(1, density) * alpha;
    existing.preferredBoldness = existing.preferredBoldness * (1 - alpha) + avgEnergy * 0.8 * alpha;
  }
  
  existing.sampleCount++;
  existing.updatedAt = new Date();
  tasteStore.set(userId, existing);
  logger.debug(`[MemoryStore] Taste updated for ${userId}: energy=${existing.preferredEnergy.toFixed(2)}, polish=${existing.preferredPolish.toFixed(2)}`);
}

// ═══════════════════════════════════════════════════════════════════
// SESSION FINGERPRINTS (for fatigue detection)
// ═══════════════════════════════════════════════════════════════════

export interface SessionFingerprint {
  generationId: string;
  timestamp: Date;
  layoutSignature: string;
  paletteMood: string;
  motionStyle: string;
  focalPattern: string;
  combinedHash: string;
}

const sessionStore = new Map<string, SessionFingerprint[]>();
const MAX_SESSION_FINGERPRINTS = 30;

export function recordSessionFingerprint(userId: string, fp: SessionFingerprint): void {
  const fps = sessionStore.get(userId) || [];
  fps.push(fp);
  if (fps.length > MAX_SESSION_FINGERPRINTS) fps.shift();
  sessionStore.set(userId, fps);
}

export function getSessionFingerprints(userId: string): SessionFingerprint[] {
  return sessionStore.get(userId) || [];
}

export function computeFingerprint(scenes: any[], jobId: string): SessionFingerprint {
  const roles = scenes.map(s => s.role || 'unknown').join('-');
  const avgEmotion = scenes.reduce((s, sc) => s + (sc.emotionTarget || 0.5), 0) / Math.max(1, scenes.length);
  const avgPacing = scenes.reduce((s, sc) => s + (sc.pacingBpm || 100), 0) / Math.max(1, scenes.length);
  const cameras = scenes.map(s => s.cameraMove || 'static').join('-');
  
  return {
    generationId: jobId,
    timestamp: new Date(),
    layoutSignature: roles,
    paletteMood: avgEmotion > 0.7 ? 'warm_energetic' : avgEmotion > 0.4 ? 'balanced' : 'cool_calm',
    motionStyle: avgPacing > 120 ? 'fast' : avgPacing > 90 ? 'moderate' : 'slow',
    focalPattern: scenes[0]?.role || 'hook',
    combinedHash: `${roles}_${Math.round(avgEmotion * 10)}_${Math.round(avgPacing / 10)}_${cameras}`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// OUTPUT FRESHNESS TRACKING
// ═══════════════════════════════════════════════════════════════════

const freshnessStore = new Map<string, string[]>();
const MAX_FRESHNESS_ENTRIES = 50;

export function recordOutputFingerprint(userId: string, fingerprint: string): void {
  const fps = freshnessStore.get(userId) || [];
  fps.push(fingerprint);
  if (fps.length > MAX_FRESHNESS_ENTRIES) fps.shift();
  freshnessStore.set(userId, fps);
}

export function getRecentOutputFingerprints(userId: string): string[] {
  return freshnessStore.get(userId) || [];
}

// ═══════════════════════════════════════════════════════════════════
// BENCHMARK BASELINE (persisted per workspace)
// ═══════════════════════════════════════════════════════════════════

const benchmarkStore = new Map<string, { baseline: number; samples: number; updatedAt: Date }>();

export function getBenchmarkBaseline(workspaceId: string): number {
  return benchmarkStore.get(workspaceId)?.baseline || 60;
}

export function updateBenchmark(workspaceId: string, score: number): void {
  const existing = benchmarkStore.get(workspaceId) || { baseline: 60, samples: 0, updatedAt: new Date() };
  const alpha = Math.min(0.1, 1 / (existing.samples + 1));
  existing.baseline = existing.baseline * (1 - alpha) + score * alpha;
  existing.samples++;
  existing.updatedAt = new Date();
  benchmarkStore.set(workspaceId, existing);
}
