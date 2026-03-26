/**
 * Platform Specifications — 2D Ad Video Engine
 *
 * Single source of truth for platform-specific constraints, formats,
 * export specs, prompt modifiers, and ad structure rules for:
 *   YouTube · Facebook · Instagram · TikTok
 *
 * Used by: adScriptEngine, ffmpegPipeline (export), renderQueue (prompt build)
 */

export type Platform = 'youtube' | 'facebook' | 'instagram' | 'tiktok';
export type AspectRatio = '9:16' | '1:1' | '16:9' | '4:5';
export type AdPlacement =
  | 'youtube_instream'
  | 'youtube_shorts'
  | 'facebook_feed'
  | 'facebook_reel'
  | 'facebook_story'
  | 'instagram_feed'
  | 'instagram_reel'
  | 'instagram_story'
  | 'tiktok_feed'
  | 'tiktok_topview';

// ── Resolution definitions ─────────────────────────────────────
export interface Resolution {
  w: number;
  h: number;
  label: string;
}

// ── Platform placement spec ────────────────────────────────────
export interface PlacementSpec {
  platform: Platform;
  placement: AdPlacement;
  label: string;
  aspectRatio: AspectRatio;
  resolution1080p: Resolution;
  resolution4k: Resolution;
  /** Duration limits in seconds */
  minDurationSec: number;
  maxDurationSec: number;
  /** Recommended scene count for best performance */
  recommendedScenes: number;
  /** Seconds per scene (approximate) */
  secPerScene: number;
  /** Prompt modifier injected into AI generation */
  promptModifier: string;
  /** Safe zone: fraction from each edge where text/logos should stay */
  safeZoneRatio: number;
  /** Platform-specific FFmpeg bitrate target (kbps) */
  targetBitrateKbps: number;
  /** Max file size in MB */
  maxFileSizeMb: number;
  /** Required audio sample rate */
  audioSampleRate: 44100 | 48000;
  /** Platform accent colour for UI */
  accentColor: string;
  icon: string;
}

