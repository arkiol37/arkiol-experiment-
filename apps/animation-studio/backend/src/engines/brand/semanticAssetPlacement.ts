import type { StoryboardScene } from '../types';
export interface AssetPlacement { assetId: string; assetType: string; sceneId: string; position: { x: number; y: number; width: number; height: number }; zIndex: number; animation: string; }
const R: Record<string, Record<string, { x: number; y: number; w: number; h: number; z: number }>> = {
  logo: { hook: { x: 35, y: 5, w: 30, h: 8, z: 5 }, cta: { x: 35, y: 80, w: 30, h: 8, z: 5 }, brand_reveal: { x: 25, y: 30, w: 50, h: 25, z: 3 }, _d: { x: 5, y: 85, w: 20, h: 6, z: 5 } },
  product: { hook: { x: 20, y: 15, w: 60, h: 65, z: 2 }, solution: { x: 15, y: 10, w: 70, h: 70, z: 2 }, _d: { x: 20, y: 15, w: 60, h: 60, z: 2 } },
};
export function placeAssets(assets: { id: string; type: string }[], scene: StoryboardScene): AssetPlacement[] {
  return assets.map(a => { const r = R[a.type] || R.product; const rule = r[scene.role] || r._d || { x: 20, y: 15, w: 60, h: 60, z: 2 };
    return { assetId: a.id, assetType: a.type, sceneId: scene.id, position: { x: rule.x, y: rule.y, width: rule.w, height: rule.h }, zIndex: rule.z, animation: scene.role === 'brand_reveal' ? 'scale_in_bounce' : 'fade_in' };
  });
}
