/**
 * Ad Script Engine — 2D Video Ad Generator
 *
 * Builds platform-optimised, psychology-driven ad scripts for:
 *   YouTube · Facebook · Instagram · TikTok
 *
 * Each scene gets:
 *   - A role (hook/problem/solution/proof/cta)
 *   - A detailed AI prompt (platform + mood + brand aware)
 *   - A voiceover script line
 *   - Visual direction metadata
 *   - Timing spec (respects platform max-duration)
 */
import type { AdPlacement, Platform } from './platformSpecs';
import { PLACEMENT_SPECS, estimateDuration } from './platformSpecs';

// ── Types ──────────────────────────────────────────────────────
export type SceneRole = 'hook' | 'problem' | 'solution' | 'proof' | 'cta' | 'brand_reveal' | 'offer';
export type HookType  = 'pain_point' | 'curiosity_gap' | 'bold_claim' | 'social_proof' | 'direct_offer' | 'question' | 'shocking_stat';
export type Mood      = 'Luxury' | 'Energetic' | 'Minimal' | 'Playful' | 'Cinematic' | 'Emotional' | 'Corporate' | 'Bold' | 'Calm' | 'Tech';

export interface BrandContext {
  name: string;
  brief: string;
  industry: string;
  valueProposition?: string;
  targetAudience?: string;
  uniqueSellingPoint?: string;
}

export interface SceneSpec {
  role: SceneRole;
  durationSec: number;
  prompt: string;
  voiceoverScript: string;
  visualDirection: string;
  onScreenText?: string;
  transitionIn: 'cut' | 'crossfade' | 'push' | 'zoom';
}

export interface AdScript {
  placement: AdPlacement;
  totalDurationSec: number;
  scenes: SceneSpec[];
  titleSuggestion: string;
  ctaText: string;
}

// ── Mood modifiers injected into every prompt ─────────────────
const MOOD_PROMPT_MODIFIERS: Record<Mood, string> = {
  Luxury:     'ultra-premium aesthetic, dark rich backgrounds, gold accents, elegant slow motion, sophisticated typography, aspirational lifestyle',
  Energetic:  'high energy kinetic motion, vibrant saturated colors, fast dynamic cuts, bold graphic elements, electric atmosphere',
  Minimal:    'clean white space, minimal design language, refined typography, subtle motion, Scandinavian aesthetic, calm sophistication',
  Playful:    'bright cheerful colors, bouncy animations, fun typography, joy and excitement, friendly approachable feel',
  Cinematic:  'cinematic depth of field, dramatic lighting, film grain texture, widescreen letterbox effect, movie-quality production',
  Emotional:  'warm intimate lighting, authentic human moments, genuine emotion, soft focus, touching real-world connection',
  Corporate:  'professional clean design, trustworthy blue tones, modern business aesthetic, data visualization, confident leadership',
  Bold:       'high contrast black and white, impactful full-screen typography, graphic statement design, commanding visual power',
  Calm:       'serene soft lighting, gentle motion blur, peaceful nature elements, breathable white space, mindful pacing',
  Tech:       'futuristic holographic UI elements, data streams, neural network visuals, neon on dark, sci-fi interface aesthetics',
};

// ── Industry context injected into prompts ────────────────────
const INDUSTRY_VISUAL_CONTEXT: Record<string, string> = {
  'Tech / SaaS':          'sleek interfaces, productivity dashboards, professionals at computers, modern office environments',
  'E-commerce':           'product showcase, lifestyle use, unboxing moments, happy customers, beautiful product photography',
  'Finance':              'charts growing upward, financial freedom, professional advice, security imagery, wealth symbols',
  'Health & Wellness':    'active lifestyle, natural environments, healthy food, exercise, before/after transformations',
  'Fashion':              'studio photography, model lifestyle, fabric texture close-ups, runway-inspired movement',
  'Food & Beverage':      'appetite-inducing macro food photography, cooking in action, satisfied customers, ingredient quality',
  'Real Estate':          'aspirational property interiors, aerial drone footage style, family lifestyle, architectural beauty',
  'Education':            'learning environments, aha moments, student success, knowledge symbols, growth visualization',
  'Other':                'diverse real-world scenarios, authentic people, genuine moments',
};

