/**
 * Cinematic Direction Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 * Acts like an AI film director: chooses shot types, composition, zoom, pan,
 * push-in, focus behavior, subject tracking, scene transitions, and visual
 * rhythm based on ad intent, hook timing, and platform format.
 *
 * Architecture:
 *   1. ShotLanguagePlanner — selects shot grammar per scene role and emotion
 *   2. CompositionDirector — applies rule-of-thirds, golden ratio, framing
 *   3. FocusBehavior — controls rack focus, pull focus, selective DOF
 *   4. SubjectTracker — defines subject tracking and reveal patterns
 *   5. VisualRhythm — creates pacing rhythm through cut timing and movement
 *   6. TransitionChoreographer — advanced transition design with motion match
 *   7. CinematicGradeDirector — per-scene color grading and atmosphere
 *
 * This engine supersedes the basic shotPlanner and cameraIntelligence with
 * a unified cinematic vision that treats the entire ad as a short film.
 */

import type {
  StoryboardScene, DirectorIntent, SceneRole, Mood, Platform,
  AspectRatio, CameraPreset, ShotType, TransitionType, CameraKeyframe,
} from '../types';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CinematicDirectionPlan {
  sceneId: string;
  shotLanguage: ShotLanguageDirective;
  composition: CompositionDirective;
  focusBehavior: FocusBehaviorDirective;
  subjectTracking: SubjectTrackingDirective;
  visualRhythm: VisualRhythmDirective;
  transitionDesign: TransitionDesignDirective;
  cinematicGrade: CinematicGradeDirective;
  cameraKeyframes: CameraKeyframe[];
  promptInjection: string;
}

export interface ShotLanguageDirective {
  primaryShot: ShotType;
  secondaryShot: ShotType | null;
  cutPoint: number | null;       // ms where primary transitions to secondary
  shotMotivation: string;         // why this shot was chosen
  visualWeight: 'subject_heavy' | 'environment_heavy' | 'balanced' | 'negative_space';
  eyeLevel: 'high_angle' | 'eye_level' | 'low_angle' | 'birds_eye' | 'worms_eye';
  framingStyle: 'centered' | 'rule_of_thirds' | 'golden_ratio' | 'dynamic_diagonal' | 'symmetrical' | 'frame_within_frame';
}

export interface CompositionDirective {
  subjectPosition: { x: number; y: number };    // 0-1 normalized
  headroom: number;                               // % top padding
  leadRoom: number;                               // % direction-of-gaze padding
  depthOfField: 'deep' | 'medium' | 'shallow' | 'ultra_shallow';
  focalLength: number;                            // mm equivalent
  perspectiveDistortion: number;                  // 0-1 (wide angle distortion)
  negativeSpaceRatio: number;                     // 0-1 (how much empty space)
}

export interface FocusBehaviorDirective {
  initialFocus: string;          // what's in focus at start
  focusTransitions: FocusPull[];
  depthOfFieldMs: number[];      // DOF animation keyframe times
  bokehShape: 'circle' | 'hexagon' | 'anamorphic_oval';
  bokehIntensity: number;
}

export interface FocusPull {
  timeMs: number;
  from: string;
  to: string;
  durationMs: number;
  technique: 'rack_focus' | 'pull_focus' | 'follow_focus' | 'split_diopter';
}

export interface SubjectTrackingDirective {
  primarySubject: string;
  trackingMode: 'locked' | 'lead' | 'follow' | 'reveal' | 'orbit';
  entryDirection: 'left' | 'right' | 'top' | 'bottom' | 'center' | 'depth';
  revealTiming: number;           // ms until subject is fully revealed
  motionPrediction: boolean;      // anticipate subject movement
  reframingSpeed: number;         // 0-1 how fast camera reframes
}

export interface VisualRhythmDirective {
  beatPattern: RhythmBeat[];
  overallTempo: 'slow' | 'moderate' | 'fast' | 'frenetic';
  breathingRoom: number;          // ms of visual pause between actions
  escalationCurve: number[];      // visual energy per quarter of scene
  climaxPoint: number;            // 0-1 where visual climax occurs
}

export interface RhythmBeat {
  timeMs: number;
  type: 'visual_accent' | 'motion_peak' | 'stillness' | 'cut_point' | 'zoom_beat';
  intensity: number;
  syncedToAudio: boolean;
}

