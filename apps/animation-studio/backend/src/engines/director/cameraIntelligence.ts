/**
 * Camera Intelligence — generates per-scene camera keyframe sequences from presets.
 */
import type { StoryboardScene, DirectorIntent, CameraKeyframe, CameraPreset } from '../types';

interface CameraSeq { sceneId: string; keyframes: CameraKeyframe[]; preset: CameraPreset; }

const GEN: Record<CameraPreset, (d: number, i: number) => CameraKeyframe[]> = {
  push_in: (d, i) => [{ timeMs: 0, scale: 1.00, translateX: 0, translateY: 0, rotation: 0, easing: 'cubic-bezier(0.25,0.1,0.25,1)' }, { timeMs: d, scale: 1 + 0.06 * i, translateX: 0, translateY: -0.5 * i, rotation: 0, easing: 'cubic-bezier(0.25,0.1,0.25,1)' }],
  pull_back: (d, i) => [{ timeMs: 0, scale: 1 + 0.08 * i, translateX: 0, translateY: 0, rotation: 0, easing: 'cubic-bezier(0.42,0,0.58,1)' }, { timeMs: d, scale: 1, translateX: 0, translateY: 0.5 * i, rotation: 0, easing: 'cubic-bezier(0.42,0,0.58,1)' }],
  horizontal_drift: (d, i) => [{ timeMs: 0, scale: 1.04, translateX: -i, translateY: 0, rotation: 0, easing: 'linear' }, { timeMs: d, scale: 1.04, translateX: i, translateY: 0, rotation: 0, easing: 'linear' }],
  ken_burns: (d, i) => [{ timeMs: 0, scale: 1, translateX: -0.5 * i, translateY: 0.5 * i, rotation: -0.3 * i, easing: 'cubic-bezier(0.25,0.1,0.25,1)' }, { timeMs: d, scale: 1 + 0.08 * i, translateX: 0.5 * i, translateY: -0.5 * i, rotation: 0.3 * i, easing: 'cubic-bezier(0.25,0.1,0.25,1)' }],
  static_lock: (d) => [{ timeMs: 0, scale: 1, translateX: 0, translateY: 0, rotation: 0, easing: 'linear' }, { timeMs: d, scale: 1, translateX: 0, translateY: 0, rotation: 0, easing: 'linear' }],
  rise_up: (d, i) => [{ timeMs: 0, scale: 1.03, translateX: 0, translateY: i, rotation: 0, easing: 'cubic-bezier(0.25,0.1,0.25,1)' }, { timeMs: d, scale: 1.06, translateX: 0, translateY: -0.5 * i, rotation: 0, easing: 'cubic-bezier(0.25,0.1,0.25,1)' }],
  orbit: (d, i) => [{ timeMs: 0, scale: 1.02, translateX: -0.8 * i, translateY: 0.3, rotation: -i, easing: 'ease-in-out' }, { timeMs: d * 0.5, scale: 1.05, translateX: 0, translateY: -0.2, rotation: 0, easing: 'ease-in-out' }, { timeMs: d, scale: 1.02, translateX: 0.8 * i, translateY: 0.3, rotation: i, easing: 'ease-in-out' }],
  crane_down: (d, i) => [{ timeMs: 0, scale: 1.08, translateX: 0, translateY: -1.5 * i, rotation: 0, easing: 'ease-out' }, { timeMs: d, scale: 1, translateX: 0, translateY: 0, rotation: 0, easing: 'ease-out' }],
  dolly_left: (d, i) => [{ timeMs: 0, scale: 1.03, translateX: 1.5 * i, translateY: 0, rotation: 0, easing: 'ease-in-out' }, { timeMs: d, scale: 1.03, translateX: -0.5 * i, translateY: 0, rotation: 0, easing: 'ease-in-out' }],
  dolly_right: (d, i) => [{ timeMs: 0, scale: 1.03, translateX: -1.5 * i, translateY: 0, rotation: 0, easing: 'ease-in-out' }, { timeMs: d, scale: 1.03, translateX: 0.5 * i, translateY: 0, rotation: 0, easing: 'ease-in-out' }],
};

export function computeCameraIntelligence(scenes: StoryboardScene[], intent: DirectorIntent): CameraSeq[] {
  return scenes.map(scene => {
    const dMs = scene.durationSec * 1000;
    const intensity = Math.max(0.3, Math.min(1, scene.emotionTarget));
    const gen = GEN[scene.cameraMove] || GEN.static_lock;
    const kf = gen(dMs, intensity);
    if (intent.renderMode === 'Cinematic Ad') kf.forEach(k => { k.translateX *= 1.2; k.translateY *= 1.2; if (k.scale > 1) k.scale = 1 + (k.scale - 1) * 1.2; });
    return { sceneId: scene.id, keyframes: kf, preset: scene.cameraMove };
  });
}
