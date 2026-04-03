import type { StoryboardScene, QualityScore, QualityIssue } from '../types';
export function scoreVisualCoherence(scenes: StoryboardScene[]): QualityScore {
  const issues: QualityIssue[] = []; let score = 85;
  const moods = new Set(scenes.map(s => s.continuityTokens.find(t => t.key === 'mood')?.value));
  if (moods.size > 1) { score -= 10; issues.push({ id: 'mood_mix', severity: 'warning', category: 'coherence', message: 'Multiple moods', autoFixable: true }); }
  const ems = scenes.map(s => s.emotionTarget);
  if (Math.max(...ems) - Math.min(...ems) < 0.2 && scenes.length > 3) { score -= 10; issues.push({ id: 'flat_emotion', severity: 'warning', category: 'coherence', message: 'Flat emotion curve', autoFixable: true }); }
  for (let i = 0; i < scenes.length - 1; i++) if (scenes[i].shotType === scenes[i+1].shotType && scenes[i+1].shotType !== 'medium') { score -= 3; issues.push({ id: `repeat_shot_${i}`, severity: 'info', category: 'coherence', message: `Consecutive ${scenes[i].shotType}`, autoFixable: true }); }
  return { overall: Math.max(0, score), visual: score, motion: score, audio: 80, brand: 80, readability: 80, coherence: score, passed: score >= 60, issues };
}
