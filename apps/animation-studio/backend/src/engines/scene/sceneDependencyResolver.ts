import type { StoryboardScene, ContinuityToken } from '../types';
import type { SceneGraph } from './sceneGraphEngine';

export interface ResolvedDependency { sceneId: string; inheritedTokens: ContinuityToken[]; overrideTokens: ContinuityToken[]; }

export function resolveDependencies(scenes: StoryboardScene[], graph: SceneGraph): ResolvedDependency[] {
  const map = new Map(scenes.map(s => [s.id, s])); const res: ResolvedDependency[] = [];
  for (const batch of graph.executionOrder) {
    for (const sid of batch) {
      const scene = map.get(sid); if (!scene) continue;
      const node = graph.nodes.find(n => n.sceneId === sid); if (!node) continue;
      const inherited: ContinuityToken[] = [];
      for (const depId of node.dependencies) {
        const dep = map.get(depId); if (!dep) continue;
        for (const t of dep.continuityTokens) {
          if (t.scope === 'global' && !scene.continuityTokens.some(ct => ct.key === t.key && ct.category === t.category)) inherited.push(t);
        }
      }
      res.push({ sceneId: sid, inheritedTokens: inherited, overrideTokens: scene.continuityTokens.filter(t => t.scope === 'scene') });
      scene.continuityTokens = [...scene.continuityTokens, ...inherited];
    }
  }
  return res;
}
