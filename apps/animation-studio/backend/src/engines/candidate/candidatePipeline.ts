/**
 * Unified Candidate Pipeline
 * Generates candidate pool → QI (16) + PS (14) evaluation → blocking →
 * ranking → directive application → deep refinement → validation
 */
import { logger } from '../../config/logger';
import { evaluateQI, createQICandidate, generateVariations, type QICandidate, type QIContext } from '../quality-intelligence';
import { evaluatePS, createPSCandidate, type PSCandidate, type PSContext } from '../psychology';
import { checkMemoryPressure, saveCheckpoint, registerHeartbeat, isCircuitOpen, recordCircuitSuccess } from '../self-healing';
import { getRegenerationHistory, getSessionFingerprints, getTasteProfile, getRecentOutputFingerprints, getBenchmarkBaseline,
  recordSessionFingerprint, recordOutputFingerprint, updateBenchmark, computeFingerprint,
  type RegenerationEvent, type SessionFingerprint, type TasteProfile } from './memoryStore';

export interface PipelineConfig { maxCandidates: number; evaluationBudgetMs: number; minComposite: number; }
const DEFAULTS: PipelineConfig = { maxCandidates: 4, evaluationBudgetMs: 15_000, minComposite: 45 };

export interface UnifiedCandidate {
  id: string; scenes: any[]; intent: any;
  qualityComposite: number; psychComposite: number; unified: number;
  qualityDirectives: any[]; psychDirectives: any[];
  blocked: boolean; blockReasons: string[]; isWinner: boolean;
  meta: Record<string, unknown>;
}

export interface PipelineResult {
  winner: UnifiedCandidate;
  allCandidates: UnifiedCandidate[];
  poolSize: number; blockedCount: number; appliedDirectives: number;
  evalTimeMs: number;
  progressiveFeedback: any[];
  comparisonInsights: any[];
}

