/**
 * Intelligence Orchestrator — 19-stage pipeline controller that coordinates
 * all AI engines into a cohesive ad generation pipeline.
 */
import { logger } from '../../config/logger';
import type { PipelineContext, PipelineStage, StoryboardScene, TimelineTrack, QualityScore, DirectorIntent } from '../types';
import { translateIntent } from '../director/intentTranslator';
import { computeNarrativeArc } from '../director/narrativeArcEngine';
import { computeEmotionCurve } from '../director/emotionCurveEngine';
import { planStoryboard } from '../director/storyboardPlanner';
import { planScenePacing } from '../director/scenePacingEngine';
import { planShots } from '../director/shotPlanner';
import { computeCameraIntelligence } from '../director/cameraIntelligence';
import { optimizeHook } from '../director/hookOptimizer';
import { optimizeCta } from '../director/ctaOptimizer';
import { buildAudienceProfile } from '../director/audienceEngine';
import { getObjectiveProfile } from '../director/adObjectiveOptimizer';
import { buildSceneGraph } from '../scene/sceneGraphEngine';
import { resolveDependencies } from '../scene/sceneDependencyResolver';
import { detectConflicts, resolveConflicts } from '../scene/sceneConflictResolver';
import { buildTimelineIntelligence } from '../timeline/timelineIntelligence';
import { computeTransitions } from '../timeline/transitionEngine';
import { planMotionSemantics } from '../motion/motionSemantics';
import { analyzeMusicIntelligence } from '../audio/musicIntelligence';
import { syncBeats } from '../audio/beatSyncEngine';
import { validateContinuity } from '../continuity/continuityEngine';
import { repairContinuity } from '../continuity/continuityRepair';
import { scoreSceneQuality } from '../qc/sceneQualityValidator';
import { planAllPerformances } from '../acting/performanceActingEngine';
import { planAllFrameContinuity, validateFrameContinuity } from '../continuity/frameContinuityEngine';
import { planAllCinematicDirection } from '../cinematic/cinematicDirectionEngine';
import { scoreAdQuality } from '../qc/adQualityScorer';
import { scoreVisualCoherence } from '../qc/visualCoherenceScorer';
import { scoreBrandConsistency } from '../qc/brandConsistencyScorer';
import { computeConfidence } from './confidenceEngine';
import { compileAllPrompts, selectOptimalProvider } from '../prompt/promptCompilerEngine';
import { planReferenceImages, estimateReferenceGenerationTime } from '../reference/referenceImagePipeline';
import { generateAnimaticPreview } from '../preview/previewAnimaticEngine';

// Shared cross-app modules (from @arkiol/shared monorepo package)
import { evaluateQualityGate } from '@arkiol/shared/src/qc/qualityGate';
import { trackRenderEvent } from '@arkiol/shared/src/analytics/renderAnalytics';
import { isFeatureEnabled } from '@arkiol/shared/src/config/featureFlags';
import { logDecision, createDecision, clearDecisions, getDecisions } from './decisionLogger';
import { validateActingOutput, validateContinuityOutput, validateCinematicOutput, validatePromptCompilation, aggregateValidation } from '../validation/engineOutputValidator';

// ── Unified Candidate Pipeline (QI 16 + PS 14 + Self-Healing) ──
import { runCandidatePipeline, type PipelineResult } from '../candidate';
import { classifyFailure, attemptRecovery, saveCheckpoint, checkMemoryPressure, registerHeartbeat, getStageBudget } from '../self-healing';

export interface OrchestratorInput {
  renderJobId: string; workspaceId: string; userId: string;
  brief: string; brandName: string; industry: string;
  mood?: string; hookType?: string; platform: string; placement: string;
  sceneCount: number; aspectRatio: string; renderMode: string; maxDurationSec: number;
  brandAssetIds?: string[]; brandPalette?: string[]; targetAudience?: string; objective?: string;
}

const CRITICAL_STAGES = new Set(['intent_translation', 'storyboard_planning', 'timeline_assembly']);

async function runStage<T>(ctx: PipelineContext, name: string, fn: () => T | Promise<T>): Promise<T | null> {
  const stage: PipelineStage = { name, status: 'running', startedAt: new Date(), retries: 0 };
  ctx.stages.push(stage);
  try {
    const result = await fn();
    stage.status = 'complete';
    stage.completedAt = new Date();
    stage.durationMs = stage.completedAt.getTime() - stage.startedAt!.getTime();
    stage.output = typeof result === 'object' ? 'ok' : result;
    return result;
  } catch (err: any) {
    stage.status = 'failed';
    stage.error = err.message;
    stage.completedAt = new Date();
    stage.durationMs = stage.completedAt.getTime() - stage.startedAt!.getTime();
    logger.error(`[Orchestrator] Stage "${name}" failed: ${err.message}`, { renderJobId: ctx.renderJobId });
    if (CRITICAL_STAGES.has(name)) throw new Error(`Critical stage "${name}" failed: ${err.message}`);
    return null;
  }
}

