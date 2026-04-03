import type { RenderPass } from '../types';
export interface MultiPassConfig { sceneId: string; renderJobId: string; width: number; height: number; fps: number; codec: string; quality: number; isCinematic: boolean; }
const PASSES: RenderPass[] = [
  { id: 'base', name: 'Base Layer', order: 0, inputLayers: ['background','midground'], outputFormat: 'intermediate', filters: [], quality: 90 },
  { id: 'depth', name: 'Depth Composite', order: 1, inputLayers: ['subject','headline'], outputFormat: 'intermediate', filters: ['depth_blur','parallax'], quality: 90 },
  { id: 'overlay', name: 'Overlay Pass', order: 2, inputLayers: ['supporting','overlay'], outputFormat: 'intermediate', filters: ['blend_overlay'], quality: 90 },
  { id: 'motion', name: 'Motion Pass', order: 3, inputLayers: ['all'], outputFormat: 'intermediate', filters: ['motion_blur'], quality: 90 },
  { id: 'color', name: 'Color Grade', order: 4, inputLayers: ['composite'], outputFormat: 'intermediate', filters: ['lut_apply','vignette','film_grain'], quality: 95 },
  { id: 'final', name: 'Final Encode', order: 5, inputLayers: ['graded'], outputFormat: 'mp4', filters: ['h264_encode'], quality: 85 },
];
export function planRenderPasses(config: MultiPassConfig): RenderPass[] {
  let passes = [...PASSES];
  if (config.isCinematic) passes.splice(4, 0, { id: 'cinematic', name: 'Cinematic Grade', order: 3.5, inputLayers: ['composite'], outputFormat: 'intermediate', filters: ['letterbox','film_grain_heavy','color_teal_orange','depth_of_field'], quality: 95 });
  return passes.sort((a, b) => a.order - b.order).map(p => ({ ...p, quality: Math.max(p.quality, config.quality) }));
}
export function buildPassFilterChain(pass: RenderPass, config: MultiPassConfig): string[] {
  const f: string[] = [];
  for (const fi of pass.filters) { if (fi === 'depth_blur') f.push('boxblur=2:1'); if (fi === 'vignette') f.push('vignette=PI/4'); if (fi === 'film_grain') f.push('noise=alls=3:allf=t'); if (fi === 'film_grain_heavy') f.push('noise=alls=8:allf=t'); if (fi === 'letterbox') f.push(`pad=${config.width}:${Math.round(config.width/2.35)}:(ow-iw)/2:(oh-ih)/2:black`); if (fi === 'color_teal_orange') f.push('colorbalance=rs=0.1:gs=-0.05:bs=-0.1:rh=-0.05:gh=0.05:bh=0.1'); }
  return f;
}
export function estimateRenderTime(durSec: number, isCinematic: boolean, resolution: string): number { return Math.round(durSec * (resolution === '4K' ? 8000 : 3000) * (isCinematic ? 1.6 : 1)); }
