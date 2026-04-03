import { v4 as uuidv4 } from 'uuid';
import type { StoryboardScene, DepthLayerSpec, DepthLayerName, LayerElement } from '../types';
const DEPTH: Record<DepthLayerName, { z: number; p: number; b: number; s: number }> = {
  background: { z: 0, p: 0.06, b: 1.2, s: 1.08 }, midground: { z: 1, p: 0.14, b: 0.4, s: 1.05 },
  subject: { z: 2, p: 0.22, b: 0, s: 1.03 }, headline: { z: 3, p: 0.30, b: 0, s: 1.02 },
  supporting: { z: 4, p: 0.32, b: 0, s: 1.02 }, overlay: { z: 5, p: 0.36, b: 0, s: 1.01 },
  vignette: { z: 6, p: 0, b: 0, s: 1 },
};
export interface Spatial25DComposition { sceneId: string; layers: DepthLayerSpec[]; parallaxIntensity: number; }
function buildLayer(name: DepthLayerName, els: LayerElement[], mul: number): DepthLayerSpec {
  const d = DEPTH[name]; return { layer: name, zIndex: d.z, parallaxFactor: d.p * mul, blurRadius: d.b, scaleReserve: d.s, elements: els };
}
export function decompose25D(scene: StoryboardScene, isCinematic: boolean): Spatial25DComposition {
  const m = isCinematic ? 1.3 : 1.0; const layers: DepthLayerSpec[] = [];
  layers.push(buildLayer('background', [{ id: uuidv4(), type: 'gradient', position: { x: 0, y: 0, width: 100, height: 100 }, opacity: 1, rotation: 0 }], m));
  if (scene.role !== 'end') layers.push(buildLayer('midground', [{ id: uuidv4(), type: 'shape', position: { x: 10, y: 20, width: 80, height: 60 }, opacity: 0.6, rotation: 0 }], m));
  layers.push(buildLayer('subject', [{ id: uuidv4(), type: 'image', position: { x: 20, y: 15, width: 60, height: 70 }, opacity: 1, rotation: 0 }], m));
  if (scene.onScreenText) layers.push(buildLayer('headline', [{ id: uuidv4(), type: 'text', position: { x: 10, y: 30, width: 80, height: 20 }, opacity: 1, rotation: 0 }], m));
  if (scene.role === 'cta' || scene.role === 'brand_reveal') layers.push(buildLayer('overlay', [{ id: uuidv4(), type: 'image', position: { x: 35, y: 80, width: 30, height: 12 }, opacity: 1, rotation: 0 }], m));
  if (isCinematic) layers.push(buildLayer('vignette', [{ id: uuidv4(), type: 'gradient', position: { x: 0, y: 0, width: 100, height: 100 }, opacity: 0.3, rotation: 0 }], m));
  return { sceneId: scene.id, layers, parallaxIntensity: 0.5 * m };
}
