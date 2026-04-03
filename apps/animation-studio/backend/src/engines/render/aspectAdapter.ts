import type { AspectRatio } from '../types';
export interface AdaptationPlan { sourceAspect: AspectRatio; targetAspect: AspectRatio; method: string; ffmpegFilter: string; }
const AV: Record<AspectRatio, number> = { '16:9': 16/9, '9:16': 9/16, '1:1': 1 };
export function planAspectAdaptation(src: AspectRatio, tgt: AspectRatio, sw: number, sh: number): AdaptationPlan {
  if (src === tgt) return { sourceAspect: src, targetAspect: tgt, method: 'scale_fit', ffmpegFilter: `scale=${sw}:${sh}` };
  if (AV[src] > AV[tgt]) { const nw = Math.round(sh * AV[tgt]); const cx = Math.round((sw-nw)/2); return { sourceAspect: src, targetAspect: tgt, method: 'crop', ffmpegFilter: `crop=${nw}:${sh}:${cx}:0` }; }
  const nh = Math.round(sw / AV[tgt]); const py = Math.round((nh-sh)/2);
  return { sourceAspect: src, targetAspect: tgt, method: 'pad', ffmpegFilter: `pad=${sw}:${nh}:0:${py}:black` };
}
export function getTargetResolution(aspect: AspectRatio, quality: '1080p' | '4K'): { width: number; height: number } {
  const r: Record<string, { width: number; height: number }> = { '16:9_1080p': { width: 1920, height: 1080 }, '16:9_4K': { width: 3840, height: 2160 }, '9:16_1080p': { width: 1080, height: 1920 }, '9:16_4K': { width: 2160, height: 3840 }, '1:1_1080p': { width: 1080, height: 1080 }, '1:1_4K': { width: 2160, height: 2160 } };
  return r[`${aspect}_${quality}`] || r['16:9_1080p'];
}
