/**
 * Performance & Acting Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 * Controls micro-expressions, eye direction, blink timing, head movement,
 * posture, gesture intent, emotion progression, and presenter/product acting
 * behavior so characters and scenes feel alive, natural, and premium.
 *
 * Architecture:
 *   1. EmotionProgression — maps narrative arc to per-frame emotional state
 *   2. MicroExpressionPlanner — generates subtle facial movement cues
 *   3. GazeDirector — controls eye direction, blink timing, focus tracking
 *   4. GestureChoreographer — plans body language and hand gestures
 *   5. ProductActingDirector — gives products "personality" through motion
 *   6. PresenterDirector — coordinates all elements into a unified performance
 *
 * Each function produces prompt-injection directives that guide the video
 * generation provider (Runway/Pika/Sora) to produce lifelike output.
 */

import type {
  StoryboardScene, DirectorIntent, SceneRole, Mood, EmotionPoint,
  CameraPreset, EasingFunction,
} from '../types';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ActingPerformance {
  sceneId: string;
  emotionProgression: EmotionKeyframe[];
  microExpressions: MicroExpression[];
  gazeDirective: GazeDirective;
  gestureSequence: GestureEvent[];
  productActing: ProductActingDirective | null;
  presenterDirective: PresenterDirective;
  promptInjection: string;  // The final prompt fragment to inject
}

export interface EmotionKeyframe {
  timeMs: number;
  emotion: string;
  intensity: number;       // 0–1
  valence: number;         // -1 (negative) to +1 (positive)
  microShift: string;      // subtle secondary emotion
  breathingRate: number;   // breaths per minute (affects shoulder/chest rhythm)
}

export interface MicroExpression {
  timeMs: number;
  durationMs: number;
  type: 'brow_raise' | 'lip_curl' | 'nostril_flare' | 'eye_widen' | 'jaw_clench'
      | 'smile_onset' | 'smile_peak' | 'smile_fade' | 'brow_furrow' | 'head_tilt'
      | 'eye_squint' | 'chin_lift' | 'lip_part' | 'cheek_raise';
  intensity: number;
  side: 'left' | 'right' | 'both';
  trigger: string;         // what prompted this expression
}

export interface GazeDirective {
  sceneId: string;
  eyeContactMs: number[];         // timestamps where subject looks at camera
  lookAwayMs: number[];            // timestamps where eyes drift naturally
  blinkPattern: BlinkEvent[];
  pupilDilation: number;          // 0–1 (interest/arousal indicator)
  headOrientation: { yaw: number; pitch: number; roll: number }[];
}

export interface BlinkEvent {
  timeMs: number;
  durationMs: number;
  type: 'natural' | 'emphasis' | 'slow_close' | 'rapid';
}

export interface GestureEvent {
  timeMs: number;
  durationMs: number;
  type: 'open_palm' | 'point' | 'hold_product' | 'gesture_toward' | 'arms_open'
      | 'nod' | 'head_shake' | 'lean_forward' | 'lean_back' | 'shrug'
      | 'hand_on_chin' | 'hands_together' | 'thumbs_up' | 'wave';
  hand: 'left' | 'right' | 'both';
  intensity: number;
  linkedTo: string;        // what this gesture emphasizes
}

export interface ProductActingDirective {
  entrance: { style: string; durationMs: number; easing: string };
  heroMoment: { timeMs: number; technique: string; lightingShift: string };
  microMotion: { type: string; amplitude: number; frequencyHz: number };
  materialEmphasis: string;
  shadowPlay: string;
}

