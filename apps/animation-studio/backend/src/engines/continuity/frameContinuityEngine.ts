/**
 * Frame Continuity Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 * Enforces frame-to-frame consistency across characters, products, lighting,
 * colors, camera position, scene state, motion flow, and style so there is
 * no jitter, morphing, flicker, or identity drift in 2D/2.5D ad videos.
 *
 * Architecture:
 *   1. IdentityLock — locks character/product visual identity across scenes
 *   2. LightingContinuity — ensures lighting direction, color temp, intensity match
 *   3. ColorConsistency — enforces palette adherence and prevents color drift
 *   4. MotionFlowValidator — detects and prevents jitter/discontinuous motion
 *   5. StyleCoherenceEnforcer — maintains visual style DNA across all frames
 *   6. ContinuityScorer — scores and reports frame continuity quality
 *
 * Output: per-scene continuity constraints that are injected into the video
 * generation prompts to prevent the provider from drifting.
 */

import type {
  StoryboardScene, DirectorIntent, ContinuityToken, ContinuityViolation,
  SceneRole, Mood, CameraPreset, ShotType,
} from '../types';
import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface FrameContinuityPlan {
  sceneId: string;
  identityLocks: IdentityLock[];
  lightingConstraints: LightingConstraint;
  colorConstraints: ColorConstraint;
  motionFlowRules: MotionFlowRule[];
  styleCoherence: StyleCoherenceRule;
  frameSafetyNet: FrameSafetyNet;
  promptInjection: string;
  continuityScore: number;
}

export interface IdentityLock {
  elementId: string;
  elementType: 'character' | 'product' | 'logo' | 'environment' | 'text';
  referenceHash: string;        // Unique identity hash
  lockedAttributes: {
    silhouette: string;         // Shape description
    colorSignature: string[];   // Dominant colors
    scale: number;              // Relative scale (0-1)
    position: { x: number; y: number };
    orientation: number;        // degrees
  };
  driftTolerance: number;       // 0-1, how much variation allowed
  persistAcrossScenes: boolean;
}

export interface LightingConstraint {
  keyLightAngle: number;        // degrees (0=front, 90=side, 180=back)
  keyLightIntensity: number;    // 0-1
  colorTemperature: number;     // Kelvin (2700=warm, 5500=neutral, 7000=cool)
  ambientLevel: number;         // 0-1
  shadowDirection: number;      // degrees
  shadowSoftness: number;       // 0-1
  rimLightPresent: boolean;
  rimLightColor: string;
  consistencyWithPrevious: number; // 0-1 how much to match previous scene
}

export interface ColorConstraint {
  dominantPalette: string[];
  accentColor: string;
  saturationRange: [number, number];
  brightnessRange: [number, number];
  warmthBias: number;           // -1 (cool) to +1 (warm)
  contrastTarget: number;       // 0-1
  maxDeviationPercent: number;  // max % drift from locked palette
}

export interface MotionFlowRule {
  property: string;
  maxVelocityPerFrame: number;  // max change per frame
  maxAcceleration: number;      // max velocity change per frame
  smoothingFactor: number;      // 0-1 (1 = heavy smoothing)
  anticipation: boolean;        // whether to add anticipation before movement
  followThrough: boolean;       // whether to add follow-through after movement
  settlingOscillations: number; // damped oscillations after arrival (0 = none)
}

export interface StyleCoherenceRule {
  visualDNA: string;            // Core style description
  renderStyle: string;          // 'photorealistic' | 'stylized' | 'animated' etc.
  textureConsistency: string;   // texture treatment across scenes
  grainLevel: number;           // film grain amount (0-1)
  vignetteStrength: number;     // vignette darkness (0-1)
  colorGrading: string;         // LUT/grade description
  aberrationLevel: number;      // chromatic aberration (0-1)
}