export async function runCandidatePipeline(
  baseScenes: any[], intent: any, pipelineCtx: any,
  data: { industry: string; mood: string; platform: string; aspectRatio: string; renderMode: string; userId: string; workspaceId: string; jobId: string; workerId?: string; },
  config: Partial<PipelineConfig> = {},
): Promise<PipelineResult> {
  const cfg = { ...DEFAULTS, ...config };
  const start = Date.now();
  const userId = data.userId;

  // Memory check — reduce pool if under pressure
  const mem = checkMemoryPressure();
  if (!mem.safe) { cfg.maxCandidates = Math.min(cfg.maxCandidates, 2); logger.warn(`[CandidatePipeline] Memory pressure — pool reduced to ${cfg.maxCandidates}`); }
  if (data.workerId) registerHeartbeat(data.workerId, data.jobId, 'candidate_pipeline', mem.usageMB);

  // ── 1. POPULATE memory stores with real signals ──────────────────
  const regenHistory = getRegenerationHistory(userId);
  const sessionFps = getSessionFingerprints(userId);
  const tasteProfile = getTasteProfile(userId);
  const recentFps = getRecentOutputFingerprints(userId);
  const benchmark = getBenchmarkBaseline(data.workspaceId);

  // ── 2. GENERATE candidate pool ───────────────────────────────────
  const baseQI = createQICandidate(`${data.jobId}_base`, baseScenes, intent);
  const qiCtx: QIContext = { industry: data.industry, mood: data.mood, platform: data.platform, renderMode: data.renderMode, recentFingerprints: recentFps, tasteProfile, benchmarkBaseline: benchmark, allCandidates: [] };

  const variations = generateVariations(baseQI, qiCtx, cfg.maxCandidates - 1);
  const qiCandidates: QICandidate[] = [baseQI];
  for (const v of variations) {
    const mutated = applyMutations(baseScenes, v.mutations);
    qiCandidates.push(createQICandidate(v.id, mutated, intent));
  }

  saveCheckpoint({ jobId: data.jobId, stage: 'candidate_generation', sceneIndex: 0, specHash: `pool_${qiCandidates.length}`, retryCount: 0 });

  // ── 3. QUALITY INTELLIGENCE (16 engines) ─────────────────────────
  let qiResult = { ranked: qiCandidates, blocked: [] as QICandidate[], blockReasons: [] as string[] };
  try { qiResult = evaluateQI(qiCandidates, { ...qiCtx, allCandidates: qiCandidates }); recordCircuitSuccess('quality_intelligence'); }
  catch (e: any) { logger.warn(`[CandidatePipeline] QI failed (non-fatal): ${e.message}`); }

  // ── 4. PSYCHOLOGY (14 engines) ───────────────────────────────────
  const psCtx: PSContext = { industry: data.industry, mood: data.mood, platform: data.platform, regenHistory, sessionFps, allCandidates: [] };
  const psCandidates = qiResult.ranked.map(qc => createPSCandidate(qc.id, qc.scenes, qc.intent));
  let psResult = { ranked: psCandidates, profile: {} as Record<string, number>, directives: [] as any[] };
  try { psResult = evaluatePS(psCandidates, { ...psCtx, allCandidates: psCandidates }); recordCircuitSuccess('psychology_layer'); }
  catch (e: any) { logger.warn(`[CandidatePipeline] PS failed (non-fatal): ${e.message}`); }

  // ── 5. MERGE & RANK ──────────────────────────────────────────────
  const unified: UnifiedCandidate[] = qiCandidates.map(qc => {
    const pc = psResult.ranked.find(p => p.id === qc.id);
    const isBlocked = qiResult.blocked.some(b => b.id === qc.id);
    const qComp = qc.composite || 50, pComp = pc?.composite || 50;
    const uni = Math.round(qComp * 0.55 + pComp * 0.45);
    return {
      id: qc.id, scenes: qc.scenes, intent: qc.intent,
      qualityComposite: qComp, psychComposite: pComp, unified: uni,
      qualityDirectives: qc.directives || [], psychDirectives: pc?.directives || [],
      blocked: isBlocked || uni < cfg.minComposite,
      blockReasons: isBlocked ? qiResult.blockReasons : (uni < cfg.minComposite ? [`Below min (${uni}<${cfg.minComposite})`] : []),
      isWinner: false, meta: { qScores: qc.scores, pScores: pc?.scores },
    };
  });

  unified.sort((a, b) => b.unified - a.unified);
  const viable = unified.filter(c => !c.blocked);
  if (viable.length === 0) { unified[0].blocked = false; unified[0].isWinner = true; }
  else { viable[0].isWinner = true; }
  const winner = unified.find(c => c.isWinner)!;

  // ── 6. APPLY all directives to winner ────────────────────────────
  const allDirs = [...winner.qualityDirectives, ...winner.psychDirectives];
  const toApply = allDirs.filter(d => d.strength === 'require' || (d.strength === 'recommend' && d.priority >= 65));
  let applied = 0;
  for (const dir of toApply) {
    try { applyDirective(winner.scenes, winner.intent, dir); applied++; }
    catch (e: any) { logger.warn(`[CandidatePipeline] Directive failed: ${dir.action} — ${e.message}`); }
  }

  // ── 7. UPDATE memory stores ──────────────────────────────────────
  const fp = computeFingerprint(winner.scenes, data.jobId);
  recordSessionFingerprint(userId, fp);
  recordOutputFingerprint(userId, fp.combinedHash);
  updateBenchmark(data.workspaceId, winner.unified);

  saveCheckpoint({ jobId: data.jobId, stage: 'post_refinement', sceneIndex: 0, specHash: `winner_${winner.id}_${winner.unified}`, retryCount: 0 });

  // ── 8. BUILD comparison insights ─────────────────────────────────
  const insights = viable.slice(0, 3).map(c => {
    let strongest = 'overall', sv = 0;
    for (const [k, v] of Object.entries((c.meta.qScores || {}) as Record<string, any>)) { if (v?.score > sv) { sv = v.score; strongest = k; } }
    return { id: c.id, label: strongest.replace(/_/g, ' '), quality: c.qualityComposite, psych: c.psychComposite, unified: c.unified, isWinner: c.isWinner };
  });

  // ── 9. EXTRACT progressive feedback ──────────────────────────────
  const speedDir = winner.psychDirectives.find((d: any) => d.action === 'emit_progressive_feedback');
  const feedback = speedDir?.params?.stages || [];

  const evalTime = Date.now() - start;
  logger.info(`[CandidatePipeline] Done in ${evalTime}ms: winner=${winner.id} (Q=${winner.qualityComposite}/P=${winner.psychComposite}/U=${winner.unified}), pool=${unified.length}, blocked=${unified.filter(c => c.blocked).length}, directives=${applied}`);

  return { winner, allCandidates: unified, poolSize: unified.length, blockedCount: unified.filter(c => c.blocked).length, appliedDirectives: applied, evalTimeMs: evalTime, progressiveFeedback: feedback, comparisonInsights: insights };
}

