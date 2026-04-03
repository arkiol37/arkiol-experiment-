import type { DepthLayerSpec, CameraKeyframe } from '../types';
export interface CompositeFrame { layers: { layerName: string; zIndex: number; transform: { translateX: number; translateY: number; scale: number; blur: number; opacity: number } }[]; totalLayers: number; hasParallax: boolean; }
export function composeFrame(layers: DepthLayerSpec[], cam: CameraKeyframe, _tp: number): CompositeFrame {
  const cls = layers.map(l => ({ layerName: l.layer, zIndex: l.zIndex, transform: { translateX: cam.translateX * l.parallaxFactor, translateY: cam.translateY * l.parallaxFactor, scale: (1 + (cam.scale - 1) * l.parallaxFactor) * l.scaleReserve, blur: l.blurRadius, opacity: l.layer === 'vignette' ? 0.25 : 1 } })).sort((a, b) => a.zIndex - b.zIndex);
  return { layers: cls, totalLayers: cls.length, hasParallax: cls.some(l => l.transform.translateX !== 0 || l.transform.translateY !== 0) };
}
