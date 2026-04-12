/**
 * Export Profiles — canonical export specifications for all supported
 * platforms and placements, shared across both apps.
 */
export interface ExportProfile {
  id: string;
  platform: string;
  placement: string;
  width: number;
  height: number;
  aspectRatio: string;
  maxFileSizeMb: number;
  maxDurationSec: number;
  codec: string;
  videoBitrate: string;
  audioBitrate: string;
  fps: number;
  container: string;
  description: string;
}

export const EXPORT_PROFILES: ExportProfile[] = [
  { id: 'yt_instream', platform: 'youtube', placement: 'instream', width: 1920, height: 1080, aspectRatio: '16:9', maxFileSizeMb: 256, maxDurationSec: 60, codec: 'libx264', videoBitrate: '8000k', audioBitrate: '256k', fps: 30, container: 'mp4', description: 'YouTube In-Stream Ad' },
  { id: 'yt_shorts', platform: 'youtube', placement: 'shorts', width: 1080, height: 1920, aspectRatio: '9:16', maxFileSizeMb: 256, maxDurationSec: 60, codec: 'libx264', videoBitrate: '6000k', audioBitrate: '256k', fps: 30, container: 'mp4', description: 'YouTube Shorts' },
  { id: 'ig_reel', platform: 'instagram', placement: 'reel', width: 1080, height: 1920, aspectRatio: '9:16', maxFileSizeMb: 100, maxDurationSec: 90, codec: 'libx264', videoBitrate: '5000k', audioBitrate: '128k', fps: 30, container: 'mp4', description: 'Instagram Reel' },
  { id: 'ig_feed', platform: 'instagram', placement: 'feed', width: 1080, height: 1080, aspectRatio: '1:1', maxFileSizeMb: 100, maxDurationSec: 60, codec: 'libx264', videoBitrate: '5000k', audioBitrate: '128k', fps: 30, container: 'mp4', description: 'Instagram Feed' },
  { id: 'ig_story', platform: 'instagram', placement: 'story', width: 1080, height: 1920, aspectRatio: '9:16', maxFileSizeMb: 30, maxDurationSec: 15, codec: 'libx264', videoBitrate: '4000k', audioBitrate: '128k', fps: 30, container: 'mp4', description: 'Instagram Story' },
  { id: 'fb_feed', platform: 'facebook', placement: 'feed', width: 1920, height: 1080, aspectRatio: '16:9', maxFileSizeMb: 4000, maxDurationSec: 240, codec: 'libx264', videoBitrate: '8000k', audioBitrate: '256k', fps: 30, container: 'mp4', description: 'Facebook Feed' },
  { id: 'fb_reel', platform: 'facebook', placement: 'reel', width: 1080, height: 1920, aspectRatio: '9:16', maxFileSizeMb: 100, maxDurationSec: 60, codec: 'libx264', videoBitrate: '5000k', audioBitrate: '128k', fps: 30, container: 'mp4', description: 'Facebook Reel' },
  { id: 'tt_feed', platform: 'tiktok', placement: 'feed', width: 1080, height: 1920, aspectRatio: '9:16', maxFileSizeMb: 72, maxDurationSec: 60, codec: 'libx264', videoBitrate: '4000k', audioBitrate: '128k', fps: 30, container: 'mp4', description: 'TikTok Feed' },
  { id: 'tt_topview', platform: 'tiktok', placement: 'topview', width: 1080, height: 1920, aspectRatio: '9:16', maxFileSizeMb: 72, maxDurationSec: 60, codec: 'libx264', videoBitrate: '5000k', audioBitrate: '128k', fps: 30, container: 'mp4', description: 'TikTok TopView' },
];

export function getExportProfile(platform: string, placement: string): ExportProfile | undefined {
  return EXPORT_PROFILES.find(p => p.platform === platform && p.placement === placement);
}

export function getProfilesForPlatform(platform: string): ExportProfile[] {
  return EXPORT_PROFILES.filter(p => p.platform === platform);
}

export function getProfileById(id: string): ExportProfile | undefined {
  return EXPORT_PROFILES.find(p => p.id === id);
}
