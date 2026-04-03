/**
 * Shot Planner — assigns cinematic shot types and camera moves to each scene,
 * ensuring visual variety by avoiding consecutive identical shots.
 */
import type { StoryboardScene, DirectorIntent, ShotPlan, ShotType, CameraPreset } from '../types';

const ROLE_SHOTS: Record<string, ShotType[]> = {
  hook: ['close_up','extreme_close','dutch_angle'], problem: ['medium','over_shoulder','pov'],
  solution: ['medium','wide','close_up'], proof: ['medium','close_up','over_shoulder'],
  cta: ['close_up','medium'], brand_reveal: ['wide','aerial','medium'], offer: ['close_up','medium'],
  close: ['wide','medium'], end: ['medium','wide'],
};
const ROLE_CAMS: Record<string, CameraPreset[]> = {
  hook: ['push_in','crane_down','dolly_right'], problem: ['horizontal_drift','static_lock','dolly_left'],
  solution: ['pull_back','rise_up','push_in'], proof: ['ken_burns','horizontal_drift','static_lock'],
  cta: ['push_in','static_lock'], brand_reveal: ['rise_up','orbit','pull_back'],
  offer: ['static_lock','push_in'], close: ['pull_back','horizontal_drift'], end: ['static_lock','pull_back'],
};
const MOOD_LIGHT: Record<string, string> = {
  Luxury: 'low-key dramatic, warm highlights', Energetic: 'high-key vibrant, dynamic colored lights',
  Minimal: 'soft even lighting, clean shadows', Playful: 'bright cheerful, soft colorful fill',
  Cinematic: 'moody contrast, volumetric light rays', Emotional: 'warm golden hour, intimate softbox',
  Corporate: 'clean office lighting, professional blue', Bold: 'high contrast, rim lighting, dramatic shadows',
  Calm: 'diffused soft light, gentle gradients', Tech: 'cool blue neon, screen glow, data ambience',
};

export function planShots(scenes: StoryboardScene[], intent: DirectorIntent): ShotPlan[] {
  const plans: ShotPlan[] = []; let lastShot: ShotType | null = null; let lastCam: CameraPreset | null = null;
  for (const scene of scenes) {
    const sc = ROLE_SHOTS[scene.role] || ['medium']; const cc = ROLE_CAMS[scene.role] || ['static_lock'];
    let shotType = sc.find(s => s !== lastShot) || sc[0];
    let cameraMove = cc.find(c => c !== lastCam) || cc[0];
    const dof = shotType === 'close_up' || shotType === 'extreme_close' ? 0.8 : shotType === 'wide' || shotType === 'aerial' ? 0.2 : 0.5;
    const base = MOOD_LIGHT[intent.mood] || 'balanced natural lighting';
    const light = scene.role === 'problem' ? `${base}, slightly desaturated` : scene.role === 'solution' ? `${base}, brightened` : base;
    plans.push({ sceneId: scene.id, shotType, cameraMove, focalPoint: { x: 0.5, y: scene.role === 'cta' ? 0.55 : 0.4 }, depthOfField: dof, motionIntensity: Math.min(1, scene.emotionTarget * 1.2), lightingMood: light });
    lastShot = shotType; lastCam = cameraMove;
  }
  return plans;
}
