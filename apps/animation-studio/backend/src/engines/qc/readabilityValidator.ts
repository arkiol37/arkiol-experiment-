import type { StoryboardScene, QualityIssue } from '../types';
export function validateReadability(scenes: StoryboardScene[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const s of scenes) {
    if (!s.onScreenText) continue;
    if (s.durationSec < 2) issues.push({ id: `short_${s.id}`, severity: 'warning', category: 'readability', message: `Text visible ${s.durationSec}s — min 2s`, sceneId: s.id, autoFixable: true });
    const wc = s.onScreenText.split(/\s+/).length;
    if (wc > 10) issues.push({ id: `long_${s.id}`, severity: 'warning', category: 'readability', message: `${wc} words — keep under 10`, sceneId: s.id, autoFixable: true });
    if (s.voiceoverScript) { const vw = s.voiceoverScript.split(/\s+/).length; if (vw / 2.5 > s.durationSec * 0.9) issues.push({ id: `vo_${s.id}`, severity: 'warning', category: 'readability', message: `VO ${vw} words may overflow ${s.durationSec}s`, sceneId: s.id, autoFixable: true }); }
  }
  return issues;
}
