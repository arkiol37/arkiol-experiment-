import type { ConfidenceScore, PipelineStage, QualityScore } from '../types';
export function computeConfidence(stages: PipelineStage[], qualityScores: QualityScore[]): ConfidenceScore {
  const factors: Record<string, number> = {};
  const completedStages = stages.filter(s => s.status === 'complete');
  factors.stage_completion = completedStages.length / Math.max(1, stages.length);
  const failedCritical = stages.filter(s => s.status === 'failed' && ['intent_translation','storyboard_planning','timeline_assembly'].includes(s.name));
  factors.critical_success = failedCritical.length === 0 ? 1 : 0;
  if (qualityScores.length > 0) { factors.quality_avg = qualityScores.reduce((s, q) => s + q.overall, 0) / qualityScores.length / 100; }
  else { factors.quality_avg = 0.5; }
  const totalRetries = stages.reduce((s, st) => s + st.retries, 0);
  factors.stability = Math.max(0, 1 - totalRetries * 0.15);
  const value = Object.values(factors).reduce((s, v) => s + v, 0) / Object.keys(factors).length;
  let recommendation: ConfidenceScore['recommendation'] = 'proceed';
  if (value < 0.4 || factors.critical_success === 0) recommendation = 'abort';
  else if (value < 0.65) recommendation = 'review';
  return { value: Math.max(0, Math.min(1, value)), factors, recommendation };
}
