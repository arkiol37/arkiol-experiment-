/**
 * Reference Image Pipeline
 * ═══════════════════════════════════════════════════════════════════════════════
 * Generates still reference frames for each scene that are passed as image
 * references to the video generation provider. This enforces visual
 * consistency across scenes far more effectively than text prompts alone.
 *
 * Architecture:
 *   1. ReferenceFramePlanner — decides which scenes need reference images
 *   2. StyleReferenceBuilder — builds a style reference from brand assets
 *   3. KeyframeDescriptor — generates detailed image descriptions
 *   4. ConsistencyChain — chains references so each scene inherits from prior
 *   5. ReferenceValidator — validates reference quality before use
 */

import type { StoryboardScene, DirectorIntent, SceneRole, Mood } from '../types';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ReferenceImagePlan {
  sceneId: string;
  needsReference: boolean;
  referenceType: 'generated' | 'brand_asset' | 'previous_frame' | 'style_reference' | 'none';
  imagePrompt: string;                    // Prompt for generating the reference still
  styleGuide: StyleGuide;
  consistencyChain: ConsistencyLink[];    // References to inherit from
  priority: number;                        // Generation order priority
  estimatedGenerationMs: number;
}

export interface StyleGuide {
  colorPalette: string[];
  lightingDescription: string;
  textureDescription: string;
  compositionDescription: string;
  moodDescription: string;
  brandElements: string[];
}

export interface ConsistencyLink {
  sourceSceneId: string;
  inheritAttributes: string[];    // What to carry forward
  strength: number;               // 0-1 how much to match
}

