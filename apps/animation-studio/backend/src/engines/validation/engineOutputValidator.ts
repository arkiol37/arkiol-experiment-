/**
 * Engine Output Validator
 * Scores and validates the output of each AI engine to ensure
 * measurable quality impact. Logs metrics for comparison.
 */

import { logger } from '../../config/logger';

export interface EngineValidationResult {
  engine: string;
  passed: boolean;
  score: number;          // 0-100
  metrics: Record<string, number>;
  issues: string[];
  promptLengthBefore: number;
  promptLengthAfter: number;
  directivesInjected: number;
}

/**
 * Validate Performance & Acting engine output.
 */
export function validateActingOutput(performances: any[]): EngineValidationResult {
  const issues: string[] = [];
  let score = 70;
  let directivesInjected = 0;

  for (const perf of performances) {
    if (!perf.emotionProgression || perf.emotionProgression.length < 3) {
      issues.push(`Scene ${perf.sceneId}: insufficient emotion keyframes`);
      score -= 5;
    }
    if (!perf.microExpressions || perf.microExpressions.length === 0) {
      issues.push(`Scene ${perf.sceneId}: no micro-expressions planned`);
      score -= 3;
    }
    if (perf.promptInjection && perf.promptInjection.length > 20) directivesInjected++;
    if (!perf.gazeDirective || perf.gazeDirective.blinkPattern.length === 0) {
      issues.push(`Scene ${perf.sceneId}: no blink pattern`);
      score -= 2;
    }
  }

  if (directivesInjected === performances.length) score += 10;
  if (performances.some(p => p.productActing)) score += 5;

  score = Math.max(0, Math.min(100, score));
  logger.info(`[Validation] Acting engine: ${score}/100 (${directivesInjected}/${performances.length} directives, ${issues.length} issues)`);

  return {
    engine: 'performance_acting',
    passed: score >= 60,
    score,
    metrics: {
      scenesWithDirectives: directivesInjected,
      totalScenes: performances.length,
      avgEmotionKeyframes: performances.reduce((s: number, p: any) => s + (p.emotionProgression?.length || 0), 0) / Math.max(1, performances.length),
      avgMicroExpressions: performances.reduce((s: number, p: any) => s + (p.microExpressions?.length || 0), 0) / Math.max(1, performances.length),
      productActingScenes: performances.filter((p: any) => p.productActing).length,
    },
    issues,
    promptLengthBefore: 0,
    promptLengthAfter: performances.reduce((s: number, p: any) => s + (p.promptInjection?.length || 0), 0),
    directivesInjected,
  };
}

/**
 * Validate Frame Continuity engine output.
 */
export function validateContinuityOutput(plans: any[]): EngineValidationResult {
  const issues: string[] = [];
  let score = 70;
  let directivesInjected = 0;

  for (const plan of plans) {
    if (!plan.identityLocks || plan.identityLocks.length === 0) {
      issues.push(`Scene ${plan.sceneId}: no identity locks`);
      score -= 5;
    }
    if (plan.continuityScore < 60) {
      issues.push(`Scene ${plan.sceneId}: low continuity score (${plan.continuityScore})`);
      score -= 3;
    }
    if (plan.promptInjection && plan.promptInjection.length > 20) directivesInjected++;
  }

  const avgContinuity = plans.reduce((s: number, p: any) => s + (p.continuityScore || 0), 0) / Math.max(1, plans.length);
  if (avgContinuity >= 80) score += 15;
  else if (avgContinuity >= 70) score += 8;

  score = Math.max(0, Math.min(100, score));
  logger.info(`[Validation] Continuity engine: ${score}/100 (avg continuity ${avgContinuity.toFixed(0)}, ${issues.length} issues)`);

  return {
    engine: 'frame_continuity',
    passed: score >= 60,
    score,
    metrics: {
      avgContinuityScore: avgContinuity,
      identityLocksTotal: plans.reduce((s: number, p: any) => s + (p.identityLocks?.length || 0), 0),
      scenesWithConstraints: directivesInjected,
    },
    issues,
    promptLengthBefore: 0,
    promptLengthAfter: plans.reduce((s: number, p: any) => s + (p.promptInjection?.length || 0), 0),
    directivesInjected,
  };
}

/**
 * Validate Cinematic Direction engine output.
 */
