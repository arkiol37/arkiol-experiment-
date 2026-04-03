import type { StoryboardScene } from '../types';
export interface PlacementBlock { elementType: string; position: { x: number; y: number }; size: { width: number; height: number }; zIndex: number; animation: string; importance: number; }
export interface BlockingPlan { sceneId: string; blocks: PlacementBlock[]; }
export function planProductBlocking(scene: StoryboardScene, hasBrandAssets: boolean, aspectRatio: string): BlockingPlan {
  const blocks: PlacementBlock[] = []; const isV = aspectRatio === '9:16';
  blocks.push({ elementType: 'background', position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 0, animation: 'none', importance: 0.3 });
  if (scene.role === 'hook') { blocks.push({ elementType: 'text', position: { x: isV ? 10 : 15, y: isV ? 30 : 25 }, size: { width: isV ? 80 : 70, height: 20 }, zIndex: 3, animation: 'scale_in', importance: 1 }); if (hasBrandAssets) blocks.push({ elementType: 'logo', position: { x: isV ? 35 : 5, y: isV ? 8 : 5 }, size: { width: isV ? 30 : 15, height: isV ? 6 : 8 }, zIndex: 4, animation: 'fade_in', importance: 0.6 }); }
  else if (scene.role === 'solution') blocks.push({ elementType: 'product', position: { x: isV ? 15 : 20, y: isV ? 20 : 10 }, size: { width: isV ? 70 : 55, height: isV ? 45 : 70 }, zIndex: 2, animation: 'scale_in', importance: 1 });
  else if (scene.role === 'cta') { blocks.push({ elementType: 'cta_button', position: { x: isV ? 15 : 30, y: isV ? 55 : 50 }, size: { width: isV ? 70 : 40, height: isV ? 8 : 12 }, zIndex: 4, animation: 'pulse', importance: 1 }); blocks.push({ elementType: 'logo', position: { x: 35, y: isV ? 75 : 70 }, size: { width: 30, height: 8 }, zIndex: 4, animation: 'fade_in', importance: 0.7 }); }
  else if (scene.role === 'brand_reveal') blocks.push({ elementType: 'logo', position: { x: 25, y: 35 }, size: { width: 50, height: 20 }, zIndex: 3, animation: 'scale_in_bounce', importance: 1 });
  return { sceneId: scene.id, blocks };
}
