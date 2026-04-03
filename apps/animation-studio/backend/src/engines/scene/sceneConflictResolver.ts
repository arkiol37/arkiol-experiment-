import type { StoryboardScene } from '../types';

export interface SceneConflict { type: string; sceneIds: string[]; severity: 'warning' | 'error'; description: string; }

export function detectConflicts(scenes: StoryboardScene[], maxDur: number): SceneConflict[] {
  const c: SceneConflict[] = [];
  const total = scenes.reduce((s, sc) => s + sc.durationSec, 0);
  if (total > maxDur * 1.05) c.push({ type: 'duration_overflow', sceneIds: scenes.map(s => s.id), severity: 'error', description: `Total ${total}s > max ${maxDur}s` });
  for (let i = 0; i < scenes.length - 1; i++) {
    if (scenes[i].transitionOut !== scenes[i + 1].transitionIn && scenes[i].transitionOut !== 'cut')
      c.push({ type: 'transition_mismatch', sceneIds: [scenes[i].id, scenes[i + 1].id], severity: 'warning', description: `Mismatch at scene ${i}` });
  }
  const rc: Record<string, number> = {}; scenes.forEach(s => rc[s.role] = (rc[s.role] || 0) + 1);
  for (const [role, cnt] of Object.entries(rc)) {
    if ((role === 'hook' || role === 'cta') && cnt > 1) c.push({ type: 'role_duplicate', sceneIds: scenes.filter(s => s.role === role).map(s => s.id), severity: 'warning', description: `Multiple ${role} (${cnt})` });
  }
  return c;
}

export function resolveConflicts(scenes: StoryboardScene[], conflicts: SceneConflict[], maxDur: number): StoryboardScene[] {
  let r = [...scenes];
  for (const c of conflicts) {
    if (c.type === 'duration_overflow') { const t = r.reduce((s, sc) => s + sc.durationSec, 0); const ratio = maxDur / t; r = r.map(s => ({ ...s, durationSec: Math.max(2, Math.round(s.durationSec * ratio)) })); }
    if (c.type === 'transition_mismatch') { const b = r.find(s => s.id === c.sceneIds[1]); const a = r.find(s => s.id === c.sceneIds[0]); if (a && b) b.transitionIn = a.transitionOut; }
  }
  return r;
}