export function validateCinematicOutput(plans: any[]): EngineValidationResult {
  const issues: string[] = [];
  let score = 70;
  let directivesInjected = 0;

  for (const plan of plans) {
    if (!plan.shotLanguage || !plan.shotLanguage.primaryShot) {
      issues.push(`Scene ${plan.sceneId}: no shot language`);
      score -= 5;
    }
    if (!plan.cameraKeyframes || plan.cameraKeyframes.length < 2) {
      issues.push(`Scene ${plan.sceneId}: insufficient camera keyframes`);
      score -= 3;
    }
    if (plan.promptInjection && plan.promptInjection.length > 20) directivesInjected++;
    if (!plan.visualRhythm || !plan.visualRhythm.beatPattern) {
      issues.push(`Scene ${plan.sceneId}: no visual rhythm`);
      score -= 2;
    }
  }

  // Check shot variety
  const shotTypes = plans.map((p: any) => p.shotLanguage?.primaryShot).filter(Boolean);
  const uniqueShots = new Set(shotTypes);
  if (uniqueShots.size >= Math.min(3, plans.length)) score += 10;

  // Check transition quality
  const hasTransitions = plans.filter((p: any) => p.transitionDesign?.inTransition?.durationMs > 0);
  if (hasTransitions.length >= plans.length - 1) score += 5;

  score = Math.max(0, Math.min(100, score));
  logger.info(`[Validation] Cinematic engine: ${score}/100 (${uniqueShots.size} shot types, ${issues.length} issues)`);

  return {
    engine: 'cinematic_direction',
    passed: score >= 60,
    score,
    metrics: {
      uniqueShotTypes: uniqueShots.size,
      avgKeyframes: plans.reduce((s: number, p: any) => s + (p.cameraKeyframes?.length || 0), 0) / Math.max(1, plans.length),
      transitionsCovered: hasTransitions.length,
      scenesWithDirection: directivesInjected,
    },
    issues,
    promptLengthBefore: 0,
    promptLengthAfter: plans.reduce((s: number, p: any) => s + (p.promptInjection?.length || 0), 0),
    directivesInjected,
  };
}

/**
 * Validate Prompt Compiler output.
 */
export function validatePromptCompilation(compiled: any[]): EngineValidationResult {
  const issues: string[] = [];
  let score = 75;

  for (const c of compiled) {
    if (!c.positivePrompt || c.positivePrompt.length < 100) {
      issues.push(`Scene: compiled prompt too short (${c.positivePrompt?.length || 0} chars)`);
      score -= 5;
    }
    if (c.compressionRatio > 3) {
      issues.push(`Scene: excessive compression ratio (${c.compressionRatio.toFixed(1)}x)`);
      score -= 3;
    }
  }

  const avgLength = compiled.reduce((s: number, c: any) => s + (c.compiledLength || 0), 0) / Math.max(1, compiled.length);
  if (avgLength > 200) score += 10;
  if (compiled.every((c: any) => c.negativePrompt && c.negativePrompt.length > 20)) score += 5;

  score = Math.max(0, Math.min(100, score));

  return {
    engine: 'prompt_compiler',
    passed: score >= 60,
    score,
    metrics: {
      avgCompiledLength: avgLength,
      avgCompressionRatio: compiled.reduce((s: number, c: any) => s + (c.compressionRatio || 1), 0) / Math.max(1, compiled.length),
      withNegativePrompt: compiled.filter((c: any) => c.negativePrompt).length,
    },
    issues,
    promptLengthBefore: compiled.reduce((s: number, c: any) => s + (c.originalLength || 0), 0),
    promptLengthAfter: compiled.reduce((s: number, c: any) => s + (c.compiledLength || 0), 0),
    directivesInjected: compiled.length,
  };
}

/**
 * Aggregate all engine validation results.
 */
export function aggregateValidation(results: EngineValidationResult[]): {
  allPassed: boolean;
  avgScore: number;
  totalDirectives: number;
  totalIssues: number;
  summary: string;
} {
  const avgScore = results.reduce((s, r) => s + r.score, 0) / Math.max(1, results.length);
  const totalDirectives = results.reduce((s, r) => s + r.directivesInjected, 0);
  const totalIssues = results.reduce((s, r) => s + r.issues.length, 0);
  const allPassed = results.every(r => r.passed);

  const summary = results.map(r =>
    `${r.engine}: ${r.score}/100 (${r.passed ? 'PASS' : 'FAIL'}, ${r.directivesInjected} directives, ${r.issues.length} issues)`
  ).join(' | ');

  logger.info(`[Validation] Aggregate: ${avgScore.toFixed(0)}/100 avg, ${totalDirectives} total directives, ${totalIssues} issues. ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);

  return { allPassed, avgScore, totalDirectives, totalIssues, summary };
}
