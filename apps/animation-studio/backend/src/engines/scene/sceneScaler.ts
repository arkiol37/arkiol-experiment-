import type { StoryboardScene, AspectRatio } from '../types';

const SZ: Record<AspectRatio, { top: number; bottom: number; left: number; right: number }> = { '16:9': { top: 5, bottom: 5, left: 5, right: 5 }, '9:16': { top: 10, bottom: 15, left: 5, right: 5 }, '1:1': { top: 5, bottom: 10, left: 5, right: 5 } };
const RES: Record<string, { width: number; height: number }> = { '16:9_1080p': { width: 1920, height: 1080 }, '16:9_4K': { width: 3840, height: 2160 }, '9:16_1080p': { width: 1080, height: 1920 }, '9:16_4K': { width: 2160, height: 3840 }, '1:1_1080p': { width: 1080, height: 1080 }, '1:1_4K': { width: 2160, height: 2160 } };

export interface ScaledScene { scene: StoryboardScene; resolution: { width: number; height: number }; safeZone: typeof SZ['16:9']; textScale: number; }

export function scaleScenes(scenes: StoryboardScene[], aspect: AspectRatio, resolution: '1080p' | '4K'): ScaledScene[] {
  const res = RES[`${aspect}_${resolution}`] || RES['16:9_1080p'];
  const sz = SZ[aspect] || SZ['16:9'];
  const ts = aspect === '9:16' ? 1.15 : aspect === '1:1' ? 1.0 : 0.9;
  return scenes.map(s => ({ scene: { ...s, visualDirection: `${s.visualDirection}. ${aspect} (${res.width}x${res.height}).` }, resolution: res, safeZone: sz, textScale: ts }));
}