// ═══════════ MUTATION APPLICATION ═══════════
function applyMutations(scenes: any[], mutations: Record<string, unknown>): any[] {
  return scenes.map(s => {
    const c = { ...s, depthLayers: [...(s.depthLayers || [])].map(l => ({...l, elements: [...(l.elements||[])].map(e => ({...e, position: {...(e.position||{})}})) })), timing: { ...s.timing } };
    // Text mutations
    if (mutations.headlineScale && c.onScreenText) { const w = c.onScreenText.split(/\s+/); if (w.length > 6) c.onScreenText = w.slice(0, 6).join(' '); }
    // Pacing/motion mutations
    if (mutations.pacingMultiplier) c.pacingBpm = Math.round(c.pacingBpm * (mutations.pacingMultiplier as number));
    if (mutations.motionIntensity) c.pacingBpm = Math.round(c.pacingBpm * (mutations.motionIntensity as number));
    // Emotion/contrast mutations
    if (mutations.contrastBoost) c.emotionTarget = Math.min(1, c.emotionTarget + (mutations.contrastBoost as number));
    if (mutations.emotionBoost) c.emotionTarget = Math.min(1, c.emotionTarget + (mutations.emotionBoost as number));
    if (mutations.emotionDampen) c.emotionTarget = Math.max(0.15, c.emotionTarget - (mutations.emotionDampen as number));
    if (mutations.emotionShift) c.emotionTarget = Math.min(1, Math.max(0.1, c.emotionTarget + ((Math.random() > 0.5 ? 1 : -1) * (mutations.emotionShift as number))));
    // Quality mutations
    if (mutations.qualityBoost) c.qualityTarget = Math.min(100, c.qualityTarget + (mutations.qualityBoost as number));
    // CTA mutations
    if (mutations.ctaScale && c.role === 'cta') { c.qualityTarget = Math.min(100, c.qualityTarget + (mutations.ctaQualityBoost as number || 10)); c.emotionTarget = Math.min(1, c.emotionTarget + (mutations.ctaEmotionBoost as number || 0.1)); }
    if (mutations.urgencyBoost && c.role === 'cta') c.emotionTarget = Math.min(1, c.emotionTarget + 0.15);
    // Composition mutations
    if (mutations.compositionShift) { for (const l of c.depthLayers) { for (const e of (l.elements || [])) { e.position.x = Math.min(0.9, (e.position?.x || 0.5) + 0.05); } } }
    if (mutations.layoutFlip) { for (const l of c.depthLayers) { for (const e of (l.elements || [])) { e.position.x = Math.max(0.05, Math.min(0.95, 1 - (e.position?.x || 0.5))); } } }
    // Spacing/padding mutations
    if (mutations.spacingAdjust) { /* spatial adjustments handled by constraint engine downstream */ }
    if (mutations.paddingBoost) { /* padding adjustments handled by layout engine downstream */ }
    // Density mutations
    if (mutations.densityReduction) { const maxLayers = Math.max(2, Math.floor((c.depthLayers||[]).length * (mutations.densityReduction as number))); c.depthLayers = c.depthLayers.slice(0, maxLayers); }
    // Camera mutations
    if (mutations.cameraUpgrade && c.cameraMove === 'static_lock') c.cameraMove = 'push_in';
    if (mutations.cameraSwap) { const presets = ['push_in','pull_back','ken_burns','rise_up','dolly_left','horizontal_drift']; c.cameraMove = presets[Math.floor(Math.abs(c.id?.charCodeAt(0)||0) % presets.length)]; }
    return c;
  });
}