export interface ReferenceImageResult {
  sceneId: string;
  imageUrl: string | null;        // URL of generated reference image
  provider: string;
  generationMs: number;
  usedAsReference: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 1  REFERENCE FRAME PLANNER
// ═══════════════════════════════════════════════════════════════════════════════

const SCENE_REFERENCE_PRIORITY: Record<SceneRole, { needs: boolean; priority: number; type: ReferenceImagePlan['referenceType'] }> = {
  hook:         { needs: true,  priority: 0, type: 'generated' },         // First scene — sets the visual DNA
  problem:      { needs: true,  priority: 2, type: 'previous_frame' },    // Inherits from hook
  solution:     { needs: true,  priority: 1, type: 'generated' },         // Product hero — needs its own reference
  proof:        { needs: false, priority: 4, type: 'previous_frame' },    // Inherits
  cta:          { needs: true,  priority: 3, type: 'generated' },         // CTA needs specific composition
  brand_reveal: { needs: true,  priority: 2, type: 'brand_asset' },       // Use brand assets directly
  offer:        { needs: false, priority: 5, type: 'previous_frame' },
  close:        { needs: false, priority: 6, type: 'previous_frame' },
  end:          { needs: false, priority: 7, type: 'style_reference' },
};

function planReferenceFrame(
  scene: StoryboardScene,
  intent: DirectorIntent,
  sceneIndex: number,
  prevSceneId?: string,
): ReferenceImagePlan {
  const config = SCENE_REFERENCE_PRIORITY[scene.role] || { needs: false, priority: 5, type: 'none' as const };

  // Build style guide from intent
  const styleGuide: StyleGuide = {
    colorPalette: intent.brand.palette || ['#3B82F6', '#8B5CF6', '#F59E0B'],
    lightingDescription: MOOD_LIGHTING_DESC[intent.mood] || 'balanced professional lighting',
    textureDescription: MOOD_TEXTURE_DESC[intent.mood] || 'clean polished surface',
    compositionDescription: MOOD_COMPOSITION_DESC[intent.mood] || 'balanced professional composition',
    moodDescription: intent.mood.toLowerCase(),
    brandElements: intent.brand.logoUrl ? [intent.brand.logoUrl] : [],
  };

  // Build consistency chain
  const consistencyChain: ConsistencyLink[] = [];
  if (sceneIndex > 0 && prevSceneId) {
    consistencyChain.push({
      sourceSceneId: prevSceneId,
      inheritAttributes: ['color_palette', 'lighting_direction', 'character_appearance', 'environment_style'],
      strength: scene.role === 'problem' || scene.role === 'solution' ? 0.85 : 0.7,
    });
  }
  // Hook always sets the reference for all subsequent scenes
  if (scene.role !== 'hook' && sceneIndex > 0) {
    consistencyChain.push({
      sourceSceneId: 'hook_scene',  // Resolved at generation time
      inheritAttributes: ['brand_colors', 'visual_dna', 'character_identity'],
      strength: 0.6,
    });
  }

  // Build image prompt for reference generation
  const imagePrompt = buildReferenceImagePrompt(scene, intent, styleGuide);

  return {
    sceneId: scene.id,
    needsReference: config.needs || intent.renderMode === 'Cinematic Ad',  // Cinematic always uses references
    referenceType: config.type,
    imagePrompt,
    styleGuide,
    consistencyChain,
    priority: config.priority,
    estimatedGenerationMs: config.type === 'generated' ? 8000 : config.type === 'brand_asset' ? 500 : 1000,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 2  MOOD DESCRIPTORS
// ═══════════════════════════════════════════════════════════════════════════════

const MOOD_LIGHTING_DESC: Record<Mood, string> = {
  Luxury:    'warm golden key light from 45 degrees, deep rich shadows, subtle rim light',
  Energetic: 'bright high-key lighting, vibrant colored fill lights, dynamic light streaks',
  Minimal:   'soft even diffused lighting, minimal shadows, clean bright environment',
  Playful:   'warm cheerful daylight, soft colorful fill, gentle shadows',
  Cinematic: 'dramatic chiaroscuro, strong key light with deep shadows, rim separation, volumetric haze',
  Emotional: 'warm golden hour light streaming through, intimate soft focus, gentle lens flare',
  Corporate: 'professional studio three-point lighting, clean shadows, neutral color temperature',
  Bold:      'high contrast dramatic side lighting, strong shadows, rim light separation',
  Calm:      'soft diffused overcast lighting, gentle gradients, no harsh shadows',
  Tech:      'cool blue ambient light, neon accent lighting, dark environment with selective illumination',
};

const MOOD_TEXTURE_DESC: Record<Mood, string> = {
  Luxury:    'metallic reflections, glass refractions, silk fabric, polished surfaces',
  Energetic: 'sharp crisp textures, saturated materials, glossy surfaces',
  Minimal:   'matte flat surfaces, clean white materials, subtle grain',
  Playful:   'soft rounded surfaces, bright matte colors, smooth materials',
  Cinematic: 'organic film grain, rich textured surfaces, visible lens characteristics',
  Emotional: 'soft natural textures, warm wood, fabric, skin detail',
  Corporate: 'polished professional surfaces, glass and steel, clean modern materials',
  Bold:      'sharp graphic textures, high-contrast surfaces, strong material definition',
  Calm:      'soft diffused textures, muted pastels, gentle natural materials',
  Tech:      'holographic surfaces, matte digital panels, glass with data reflections',
};

const MOOD_COMPOSITION_DESC: Record<Mood, string> = {
  Luxury:    'centered symmetrical with negative space, rule of thirds for product',
  Energetic: 'dynamic diagonal composition, asymmetric balance, leading lines',
  Minimal:   'strong negative space, centered subject, geometric alignment',
  Playful:   'rule of thirds with playful asymmetry, organic arrangement',
  Cinematic: 'golden ratio composition, deep z-axis staging, foreground framing elements',
  Emotional: 'intimate framing with shallow depth, subject filling frame warmly',
  Corporate: 'balanced professional framing, clean negative space, structured grid',
  Bold:      'graphic composition, strong vertical/horizontal division, dramatic framing',
  Calm:      'open spacious composition, generous margins, centered balance',
  Tech:      'geometric grid composition, data-overlay areas, futuristic framing',
};

// ═══════════════════════════════════════════════════════════════════════════════
// § 3  REFERENCE IMAGE PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildReferenceImagePrompt(scene: StoryboardScene, intent: DirectorIntent, style: StyleGuide): string {
  const parts: string[] = [];

  // Core scene description (stripped of engine directives)
  const cleanPrompt = scene.prompt
    .replace(/Emotion:.*?(?=\.|$)/g, '')
    .replace(/IDENTITY LOCK:.*?(?=\.|$)/g, '')
    .replace(/CINEMATOGRAPHY:.*?(?=\.|$)/g, '')
    .replace(/CRITICAL:.*?(?=\.|$)/g, '')
    .replace(/Lighting:.*?(?=\.|$)/g, '')
    .replace(/Color:.*?(?=\.|$)/g, '')
    .replace(/Style:.*?(?=\.|$)/g, '')
    .replace(/Motion:.*?(?=\.|$)/g, '')
    .replace(/Presenter:.*?(?=\.|$)/g, '')
    .replace(/Product:.*?(?=\.|$)/g, '')
    .replace(/Material:.*?(?=\.|$)/g, '')
    .replace(/Shadow:.*?(?=\.|$)/g, '')
    .replace(/DOF:.*?(?=\.|$)/g, '')
    .replace(/Subject:.*?(?=\.|$)/g, '')
    .replace(/Rhythm:.*?(?=\.|$)/g, '')
    .replace(/Grade:.*?(?=\.|$)/g, '')
    .replace(/Transition.*?(?=\.|$)/g, '')
    .replace(/Micro-expressions:.*?(?=\.|$)/g, '')
    .replace(/Blink:.*?(?=\.|$)/g, '')
    .replace(/Gestures:.*?(?=\.|$)/g, '')
    .replace(/Authenticity:.*?(?=\.|$)/g, '')
    .split('.').filter(s => s.trim().length > 10).slice(0, 4).join('. ');

  parts.push(cleanPrompt);
  parts.push(style.lightingDescription);
  parts.push(`Color palette: ${style.colorPalette.join(', ')}`);
  parts.push(style.compositionDescription);

  // On-screen text overlay description
  if (scene.onScreenText) {
    parts.push(`Text overlay: "${scene.onScreenText}" in brand typography`);
  }

  // Technical specs
  parts.push(`${intent.aspectRatio} aspect ratio, still frame, single frame composition`);
  parts.push('photorealistic, high resolution, professional photography, no motion blur');

  return parts.filter(Boolean).join('. ').replace(/\.\./g, '.').trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 4  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export function planReferenceImages(scenes: StoryboardScene[], intent: DirectorIntent): ReferenceImagePlan[] {
  return scenes.map((scene, i) =>
    planReferenceFrame(scene, intent, i, i > 0 ? scenes[i - 1].id : undefined)
  ).sort((a, b) => a.priority - b.priority);
}

/**
 * Get scenes that need reference generation, in priority order.
 */
export function getReferenceGenerationQueue(plans: ReferenceImagePlan[]): ReferenceImagePlan[] {
  return plans.filter(p => p.needsReference && p.referenceType === 'generated').sort((a, b) => a.priority - b.priority);
}

/**
 * Estimate total reference generation time.
 */
export function estimateReferenceGenerationTime(plans: ReferenceImagePlan[]): number {
  const queue = getReferenceGenerationQueue(plans);
  // First 2 can be parallel, rest sequential
  if (queue.length <= 2) return Math.max(...queue.map(p => p.estimatedGenerationMs), 0);
  return Math.max(queue[0]?.estimatedGenerationMs || 0, queue[1]?.estimatedGenerationMs || 0) + queue.slice(2).reduce((s, p) => s + p.estimatedGenerationMs, 0);
}