// ── Hook opener templates per hook type ──────────────────────
function buildHookOpener(hookType: HookType, brand: BrandContext): { visualPrompt: string; voiceover: string; onScreen: string } {
  const b = brand.name || 'our brand';
  const brief = brand.brief || 'solving your biggest challenge';
  const audience = brand.targetAudience || 'you';
  const usp = brand.uniqueSellingPoint || brand.brief || 'a better way';

  const hooks: Record<HookType, { visualPrompt: string; voiceover: string; onScreen: string }> = {
    pain_point: {
      visualPrompt: `frustrated person facing a relatable problem, authentic emotional expression of struggle, ${brief}`,
      voiceover: `Still struggling with ${brief}? You're not alone.`,
      onScreen: `Still struggling?`,
    },
    curiosity_gap: {
      visualPrompt: `mysterious teaser visual with partial reveal, intriguing question posed visually, curiosity-building composition`,
      voiceover: `What if there was a way to ${brief || 'change everything'}?`,
      onScreen: `What if...`,
    },
    bold_claim: {
      visualPrompt: `confident product hero shot, bold statement typography filling frame, dramatic lighting emphasising strength`,
      voiceover: `${b} is the only ${usp}. Period.`,
      onScreen: `The ONLY ${usp.slice(0, 30)}`,
    },
    social_proof: {
      visualPrompt: `crowd of happy satisfied customers, testimonial overlay graphics, social media feed style trust signals`,
      voiceover: `Over ${audience === 'you' ? '10,000 people' : audience} already trust ${b}.`,
      onScreen: `10,000+ Happy Customers`,
    },
    direct_offer: {
      visualPrompt: `product/service clearly displayed, clean offer graphic overlay, urgency visual elements, countdown timer style`,
      voiceover: `Get started with ${b} — free today, no credit card needed.`,
      onScreen: `Try ${b} FREE`,
    },
    question: {
      visualPrompt: `split screen showing before and after, question mark graphic element, contemplative scene setting`,
      voiceover: `Are you getting the results you deserve?`,
      onScreen: `Are you getting results?`,
    },
    shocking_stat: {
      visualPrompt: `data visualisation explosion, statistic displayed large on screen, graph breaking upward, impact visual`,
      voiceover: `9 out of 10 ${audience} never achieve ${brief}. Until now.`,
      onScreen: `9/10 people struggle`,
    },
  };

  return hooks[hookType] || hooks.pain_point;
}

// ── CTA builder per placement ─────────────────────────────────
function buildCTAScene(placement: AdPlacement, brand: BrandContext, ctaText: string, mood: Mood): SceneSpec {
  const spec = PLACEMENT_SPECS[placement];
  const b = brand.name || 'us';
  const isShortForm = spec.maxDurationSec <= 60;

  return {
    role: 'cta',
    durationSec: isShortForm ? 3 : 5,
    prompt: `${MOOD_PROMPT_MODIFIERS[mood]}, powerful call-to-action scene, ${b} logo prominent, ${ctaText} message large on screen, ${spec.promptModifier}, final frame with brand identity lock-up, urgency and excitement`,
    voiceoverScript: ctaText,
    visualDirection: `Brand logo at center, CTA button graphic, ${mood.toLowerCase()} color palette, transition to black or brand color end card`,
    onScreenText: ctaText,
    transitionIn: 'crossfade',
  };
}

// ── Scene role content library ────────────────────────────────
function buildRoleScene(
  role: SceneRole,
  position: number,
  brand: BrandContext,
  mood: Mood,
  placement: AdPlacement,
  industryContext: string
): SceneSpec {
  const spec = PLACEMENT_SPECS[placement];
  const moodMod = MOOD_PROMPT_MODIFIERS[mood];
  const b = brand.name || 'the brand';
  const brief = brand.brief || 'solving your challenge';
  const usp = brand.uniqueSellingPoint || brand.valueProposition || brief;

  const roleTemplates: Record<SceneRole, { prompt: string; voiceover: string; visual: string }> = {
    hook: {
      prompt: `opening hook scene, immediate visual impact, ${industryContext}, ${moodMod}, ${spec.promptModifier}`,
      voiceover: `Introducing ${b}.`,
      visual: `Full-bleed opening shot, logo reveal, ${mood.toLowerCase()} tone`,
    },
    problem: {
      prompt: `relatable problem scene depicting what life looks like without the solution, ${industryContext}, emotional resonance, ${moodMod}, ${spec.promptModifier}`,
      voiceover: `The old way just doesn't work anymore.`,
      visual: `Empathetic problem framing, avoid showing brand, let audience self-identify`,
    },
    solution: {
      prompt: `${b} solution reveal, product or service in action, transformation moment, ${industryContext}, ${moodMod}, ${spec.promptModifier}, hero product shot`,
      voiceover: `${b} changes everything — ${usp}.`,
      visual: `Product hero moment, clear benefit demonstration, ${mood.toLowerCase()} aesthetic`,
    },
    proof: {
      prompt: `social proof scene, testimonials, reviews, user-generated content style, happy customers using ${b}, ${industryContext}, ${moodMod}, ${spec.promptModifier}`,
      voiceover: `Thousands of customers have already made the switch.`,
      visual: `Trust-building imagery, review graphics overlay, real customer moments`,
    },
    brand_reveal: {
      prompt: `cinematic ${b} brand reveal, logo animation, brand colors dominant, ${moodMod}, ${spec.promptModifier}, premium brand identity moment`,
      voiceover: `${b} — ${usp}.`,
      visual: `Full brand identity display, logo animation, brand color palette showcase`,
    },
    offer: {
      prompt: `limited time offer visual, urgency design elements, discount or bonus highlight, ${moodMod}, ${spec.promptModifier}, value proposition graphic`,
      voiceover: `For a limited time — get exclusive access now.`,
      visual: `Offer graphic, countdown elements, value display`,
    },
    cta: {
      prompt: `call to action finale, ${b} logo lock-up, ${moodMod}, ${spec.promptModifier}`,
      voiceover: `Get started today.`,
      visual: `CTA button, brand logo, contact/URL prominent`,
    },
  };

  const t = roleTemplates[role] || roleTemplates.solution;
  const durationSec = spec.secPerScene;

  return {
    role,
    durationSec,
    prompt: t.prompt,
    voiceoverScript: t.voiceover,
    visualDirection: t.visual,
    transitionIn: position === 0 ? 'cut' : 'crossfade',
  };
}