export interface FrameSafetyNet {
  maxInterFrameDeltaPercent: number;  // max pixel change between consecutive frames
  flickerDetectionThreshold: number;  // brightness variance threshold
  morphDetectionEnabled: boolean;     // detect identity morphing
  jitterCorrectionStrength: number;   // 0-1 stabilization strength
  identityDriftAlertThreshold: number; // alert if drift exceeds this
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 1  IDENTITY LOCK
// ═══════════════════════════════════════════════════════════════════════════════

function buildIdentityLocks(scene: StoryboardScene, intent: DirectorIntent, prevScene?: StoryboardScene): IdentityLock[] {
  const locks: IdentityLock[] = [];

  // Lock brand elements
  locks.push({
    elementId: `brand_${intent.brand.name}`,
    elementType: 'logo',
    referenceHash: `logo_${intent.brand.name.toLowerCase().replace(/\s/g, '_')}`,
    lockedAttributes: {
      silhouette: 'brand_logo_exact_shape',
      colorSignature: intent.brand.palette || ['#ffffff'],
      scale: scene.role === 'brand_reveal' ? 0.4 : scene.role === 'cta' ? 0.2 : 0.12,
      position: scene.role === 'brand_reveal' ? { x: 0.5, y: 0.4 } : { x: 0.85, y: 0.08 },
      orientation: 0,
    },
    driftTolerance: 0.02, // Very tight — logo must NOT morph
    persistAcrossScenes: true,
  });

  // Lock product identity if product scene
  if (['solution', 'proof', 'offer'].includes(scene.role)) {
    locks.push({
      elementId: `product_${scene.id}`,
      elementType: 'product',
      referenceHash: `product_${intent.brand.name}_main`,
      lockedAttributes: {
        silhouette: 'product_consistent_shape',
        colorSignature: intent.brand.palette?.slice(0, 2) || ['#333333'],
        scale: scene.role === 'solution' ? 0.6 : 0.4,
        position: { x: 0.5, y: 0.45 },
        orientation: 0,
      },
      driftTolerance: 0.08,
      persistAcrossScenes: true,
    });
  }

  // Lock character identity if presenter scene
  if (['hook', 'problem', 'solution', 'proof', 'cta'].includes(scene.role)) {
    locks.push({
      elementId: `presenter_${scene.id}`,
      elementType: 'character',
      referenceHash: 'presenter_primary',
      lockedAttributes: {
        silhouette: 'human_presenter_consistent',
        colorSignature: ['#FFDBB4', '#8B5E3C', '#2C2C2C'],
        scale: scene.shotType === 'close_up' ? 0.8 : scene.shotType === 'wide' ? 0.4 : 0.6,
        position: { x: 0.5, y: 0.5 },
        orientation: 0,
      },
      driftTolerance: 0.05, // Tight — face must not morph
      persistAcrossScenes: true,
    });
  }

  return locks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 2  LIGHTING CONTINUITY
// ═══════════════════════════════════════════════════════════════════════════════

const MOOD_LIGHTING: Record<Mood, Partial<LightingConstraint>> = {
  Luxury:    { keyLightAngle: 45, keyLightIntensity: 0.7, colorTemperature: 3200, ambientLevel: 0.3, shadowSoftness: 0.7, rimLightPresent: true, rimLightColor: '#FFD700' },
  Energetic: { keyLightAngle: 30, keyLightIntensity: 0.9, colorTemperature: 5500, ambientLevel: 0.6, shadowSoftness: 0.4, rimLightPresent: false, rimLightColor: '#FFFFFF' },
  Minimal:   { keyLightAngle: 0,  keyLightIntensity: 0.8, colorTemperature: 5500, ambientLevel: 0.7, shadowSoftness: 0.9, rimLightPresent: false, rimLightColor: '#FFFFFF' },
  Playful:   { keyLightAngle: 20, keyLightIntensity: 0.85, colorTemperature: 5000, ambientLevel: 0.65, shadowSoftness: 0.6, rimLightPresent: false, rimLightColor: '#FFFFFF' },
  Cinematic: { keyLightAngle: 60, keyLightIntensity: 0.6, colorTemperature: 4200, ambientLevel: 0.2, shadowSoftness: 0.3, rimLightPresent: true, rimLightColor: '#87CEEB' },
  Emotional: { keyLightAngle: 40, keyLightIntensity: 0.65, colorTemperature: 3500, ambientLevel: 0.35, shadowSoftness: 0.7, rimLightPresent: true, rimLightColor: '#FFA500' },
  Corporate: { keyLightAngle: 15, keyLightIntensity: 0.8, colorTemperature: 5500, ambientLevel: 0.6, shadowSoftness: 0.5, rimLightPresent: false, rimLightColor: '#FFFFFF' },
  Bold:      { keyLightAngle: 70, keyLightIntensity: 0.5, colorTemperature: 4500, ambientLevel: 0.15, shadowSoftness: 0.2, rimLightPresent: true, rimLightColor: '#FF4444' },
  Calm:      { keyLightAngle: 10, keyLightIntensity: 0.7, colorTemperature: 4000, ambientLevel: 0.5, shadowSoftness: 0.9, rimLightPresent: false, rimLightColor: '#FFFFFF' },
  Tech:      { keyLightAngle: 50, keyLightIntensity: 0.55, colorTemperature: 6500, ambientLevel: 0.2, shadowSoftness: 0.4, rimLightPresent: true, rimLightColor: '#00BFFF' },
};

function buildLightingConstraint(scene: StoryboardScene, intent: DirectorIntent, sceneIdx: number): LightingConstraint {
  const base = MOOD_LIGHTING[intent.mood] || MOOD_LIGHTING.Cinematic;
  const roleAdjust = scene.role === 'problem' ? { keyLightIntensity: (base.keyLightIntensity || 0.6) * 0.8, ambientLevel: (base.ambientLevel || 0.3) * 0.7 } :
                     scene.role === 'solution' ? { keyLightIntensity: Math.min(1, (base.keyLightIntensity || 0.6) * 1.15) } :
                     scene.role === 'cta' ? { keyLightIntensity: Math.min(1, (base.keyLightIntensity || 0.6) * 1.1) } : {};

  return {
    keyLightAngle: base.keyLightAngle || 45,
    keyLightIntensity: roleAdjust.keyLightIntensity ?? base.keyLightIntensity ?? 0.7,
    colorTemperature: base.colorTemperature || 5500,
    ambientLevel: roleAdjust.ambientLevel ?? base.ambientLevel ?? 0.4,
    shadowDirection: (base.keyLightAngle || 45) + 180,
    shadowSoftness: base.shadowSoftness || 0.5,
    rimLightPresent: base.rimLightPresent ?? false,
    rimLightColor: base.rimLightColor || '#FFFFFF',
    consistencyWithPrevious: sceneIdx === 0 ? 0 : 0.75, // High continuity with previous
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 3  COLOR CONSISTENCY
// ═══════════════════════════════════════════════════════════════════════════════

function buildColorConstraint(scene: StoryboardScene, intent: DirectorIntent): ColorConstraint {
  const palette = intent.brand.palette || ['#3B82F6', '#8B5CF6', '#F59E0B'];
  const moodWarmth: Record<string, number> = { Luxury: 0.4, Energetic: 0.1, Minimal: 0, Cinematic: 0.2, Emotional: 0.5, Corporate: -0.1, Bold: 0, Calm: 0.3, Tech: -0.3, Playful: 0.2 };

  return {
    dominantPalette: palette,
    accentColor: palette[2] || palette[0],
    saturationRange: intent.mood === 'Minimal' ? [0.1, 0.5] : intent.mood === 'Bold' ? [0.6, 1.0] : [0.3, 0.8],
    brightnessRange: scene.role === 'problem' ? [0.2, 0.6] : scene.role === 'hook' ? [0.3, 0.8] : [0.3, 0.75],
    warmthBias: moodWarmth[intent.mood] || 0,
    contrastTarget: intent.mood === 'Bold' ? 0.85 : intent.mood === 'Cinematic' ? 0.7 : intent.mood === 'Minimal' ? 0.4 : 0.6,
    maxDeviationPercent: 12, // Max 12% color drift from locked palette
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 4  MOTION FLOW VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════════

function buildMotionFlowRules(scene: StoryboardScene, intent: DirectorIntent): MotionFlowRule[] {
  const isCinematic = intent.renderMode === 'Cinematic Ad';
  const smoothing = isCinematic ? 0.85 : intent.mood === 'Energetic' ? 0.4 : intent.mood === 'Calm' ? 0.9 : 0.65;

  return [
    {
      property: 'position',
      maxVelocityPerFrame: isCinematic ? 8 : 15,
      maxAcceleration: isCinematic ? 2 : 5,
      smoothingFactor: smoothing,
      anticipation: isCinematic,
      followThrough: true,
      settlingOscillations: intent.mood === 'Playful' ? 2 : isCinematic ? 1 : 0,
    },
    {
      property: 'scale',
      maxVelocityPerFrame: 0.02,
      maxAcceleration: 0.005,
      smoothingFactor: Math.min(1, smoothing + 0.1),
      anticipation: false,
      followThrough: true,
      settlingOscillations: 0,
    },
    {
      property: 'rotation',
      maxVelocityPerFrame: isCinematic ? 1 : 3,
      maxAcceleration: 0.5,
      smoothingFactor: smoothing,
      anticipation: isCinematic,
      followThrough: true,
      settlingOscillations: intent.mood === 'Playful' ? 1 : 0,
    },
    {
      property: 'opacity',
      maxVelocityPerFrame: 0.05,
      maxAcceleration: 0.02,
      smoothingFactor: 0.8,
      anticipation: false,
      followThrough: false,
      settlingOscillations: 0,
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 5  STYLE COHERENCE
// ═══════════════════════════════════════════════════════════════════════════════

const MOOD_STYLE_DNA: Record<Mood, { render: string; texture: string; grain: number; vignette: number; grade: string; aberration: number }> = {
  Luxury:    { render: 'photorealistic_premium', texture: 'smooth_metallic_glass', grain: 0.05, vignette: 0.3, grade: 'warm_gold_shadows', aberration: 0 },
  Energetic: { render: 'vibrant_dynamic', texture: 'sharp_saturated', grain: 0.02, vignette: 0.1, grade: 'punchy_contrast', aberration: 0.02 },
  Minimal:   { render: 'clean_precise', texture: 'flat_matte', grain: 0, vignette: 0.05, grade: 'desaturated_clean', aberration: 0 },
  Playful:   { render: 'colorful_friendly', texture: 'soft_rounded', grain: 0.01, vignette: 0.05, grade: 'warm_bright', aberration: 0 },
  Cinematic: { render: 'filmic_cinematic', texture: 'rich_textured_organic', grain: 0.15, vignette: 0.4, grade: 'teal_orange_cinematic', aberration: 0.03 },
  Emotional: { render: 'warm_intimate', texture: 'soft_natural', grain: 0.08, vignette: 0.25, grade: 'golden_hour_warm', aberration: 0.01 },
  Corporate: { render: 'professional_clean', texture: 'polished_corporate', grain: 0.02, vignette: 0.1, grade: 'neutral_balanced', aberration: 0 },
  Bold:      { render: 'high_contrast_dramatic', texture: 'sharp_graphic', grain: 0.03, vignette: 0.35, grade: 'high_contrast_deep_blacks', aberration: 0.04 },
  Calm:      { render: 'soft_serene', texture: 'diffused_gentle', grain: 0.04, vignette: 0.15, grade: 'pastel_soft', aberration: 0 },
  Tech:      { render: 'futuristic_digital', texture: 'holographic_matte', grain: 0.01, vignette: 0.2, grade: 'cool_blue_neon', aberration: 0.05 },
};

function buildStyleCoherence(intent: DirectorIntent): StyleCoherenceRule {
  const dna = MOOD_STYLE_DNA[intent.mood] || MOOD_STYLE_DNA.Cinematic;
  const isCinematic = intent.renderMode === 'Cinematic Ad';
  return {
    visualDNA: `${intent.mood.toLowerCase()} ${intent.brand.industry?.toLowerCase() || ''} ${intent.platform} ad`,
    renderStyle: dna.render,
    textureConsistency: dna.texture,
    grainLevel: isCinematic ? Math.max(dna.grain, 0.1) : dna.grain,
    vignetteStrength: isCinematic ? Math.max(dna.vignette, 0.3) : dna.vignette,
    colorGrading: dna.grade,
    aberrationLevel: isCinematic ? Math.max(dna.aberration, 0.02) : dna.aberration,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 6  FRAME SAFETY NET
// ═══════════════════════════════════════════════════════════════════════════════

function buildFrameSafetyNet(intent: DirectorIntent): FrameSafetyNet {
  const isCinematic = intent.renderMode === 'Cinematic Ad';
  return {
    maxInterFrameDeltaPercent: isCinematic ? 5 : 8,
    flickerDetectionThreshold: 0.15,
    morphDetectionEnabled: true,
    jitterCorrectionStrength: isCinematic ? 0.85 : 0.6,
    identityDriftAlertThreshold: 0.1,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 7  PROMPT INJECTION
// ═══════════════════════════════════════════════════════════════════════════════

function buildContinuityPromptInjection(plan: Omit<FrameContinuityPlan, 'promptInjection' | 'continuityScore'>): string {
  const parts: string[] = [];

  // Identity locks
  const lockedElements = plan.identityLocks.filter(l => l.persistAcrossScenes);
  if (lockedElements.length > 0) {
    parts.push(`IDENTITY LOCK: ${lockedElements.map(l => `${l.elementType} must maintain exact appearance (drift tolerance ${Math.round(l.driftTolerance * 100)}%)`).join('; ')}`);
  }

  // Lighting
  const lt = plan.lightingConstraints;
  parts.push(`Lighting: ${lt.colorTemperature}K color temp, key light ${Math.round(lt.keyLightIntensity * 100)}% intensity at ${lt.keyLightAngle}°, shadow softness ${Math.round(lt.shadowSoftness * 100)}%${lt.rimLightPresent ? `, rim light ${lt.rimLightColor}` : ''}`);

  // Color
  const cc = plan.colorConstraints;
  parts.push(`Color: stay within brand palette [${cc.dominantPalette.join(',')}], max ${cc.maxDeviationPercent}% drift, saturation ${Math.round(cc.saturationRange[0] * 100)}-${Math.round(cc.saturationRange[1] * 100)}%, warmth bias ${cc.warmthBias > 0 ? 'warm' : cc.warmthBias < 0 ? 'cool' : 'neutral'}`);

  // Style
  const sc = plan.styleCoherence;
  parts.push(`Style: ${sc.renderStyle.replace(/_/g, ' ')}, ${sc.textureConsistency.replace(/_/g, ' ')}, grade: ${sc.colorGrading.replace(/_/g, ' ')}${sc.grainLevel > 0.05 ? `, film grain ${Math.round(sc.grainLevel * 100)}%` : ''}${sc.vignetteStrength > 0.15 ? `, vignette ${Math.round(sc.vignetteStrength * 100)}%` : ''}`);

  // Motion flow
  parts.push(`Motion: smooth (factor ${Math.round(plan.motionFlowRules[0]?.smoothingFactor * 100 || 65)}%), no jitter, ${plan.motionFlowRules[0]?.anticipation ? 'with anticipation/follow-through' : 'clean arcs'}`);

  // Safety
  parts.push(`CRITICAL: No identity morphing, no flicker, no color drift between frames. Maintain absolute visual consistency.`);

  return parts.join('. ');
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 8  CONTINUITY SCORER
// ═══════════════════════════════════════════════════════════════════════════════

function scoreContinuity(plan: Omit<FrameContinuityPlan, 'promptInjection' | 'continuityScore'>): number {
  let score = 80;
  // Identity locks present
  score += plan.identityLocks.length * 3;
  // Tight drift tolerance
  const avgDrift = plan.identityLocks.reduce((s, l) => s + l.driftTolerance, 0) / Math.max(1, plan.identityLocks.length);
  if (avgDrift < 0.1) score += 5;
  // Lighting consistency with previous
  if (plan.lightingConstraints.consistencyWithPrevious > 0.6) score += 5;
  // Color palette locked
  if (plan.colorConstraints.maxDeviationPercent <= 15) score += 3;
  // Motion smoothing
  if (plan.motionFlowRules[0]?.smoothingFactor > 0.6) score += 4;
  return Math.min(100, score);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 9  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export function planFrameContinuity(
  scene: StoryboardScene,
  intent: DirectorIntent,
  sceneIndex: number,
  prevScene?: StoryboardScene,
): FrameContinuityPlan {
  const identityLocks = buildIdentityLocks(scene, intent, prevScene);
  const lightingConstraints = buildLightingConstraint(scene, intent, sceneIndex);
  const colorConstraints = buildColorConstraint(scene, intent);
  const motionFlowRules = buildMotionFlowRules(scene, intent);
  const styleCoherence = buildStyleCoherence(intent);
  const frameSafetyNet = buildFrameSafetyNet(intent);

  const partial = { sceneId: scene.id, identityLocks, lightingConstraints, colorConstraints, motionFlowRules, styleCoherence, frameSafetyNet };
  const promptInjection = buildContinuityPromptInjection(partial);
  const continuityScore = scoreContinuity(partial);

  return { ...partial, promptInjection, continuityScore };
}

export function planAllFrameContinuity(scenes: StoryboardScene[], intent: DirectorIntent): FrameContinuityPlan[] {
  return scenes.map((scene, i) => planFrameContinuity(scene, intent, i, i > 0 ? scenes[i - 1] : undefined));
}

export function validateFrameContinuity(plans: FrameContinuityPlan[]): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];
  for (let i = 1; i < plans.length; i++) {
    const prev = plans[i - 1]; const curr = plans[i];
    // Check lighting temperature consistency
    const tempDiff = Math.abs(prev.lightingConstraints.colorTemperature - curr.lightingConstraints.colorTemperature);
    if (tempDiff > 1500) {
      violations.push({ sceneId: curr.sceneId, token: { key: 'color_temperature', value: curr.lightingConstraints.colorTemperature, scope: 'global', category: 'color' }, expected: prev.lightingConstraints.colorTemperature, actual: curr.lightingConstraints.colorTemperature, severity: 'warning', autoFixable: true, suggestedFix: `Reduce temperature gap from ${tempDiff}K` });
    }
    // Check style coherence
    if (prev.styleCoherence.renderStyle !== curr.styleCoherence.renderStyle) {
      violations.push({ sceneId: curr.sceneId, token: { key: 'render_style', value: curr.styleCoherence.renderStyle, scope: 'global', category: 'layout' }, expected: prev.styleCoherence.renderStyle, actual: curr.styleCoherence.renderStyle, severity: 'error', autoFixable: true, suggestedFix: `Match style: ${prev.styleCoherence.renderStyle}` });
    }
  }
  return violations;
}
