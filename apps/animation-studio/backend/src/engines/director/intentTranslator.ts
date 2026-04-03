/**
 * Intent Translator — converts raw user input into a structured DirectorIntent.
 * Handles mood inference from brief text, hook type selection based on objective,
 * scene count optimization based on platform constraints, and duration budgeting.
 */
import type { DirectorIntent, BrandContext, AudienceProfile, Mood, HookType, AdObjective, Platform, AspectRatio, RenderMode } from '../types';

const PLATFORM_MAX_DURATION: Record<string, number> = {
  youtube_instream: 60, youtube_shorts: 60, facebook_feed: 240, facebook_reel: 60,
  facebook_story: 15, instagram_feed: 60, instagram_reel: 90, instagram_story: 15,
  tiktok_feed: 60, tiktok_topview: 60,
};

const PLATFORM_SCENES: Record<string, { min: number; max: number; optimal: number }> = {
  youtube_instream: { min: 3, max: 8, optimal: 5 }, youtube_shorts: { min: 3, max: 6, optimal: 5 },
  facebook_feed: { min: 3, max: 8, optimal: 5 }, facebook_reel: { min: 3, max: 6, optimal: 5 },
  facebook_story: { min: 2, max: 3, optimal: 2 }, instagram_feed: { min: 3, max: 6, optimal: 4 },
  instagram_reel: { min: 3, max: 6, optimal: 5 }, instagram_story: { min: 2, max: 3, optimal: 2 },
  tiktok_feed: { min: 3, max: 7, optimal: 5 }, tiktok_topview: { min: 4, max: 8, optimal: 6 },
};

const MOOD_KEYWORDS: Record<Mood, string[]> = {
  Luxury: ['premium','luxury','exclusive','elegant','sophisticated','high-end','refined'],
  Energetic: ['energy','fast','dynamic','exciting','powerful','intense','active'],
  Minimal: ['clean','simple','minimal','modern','sleek','uncluttered'],
  Playful: ['fun','playful','cheerful','happy','bright','colorful','joy'],
  Cinematic: ['cinematic','epic','dramatic','movie','film','theatrical'],
  Emotional: ['emotional','touching','heartfelt','warm','inspiring','human'],
  Corporate: ['professional','corporate','business','enterprise','B2B','trust'],
  Bold: ['bold','statement','impactful','strong','commanding','provocative'],
  Calm: ['calm','peaceful','serene','gentle','relaxing','soothing'],
  Tech: ['tech','futuristic','digital','AI','innovation','data','cyber'],
};

const OBJECTIVE_HOOK_MAP: Record<AdObjective, HookType[]> = {
  awareness: ['curiosity_gap','bold_claim','shocking_stat'],
  consideration: ['pain_point','social_proof','question'],
  conversion: ['direct_offer','pain_point','bold_claim'],
  retention: ['social_proof','question','curiosity_gap'],
  app_install: ['direct_offer','bold_claim','social_proof'],
};

const PLATFORM_ATTENTION: Record<Platform, number> = {
  tiktok: 2000, instagram: 3000, facebook: 4000, youtube: 6000,
};

function inferMood(brief: string, industry: string): Mood {
  const text = `${brief} ${industry}`.toLowerCase();
  let best: Mood = 'Energetic'; let bestScore = 0;
  for (const [mood, kws] of Object.entries(MOOD_KEYWORDS) as [Mood, string[]][]) {
    const score = kws.reduce((s, kw) => s + (text.includes(kw.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = mood; }
  }
  return best;
}

function inferObjective(brief: string): AdObjective {
  const l = brief.toLowerCase();
  if (l.includes('install') || l.includes('download') || l.includes('app')) return 'app_install';
  if (l.includes('buy') || l.includes('purchase') || l.includes('order') || l.includes('sale')) return 'conversion';
  if (l.includes('learn') || l.includes('discover') || l.includes('explore')) return 'consideration';
  if (l.includes('loyal') || l.includes('retain') || l.includes('renew')) return 'retention';
  return 'awareness';
}

export function translateIntent(input: {
  brief: string; brandName: string; industry: string; mood?: string; hookType?: string;
  platform: Platform; placement: string; sceneCount: number; aspectRatio: AspectRatio;
  renderMode: RenderMode; maxDurationSec: number; brandAssetIds?: string[];
  brandPalette?: string[]; targetAudience?: string; objective?: string;
}): DirectorIntent {
  const objective: AdObjective = (input.objective as AdObjective) || inferObjective(input.brief);
  const mood: Mood = (input.mood as Mood) || inferMood(input.brief, input.industry);
  const hookCandidates = OBJECTIVE_HOOK_MAP[objective] || OBJECTIVE_HOOK_MAP.awareness;
  const hookType: HookType = (input.hookType as HookType) || hookCandidates[0];
  const platformLimits = PLATFORM_SCENES[input.placement] || { min: 2, max: 8, optimal: 5 };
  const clampedScenes = Math.max(platformLimits.min, Math.min(platformLimits.max, input.sceneCount));
  const platformMaxDur = PLATFORM_MAX_DURATION[input.placement] || 60;
  const maxDurationSec = Math.min(input.maxDurationSec || platformMaxDur, platformMaxDur);
  const brand: BrandContext = {
    name: input.brandName, brief: input.brief, industry: input.industry,
    targetAudience: input.targetAudience, palette: input.brandPalette, brandAssetIds: input.brandAssetIds,
  };
  const audience: AudienceProfile = {
    ageRange: [18, 45], gender: 'all',
    interests: input.targetAudience ? input.targetAudience.split(',').map(s => s.trim()) : [],
    psychographics: [], platform: input.platform,
    attentionSpanMs: PLATFORM_ATTENTION[input.platform] || 4000,
    peakEngagementSec: input.platform === 'tiktok' ? 8 : input.platform === 'youtube' ? 15 : 10,
  };
  return { objective, brand, audience, mood, hookType, platform: input.platform, placement: input.placement, maxDurationSec, sceneCount: clampedScenes, renderMode: input.renderMode, aspectRatio: input.aspectRatio };
}
