import type { StoryboardScene, DirectorIntent, QualityScore, QualityIssue } from '../types';
export function scoreSceneQuality(scene: StoryboardScene, _intent: DirectorIntent): QualityScore {
  const issues: QualityIssue[] = []; let v = 80, m = 80, a = 80, b = 80, r = 80, c = 80;
  if (scene.prompt.length < 50) { v -= 15; issues.push({ id: 'short_prompt', severity: 'warning', category: 'visual', message: `Prompt too short (${scene.prompt.length})`, autoFixable: true }); }
  if (scene.durationSec < 2) { m -= 20; issues.push({ id: 'too_short', severity: 'error', category: 'timing', message: `${scene.durationSec}s too short`, autoFixable: true }); }
  if (!scene.voiceoverScript || scene.voiceoverScript.length < 5) { a -= 15; issues.push({ id: 'no_vo', severity: 'warning', category: 'audio', message: 'Missing voiceover', autoFixable: true }); }
  if (!scene.continuityTokens.some(t => t.category === 'brand')) { b -= 20; issues.push({ id: 'no_brand', severity: 'warning', category: 'brand', message: 'No brand token', autoFixable: true }); }
  if ((scene.role === 'hook' || scene.role === 'cta') && !scene.onScreenText) { r -= 10; issues.push({ id: 'no_text', severity: 'info', category: 'readability', message: `${scene.role} needs on-screen text`, autoFixable: true }); }
  const overall = Math.round((v + m + a + b + r + c) / 6);
  return { overall, visual: v, motion: m, audio: a, brand: b, readability: r, coherence: c, passed: overall >= 60, issues };
}