export interface TransitionDesignDirective {
  inTransition: AdvancedTransition;
  outTransition: AdvancedTransition;
}

export interface AdvancedTransition {
  type: TransitionType;
  technique: string;             // specific technique within type
  durationMs: number;
  motionMatch: boolean;          // match motion direction across cut
  colorMatch: boolean;           // match color across cut
  graphicMatch: boolean;         // match shape/composition across cut
  soundBridge: boolean;          // audio continues across cut
  ffmpegFilter: string;
}

export interface CinematicGradeDirective {
  lut: string;                   // Color grading LUT name
  contrast: number;              // -1 to +1
  saturation: number;            // -1 to +1
  temperature: number;           // -1 (cool) to +1 (warm)
  tint: number;                  // -1 (green) to +1 (magenta)
  highlights: number;            // -1 to +1
  shadows: number;               // -1 to +1
  vignetteStrength: number;
  bloomStrength: number;
  filmGrain: number;
  letterboxRatio: number | null; // null = no letterbox, 2.35 = cinema
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 1  SHOT LANGUAGE PLANNER
// ═══════════════════════════════════════════════════════════════════════════════

interface ShotGrammar { primary: ShotType; secondary: ShotType | null; cutRatio: number | null; motivation: string; weight: ShotLanguageDirective['visualWeight']; eye: ShotLanguageDirective['eyeLevel']; framing: ShotLanguageDirective['framingStyle'] }

const CINEMATIC_SHOT_GRAMMAR: Record<SceneRole, Record<Mood, ShotGrammar>> & Record<SceneRole, { _default: ShotGrammar }> = {
  hook: {
    _default: { primary: 'close_up', secondary: 'medium', cutRatio: 0.4, motivation: 'Immediate intimacy forces attention', weight: 'subject_heavy', eye: 'eye_level', framing: 'centered' },
    Cinematic: { primary: 'extreme_close', secondary: 'wide', cutRatio: 0.35, motivation: 'Extreme detail→context reveal creates intrigue', weight: 'subject_heavy', eye: 'low_angle', framing: 'golden_ratio' },
    Bold: { primary: 'dutch_angle', secondary: 'close_up', cutRatio: 0.3, motivation: 'Disorientation demands attention', weight: 'subject_heavy', eye: 'low_angle', framing: 'dynamic_diagonal' },
    Luxury: { primary: 'medium', secondary: null, cutRatio: null, motivation: 'Elegant restraint, let beauty speak', weight: 'balanced', eye: 'eye_level', framing: 'symmetrical' },
  } as any,
  problem: {
    _default: { primary: 'medium', secondary: 'close_up', cutRatio: 0.5, motivation: 'Show context then close on emotion', weight: 'balanced', eye: 'high_angle', framing: 'rule_of_thirds' },
    Cinematic: { primary: 'over_shoulder', secondary: 'close_up', cutRatio: 0.45, motivation: 'Voyeuristic perspective builds empathy', weight: 'negative_space', eye: 'high_angle', framing: 'frame_within_frame' },
  } as any,
  solution: {
    _default: { primary: 'medium', secondary: 'close_up', cutRatio: 0.55, motivation: 'Reveal then detail the solution', weight: 'subject_heavy', eye: 'eye_level', framing: 'rule_of_thirds' },
    Cinematic: { primary: 'wide', secondary: 'close_up', cutRatio: 0.4, motivation: 'Grand reveal then intimate product detail', weight: 'environment_heavy', eye: 'low_angle', framing: 'golden_ratio' },
    Tech: { primary: 'medium', secondary: 'extreme_close', cutRatio: 0.5, motivation: 'Product overview then detail shot', weight: 'subject_heavy', eye: 'eye_level', framing: 'centered' },
  } as any,
  proof: {
    _default: { primary: 'medium', secondary: null, cutRatio: null, motivation: 'Steady frame builds trust', weight: 'balanced', eye: 'eye_level', framing: 'rule_of_thirds' },
  } as any,
  cta: {
    _default: { primary: 'close_up', secondary: null, cutRatio: null, motivation: 'Direct address demands action', weight: 'subject_heavy', eye: 'eye_level', framing: 'centered' },
    Cinematic: { primary: 'medium', secondary: 'close_up', cutRatio: 0.6, motivation: 'Context then intimate CTA', weight: 'balanced', eye: 'eye_level', framing: 'golden_ratio' },
  } as any,
  brand_reveal: {
    _default: { primary: 'wide', secondary: 'medium', cutRatio: 0.5, motivation: 'Grand brand establishment', weight: 'environment_heavy', eye: 'low_angle', framing: 'symmetrical' },
    Cinematic: { primary: 'aerial', secondary: 'medium', cutRatio: 0.45, motivation: 'Epic scope then human scale', weight: 'environment_heavy', eye: 'birds_eye', framing: 'centered' },
  } as any,
  offer: {
    _default: { primary: 'close_up', secondary: null, cutRatio: null, motivation: 'Focus on value proposition', weight: 'subject_heavy', eye: 'eye_level', framing: 'centered' },
  } as any,
  close: {
    _default: { primary: 'wide', secondary: null, cutRatio: null, motivation: 'Pull back for resolution', weight: 'negative_space', eye: 'eye_level', framing: 'symmetrical' },
  } as any,
  end: {
    _default: { primary: 'medium', secondary: null, cutRatio: null, motivation: 'Clean end frame', weight: 'balanced', eye: 'eye_level', framing: 'centered' },
  } as any,
};

function planShotLanguage(scene: StoryboardScene, intent: DirectorIntent): ShotLanguageDirective {
  const roleGrammar = CINEMATIC_SHOT_GRAMMAR[scene.role] || CINEMATIC_SHOT_GRAMMAR.proof;
  const grammar: ShotGrammar = (roleGrammar as any)[intent.mood] || roleGrammar._default;
  return {
    primaryShot: grammar.primary,
    secondaryShot: grammar.secondary,
    cutPoint: grammar.cutRatio ? Math.round(scene.durationSec * 1000 * grammar.cutRatio) : null,
    shotMotivation: grammar.motivation,
    visualWeight: grammar.weight,
    eyeLevel: grammar.eye,
    framingStyle: grammar.framing,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 2  COMPOSITION DIRECTOR
// ═══════════════════════════════════════════════════════════════════════════════

function directComposition(scene: StoryboardScene, shot: ShotLanguageDirective, intent: DirectorIntent): CompositionDirective {
  const FRAMING_POSITIONS: Record<string, { x: number; y: number }> = {
    centered: { x: 0.5, y: 0.45 }, rule_of_thirds: { x: 0.33, y: 0.38 },
    golden_ratio: { x: 0.382, y: 0.382 }, dynamic_diagonal: { x: 0.3, y: 0.35 },
    symmetrical: { x: 0.5, y: 0.5 }, frame_within_frame: { x: 0.5, y: 0.42 },
  };
  const pos = FRAMING_POSITIONS[shot.framingStyle] || FRAMING_POSITIONS.rule_of_thirds;
  const isVertical = intent.aspectRatio === '9:16';

  return {
    subjectPosition: isVertical ? { x: pos.x, y: pos.y * 0.9 } : pos,
    headroom: shot.primaryShot === 'close_up' ? 8 : shot.primaryShot === 'wide' ? 20 : 12,
    leadRoom: shot.primaryShot === 'over_shoulder' ? 35 : 15,
    depthOfField: shot.primaryShot === 'extreme_close' ? 'ultra_shallow' :
                  shot.primaryShot === 'close_up' ? 'shallow' :
                  intent.renderMode === 'Cinematic Ad' ? 'medium' : 'deep',
    focalLength: shot.primaryShot === 'extreme_close' ? 100 :
                 shot.primaryShot === 'close_up' ? 85 :
                 shot.primaryShot === 'wide' ? 24 :
                 shot.primaryShot === 'aerial' ? 16 : 50,
    perspectiveDistortion: shot.primaryShot === 'wide' ? 0.4 : shot.primaryShot === 'aerial' ? 0.6 : 0.1,
    negativeSpaceRatio: shot.visualWeight === 'negative_space' ? 0.5 : shot.visualWeight === 'subject_heavy' ? 0.15 : 0.3,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 3  FOCUS BEHAVIOR
// ═══════════════════════════════════════════════════════════════════════════════

function planFocusBehavior(scene: StoryboardScene, intent: DirectorIntent, shot: ShotLanguageDirective): FocusBehaviorDirective {
  const isCinematic = intent.renderMode === 'Cinematic Ad';
  const focusTransitions: FocusPull[] = [];
  const durMs = scene.durationSec * 1000;

  // Rack focus for dramatic scenes
  if (isCinematic && scene.role === 'solution') {
    focusTransitions.push({ timeMs: Math.round(durMs * 0.3), from: 'background', to: 'product', durationMs: 800, technique: 'rack_focus' });
  }
  if (isCinematic && scene.role === 'hook') {
    focusTransitions.push({ timeMs: Math.round(durMs * 0.15), from: 'blur', to: 'subject', durationMs: 600, technique: 'pull_focus' });
  }
  if (shot.secondaryShot && shot.cutPoint) {
    focusTransitions.push({ timeMs: shot.cutPoint, from: 'primary_subject', to: 'detail', durationMs: 400, technique: 'follow_focus' });
  }

  return {
    initialFocus: scene.role === 'hook' && isCinematic ? 'soft_blur_to_sharp' : 'subject',
    focusTransitions,
    depthOfFieldMs: focusTransitions.map(f => f.timeMs),
    bokehShape: isCinematic ? 'anamorphic_oval' : 'circle',
    bokehIntensity: isCinematic ? 0.7 : 0.3,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 4  SUBJECT TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

function planSubjectTracking(scene: StoryboardScene, intent: DirectorIntent): SubjectTrackingDirective {
  const ROLE_TRACKING: Record<SceneRole, SubjectTrackingDirective['trackingMode']> = {
    hook: 'reveal', problem: 'follow', solution: 'reveal', proof: 'locked',
    cta: 'locked', brand_reveal: 'reveal', offer: 'locked', close: 'follow', end: 'locked',
  };
  const ROLE_ENTRY: Record<SceneRole, SubjectTrackingDirective['entryDirection']> = {
    hook: 'center', problem: 'left', solution: 'depth', proof: 'right',
    cta: 'center', brand_reveal: 'depth', offer: 'bottom', close: 'center', end: 'center',
  };

  return {
    primarySubject: scene.role === 'solution' || scene.role === 'offer' ? 'product' : 'presenter',
    trackingMode: ROLE_TRACKING[scene.role] || 'locked',
    entryDirection: ROLE_ENTRY[scene.role] || 'center',
    revealTiming: scene.role === 'hook' ? 800 : scene.role === 'brand_reveal' ? 1200 : 400,
    motionPrediction: intent.renderMode === 'Cinematic Ad',
    reframingSpeed: intent.mood === 'Calm' || intent.mood === 'Luxury' ? 0.3 : intent.mood === 'Energetic' ? 0.8 : 0.5,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 5  VISUAL RHYTHM
// ═══════════════════════════════════════════════════════════════════════════════

function planVisualRhythm(scene: StoryboardScene, intent: DirectorIntent): VisualRhythmDirective {
  const durMs = scene.durationSec * 1000;
  const tempo = intent.mood === 'Energetic' || intent.mood === 'Bold' ? 'fast' as const :
                intent.mood === 'Calm' || intent.mood === 'Luxury' ? 'slow' as const :
                intent.mood === 'Cinematic' ? 'moderate' as const : 'moderate' as const;

  const beatInterval = tempo === 'fast' ? 600 : tempo === 'slow' ? 1500 : 1000;
  const beats: RhythmBeat[] = [];
  for (let t = beatInterval; t < durMs; t += beatInterval) {
    const isClimactic = t / durMs > 0.4 && t / durMs < 0.7;
    beats.push({
      timeMs: Math.round(t),
      type: isClimactic ? 'visual_accent' : Math.random() > 0.5 ? 'motion_peak' : 'zoom_beat',
      intensity: isClimactic ? 0.8 + scene.emotionTarget * 0.2 : 0.4 + scene.emotionTarget * 0.3,
      syncedToAudio: true,
    });
  }

  // Add a stillness moment before climax
  if (scene.role !== 'hook') {
    beats.push({ timeMs: Math.round(durMs * 0.35), type: 'stillness', intensity: 0.1, syncedToAudio: false });
  }

  return {
    beatPattern: beats.sort((a, b) => a.timeMs - b.timeMs),
    overallTempo: tempo,
    breathingRoom: tempo === 'slow' ? 800 : tempo === 'fast' ? 200 : 400,
    escalationCurve: [0.3, 0.5, 0.8, scene.role === 'cta' ? 0.9 : 0.6],
    climaxPoint: scene.role === 'hook' ? 0.3 : scene.role === 'cta' ? 0.6 : 0.55,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 6  TRANSITION CHOREOGRAPHER
// ═══════════════════════════════════════════════════════════════════════════════

function choreographTransitions(scene: StoryboardScene, intent: DirectorIntent, sceneIndex: number, totalScenes: number): TransitionDesignDirective {
  const isCinematic = intent.renderMode === 'Cinematic Ad';
  const isFirst = sceneIndex === 0;
  const isLast = sceneIndex === totalScenes - 1;

  const ROLE_TRANSITIONS: Record<string, { in: string; out: string }> = {
    hook: { in: isCinematic ? 'fade_from_black' : 'cut', out: isCinematic ? 'whip_pan' : 'crossfade' },
    problem: { in: 'crossfade', out: isCinematic ? 'zoom_through' : 'push' },
    solution: { in: isCinematic ? 'light_flash' : 'zoom', out: 'crossfade' },
    proof: { in: 'crossfade', out: 'crossfade' },
    cta: { in: isCinematic ? 'zoom_through' : 'push', out: 'cut' },
    brand_reveal: { in: isCinematic ? 'iris_open' : 'zoom', out: 'dissolve' },
    offer: { in: 'push', out: 'crossfade' },
    close: { in: 'dissolve', out: 'fade_to_black' },
    end: { in: 'dissolve', out: 'fade_to_black' },
  };

  const transitions = ROLE_TRANSITIONS[scene.role] || ROLE_TRANSITIONS.proof;
  const baseDurMs = isCinematic ? 700 : 400;

  function buildTransition(technique: string, isIn: boolean): AdvancedTransition {
    const type: TransitionType = technique.includes('fade') ? 'dissolve' : technique.includes('push') || technique.includes('whip') ? 'push' : technique.includes('zoom') ? 'zoom' : technique.includes('iris') ? 'wipe' : 'crossfade';
    const dur = isIn && isFirst ? 0 : isIn ? baseDurMs : isLast ? baseDurMs + 200 : baseDurMs;
    return {
      type, technique, durationMs: dur,
      motionMatch: isCinematic, colorMatch: true,
      graphicMatch: isCinematic && (technique.includes('zoom') || technique.includes('iris')),
      soundBridge: !isFirst && !isLast,
      ffmpegFilter: type === 'crossfade' ? `xfade=transition=fade:duration=${dur / 1000}` :
                    type === 'push' ? `xfade=transition=slideleft:duration=${dur / 1000}` :
                    type === 'zoom' ? `xfade=transition=zoomin:duration=${dur / 1000}` :
                    type === 'dissolve' ? `xfade=transition=dissolve:duration=${dur / 1000}` :
                    type === 'wipe' ? `xfade=transition=circlecrop:duration=${dur / 1000}` : '',
    };
  }

  return {
    inTransition: buildTransition(transitions.in, true),
    outTransition: buildTransition(transitions.out, false),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 7  CINEMATIC GRADE DIRECTOR
// ═══════════════════════════════════════════════════════════════════════════════

const MOOD_GRADES: Record<Mood, Partial<CinematicGradeDirective>> = {
  Luxury:    { lut: 'gold_shadow', contrast: 0.3, saturation: -0.1, temperature: 0.3, highlights: 0.1, shadows: -0.2, filmGrain: 0.05, bloomStrength: 0.15 },
  Energetic: { lut: 'vibrant_pop', contrast: 0.4, saturation: 0.3, temperature: 0, highlights: 0.2, shadows: 0, filmGrain: 0.02, bloomStrength: 0.05 },
  Minimal:   { lut: 'clean_flat', contrast: 0, saturation: -0.3, temperature: 0, highlights: 0, shadows: 0.1, filmGrain: 0, bloomStrength: 0 },
  Playful:   { lut: 'warm_pastel', contrast: 0.1, saturation: 0.2, temperature: 0.15, highlights: 0.1, shadows: 0.05, filmGrain: 0.01, bloomStrength: 0.1 },
  Cinematic: { lut: 'teal_orange_film', contrast: 0.35, saturation: -0.05, temperature: 0.1, highlights: -0.1, shadows: -0.15, filmGrain: 0.15, bloomStrength: 0.08 },
  Emotional: { lut: 'golden_hour', contrast: 0.15, saturation: 0, temperature: 0.25, highlights: 0.15, shadows: -0.1, filmGrain: 0.08, bloomStrength: 0.12 },
  Corporate: { lut: 'neutral_pro', contrast: 0.1, saturation: 0, temperature: -0.05, highlights: 0, shadows: 0, filmGrain: 0.02, bloomStrength: 0 },
  Bold:      { lut: 'high_contrast_dark', contrast: 0.5, saturation: 0.1, temperature: 0, highlights: 0.3, shadows: -0.3, filmGrain: 0.03, bloomStrength: 0 },
  Calm:      { lut: 'soft_pastel', contrast: -0.1, saturation: -0.15, temperature: 0.1, highlights: 0.1, shadows: 0.1, filmGrain: 0.04, bloomStrength: 0.08 },
  Tech:      { lut: 'cool_cyber', contrast: 0.25, saturation: 0, temperature: -0.25, highlights: 0.1, shadows: -0.1, filmGrain: 0.01, bloomStrength: 0.05 },
};

function directCinematicGrade(scene: StoryboardScene, intent: DirectorIntent): CinematicGradeDirective {
  const base = MOOD_GRADES[intent.mood] || MOOD_GRADES.Cinematic;
  const isCinematic = intent.renderMode === 'Cinematic Ad';
  const roleAdj = scene.role === 'problem' ? { saturation: -0.1, contrast: 0.1 } :
                  scene.role === 'solution' ? { saturation: 0.05, highlights: 0.1 } :
                  scene.role === 'hook' ? { contrast: 0.05 } : {};

  return {
    lut: base.lut || 'neutral',
    contrast: Math.max(-1, Math.min(1, (base.contrast || 0) + (roleAdj as any).contrast || 0)),
    saturation: Math.max(-1, Math.min(1, (base.saturation || 0) + (roleAdj as any).saturation || 0)),
    temperature: base.temperature || 0,
    tint: 0,
    highlights: Math.max(-1, Math.min(1, (base.highlights || 0) + (roleAdj as any).highlights || 0)),
    shadows: base.shadows || 0,
    vignetteStrength: isCinematic ? 0.35 : 0.1,
    bloomStrength: base.bloomStrength || 0,
    filmGrain: isCinematic ? Math.max(base.filmGrain || 0, 0.1) : base.filmGrain || 0,
    letterboxRatio: isCinematic ? 2.35 : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 8  CAMERA KEYFRAME GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

function generateCinematicKeyframes(scene: StoryboardScene, shot: ShotLanguageDirective, rhythm: VisualRhythmDirective, intent: DirectorIntent): CameraKeyframe[] {
  const durMs = scene.durationSec * 1000;
  const keyframes: CameraKeyframe[] = [];
  const isCinematic = intent.renderMode === 'Cinematic Ad';
  const intensity = scene.emotionTarget;

  // Base movement from camera preset
  const scale0 = 1;
  const scaleFinal = scene.cameraMove === 'push_in' ? 1 + 0.06 * intensity : scene.cameraMove === 'pull_back' ? 1 - 0.04 * intensity : 1 + 0.02 * intensity;
  const driftX = scene.cameraMove === 'horizontal_drift' ? intensity * 3 : scene.cameraMove === 'dolly_left' ? -intensity * 2 : scene.cameraMove === 'dolly_right' ? intensity * 2 : 0;

  keyframes.push({ timeMs: 0, scale: scale0, translateX: -driftX * 0.5, translateY: 0, rotation: 0, easing: isCinematic ? 'cubic-bezier(0.16,1,0.3,1)' : 'cubic-bezier(0.25,0.1,0.25,1)' });

  // Add rhythm-synced keyframes
  for (const beat of rhythm.beatPattern.filter(b => b.type === 'visual_accent' || b.type === 'zoom_beat')) {
    const progress = beat.timeMs / durMs;
    const scale = scale0 + (scaleFinal - scale0) * progress;
    const tx = driftX * (progress - 0.5) * 2;
    keyframes.push({
      timeMs: beat.timeMs,
      scale: scale + (beat.type === 'zoom_beat' ? 0.01 * beat.intensity : 0),
      translateX: tx,
      translateY: scene.cameraMove === 'rise_up' ? intensity * (1 - progress) * 2 : scene.cameraMove === 'crane_down' ? -intensity * (1 - progress) * 2 : 0,
      rotation: scene.cameraMove === 'orbit' ? (progress - 0.5) * intensity * 3 : 0,
      easing: isCinematic ? 'cubic-bezier(0.33,1,0.68,1)' : 'ease-in-out',
    });
  }

  // Final keyframe
  keyframes.push({ timeMs: durMs, scale: scaleFinal, translateX: driftX * 0.5, translateY: 0, rotation: 0, easing: 'cubic-bezier(0.33,1,0.68,1)' });

  // Cinematic amplification
  if (isCinematic) {
    keyframes.forEach(kf => {
      kf.translateX *= 1.3;
      kf.translateY *= 1.3;
      if (kf.scale > 1) kf.scale = 1 + (kf.scale - 1) * 1.25;
    });
  }

  return keyframes.sort((a, b) => a.timeMs - b.timeMs);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 9  PROMPT INJECTION
// ═══════════════════════════════════════════════════════════════════════════════

function buildCinematicPromptInjection(plan: Omit<CinematicDirectionPlan, 'promptInjection'>): string {
  const parts: string[] = [];
  const s = plan.shotLanguage;
  const c = plan.composition;
  const g = plan.cinematicGrade;

  parts.push(`CINEMATOGRAPHY: ${s.primaryShot.replace('_', ' ')} shot${s.secondaryShot ? ` → ${s.secondaryShot.replace('_', ' ')}` : ''}, ${s.eyeLevel.replace('_', ' ')}, ${s.framingStyle.replace('_', ' ')} composition`);
  parts.push(`DOF: ${c.depthOfField}, ${c.focalLength}mm equivalent${plan.focusBehavior.focusTransitions.length > 0 ? `, ${plan.focusBehavior.focusTransitions[0].technique.replace('_', ' ')} at ${plan.focusBehavior.focusTransitions[0].timeMs}ms` : ''}`);
  parts.push(`Subject: ${plan.subjectTracking.trackingMode} tracking, enters from ${plan.subjectTracking.entryDirection}`);
  parts.push(`Rhythm: ${plan.visualRhythm.overallTempo} tempo, climax at ${Math.round(plan.visualRhythm.climaxPoint * 100)}%`);
  parts.push(`Grade: ${g.lut.replace('_', ' ')}, contrast ${g.contrast > 0 ? '+' : ''}${Math.round(g.contrast * 100)}%, grain ${Math.round(g.filmGrain * 100)}%${g.letterboxRatio ? `, ${g.letterboxRatio}:1 letterbox` : ''}`);
  if (plan.transitionDesign.inTransition.durationMs > 0) parts.push(`Transition in: ${plan.transitionDesign.inTransition.technique.replace(/_/g, ' ')}`);

  return parts.join('. ') + '.';
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 10  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export function planCinematicDirection(
  scene: StoryboardScene,
  intent: DirectorIntent,
  sceneIndex: number,
  totalScenes: number,
): CinematicDirectionPlan {
  const shotLanguage = planShotLanguage(scene, intent);
  const composition = directComposition(scene, shotLanguage, intent);
  const focusBehavior = planFocusBehavior(scene, intent, shotLanguage);
  const subjectTracking = planSubjectTracking(scene, intent);
  const visualRhythm = planVisualRhythm(scene, intent);
  const transitionDesign = choreographTransitions(scene, intent, sceneIndex, totalScenes);
  const cinematicGrade = directCinematicGrade(scene, intent);
  const cameraKeyframes = generateCinematicKeyframes(scene, shotLanguage, visualRhythm, intent);

  const partial = { sceneId: scene.id, shotLanguage, composition, focusBehavior, subjectTracking, visualRhythm, transitionDesign, cinematicGrade, cameraKeyframes };
  const promptInjection = buildCinematicPromptInjection(partial);

  return { ...partial, promptInjection };
}

export function planAllCinematicDirection(scenes: StoryboardScene[], intent: DirectorIntent): CinematicDirectionPlan[] {
  return scenes.map((scene, i) => planCinematicDirection(scene, intent, i, scenes.length));
}
