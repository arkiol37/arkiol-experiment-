/**
 * Preview Animatic Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 * Generates an instant lightweight animatic preview (~5 seconds) before the
 * user commits to a full render. Creates a timed slideshow of scene
 * descriptions with transition timing, audio cues, and pacing visualization.
 *
 * This lets users see what they're getting before spending credits.
 */

import type { StoryboardScene, DirectorIntent, TimelineTrack, MusicProfile, AudioSyncPoint } from '../types';

export interface AnimaticPreview {
  scenes: AnimaticScene[];
  totalDurationMs: number;
  audioPreview: AudioPreview;
  transitionTimings: TransitionTiming[];
  qualityPrediction: number;    // 0-100 predicted quality
  creditCost: number;
  estimatedRenderTimeSec: number;
}

export interface AnimaticScene {
  sceneId: string;
  position: number;
  role: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  description: string;          // Human-readable scene description
  visualThumbnailDesc: string;  // What the scene will look like
  onScreenText: string | null;
  emotionLabel: string;
  emotionIntensity: number;
  shotType: string;
  cameraMove: string;
  dominantColor: string;
}

export interface AudioPreview {
  voiceoverTimings: { startMs: number; endMs: number; text: string }[];
  musicMood: string;
  musicBpm: number;
  beatMarkers: number[];
}

export interface TransitionTiming {
  fromSceneId: string;
  toSceneId: string;
  type: string;
  startMs: number;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

const ROLE_DESCRIPTIONS: Record<string, string> = {
  hook: 'Attention-grabbing opening that stops the scroll',
  problem: 'Relatable pain point that builds empathy',
  solution: 'Product/brand reveal showing the transformation',
  proof: 'Social proof and trust-building evidence',
  cta: 'Call-to-action driving the viewer to act',
  brand_reveal: 'Brand identity moment with logo and tagline',
  offer: 'Limited-time offer creating urgency',
  close: 'Satisfying conclusion with brand recall',
  end: 'End card with brand logo and website',
};

const ROLE_COLORS: Record<string, string> = {
  hook: '#EF4444', problem: '#F59E0B', solution: '#10B981', proof: '#3B82F6',
  cta: '#8B5CF6', brand_reveal: '#F59E0B', offer: '#EC4899', close: '#6B7280', end: '#374151',
};

const EMOTION_LABELS: Record<string, string> = {
  hook: 'Curiosity → Surprise', problem: 'Concern → Frustration', solution: 'Hope → Excitement',
  proof: 'Skepticism → Trust', cta: 'Determination → Action', brand_reveal: 'Anticipation → Pride',
  offer: 'Interest → Urgency', close: 'Satisfaction', end: 'Calm',
};

export function generateAnimaticPreview(
  storyboard: StoryboardScene[],
  intent: DirectorIntent,
  timeline: TimelineTrack[],
  musicProfile?: MusicProfile,
  audioSyncPoints?: AudioSyncPoint[],
): AnimaticPreview {
  let currentMs = 0;
  const scenes: AnimaticScene[] = [];

  for (const scene of storyboard) {
    const durationMs = scene.durationSec * 1000;
    const cleanDesc = scene.prompt
      .split('.').filter(s => s.trim().length > 5 && !s.includes('IDENTITY') && !s.includes('CINEMATOGRAPHY') && !s.includes('CRITICAL') && !s.includes('Emotion:') && !s.includes('Lighting:'))
      .slice(0, 2).join('. ').trim();

    scenes.push({
      sceneId: scene.id,
      position: scene.position,
      role: scene.role,
      startMs: currentMs,
      endMs: currentMs + durationMs,
      durationMs,
      description: ROLE_DESCRIPTIONS[scene.role] || 'Scene',
      visualThumbnailDesc: cleanDesc || `${intent.mood} ${scene.role} scene for ${intent.brand.name}`,
      onScreenText: scene.onScreenText || null,
      emotionLabel: EMOTION_LABELS[scene.role] || 'Neutral',
      emotionIntensity: scene.emotionTarget,
      shotType: scene.shotType.replace('_', ' '),
      cameraMove: scene.cameraMove.replace('_', ' '),
      dominantColor: ROLE_COLORS[scene.role] || '#6B7280',
    });
    currentMs += durationMs;
  }

  // Build transition timings
  const transitionTimings: TransitionTiming[] = [];
  for (let i = 0; i < storyboard.length - 1; i++) {
    const transitionDur = storyboard[i].transitionOut === 'cut' ? 0 : 500;
    transitionTimings.push({
      fromSceneId: storyboard[i].id,
      toSceneId: storyboard[i + 1].id,
      type: storyboard[i].transitionOut,
      startMs: scenes[i].endMs - transitionDur / 2,
      durationMs: transitionDur,
    });
  }

  // Build audio preview
  const voiceoverTimings = storyboard.map((scene, i) => ({
    startMs: scenes[i].startMs + 300,
    endMs: scenes[i].endMs - 200,
    text: scene.voiceoverScript || '',
  })).filter(v => v.text.length > 0);

  const bpm = musicProfile?.bpm || 100;
  const beatInterval = 60000 / bpm;
  const beatMarkers: number[] = [];
  for (let t = 0; t < currentMs; t += beatInterval) {
    beatMarkers.push(Math.round(t));
  }

  const audioPreview: AudioPreview = {
    voiceoverTimings,
    musicMood: intent.mood,
    musicBpm: bpm,
    beatMarkers: beatMarkers.slice(0, 100),
  };

  // Quality prediction based on engine analysis
  let qualityPrediction = 70;
  if (intent.renderMode === 'Cinematic Ad') qualityPrediction += 10;
  if (storyboard.every(s => s.continuityTokens.length >= 3)) qualityPrediction += 5;
  if (storyboard.length >= 4 && storyboard.length <= 6) qualityPrediction += 5;
  if (intent.brand.palette && intent.brand.palette.length >= 2) qualityPrediction += 3;
  qualityPrediction = Math.min(95, qualityPrediction);

  // Credit cost
  const creditCost = intent.renderMode === 'Cinematic Ad' ? 35 : 20;

  // Estimated render time
  const estimatedRenderTimeSec = Math.round(
    storyboard.length * (intent.renderMode === 'Cinematic Ad' ? 12 : 8) + 15
  );

  return {
    scenes,
    totalDurationMs: currentMs,
    audioPreview,
    transitionTimings,
    qualityPrediction,
    creditCost,
    estimatedRenderTimeSec,
  };
}