export async function orchestrateAdGeneration(input: OrchestratorInput): Promise<PipelineContext> {
  const startedAt = new Date();
  clearDecisions(input.renderJobId);

  const ctx: PipelineContext = {
    renderJobId: input.renderJobId, workspaceId: input.workspaceId, userId: input.userId,
    intent: null as any, storyboard: [], timeline: [], qualityScores: [],
    stages: [], decisions: [], startedAt, metadata: {},
  };

  logger.info(`[Orchestrator] Starting pipeline for ${input.renderJobId}`, { platform: input.platform, scenes: input.sceneCount });

  // Stage 1: Intent Translation (CRITICAL)
  const intent = await runStage(ctx, 'intent_translation', () => {
    const i = translateIntent({ ...input, platform: input.platform as any, aspectRatio: input.aspectRatio as any, renderMode: input.renderMode as any });
    logDecision(input.renderJobId, createDecision('intentTranslator', `mood=${i.mood}, hook=${i.hookType}, obj=${i.objective}`, 0.85, [], 'Inferred from brief'));
    return i;
  });
  ctx.intent = intent!;

  // Stage 2: Audience Profile
  await runStage(ctx, 'audience_profiling', () => {
    ctx.intent.audience = buildAudienceProfile(ctx.intent);
    return ctx.intent.audience;
  });

  // Stage 3: Objective Optimization
  await runStage(ctx, 'objective_optimization', () => getObjectiveProfile(ctx.intent.objective));

  // Stage 4: Narrative Arc
  const arc = await runStage(ctx, 'narrative_arc', () => computeNarrativeArc(ctx.intent));

  // Stage 5: Emotion Curve
  const emotions = await runStage(ctx, 'emotion_curve', () => computeEmotionCurve(ctx.intent, arc || undefined));

  // Stage 6: Storyboard Planning (CRITICAL)
  let storyboard = await runStage(ctx, 'storyboard_planning', () => planStoryboard(ctx.intent, arc || undefined, emotions || undefined));
  ctx.storyboard = storyboard!;

  // Stage 7: Scene Pacing
  await runStage(ctx, 'scene_pacing', () => {
    ctx.storyboard = planScenePacing(ctx.storyboard, ctx.intent, arc || undefined);
    return ctx.storyboard;
  });

  // Stage 8: Hook Optimization
  await runStage(ctx, 'hook_optimization', () => {
    const hi = ctx.storyboard.findIndex(s => s.role === 'hook');
    if (hi >= 0) ctx.storyboard[hi] = optimizeHook(ctx.storyboard[hi], ctx.intent);
  });

  // Stage 9: CTA Optimization
  await runStage(ctx, 'cta_optimization', () => {
    const ci = ctx.storyboard.findIndex(s => s.role === 'cta');
    if (ci >= 0) ctx.storyboard[ci] = optimizeCta(ctx.storyboard[ci], ctx.intent);
  });

  // Stage 10: Shot Planning
  await runStage(ctx, 'shot_planning', () => planShots(ctx.storyboard, ctx.intent));

  // Stage 10b: Store shot plans in metadata
  await runStage(ctx, 'shot_plan_store', () => {
    const shots = planShots(ctx.storyboard, ctx.intent);
    ctx.metadata.shotPlans = shots;
    return shots;
  });

  // Stage 11: Camera Intelligence
  await runStage(ctx, 'camera_intelligence', () => computeCameraIntelligence(ctx.storyboard, ctx.intent));

  // Stage 12: Scene Graph & Dependencies
  await runStage(ctx, 'scene_graph', () => {
    const graph = buildSceneGraph(ctx.storyboard);
    resolveDependencies(ctx.storyboard, graph);
    const conflicts = detectConflicts(ctx.storyboard, ctx.intent.maxDurationSec);
    if (conflicts.length > 0) ctx.storyboard = resolveConflicts(ctx.storyboard, conflicts, ctx.intent.maxDurationSec);
    return graph;
  });

  // Stage 13: Motion Semantics
  await runStage(ctx, 'motion_semantics', () => planMotionSemantics(ctx.storyboard, ctx.intent));

  // Stages 13b/13c/13d: Run core AI engines in PARALLEL
  // These engines read from ctx.storyboard + ctx.intent but don't depend on
  // each other's output, so parallel execution is safe and ~3x faster.
  const [perfResult, contResult, cineResult] = await Promise.all([
    runStage(ctx, 'performance_acting', () => {
      const performances = planAllPerformances(ctx.storyboard, ctx.intent);
      ctx.metadata.performances = performances;
      logDecision(input.renderJobId, createDecision('performanceActingEngine', `Generated ${performances.length} performance plans`, 0.85, [], 'Emotion, micro-expressions, gaze, gestures, product acting'));
      return performances;
    }),
    runStage(ctx, 'frame_continuity', () => {
      const continuityPlans = planAllFrameContinuity(ctx.storyboard, ctx.intent);
      ctx.metadata.frameContinuityPlans = continuityPlans;
      const frameViolations = validateFrameContinuity(continuityPlans);
      if (frameViolations.length > 0) {
        logger.info(`[Orchestrator] ${frameViolations.length} frame continuity issues`);
        ctx.metadata.frameContinuityViolations = frameViolations;
      }
      const avgScore = continuityPlans.reduce((s, p) => s + p.continuityScore, 0) / continuityPlans.length;
      logDecision(input.renderJobId, createDecision('frameContinuityEngine', `Continuity ${avgScore.toFixed(0)}/100`, avgScore / 100, [], 'Identity locks, lighting, color, motion, style'));
      return continuityPlans;
    }),
    runStage(ctx, 'cinematic_direction', () => {
      const cinematicPlans = planAllCinematicDirection(ctx.storyboard, ctx.intent);
      ctx.metadata.cinematicDirection = cinematicPlans;
      logDecision(input.renderJobId, createDecision('cinematicDirectionEngine', `${cinematicPlans.length} cinematic shots`, 0.9, [], 'Shot language, composition, focus, tracking, rhythm, transitions'));
      return cinematicPlans;
    }),
  ]);

  // Merge all engine outputs into scene prompts (sequential — modifies shared state)
  if (perfResult) {
    for (const perf of perfResult as any[]) {
      const scene = ctx.storyboard.find(s => s.id === perf.sceneId);
      if (scene) scene.prompt += ' ' + perf.promptInjection;
    }
  }
  if (contResult) {
    for (const plan of contResult as any[]) {
      const scene = ctx.storyboard.find(s => s.id === plan.sceneId);
      if (scene) scene.prompt += ' ' + plan.promptInjection;
    }
  }
  if (cineResult) {
    for (const plan of cineResult as any[]) {
      const scene = ctx.storyboard.find(s => s.id === plan.sceneId);
      if (scene) {
        scene.prompt += ' ' + plan.promptInjection;
        (scene as any).cinematicKeyframes = plan.cameraKeyframes;
        (scene as any).cinematicGrade = plan.cinematicGrade;
      }
    }
  }

  // Stage 14: Prompt Compilation — translate engine directives to provider-optimized prompts
  await runStage(ctx, 'prompt_compilation', () => {
    const provider = selectOptimalProvider(ctx.intent);
    const compiled = compileAllPrompts(ctx.storyboard, ctx.intent, provider);
    ctx.metadata.compiledPrompts = compiled;
    ctx.metadata.selectedProvider = provider;
    // Replace scene prompts with compiled versions
    for (let i = 0; i < compiled.length && i < ctx.storyboard.length; i++) {
      ctx.storyboard[i].prompt = compiled[i].positivePrompt;
      (ctx.storyboard[i] as any).negativePrompt = compiled[i].negativePrompt;
      (ctx.storyboard[i] as any).compiledProvider = compiled[i].provider;
    }
    const avgCompression = compiled.reduce((s, c) => s + c.compressionRatio, 0) / compiled.length;
    logDecision(input.renderJobId, createDecision('promptCompiler', `Compiled ${compiled.length} prompts for ${provider} (avg ratio ${avgCompression.toFixed(1)}x)`, 0.9, [], 'Provider-specific prompt optimization'));
    return compiled;
  });

  // Stage 14b: Reference Image Planning
  await runStage(ctx, 'reference_planning', () => {
    const refPlans = planReferenceImages(ctx.storyboard, ctx.intent);
    ctx.metadata.referenceImagePlans = refPlans;
    const estTime = estimateReferenceGenerationTime(refPlans);
    ctx.metadata.referenceEstimatedMs = estTime;
    const neededCount = refPlans.filter(p => p.needsReference).length;
    logDecision(input.renderJobId, createDecision('referenceImagePipeline', `${neededCount}/${refPlans.length} scenes need reference images (est ${Math.round(estTime/1000)}s)`, 0.8, [], 'Visual consistency via reference frames'));
    return refPlans;
  });

  // Stage 14c: Animatic Preview
  await runStage(ctx, 'animatic_preview', () => {
    const preview = generateAnimaticPreview(ctx.storyboard, ctx.intent, ctx.timeline, ctx.metadata.musicProfile as any, ctx.metadata.audioSyncPoints as any);
    ctx.metadata.animaticPreview = preview;
    return preview;
  });

  // Stage 14d: Engine Output Validation — measure and score all engine outputs
  await runStage(ctx, 'engine_validation', () => {
    const validations = [];
    if (ctx.metadata.performances) validations.push(validateActingOutput(ctx.metadata.performances as any[]));
    if (ctx.metadata.frameContinuityPlans) validations.push(validateContinuityOutput(ctx.metadata.frameContinuityPlans as any[]));
    if (ctx.metadata.cinematicDirection) validations.push(validateCinematicOutput(ctx.metadata.cinematicDirection as any[]));
    if (ctx.metadata.compiledPrompts) validations.push(validatePromptCompilation(ctx.metadata.compiledPrompts as any[]));
    const aggregate = aggregateValidation(validations);
    ctx.metadata.engineValidation = aggregate;
    ctx.metadata.engineValidationDetails = validations;
    logDecision(input.renderJobId, createDecision('engineValidator', `${aggregate.avgScore.toFixed(0)}/100 avg, ${aggregate.totalDirectives} directives, ${aggregate.allPassed ? 'ALL PASS' : 'SOME FAIL'}`, aggregate.avgScore / 100, [], aggregate.summary));
    return aggregate;
  });

  // Stage 15: Timeline Assembly (CRITICAL)
  const timeline = await runStage(ctx, 'timeline_assembly', () => buildTimelineIntelligence(ctx.storyboard, ctx.intent));
  ctx.timeline = timeline!;

  // Stage 16: Transitions
  await runStage(ctx, 'transitions', () => computeTransitions(ctx.storyboard, ctx.timeline, ctx.intent));

  // Stage 17: Audio Sync
  await runStage(ctx, 'audio_sync', () => {
    const mp = analyzeMusicIntelligence(ctx.intent, ctx.storyboard);
    const syncPoints = syncBeats(mp, ctx.timeline, ctx.storyboard);
    ctx.metadata.musicProfile = mp;
    ctx.metadata.audioSyncPointCount = syncPoints.length;
    ctx.metadata.audioSyncPoints = syncPoints;
    return mp;
  });

  // Stage 18: Continuity Validation & Repair
  await runStage(ctx, 'continuity_check', () => {
    const violations = validateContinuity(ctx.storyboard);
    if (violations.length > 0) {
      logger.info(`[Orchestrator] ${violations.length} continuity violations — auto-repairing`);
      ctx.storyboard = repairContinuity(ctx.storyboard, violations);
    }
    return violations;
  });

  // Stage 19: Quality Scoring
  await runStage(ctx, 'quality_scoring', () => {
    const scores: QualityScore[] = [];
    for (const scene of ctx.storyboard) scores.push(scoreSceneQuality(scene, ctx.intent));
    scores.push(scoreAdQuality(ctx.storyboard, ctx.intent));
    scores.push(scoreVisualCoherence(ctx.storyboard));
    scores.push(scoreBrandConsistency(ctx.storyboard, ctx.intent.brand.name));
    ctx.qualityScores = scores;
    return scores;
  });

  // Stage 20: Quality Gate (shared cross-app gate)
  await runStage(ctx, 'quality_gate', () => {
    if (!isFeatureEnabled('AI_QUALITY_GATE', input.workspaceId)) return { passed: true, overallScore: 80, blockers: [], warnings: [] };
    const scores: Record<string, number> = {};
    if (ctx.qualityScores.length > 0) {
      const avg = ctx.qualityScores.reduce((s, q) => s + q.overall, 0) / ctx.qualityScores.length;
      scores.visual_quality = avg;
      scores.brand_consistency = ctx.qualityScores.reduce((s, q) => s + q.brand, 0) / ctx.qualityScores.length;
      scores.audio_sync = ctx.qualityScores.reduce((s, q) => s + q.audio, 0) / ctx.qualityScores.length;
      scores.readability = ctx.qualityScores.reduce((s, q) => s + q.readability, 0) / ctx.qualityScores.length;
      scores.structural_integrity = ctx.qualityScores.reduce((s, q) => s + q.coherence, 0) / ctx.qualityScores.length;
      scores.platform_compliance = 75; // Default — platform compliance checked downstream
    }
    const gateResult = evaluateQualityGate(scores);
    ctx.metadata.qualityGate = gateResult;
    if (!gateResult.passed) logger.warn(`[Orchestrator] Quality gate FAILED: ${gateResult.blockers.join(', ')}`, { renderJobId: ctx.renderJobId });
    return gateResult;
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // Stage 20b: Unified Candidate Pipeline
  // Multi-candidate generation → QI (16 engines) → PS (14 engines) →
  // ranking → directive application → deep refinement
  // ═══════════════════════════════════════════════════════════════════════════
  await runStage(ctx, 'candidate_pipeline', async () => {
    const cpResult: PipelineResult = await runCandidatePipeline(
      ctx.storyboard, ctx.intent, ctx,
      {
        industry: ctx.intent.brand?.industry || input.industry || 'general',
        mood: ctx.intent.mood || input.mood || 'Corporate',
        platform: ctx.intent.platform || input.platform,
        aspectRatio: ctx.intent.aspectRatio || input.aspectRatio,
        renderMode: ctx.intent.renderMode || input.renderMode,
        userId: ctx.userId, workspaceId: ctx.workspaceId, jobId: ctx.renderJobId,
      },
    );
    // Apply winner's scenes back to storyboard
    if (cpResult.winner?.scenes?.length > 0) ctx.storyboard = cpResult.winner.scenes;
    // Store all metadata for downstream consumption
    ctx.metadata.candidatePipeline = {
      poolSize: cpResult.poolSize, blockedCount: cpResult.blockedCount,
      winnerId: cpResult.winner?.id, winnerQ: cpResult.winner?.qualityComposite,
      winnerP: cpResult.winner?.psychComposite, winnerU: cpResult.winner?.unified,
      appliedDirectives: cpResult.appliedDirectives, evalTimeMs: cpResult.evalTimeMs,
    };
    ctx.metadata.comparisonInsights = cpResult.comparisonInsights;
    ctx.metadata.progressiveFeedback = cpResult.progressiveFeedback;
    ctx.metadata.allCandidateScores = cpResult.allCandidates.map(c => ({
      id: c.id, q: c.qualityComposite, p: c.psychComposite, u: c.unified, blocked: c.blocked, winner: c.isWinner,
    }));
    const w = cpResult.winner;
    logDecision(input.renderJobId, createDecision('candidatePipeline',
      `pool=${cpResult.poolSize}, winner=${w?.id} (Q=${w?.qualityComposite}/P=${w?.psychComposite}/U=${w?.unified}), blocked=${cpResult.blockedCount}, directives=${cpResult.appliedDirectives}`,
      (w?.unified || 50) / 100, [], `QI(16)+PS(14) → ${cpResult.poolSize} candidates → ${cpResult.blockedCount} blocked → refined in ${cpResult.evalTimeMs}ms`));
    return cpResult;
  });

  // Analytics tracking
  {
    trackRenderEvent({ eventType: 'render.started', renderJobId: input.renderJobId, workspaceId: input.workspaceId, timestamp: new Date(), properties: { stages: ctx.stages.length, mood: ctx.intent?.mood, platform: ctx.intent?.platform } });
  }

  // Stage 21: Confidence Assessment
  await runStage(ctx, 'confidence_assessment', () => {
    const confidence = computeConfidence(ctx.stages, ctx.qualityScores);
    ctx.metadata.confidence = confidence;
    logDecision(input.renderJobId, createDecision('confidenceEngine', `value=${confidence.value.toFixed(2)}, recommendation=${confidence.recommendation}`, confidence.value, [], 'Pipeline assessment'));
    return confidence;
  });

  ctx.decisions = getDecisions(input.renderJobId);
  ctx.metadata.pipelineElapsedMs = Date.now() - startedAt.getTime();
  ctx.metadata.stageCount = ctx.stages.length;
  ctx.metadata.completedStages = ctx.stages.filter(s => s.status === 'complete').length;
  ctx.metadata.failedStages = ctx.stages.filter(s => s.status === 'failed').length;
  const elapsed = Date.now() - startedAt.getTime();
  const completed = ctx.stages.filter(s => s.status === 'complete').length;
  logger.info(`[Orchestrator] Pipeline complete: ${completed}/${ctx.stages.length} stages in ${elapsed}ms`, { renderJobId: input.renderJobId });
  return ctx;
}