export const PLACEMENT_SPECS: Record<AdPlacement, PlacementSpec> = {
  youtube_instream: {
    platform: 'youtube',
    placement: 'youtube_instream',
    label: 'YouTube In-Stream',
    aspectRatio: '16:9',
    resolution1080p: { w: 1920, h: 1080, label: '1080p' },
    resolution4k:    { w: 3840, h: 2160, label: '4K' },
    minDurationSec: 6,
    maxDurationSec: 60,
    recommendedScenes: 5,
    secPerScene: 7,
    promptModifier: 'cinematic widescreen 16:9 ad, premium YouTube quality, broadcast-grade motion graphics, strong hook in first 5 seconds, skip-proof opening',
    safeZoneRatio: 0.08,
    targetBitrateKbps: 8000,
    maxFileSizeMb: 256,
    audioSampleRate: 48000,
    accentColor: '#FF0000',
    icon: '▶️',
  },
  youtube_shorts: {
    platform: 'youtube',
    placement: 'youtube_shorts',
    label: 'YouTube Shorts',
    aspectRatio: '9:16',
    resolution1080p: { w: 1080, h: 1920, label: '1080p' },
    resolution4k:    { w: 2160, h: 3840, label: '4K' },
    minDurationSec: 15,
    maxDurationSec: 60,
    recommendedScenes: 5,
    secPerScene: 7,
    promptModifier: 'vertical 9:16 YouTube Shorts format, fast-paced mobile-first visuals, bold typography fills frame, hook in first 2 seconds, Gen-Z energy, TikTok-native aesthetic',
    safeZoneRatio: 0.12,
    targetBitrateKbps: 6000,
    maxFileSizeMb: 256,
    audioSampleRate: 48000,
    accentColor: '#FF0000',
    icon: '📱',
  },
  facebook_feed: {
    platform: 'facebook',
    placement: 'facebook_feed',
    label: 'Facebook Feed',
    aspectRatio: '16:9',
    resolution1080p: { w: 1920, h: 1080, label: '1080p' },
    resolution4k:    { w: 3840, h: 2160, label: '4K' },
    minDurationSec: 5,
    maxDurationSec: 240,
    recommendedScenes: 5,
    secPerScene: 7,
    promptModifier: '16:9 Facebook feed ad, auto-play silent-first design, large clear text captions, high-contrast visuals that work muted, brand logo prominent within first 3 seconds',
    safeZoneRatio: 0.08,
    targetBitrateKbps: 4000,
    maxFileSizeMb: 4096,
    audioSampleRate: 44100,
    accentColor: '#1877F2',
    icon: '👥',
  },
  facebook_reel: {
    platform: 'facebook',
    placement: 'facebook_reel',
    label: 'Facebook Reels',
    aspectRatio: '9:16',
    resolution1080p: { w: 1080, h: 1920, label: '1080p' },
    resolution4k:    { w: 2160, h: 3840, label: '4K' },
    minDurationSec: 15,
    maxDurationSec: 60,
    recommendedScenes: 5,
    secPerScene: 7,
    promptModifier: 'vertical 9:16 Facebook Reels, dynamic transitions, bold lifestyle imagery, hook-first structure, energy-matched to trending Reels aesthetic',
    safeZoneRatio: 0.15,
    targetBitrateKbps: 5000,
    maxFileSizeMb: 1000,
    audioSampleRate: 44100,
    accentColor: '#1877F2',
    icon: '🎬',
  },
  facebook_story: {
    platform: 'facebook',
    placement: 'facebook_story',
    label: 'Facebook Story',
    aspectRatio: '9:16',
    resolution1080p: { w: 1080, h: 1920, label: '1080p' },
    resolution4k:    { w: 2160, h: 3840, label: '4K' },
    minDurationSec: 5,
    maxDurationSec: 15,
    recommendedScenes: 2,
    secPerScene: 6,
    promptModifier: 'vertical 9:16 Facebook Story 15-second ad, immediate visual impact, swipe-up CTA prominent, punchy single-message delivery, full-bleed vertical framing',
    safeZoneRatio: 0.14,
    targetBitrateKbps: 3500,
    maxFileSizeMb: 250,
    audioSampleRate: 44100,
    accentColor: '#1877F2',
    icon: '📖',
  },
  instagram_feed: {
    platform: 'instagram',
    placement: 'instagram_feed',
    label: 'Instagram Feed',
    aspectRatio: '1:1',
    resolution1080p: { w: 1080, h: 1080, label: '1080p' },
    resolution4k:    { w: 2160, h: 2160, label: '4K' },
    minDurationSec: 3,
    maxDurationSec: 60,
    recommendedScenes: 4,
    secPerScene: 7,
    promptModifier: '1:1 square Instagram feed ad, aesthetically cohesive, premium brand photography style, centered composition, stops scroll through visual beauty not shock, aspirational lifestyle',
    safeZoneRatio: 0.10,
    targetBitrateKbps: 3500,
    maxFileSizeMb: 250,
    audioSampleRate: 44100,
    accentColor: '#E1306C',
    icon: '📷',
  },
  instagram_reel: {
    platform: 'instagram',
    placement: 'instagram_reel',
    label: 'Instagram Reels',
    aspectRatio: '9:16',
    resolution1080p: { w: 1080, h: 1920, label: '1080p' },
    resolution4k:    { w: 2160, h: 3840, label: '4K' },
    minDurationSec: 5,
    maxDurationSec: 90,
    recommendedScenes: 5,
    secPerScene: 7,
    promptModifier: 'vertical 9:16 Instagram Reels ad, creator-native aesthetic, trending audio-reactive visuals, hook pulls viewer in first 1.5 seconds, authentic not overly polished, relatable lifestyle moments',
    safeZoneRatio: 0.15,
    targetBitrateKbps: 5000,
    maxFileSizeMb: 1000,
    audioSampleRate: 44100,
    accentColor: '#E1306C',
    icon: '🎥',
  },
  instagram_story: {
    platform: 'instagram',
    placement: 'instagram_story',
    label: 'Instagram Story',
    aspectRatio: '9:16',
    resolution1080p: { w: 1080, h: 1920, label: '1080p' },
    resolution4k:    { w: 2160, h: 3840, label: '4K' },
    minDurationSec: 5,
    maxDurationSec: 15,
    recommendedScenes: 2,
    secPerScene: 6,
    promptModifier: 'vertical 9:16 Instagram Story 15-second ad, immersive full-bleed visuals, strong CTA overlay, swipe-up interaction design, lifestyle premium feel, Instagram-native aesthetic quality',
    safeZoneRatio: 0.14,
    targetBitrateKbps: 3500,
    maxFileSizeMb: 250,
    audioSampleRate: 44100,
    accentColor: '#E1306C',
    icon: '📲',
  },
  tiktok_feed: {
    platform: 'tiktok',
    placement: 'tiktok_feed',
    label: 'TikTok In-Feed',
    aspectRatio: '9:16',
    resolution1080p: { w: 1080, h: 1920, label: '1080p' },
    resolution4k:    { w: 2160, h: 3840, label: '4K' },
    minDurationSec: 5,
    maxDurationSec: 60,
    recommendedScenes: 5,
    secPerScene: 7,
    promptModifier: 'vertical 9:16 TikTok in-feed ad, native TikTok aesthetic avoids over-produced look, hook in first 1 second, fast cuts and dynamic motion, trending visual language, authentic creator-style footage, text overlays are large and punchy',
    safeZoneRatio: 0.15,
    targetBitrateKbps: 5000,
    maxFileSizeMb: 500,
    audioSampleRate: 44100,
    accentColor: '#010101',
    icon: '🎵',
  },
  tiktok_topview: {
    platform: 'tiktok',
    placement: 'tiktok_topview',
    label: 'TikTok TopView',
    aspectRatio: '9:16',
    resolution1080p: { w: 1080, h: 1920, label: '1080p' },
    resolution4k:    { w: 2160, h: 3840, label: '4K' },
    minDurationSec: 5,
    maxDurationSec: 60,
    recommendedScenes: 6,
    secPerScene: 8,
    promptModifier: 'vertical 9:16 TikTok TopView premium placement ad, highest quality production allowed to feel slightly more polished than feed, cinematic opening 3 seconds with brand reveal, sound-on design with beat-synced transitions, immersive full-screen experience',
    safeZoneRatio: 0.12,
    targetBitrateKbps: 6000,
    maxFileSizeMb: 500,
    audioSampleRate: 44100,
    accentColor: '#010101',
    icon: '⭐',
  },
};

