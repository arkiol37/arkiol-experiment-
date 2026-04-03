/**
 * Prompt Compiler Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 * Translates structured engine directives (acting, continuity, cinematic,
 * motion) into optimized prompt strings for the internal Template Execution
 * Engine. The compilation grammar (weight syntax, quality triggers, negative
 * prompts) maximizes template binding quality.
 *
 * Architecture:
 *   1. DirectiveParser — extracts structured data from engine outputs
 *   2. CompilationGrammar — prompt syntax rules for internal renderer
 *   3. WeightAllocator — prioritizes directives by visual impact
 *   4. NegativePromptBuilder — prevents common rendering artifacts
 *   5. QualityTriggerInjector — adds quality-boosting tokens
 *   6. PromptAssembler — builds final optimized prompt string
 *
 * NOTE: Provider-specific grammars (Runway/Pika/Sora) are preserved in
 * _future_3d/ for future 3D video capabilities. The active pipeline uses
 * a single high-quality grammar profile ('internal') for all 2D/2.5D.
 */

import type { StoryboardScene, DirectorIntent, Mood, Platform, RenderMode } from '../types';

// v27: ProviderName replaced with PromptTarget. The only active target is 'internal'.
// Future 3D targets (runway/pika/sora) are documented in _future_3d/.
type PromptTarget = 'internal';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CompiledPrompt {
  provider: PromptTarget;
  positivePrompt: string;
  negativePrompt: string;
  styleTokens: string[];
  qualityTokens: string[];
  technicalParams: Record<string, unknown>;
  originalLength: number;
  compiledLength: number;
  compressionRatio: number;
}

