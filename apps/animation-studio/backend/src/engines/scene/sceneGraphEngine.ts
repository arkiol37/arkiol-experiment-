import type { StoryboardScene } from '../types';

export interface SceneNode { sceneId: string; position: number; role: string; dependencies: string[]; dependents: string[]; canParallelize: boolean; renderPriority: number; }
export interface SceneGraph { nodes: SceneNode[]; executionOrder: string[][]; criticalPath: string[]; }

export function buildSceneGraph(scenes: StoryboardScene[]): SceneGraph {
  const nodes: SceneNode[] = scenes.map((scene, i) => {
    const deps: string[] = []; const dependents: string[] = [];
    if (i > 0) deps.push(scenes[i - 1].id);
    if (i < scenes.length - 1) dependents.push(scenes[i + 1].id);
    if (scene.role === 'brand_reveal') { const h = scenes.find(s => s.role === 'hook'); if (h && !deps.includes(h.id)) deps.push(h.id); }
    if (scene.role === 'cta') { const sol = scenes.find(s => s.role === 'solution'); if (sol && !deps.includes(sol.id)) deps.push(sol.id); }
    return { sceneId: scene.id, position: i, role: scene.role, dependencies: deps, dependents, canParallelize: deps.length === 0, renderPriority: scene.role === 'hook' ? 0 : scene.role === 'cta' ? 1 : 2 + i };
  });
  const executionOrder: string[][] = []; const completed = new Set<string>();
  while (completed.size < nodes.length) {
    const batch = nodes.filter(n => !completed.has(n.sceneId) && n.dependencies.every(d => completed.has(d))).map(n => n.sceneId);
    if (batch.length === 0) { const rem = nodes.find(n => !completed.has(n.sceneId)); if (rem) batch.push(rem.sceneId); else break; }
    batch.forEach(id => completed.add(id)); executionOrder.push(batch);
  }
  return { nodes, executionOrder, criticalPath: nodes.map(n => n.sceneId) };
}
