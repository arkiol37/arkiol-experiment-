import { analyzeFeedback } from './feedbackEngine';
export interface TemplateAdjustment { parameter: string; currentValue: unknown; suggestedValue: unknown; confidence: number; basedOnSamples: number; }
export function computeTemplateAdjustments(workspaceId: string): TemplateAdjustment[] {
  const insights = analyzeFeedback(workspaceId, 100);
  const adjustments: TemplateAdjustment[] = [];
  for (const insight of insights) {
    if (insight.trend === 'declining' && insight.avgScore < 3) {
      if (insight.category === 'pacing') adjustments.push({ parameter: 'scene_duration_multiplier', currentValue: 1.0, suggestedValue: 0.9, confidence: Math.min(0.9, insight.sampleSize / 30), basedOnSamples: insight.sampleSize });
      if (insight.category === 'visual') adjustments.push({ parameter: 'prompt_detail_level', currentValue: 'standard', suggestedValue: 'detailed', confidence: Math.min(0.8, insight.sampleSize / 30), basedOnSamples: insight.sampleSize });
      if (insight.category === 'audio') adjustments.push({ parameter: 'music_volume', currentValue: 0.25, suggestedValue: 0.2, confidence: Math.min(0.7, insight.sampleSize / 30), basedOnSamples: insight.sampleSize });
    }
  }
  return adjustments;
}
