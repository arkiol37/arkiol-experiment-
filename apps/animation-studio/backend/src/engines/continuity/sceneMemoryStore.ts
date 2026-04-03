interface SceneMemEntry { sceneId: string; role: string; resolvedAt: Date; state: Record<string, unknown>; }
class SceneMemoryStore {
  private entries = new Map<string, SceneMemEntry>(); private gs: Record<string, unknown> = {};
  setSceneState(id: string, role: string, state: Record<string, unknown>): void { this.entries.set(id, { sceneId: id, role, resolvedAt: new Date(), state }); }
  getSceneState(id: string): Record<string, unknown> | undefined { return this.entries.get(id)?.state; }
  setGlobal(k: string, v: unknown): void { this.gs[k] = v; }
  getGlobal(k: string): unknown { return this.gs[k]; }
  getStateByRole(role: string): Record<string, unknown> | undefined { let l: SceneMemEntry | undefined; for (const e of this.entries.values()) if (e.role === role && (!l || e.resolvedAt > l.resolvedAt)) l = e; return l?.state; }
  clear(): void { this.entries.clear(); this.gs = {}; }
}
const stores = new Map<string, SceneMemoryStore>();
export function getSceneMemory(id: string): SceneMemoryStore { let s = stores.get(id); if (!s) { s = new SceneMemoryStore(); stores.set(id, s); } return s; }
export function releaseSceneMemory(id: string): void { stores.delete(id); }
export { SceneMemoryStore };