/** All placements grouped by platform for UI rendering */
export const PLACEMENTS_BY_PLATFORM: Record<Platform, AdPlacement[]> = {
  youtube:   ['youtube_instream', 'youtube_shorts'],
  facebook:  ['facebook_feed', 'facebook_reel', 'facebook_story'],
  instagram: ['instagram_feed', 'instagram_reel', 'instagram_story'],
  tiktok:    ['tiktok_feed', 'tiktok_topview'],
};

export const PLATFORM_META: Record<Platform, { label: string; icon: string; color: string }> = {
  youtube:   { label: 'YouTube',   icon: '▶️', color: '#FF0000' },
  facebook:  { label: 'Facebook',  icon: '👥', color: '#1877F2' },
  instagram: { label: 'Instagram', icon: '📷', color: '#E1306C' },
  tiktok:    { label: 'TikTok',    icon: '🎵', color: '#010101' },
};

/** Get spec for a placement, throws if not found */
export function getPlacementSpec(placement: AdPlacement): PlacementSpec {
  const spec = PLACEMENT_SPECS[placement];
  if (!spec) throw new Error(`Unknown placement: ${placement}`);
  return spec;
}

/** Get resolution object for 1080p or 4K */
export function getResolution(spec: PlacementSpec, is4K: boolean): Resolution {
  return is4K ? spec.resolution4k : spec.resolution1080p;
}

/** Total duration in seconds for given scenes and placement */
export function estimateDuration(spec: PlacementSpec, sceneCount: number): number {
  return Math.min(spec.maxDurationSec, Math.max(spec.minDurationSec, sceneCount * spec.secPerScene));
}