// ── Scene sequence builder ────────────────────────────────────
function buildSceneSequence(sceneCount: number, placement: AdPlacement): SceneRole[] {
  const spec = PLACEMENT_SPECS[placement];

  // Short-form (≤15s): hook + cta only
  if (spec.maxDurationSec <= 15 || sceneCount <= 2) {
    return ['hook', 'cta'].slice(0, sceneCount) as SceneRole[];
  }

  // 3-scene: hook → solution → cta
  if (sceneCount <= 3) return ['hook', 'solution', 'cta'];

  // 4-scene: hook → problem → solution → cta
  if (sceneCount <= 4) return ['hook', 'problem', 'solution', 'cta'];

  // 5-scene: standard AIDA
  if (sceneCount <= 5) return ['hook', 'problem', 'solution', 'proof', 'cta'];

  // 6-scene: add brand reveal
  if (sceneCount <= 6) return ['hook', 'problem', 'solution', 'proof', 'brand_reveal', 'cta'];

  // 7+: full funnel with offer
  const extra = sceneCount - 7;
  const base: SceneRole[] = ['hook', 'problem', 'solution', 'proof', 'brand_reveal', 'offer', 'cta'];
  const proofExtensions: SceneRole[] = Array(extra).fill('proof');
  return ['hook', 'problem', ...proofExtensions, 'solution', 'proof', 'brand_reveal', 'offer', 'cta'].slice(0, sceneCount) as SceneRole[];
}

// ── Main script builder ──────────────────────────────────────
export function buildAdScript(params: {
  brand: BrandContext;
  placement: AdPlacement;
  mood: Mood;
  hookType: HookType;
  sceneCount: number;
  ctaText: string;
}): AdScript {
  const { brand, placement, mood, hookType, sceneCount, ctaText } = params;
  const spec = PLACEMENT_SPECS[placement];
  const industryContext = INDUSTRY_VISUAL_CONTEXT[brand.industry] || INDUSTRY_VISUAL_CONTEXT['Other'];
  const clampedCount = Math.max(1, Math.min(sceneCount, 10));
  const sequence = buildSceneSequence(clampedCount, placement);

  const scenes: SceneSpec[] = sequence.map((role, i) => {
    if (role === 'hook' && i === 0) {
      // Hook: use psychology-based hook opener
      const hookData = buildHookOpener(hookType, brand);
      const moodMod = MOOD_PROMPT_MODIFIERS[mood];
      return {
        role: 'hook',
        durationSec: spec.secPerScene,
        prompt: `${hookData.visualPrompt}, ${moodMod}, ${spec.promptModifier}, ${industryContext}`,
        voiceoverScript: hookData.voiceover,
        visualDirection: `Hook opener in ${mood.toLowerCase()} style`,
        onScreenText: hookData.onScreen,
        transitionIn: 'cut',
      };
    }

    if (role === 'cta') {
      return buildCTAScene(placement, brand, ctaText, mood);
    }

    return buildRoleScene(role, i, brand, mood, placement, industryContext);
  });

  const totalDurationSec = estimateDuration(spec, clampedCount);

  return {
    placement,
    totalDurationSec,
    scenes,
    titleSuggestion: `${brand.name || 'Campaign'} — ${spec.label} ${mood} Ad`,
    ctaText,
  };
}

/** Build a full prompt string for a scene including all platform/mood context */
export function buildEnhancedPrompt(scene: SceneSpec, placement: AdPlacement, resolution: string): string {
  const spec = PLACEMENT_SPECS[placement];
  return `${scene.prompt}. ${spec.promptModifier}. ${resolution} resolution, professional motion graphics 2D animation, ad-quality render, smooth 24fps, ${scene.durationSec} seconds.`;
}