// ═══════════ DIRECTIVE EXECUTION (every target handled) ═══════════
function applyDirective(scenes: any[], intent: any, dir: any): void {
  const { target, action, params } = dir;
  switch (target) {
    case 'content':
      if (action.includes('shorten_hook') || action.includes('reduce_text')) { const h = scenes.find((s: any) => s.role === 'hook'); if (h?.onScreenText) { const w = h.onScreenText.split(/\s+/); h.onScreenText = w.slice(0, params.maxWords || 6).join(' '); } }
      if (action.includes('strengthen_cta') || action.includes('add_cta')) { const c = scenes.find((s: any) => s.role === 'cta'); if (c) { c.emotionTarget = Math.min(1, c.emotionTarget + 0.15); c.qualityTarget = Math.min(100, c.qualityTarget + 10); } }
      if (action.includes('amplify_hook') || action.includes('strengthen_hook')) { const h = scenes.find((s: any) => s.role === 'hook'); if (h) { h.emotionTarget = Math.min(1, h.emotionTarget + 0.12); h.qualityTarget = Math.min(100, h.qualityTarget + 8); } }
      break;
    case 'contrast':
      for (const s of scenes) s.emotionTarget = Math.min(1, s.emotionTarget + (params.boost || params.boostAmount || 0.1));
      break;
    case 'hierarchy':
      for (const s of scenes.filter((s: any) => s.role === 'hook' || s.role === 'cta')) s.qualityTarget = Math.min(100, s.qualityTarget + 8);
      break;
    case 'emotion':
      if (action.includes('stabilize')) { const avg = scenes.reduce((s: number, sc: any) => s + sc.emotionTarget, 0) / scenes.length; for (const s of scenes) s.emotionTarget = s.emotionTarget * 0.7 + avg * 0.3; }
      if (action.includes('recalibrate')) { for (const s of scenes) s.emotionTarget = Math.min(1, Math.max(0.2, s.emotionTarget)); }
      break;
    case 'density':
      for (const s of scenes) { if ((s.depthLayers || []).length > 4) s.depthLayers = s.depthLayers.slice(0, 4); }
      break;
    case 'composition':
      if (action.includes('simplify')) { for (const s of scenes) { if ((s.depthLayers || []).length > 5) s.depthLayers = s.depthLayers.slice(0, 5); } }
      if (action.includes('redistribute') || action.includes('depth') || action.includes('elevate') || action.includes('signature')) {
        for (const s of scenes) s.qualityTarget = Math.min(100, s.qualityTarget + 5);
      }
      break;
    case 'motion':
      if (action.includes('boost') || action.includes('increase') || action.includes('energy')) { for (const s of scenes) s.pacingBpm = Math.min(160, s.pacingBpm + 15); }
      if (action.includes('stability') || action.includes('smooth') || action.includes('refine')) { for (const s of scenes) s.pacingBpm = Math.max(60, Math.min(140, s.pacingBpm)); }
      break;
    case 'branding':
      for (const s of scenes.filter((s: any) => s.role === 'brand_reveal' || s.role === 'cta')) s.qualityTarget = Math.min(100, s.qualityTarget + 8);
      break;
    case 'scene_structure':
      // Enforce semantic unity by smoothing emotion targets
      if (scenes.length > 1) { const avg = scenes.reduce((s: number, sc: any) => s + sc.emotionTarget, 0) / scenes.length; for (const s of scenes) s.emotionTarget = s.emotionTarget * 0.8 + avg * 0.2; }
      break;
    case 'overall':
      if (action.includes('expand') || action.includes('divergence') || action.includes('exploration')) { for (const s of scenes) { if (Math.random() > 0.5) s.emotionTarget = Math.min(1, s.emotionTarget + 0.08); else s.emotionTarget = Math.max(0.1, s.emotionTarget - 0.05); } }
      if (action.includes('elevate') || action.includes('signature') || action.includes('quality') || action.includes('category')) { for (const s of scenes) s.qualityTarget = Math.min(100, s.qualityTarget + 5); }
      if (action.includes('inject_energy')) { for (const s of scenes) { s.emotionTarget = Math.min(1, s.emotionTarget + 0.1); s.pacingBpm = Math.min(150, s.pacingBpm + 10); } }
      if (action.includes('adjust_toward_taste') && params.pref) { for (const s of scenes) s.emotionTarget = s.emotionTarget * 0.8 + (params.pref.preferredEnergy || 0.5) * 0.2; }
      break;
    case 'pipeline':
      // Pipeline-level directives affect overall generation strategy, not individual scenes
      if (action === 'deep_refinement') {
        // Deep refinement: boost all quality targets and tighten emotional consistency
        for (const s of scenes) { s.qualityTarget = Math.min(100, s.qualityTarget + 5); }
        const avgE = scenes.reduce((sum: number, s: any) => sum + s.emotionTarget, 0) / scenes.length;
        for (const s of scenes) { s.emotionTarget = s.emotionTarget * 0.85 + avgE * 0.15; }
      }
      if (action === 'light_refinement') {
        // Light refinement: minor quality boost only
        for (const s of scenes) { s.qualityTarget = Math.min(100, s.qualityTarget + 2); }
      }
      break;
    default: break;
  }
}
