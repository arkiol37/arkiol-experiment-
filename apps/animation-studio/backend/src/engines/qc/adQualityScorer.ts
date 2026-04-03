import type { StoryboardScene, DirectorIntent, QualityScore, QualityIssue } from '../types';
export function scoreAdQuality(scenes: StoryboardScene[], intent: DirectorIntent): QualityScore {
  const issues: QualityIssue[] = []; let score = 80;
  if (!scenes.find(s => s.role === 'hook')) { score -= 20; issues.push({ id: 'no_hook', severity: 'critical', category: 'structure', message: 'No hook scene', autoFixable: false }); }
  else if (scenes.find(s => s.role === 'hook')!.position !== 0) { score -= 10; issues.push({ id: 'hook_not_first', severity: 'error', category: 'structure', message: 'Hook not first', autoFixable: true }); }
  if (!scenes.find(s => s.role === 'cta')) { score -= 15; issues.push({ id: 'no_cta', severity: 'error', category: 'structure', message: 'No CTA', autoFixable: false }); }
  const total = scenes.reduce((s, sc) => s + sc.durationSec, 0);
  if (total > intent.maxDurationSec * 1.1) { score -= 10; issues.push({ id: 'over_dur', severity: 'warning', category: 'compliance', message: `${total}s > ${intent.maxDurationSec}s`, autoFixable: true }); }
  return { overall: Math.max(0, score), visual: 80, motion: 80, audio: 80, brand: score, readability: 80, coherence: 80, passed: score >= 60, issues };
}
