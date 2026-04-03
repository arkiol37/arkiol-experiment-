import type { DepthLayerSpec, CameraKeyframe } from '../types';
export interface ParallaxFrame { layerName: string; offsetX: number; offsetY: number; scale: number; }
export function computeParallax(layers: DepthLayerSpec[], cx: number, cy: number, zoom: number): ParallaxFrame[] {
  return layers.map(l => ({ layerName: l.layer, offsetX: -cx * l.parallaxFactor * 100, offsetY: -cy * l.parallaxFactor * 100, scale: l.scaleReserve * (1 + (zoom - 1) * l.parallaxFactor) }));
}
export function interpolateCamera(from: CameraKeyframe, to: CameraKeyframe, progress: number): { x: number; y: number; zoom: number } {
  const t = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
  return { x: from.translateX + (to.translateX - from.translateX) * t, y: from.translateY + (to.translateY - from.translateY) * t, zoom: from.scale + (to.scale - from.scale) * t };
}
export function generateParallaxTimeline(layers: DepthLayerSpec[], kfs: CameraKeyframe[], fps: number, durMs: number): ParallaxFrame[][] {
  const total = Math.ceil((durMs / 1000) * fps); const frames: ParallaxFrame[][] = [];
  for (let f = 0; f < total; f++) { const tMs = (f / fps) * 1000; let from = kfs[0]; let to = kfs[kfs.length - 1]; for (let i = 0; i < kfs.length - 1; i++) { if (tMs >= kfs[i].timeMs && tMs <= kfs[i+1].timeMs) { from = kfs[i]; to = kfs[i+1]; break; } } const p = to.timeMs > from.timeMs ? (tMs - from.timeMs) / (to.timeMs - from.timeMs) : 0; const cam = interpolateCamera(from, to, p); frames.push(computeParallax(layers, cam.x, cam.y, cam.zoom)); }
  return frames;
}
