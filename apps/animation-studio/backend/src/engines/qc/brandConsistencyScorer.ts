import type { StoryboardScene, QualityScore, QualityIssue } from '../types';
export function scoreBrandConsistency(scenes: StoryboardScene[], brandName: string): QualityScore {
  const issues: QualityIssue[] = []; let score = 85;
  for (const s of scenes) if (!s.continuityTokens.some(t => t.key === 'brand_name')) { score -= 5; issues.push({ id: `nb_${s.id}`, severity: 'warning', category: 'brand', message: `Scene ${s.position} missing brand`, sceneId: s.id, autoFixable: true }); }
  const hook = scenes.find(s => s.role === 'hook');
  if (hook && !hook.voiceoverScript.toLowerCase().includes(brandName.toLowerCase())) { score -= 5; issues.push({ id: 'hook_no_brand', severity: 'info', category: 'brand', message: 'Hook VO missing brand name', autoFixable: true }); }
  return { overall: Math.max(0, score), visual: 80, motion: 80, audio: 80, brand: score, readability: 80, coherence: 80, passed: score >= 60, issues };
}