export interface PresenterDirective {
  archetype: 'authority' | 'friend' | 'storyteller' | 'demonstrator' | 'aspirational';
  energyLevel: number;
  authenticityMarkers: string[];
  pauseBeats: number[];     // timestamps where presenter pauses for emphasis
  emphasisWords: string[];  // words to stress in voiceover alignment
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 1  EMOTION PROGRESSION
// ═══════════════════════════════════════════════════════════════════════════════

const ROLE_EMOTION_ARC: Record<SceneRole, { start: string; peak: string; end: string; breathBpm: number }> = {
  hook:         { start: 'curiosity',     peak: 'surprise',     end: 'interest',     breathBpm: 18 },
  problem:      { start: 'concern',       peak: 'frustration',  end: 'resignation',  breathBpm: 20 },
  solution:     { start: 'hope',          peak: 'excitement',   end: 'confidence',   breathBpm: 16 },
  proof:        { start: 'skepticism',    peak: 'conviction',   end: 'trust',        breathBpm: 14 },
  cta:          { start: 'determination', peak: 'urgency',      end: 'action',       breathBpm: 18 },
  brand_reveal: { start: 'anticipation',  peak: 'pride',        end: 'warmth',       breathBpm: 14 },
  offer:        { start: 'interest',      peak: 'desire',       end: 'urgency',      breathBpm: 17 },
  close:        { start: 'satisfaction',   peak: 'contentment', end: 'calm',         breathBpm: 12 },
  end:          { start: 'calm',          peak: 'gratitude',    end: 'peace',        breathBpm: 11 },
};

const EMOTION_VALENCE: Record<string, number> = {
  curiosity: 0.3, surprise: 0.5, interest: 0.4, concern: -0.2, frustration: -0.6,
  resignation: -0.3, hope: 0.5, excitement: 0.8, confidence: 0.7, skepticism: -0.1,
  conviction: 0.6, trust: 0.7, determination: 0.5, urgency: 0.4, action: 0.6,
  anticipation: 0.5, pride: 0.8, warmth: 0.7, desire: 0.6, satisfaction: 0.7,
  contentment: 0.6, calm: 0.3, gratitude: 0.8, peace: 0.5,
};

function buildEmotionProgression(scene: StoryboardScene, _intent: DirectorIntent): EmotionKeyframe[] {
  const arc = ROLE_EMOTION_ARC[scene.role] || ROLE_EMOTION_ARC.proof;
  const durMs = scene.durationSec * 1000;
  const keyframes: EmotionKeyframe[] = [];
  const phases = [
    { t: 0,          emotion: arc.start, intensity: 0.3, micro: 'neutral' },
    { t: 0.15,       emotion: arc.start, intensity: 0.5, micro: 'slight_awareness' },
    { t: 0.4,        emotion: arc.peak,  intensity: 0.85, micro: 'engaged' },
    { t: 0.6,        emotion: arc.peak,  intensity: 1.0, micro: 'peak_expression' },
    { t: 0.8,        emotion: arc.end,   intensity: 0.7, micro: 'settling' },
    { t: 1.0,        emotion: arc.end,   intensity: 0.5, micro: 'resolved' },
  ];
  for (const phase of phases) {
    keyframes.push({
      timeMs: Math.round(durMs * phase.t),
      emotion: phase.emotion,
      intensity: phase.intensity * scene.emotionTarget,
      valence: EMOTION_VALENCE[phase.emotion] ?? 0,
      microShift: phase.micro,
      breathingRate: arc.breathBpm * (0.8 + phase.intensity * 0.4),
    });
  }
  return keyframes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 2  MICRO-EXPRESSION PLANNER
// ═══════════════════════════════════════════════════════════════════════════════

const ROLE_MICRO_PATTERNS: Record<SceneRole, MicroExpression['type'][]> = {
  hook:         ['eye_widen', 'brow_raise', 'lip_part'],
  problem:      ['brow_furrow', 'jaw_clench', 'eye_squint'],
  solution:     ['smile_onset', 'smile_peak', 'cheek_raise', 'chin_lift'],
  proof:        ['brow_raise', 'nod' as any, 'smile_onset'],
  cta:          ['chin_lift', 'eye_widen', 'smile_peak'],
  brand_reveal: ['smile_peak', 'cheek_raise', 'eye_widen'],
  offer:        ['brow_raise', 'lip_part', 'smile_onset'],
  close:        ['smile_fade', 'eye_squint'],
  end:          ['smile_fade'],
};

function planMicroExpressions(scene: StoryboardScene, emotions: EmotionKeyframe[]): MicroExpression[] {
  const micros: MicroExpression[] = [];
  const patterns = ROLE_MICRO_PATTERNS[scene.role] || ['smile_onset'];
  const durMs = scene.durationSec * 1000;

  // Place micro-expressions at emotion transition points
  for (let i = 0; i < emotions.length - 1; i++) {
    const curr = emotions[i];
    const next = emotions[i + 1];
    if (Math.abs(curr.intensity - next.intensity) > 0.15) {
      const pattern = patterns[i % patterns.length] || 'brow_raise';
      micros.push({
        timeMs: curr.timeMs + Math.round((next.timeMs - curr.timeMs) * 0.3),
        durationMs: Math.round(200 + curr.intensity * 300),
        type: pattern as MicroExpression['type'],
        intensity: Math.min(1, (curr.intensity + next.intensity) / 2),
        side: curr.valence > 0 ? 'both' : Math.random() > 0.5 ? 'left' : 'right',
        trigger: `${curr.emotion}→${next.emotion}`,
      });
    }
  }

  // Natural idle micro-expressions (every ~2s)
  for (let t = 1500; t < durMs - 500; t += 1800 + Math.random() * 1200) {
    if (!micros.some(m => Math.abs(m.timeMs - t) < 500)) {
      micros.push({
        timeMs: Math.round(t),
        durationMs: 150 + Math.round(Math.random() * 150),
        type: Math.random() > 0.5 ? 'head_tilt' : 'eye_squint',
        intensity: 0.15 + Math.random() * 0.2,
        side: 'both',
        trigger: 'idle_naturalism',
      });
    }
  }

  return micros.sort((a, b) => a.timeMs - b.timeMs);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 3  GAZE DIRECTOR
// ═══════════════════════════════════════════════════════════════════════════════

function directGaze(scene: StoryboardScene, emotions: EmotionKeyframe[]): GazeDirective {
  const durMs = scene.durationSec * 1000;
  const eyeContactMs: number[] = [];
  const lookAwayMs: number[] = [];
  const blinkPattern: BlinkEvent[] = [];

  // Eye contact: direct at camera during key moments
  if (scene.role === 'hook') eyeContactMs.push(0, 200, durMs * 0.4);
  if (scene.role === 'cta') eyeContactMs.push(durMs * 0.3, durMs * 0.6, durMs * 0.8);
  if (scene.role === 'proof') eyeContactMs.push(durMs * 0.5);
  if (scene.role === 'brand_reveal') eyeContactMs.push(durMs * 0.7);

  // Natural look-aways (every ~3s to avoid staring)
  for (let t = 800; t < durMs; t += 2500 + Math.random() * 1500) {
    if (!eyeContactMs.some(ec => Math.abs(ec - t) < 600)) {
      lookAwayMs.push(Math.round(t));
    }
  }

  // Blink pattern: natural 15-20 blinks/min = ~3-4s interval
  const blinkIntervalMs = 3000 + Math.random() * 1500;
  for (let t = 500; t < durMs; t += blinkIntervalMs + Math.random() * 1000) {
    const isEmphasis = emotions.some(e => Math.abs(e.timeMs - t) < 300 && e.intensity > 0.7);
    blinkPattern.push({
      timeMs: Math.round(t),
      durationMs: isEmphasis ? 250 : 150 + Math.round(Math.random() * 80),
      type: isEmphasis ? 'emphasis' : 'natural',
    });
  }

  // Pupil dilation based on peak emotion
  const peakEmotion = emotions.reduce((max, e) => e.intensity > max.intensity ? e : max, emotions[0]);

  return {
    sceneId: scene.id,
    eyeContactMs,
    lookAwayMs,
    blinkPattern,
    pupilDilation: Math.min(1, (peakEmotion?.intensity || 0.5) * 0.8),
    headOrientation: emotions.map(e => ({
      yaw: e.valence * 8,      // slight turn toward/away
      pitch: e.intensity * 5 - 3, // chin lift on positive emotion
      roll: (Math.random() - 0.5) * 2, // subtle tilt
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 4  GESTURE CHOREOGRAPHER
// ═══════════════════════════════════════════════════════════════════════════════

const ROLE_GESTURES: Record<SceneRole, { type: GestureEvent['type']; timeRatio: number; hand: GestureEvent['hand'] }[]> = {
  hook:         [{ type: 'lean_forward', timeRatio: 0.1, hand: 'both' }, { type: 'open_palm', timeRatio: 0.4, hand: 'right' }],
  problem:      [{ type: 'hand_on_chin', timeRatio: 0.2, hand: 'right' }, { type: 'head_shake', timeRatio: 0.5, hand: 'both' }, { type: 'shrug', timeRatio: 0.7, hand: 'both' }],
  solution:     [{ type: 'gesture_toward', timeRatio: 0.3, hand: 'right' }, { type: 'open_palm', timeRatio: 0.6, hand: 'both' }, { type: 'nod', timeRatio: 0.8, hand: 'both' }],
  proof:        [{ type: 'nod', timeRatio: 0.3, hand: 'both' }, { type: 'point', timeRatio: 0.6, hand: 'right' }],
  cta:          [{ type: 'gesture_toward', timeRatio: 0.3, hand: 'right' }, { type: 'thumbs_up', timeRatio: 0.7, hand: 'right' }],
  brand_reveal: [{ type: 'arms_open', timeRatio: 0.4, hand: 'both' }, { type: 'nod', timeRatio: 0.7, hand: 'both' }],
  offer:        [{ type: 'hold_product', timeRatio: 0.2, hand: 'both' }, { type: 'gesture_toward', timeRatio: 0.6, hand: 'right' }],
  close:        [{ type: 'nod', timeRatio: 0.5, hand: 'both' }, { type: 'wave', timeRatio: 0.8, hand: 'right' }],
  end:          [{ type: 'nod', timeRatio: 0.5, hand: 'both' }],
};

function choreographGestures(scene: StoryboardScene, emotions: EmotionKeyframe[]): GestureEvent[] {
  const durMs = scene.durationSec * 1000;
  const gestures = ROLE_GESTURES[scene.role] || ROLE_GESTURES.proof;
  return gestures.map(g => ({
    timeMs: Math.round(durMs * g.timeRatio),
    durationMs: 500 + Math.round(scene.emotionTarget * 400),
    type: g.type,
    hand: g.hand,
    intensity: Math.min(1, scene.emotionTarget * 1.1),
    linkedTo: scene.voiceoverScript?.split(' ').slice(0, 3).join(' ') || scene.role,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 5  PRODUCT ACTING DIRECTOR
// ═══════════════════════════════════════════════════════════════════════════════

function directProductActing(scene: StoryboardScene, intent: DirectorIntent): ProductActingDirective | null {
  const productRoles: SceneRole[] = ['solution', 'proof', 'offer', 'brand_reveal'];
  if (!productRoles.includes(scene.role)) return null;

  const PRODUCT_ENTRANCES: Record<string, { style: string; dur: number; easing: string }> = {
    Luxury: { style: 'slow_emerge_from_shadow', dur: 1200, easing: 'cubic-bezier(0.16,1,0.3,1)' },
    Energetic: { style: 'dynamic_slide_spin', dur: 600, easing: 'spring(1,80,10)' },
    Minimal: { style: 'clean_fade_up', dur: 800, easing: 'cubic-bezier(0.33,1,0.68,1)' },
    Cinematic: { style: 'rack_focus_reveal', dur: 1500, easing: 'cubic-bezier(0.25,0.1,0.25,1)' },
    Bold: { style: 'impact_slam', dur: 400, easing: 'cubic-bezier(0.68,-0.6,0.32,1.6)' },
    Playful: { style: 'bounce_drop', dur: 700, easing: 'spring(1,100,12)' },
    Emotional: { style: 'gentle_float_in', dur: 1000, easing: 'cubic-bezier(0.33,1,0.68,1)' },
    Corporate: { style: 'professional_slide', dur: 600, easing: 'cubic-bezier(0.25,0.1,0.25,1)' },
    Calm: { style: 'soft_materialization', dur: 1200, easing: 'cubic-bezier(0.33,1,0.68,1)' },
    Tech: { style: 'holographic_assemble', dur: 900, easing: 'cubic-bezier(0.16,1,0.3,1)' },
  };

  const entrance = PRODUCT_ENTRANCES[intent.mood] || PRODUCT_ENTRANCES.Cinematic;

  return {
    entrance: { style: entrance.style, durationMs: entrance.dur, easing: entrance.easing },
    heroMoment: {
      timeMs: Math.round(scene.durationSec * 1000 * 0.45),
      technique: intent.mood === 'Luxury' ? 'slow_rotation_with_light_catch' :
                 intent.mood === 'Tech' ? 'holographic_wireframe_overlay' :
                 intent.mood === 'Cinematic' ? 'dramatic_light_sweep' :
                 'scale_emphasis_with_subtle_glow',
      lightingShift: intent.mood === 'Luxury' ? 'warm_golden_rim' :
                     intent.mood === 'Tech' ? 'cool_blue_neon_edge' :
                     'soft_key_light_brighten',
    },
    microMotion: {
      type: intent.mood === 'Calm' ? 'breathing' :
            intent.mood === 'Tech' ? 'data_pulse' :
            'subtle_float',
      amplitude: intent.mood === 'Bold' ? 3 : intent.mood === 'Calm' ? 1 : 2,
      frequencyHz: 0.3 + scene.emotionTarget * 0.4,
    },
    materialEmphasis: intent.mood === 'Luxury' ? 'metallic_reflection, glass_refraction, fabric_texture' :
                      intent.mood === 'Tech' ? 'matte_surface, led_glow, circuit_pattern' :
                      'clean_surface, soft_shadow, natural_material',
    shadowPlay: intent.renderMode === 'Cinematic Ad' ? 'dramatic_long_shadow, rim_light_separation' :
                'soft_diffused_shadow, subtle_contact_shadow',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 6  PRESENTER DIRECTOR
// ═══════════════════════════════════════════════════════════════════════════════

const MOOD_ARCHETYPE: Record<Mood, PresenterDirective['archetype']> = {
  Luxury: 'aspirational', Energetic: 'friend', Minimal: 'authority', Playful: 'friend',
  Cinematic: 'storyteller', Emotional: 'storyteller', Corporate: 'authority',
  Bold: 'demonstrator', Calm: 'storyteller', Tech: 'demonstrator',
};

function directPresenter(scene: StoryboardScene, intent: DirectorIntent): PresenterDirective {
  const archetype = MOOD_ARCHETYPE[intent.mood] || 'friend';
  const durMs = scene.durationSec * 1000;

  const pauseBeats: number[] = [];
  // Insert pauses at emotional peaks and before key words
  if (scene.role === 'hook') pauseBeats.push(Math.round(durMs * 0.15));
  if (scene.role === 'solution') pauseBeats.push(Math.round(durMs * 0.35), Math.round(durMs * 0.65));
  if (scene.role === 'cta') pauseBeats.push(Math.round(durMs * 0.4));

  const emphasisWords: string[] = [];
  if (scene.voiceoverScript) {
    const words = scene.voiceoverScript.split(/\s+/);
    if (words.length > 0) emphasisWords.push(words[0]); // First word
    if (intent.brand.name) emphasisWords.push(intent.brand.name);
    if (words.length > 3) emphasisWords.push(words[words.length - 1]); // Last word
  }

  const authenticityMarkers: string[] = [];
  if (archetype === 'friend') authenticityMarkers.push('natural_smile', 'relaxed_shoulders', 'conversational_pace');
  if (archetype === 'authority') authenticityMarkers.push('steady_gaze', 'measured_speech', 'confident_posture');
  if (archetype === 'storyteller') authenticityMarkers.push('expressive_eyes', 'varied_pace', 'emotional_pauses');
  if (archetype === 'demonstrator') authenticityMarkers.push('clear_gestures', 'product_focus', 'step_by_step_energy');
  if (archetype === 'aspirational') authenticityMarkers.push('elegant_movement', 'subtle_smile', 'premium_posture');

  return {
    archetype,
    energyLevel: scene.emotionTarget,
    authenticityMarkers,
    pauseBeats,
    emphasisWords,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 7  PROMPT INJECTION BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildActingPromptInjection(performance: Omit<ActingPerformance, 'promptInjection'>): string {
  const parts: string[] = [];

  // Emotion arc
  const peakEmotion = performance.emotionProgression.reduce((max, e) => e.intensity > max.intensity ? e : max, performance.emotionProgression[0]);
  parts.push(`Emotion: ${peakEmotion.emotion} (peak intensity ${Math.round(peakEmotion.intensity * 100)}%)`);

  // Micro-expressions
  const microTypes = [...new Set(performance.microExpressions.map(m => m.type.replace('_', ' ')))].slice(0, 3);
  if (microTypes.length > 0) parts.push(`Micro-expressions: ${microTypes.join(', ')}`);

  // Gaze
  const gaze = performance.gazeDirective;
  if (gaze.eyeContactMs.length > 0) parts.push(`Eye contact: direct at camera at key moments, natural look-aways between`);
  parts.push(`Blink: natural ${gaze.blinkPattern.length} blinks, pupil dilation ${Math.round(gaze.pupilDilation * 100)}%`);

  // Gestures
  const gestureTypes = [...new Set(performance.gestureSequence.map(g => g.type.replace('_', ' ')))].slice(0, 3);
  if (gestureTypes.length > 0) parts.push(`Gestures: ${gestureTypes.join(', ')}`);

  // Product acting
  if (performance.productActing) {
    parts.push(`Product: ${performance.productActing.entrance.style.replace(/_/g, ' ')} entrance, ${performance.productActing.heroMoment.technique.replace(/_/g, ' ')}, ${performance.productActing.microMotion.type.replace(/_/g, ' ')} idle motion`);
    parts.push(`Material: ${performance.productActing.materialEmphasis}`);
    parts.push(`Shadow: ${performance.productActing.shadowPlay}`);
  }

  // Presenter
  const p = performance.presenterDirective;
  parts.push(`Presenter: ${p.archetype} archetype, energy ${Math.round(p.energyLevel * 100)}%`);
  if (p.authenticityMarkers.length > 0) parts.push(`Authenticity: ${p.authenticityMarkers.join(', ').replace(/_/g, ' ')}`);

  return parts.join('. ') + '.';
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 8  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export function planActingPerformance(scene: StoryboardScene, intent: DirectorIntent): ActingPerformance {
  const emotionProgression = buildEmotionProgression(scene, intent);
  const microExpressions = planMicroExpressions(scene, emotionProgression);
  const gazeDirective = directGaze(scene, emotionProgression);
  const gestureSequence = choreographGestures(scene, emotionProgression);
  const productActing = directProductActing(scene, intent);
  const presenterDirective = directPresenter(scene, intent);

  const partial = { sceneId: scene.id, emotionProgression, microExpressions, gazeDirective, gestureSequence, productActing, presenterDirective };
  const promptInjection = buildActingPromptInjection(partial);

  return { ...partial, promptInjection };
}

export function planAllPerformances(scenes: StoryboardScene[], intent: DirectorIntent): ActingPerformance[] {
  return scenes.map(scene => planActingPerformance(scene, intent));
}
