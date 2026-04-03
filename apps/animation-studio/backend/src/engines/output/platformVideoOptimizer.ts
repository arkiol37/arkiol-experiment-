import type { Platform } from '../types';
export interface PlatformExportSpec { platform: Platform; placement: string; width: number; height: number; maxFileSizeMb: number; maxDurationSec: number; codec: string; audioBitrate: string; videoBitrate: string; fps: number; container: string; }
const S: Record<string, PlatformExportSpec> = {
  youtube_instream: { platform: 'youtube', placement: 'instream', width: 1920, height: 1080, maxFileSizeMb: 256, maxDurationSec: 60, codec: 'libx264', audioBitrate: '256k', videoBitrate: '8000k', fps: 30, container: 'mp4' },
  youtube_shorts: { platform: 'youtube', placement: 'shorts', width: 1080, height: 1920, maxFileSizeMb: 256, maxDurationSec: 60, codec: 'libx264', audioBitrate: '256k', videoBitrate: '6000k', fps: 30, container: 'mp4' },
  instagram_reel: { platform: 'instagram', placement: 'reel', width: 1080, height: 1920, maxFileSizeMb: 100, maxDurationSec: 90, codec: 'libx264', audioBitrate: '128k', videoBitrate: '5000k', fps: 30, container: 'mp4' },
  instagram_feed: { platform: 'instagram', placement: 'feed', width: 1080, height: 1080, maxFileSizeMb: 100, maxDurationSec: 60, codec: 'libx264', audioBitrate: '128k', videoBitrate: '5000k', fps: 30, container: 'mp4' },
  instagram_story: { platform: 'instagram', placement: 'story', width: 1080, height: 1920, maxFileSizeMb: 30, maxDurationSec: 15, codec: 'libx264', audioBitrate: '128k', videoBitrate: '4000k', fps: 30, container: 'mp4' },
  facebook_feed: { platform: 'facebook', placement: 'feed', width: 1920, height: 1080, maxFileSizeMb: 4000, maxDurationSec: 240, codec: 'libx264', audioBitrate: '256k', videoBitrate: '8000k', fps: 30, container: 'mp4' },
  facebook_reel: { platform: 'facebook', placement: 'reel', width: 1080, height: 1920, maxFileSizeMb: 100, maxDurationSec: 60, codec: 'libx264', audioBitrate: '128k', videoBitrate: '5000k', fps: 30, container: 'mp4' },
  tiktok_feed: { platform: 'tiktok', placement: 'feed', width: 1080, height: 1920, maxFileSizeMb: 72, maxDurationSec: 60, codec: 'libx264', audioBitrate: '128k', videoBitrate: '4000k', fps: 30, container: 'mp4' },
  tiktok_topview: { platform: 'tiktok', placement: 'topview', width: 1080, height: 1920, maxFileSizeMb: 72, maxDurationSec: 60, codec: 'libx264', audioBitrate: '128k', videoBitrate: '5000k', fps: 30, container: 'mp4' },
};
export function getPlatformSpec(placement: string): PlatformExportSpec | null { return S[placement] || null; }
export function getAllPlatformSpecs(): PlatformExportSpec[] { return Object.values(S); }
export function buildFfmpegExportArgs(spec: PlatformExportSpec): string[] { return ['-c:v', spec.codec, '-b:v', spec.videoBitrate, '-c:a', 'aac', '-b:a', spec.audioBitrate, '-r', String(spec.fps), '-s', `${spec.width}x${spec.height}`, '-movflags', '+faststart', '-f', spec.container]; }
