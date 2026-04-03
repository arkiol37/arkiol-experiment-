export interface ReferenceLink { sceneId: string; referenceSceneId: string; referenceType: 'style_transfer' | 'continuation' | 'character_lock'; referenceUrl: string; strength: number; }
const chains = new Map<string, ReferenceLink[]>();
export function addReference(jobId: string, link: ReferenceLink): void { const e = chains.get(jobId) || []; e.push(link); chains.set(jobId, e); }
export function getReferences(jobId: string, sceneId: string): ReferenceLink[] { return (chains.get(jobId) || []).filter(l => l.sceneId === sceneId); }
export function clearChain(jobId: string): void { chains.delete(jobId); }
export function buildSequentialChain(scenes: { id: string; outputUrl?: string }[], strength = 0.7): ReferenceLink[] { const links: ReferenceLink[] = []; for (let i = 1; i < scenes.length; i++) { if (scenes[i-1].outputUrl) links.push({ sceneId: scenes[i].id, referenceSceneId: scenes[i-1].id, referenceType: 'continuation', referenceUrl: scenes[i-1].outputUrl!, strength }); } return links; }