interface PromptDirective {
  category: 'acting' | 'continuity' | 'cinematic' | 'motion' | 'brand' | 'platform' | 'quality';
  weight: number;        // 0-1 importance
  content: string;
  provider_specific: Partial<Record<PromptTarget, string>>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 1  PROVIDER GRAMMAR — how each provider interprets prompts
// ═══════════════════════════════════════════════════════════════════════════════

interface ProviderGrammarProfile {
  maxPromptLength: number;
  supportsNegativePrompt: boolean;
  supportsWeightSyntax: boolean;
  weightFormat: (text: string, weight: number) => string;
  qualityTriggers: string[];
  styleTriggers: Record<string, string>;
  moodTranslation: Record<Mood, string>;
  avoidTerms: string[];      // terms that confuse this provider
  strengthTerms: string[];   // terms that boost quality
}

// v27: Single compilation grammar for the internal Template Execution Engine.
// Uses the highest-quality profile (originally Runway's). Provider-specific
// grammars are preserved in _future_3d/ for future 3D video capabilities.
const PROMPT_GRAMMAR: Record<PromptTarget, ProviderGrammarProfile> = {
  internal: {
    maxPromptLength: 1500,
    supportsNegativePrompt: true,
    supportsWeightSyntax: true,
    weightFormat: (text, w) => w > 0.8 ? `(${text}:${w.toFixed(1)})` : text,
    qualityTriggers: [
      'cinematic lighting', 'professional color grading', 'smooth camera movement',
      'high production value', 'broadcast quality', 'photorealistic rendering',
      'consistent character appearance', 'stable identity throughout',
    ],
    styleTriggers: {
      cinematic: 'anamorphic lens, film grain, teal and orange grading, 2.35:1 cinematic framing',
      commercial: 'commercial broadcast quality, product photography lighting, clean key light',
      editorial: 'editorial fashion photography style, dramatic rim lighting',
    },
    moodTranslation: {
      Luxury: 'luxury commercial aesthetic, warm golden lighting, slow elegant camera movement, premium materials with light reflections',
      Energetic: 'high energy motion, dynamic camera angles, vibrant saturated colors, fast-paced kinetic movement',
      Minimal: 'minimalist design, clean white backgrounds, precise geometric composition, subtle movement',
      Playful: 'bright cheerful palette, playful bounce animation, warm natural lighting, friendly approachable feel',
      Cinematic: 'cinematic depth of field, dramatic chiaroscuro lighting, anamorphic lens flare, film grain texture',
      Emotional: 'warm intimate lighting, shallow depth of field, golden hour warmth, authentic human emotion',
      Corporate: 'professional studio lighting, clean corporate environment, trust-building blue tones, steady camera',
      Bold: 'high contrast dramatic lighting, strong shadows, impactful composition, commanding visual presence',
      Calm: 'soft diffused lighting, gentle slow motion, pastel color palette, serene atmosphere',
      Tech: 'futuristic blue-lit environment, holographic elements, data visualization aesthetic, clean digital surfaces',
    },
    avoidTerms: ['cartoon', 'anime', 'pixel art', 'low quality'],
    strengthTerms: ['photorealistic', 'broadcast quality', '8K detail', 'professional production'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// § 2  DIRECTIVE PARSER — extracts structured data from scene
// ═══════════════════════════════════════════════════════════════════════════════

function parseDirectives(scene: StoryboardScene, intent: DirectorIntent): PromptDirective[] {
  const directives: PromptDirective[] = [];

  // Core scene content (highest priority)
  directives.push({
    category: 'brand', weight: 1.0,
    content: scene.prompt.split('.').slice(0, 3).join('.'), // First 3 sentences = core brief
    provider_specific: {},
  });

  // Visual direction
  if (scene.visualDirection) {
    directives.push({
      category: 'cinematic', weight: 0.85,
      content: scene.visualDirection,
      provider_specific: {},
    });
  }

  // Acting/emotion (from prompt injection)
  const actingMatch = scene.prompt.match(/Emotion:.*?(?=\.|$)/);
  if (actingMatch) {
    directives.push({
      category: 'acting', weight: 0.7,
      content: actingMatch[0],
      provider_specific: {
        internal: actingMatch[0] + ', natural micro-expressions, realistic eye movement',
      },
    });
  }

  // Continuity constraints (from prompt injection)
  const contMatch = scene.prompt.match(/IDENTITY LOCK:.*?(?=\.|$)/);
  if (contMatch) {
    directives.push({
      category: 'continuity', weight: 0.9,
      content: contMatch[0],
      provider_specific: {
        internal: '(consistent character appearance:1.3), (no morphing:1.2), stable identity',
      },
    });
  }

  // Cinematic direction (from prompt injection)
  const cineMatch = scene.prompt.match(/CINEMATOGRAPHY:.*?(?=\.|$)/);
  if (cineMatch) {
    directives.push({
      category: 'cinematic', weight: 0.8,
      content: cineMatch[0],
      provider_specific: {},
    });
  }

  // Platform optimization
  directives.push({
    category: 'platform', weight: 0.6,
    content: `${intent.platform} ${intent.placement} format, ${intent.aspectRatio} aspect ratio`,
    provider_specific: {
      internal: intent.platform === 'tiktok' ? 'vertical format, mobile-optimized framing, subject centered' :
              intent.platform === 'youtube' ? 'widescreen cinematic framing, high production value' : '',
    },
  });

  return directives;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 3  NEGATIVE PROMPT BUILDER — prevents common AI video artifacts
// ═══════════════════════════════════════════════════════════════════════════════

function buildNegativePrompt(intent: DirectorIntent, provider: PromptTarget): string {
  const base = [
    'blurry', 'distorted', 'deformed', 'low quality', 'watermark',
    'text artifacts', 'flickering', 'jitter', 'morphing face',
    'inconsistent identity', 'color banding', 'motion blur artifacts',
  ];

  const moodNegatives: Partial<Record<Mood, string[]>> = {
    Luxury: ['cheap', 'plastic', 'harsh lighting', 'amateur'],
    Minimal: ['cluttered', 'busy', 'noisy', 'over-decorated'],
    Cinematic: ['flat lighting', 'static camera', 'TV quality'],
    Corporate: ['casual', 'unprofessional', 'messy'],
    Calm: ['aggressive', 'chaotic', 'harsh'],
  };

  const all = [...base, ...(moodNegatives[intent.mood] || [])];

  // Internal renderer supports full negative prompt
  return all.join(', ');
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 4  QUALITY TRIGGER INJECTOR
// ═══════════════════════════════════════════════════════════════════════════════

function getQualityTokens(intent: DirectorIntent, provider: PromptTarget): string[] {
  const grammar = PROMPT_GRAMMAR[provider];
  const tokens = [...grammar.qualityTriggers];

  // Add cinematic-specific quality tokens
  if (intent.renderMode === 'Cinematic Ad') {
    const style = grammar.styleTriggers.cinematic;
    if (style) tokens.push(style);
  } else {
    const style = grammar.styleTriggers.commercial;
    if (style) tokens.push(style);
  }

  // Add strength terms
  tokens.push(...grammar.strengthTerms);

  return tokens;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 5  PROMPT ASSEMBLER — builds final optimized prompt
// ═══════════════════════════════════════════════════════════════════════════════

function assemblePrompt(
  directives: PromptDirective[],
  qualityTokens: string[],
  moodTranslation: string,
  provider: PromptTarget,
  maxLength: number,
): string {
  const grammar = PROMPT_GRAMMAR[provider];

  // Sort directives by weight (highest first)
  const sorted = [...directives].sort((a, b) => b.weight - a.weight);

  const parts: string[] = [];

  // Add mood translation first (sets the visual tone)
  parts.push(moodTranslation);

  // Add directives, using provider-specific versions when available
  for (const dir of sorted) {
    const text = dir.provider_specific[provider] || dir.content;
    if (!text) continue;

    // Apply weight syntax if provider supports it
    const weighted = grammar.supportsWeightSyntax && dir.weight > 0.7
      ? grammar.weightFormat(text, dir.weight)
      : text;

    parts.push(weighted);
  }

  // Add quality tokens
  parts.push(qualityTokens.join(', '));

  // Assemble and trim to max length
  let prompt = parts.filter(Boolean).join('. ').replace(/\.\./g, '.').replace(/\s+/g, ' ').trim();

  // Remove any terms that confuse this provider
  for (const avoid of grammar.avoidTerms) {
    prompt = prompt.replace(new RegExp(avoid, 'gi'), '');
  }

  // Trim to max length at sentence boundary
  if (prompt.length > maxLength) {
    const truncated = prompt.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf('.');
    prompt = lastPeriod > maxLength * 0.5 ? truncated.substring(0, lastPeriod + 1) : truncated;
  }

  return prompt.replace(/\s+/g, ' ').trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 6  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export function compilePrompt(
  scene: StoryboardScene,
  intent: DirectorIntent,
  provider: PromptTarget,
): CompiledPrompt {
  const grammar = PROMPT_GRAMMAR[provider];
  const directives = parseDirectives(scene, intent);
  const qualityTokens = getQualityTokens(intent, provider);
  const moodTranslation = grammar.moodTranslation[intent.mood] || grammar.moodTranslation.Cinematic;
  const negativePrompt = buildNegativePrompt(intent, provider);

  const positivePrompt = assemblePrompt(
    directives, qualityTokens, moodTranslation,
    provider, grammar.maxPromptLength,
  );

  return {
    provider,
    positivePrompt,
    negativePrompt,
    styleTokens: Object.values(grammar.styleTriggers).slice(0, 2),
    qualityTokens,
    technicalParams: {
      maxLength: grammar.maxPromptLength,
      supportsNegative: grammar.supportsNegativePrompt,
      supportsWeights: grammar.supportsWeightSyntax,
    },
    originalLength: scene.prompt.length,
    compiledLength: positivePrompt.length,
    compressionRatio: positivePrompt.length / Math.max(1, scene.prompt.length),
  };
}

export function compileAllPrompts(
  scenes: StoryboardScene[],
  intent: DirectorIntent,
  provider: PromptTarget,
): CompiledPrompt[] {
  return scenes.map(scene => compilePrompt(scene, intent, provider));
}

/**
 * Select the compilation target. v27: always 'internal' for 2D/2.5D.
 */
export function selectOptimalProvider(_intent: DirectorIntent): PromptTarget {
  return 'internal';
}
