/**
 * GIF Export
 * ═══════════════════════════════════════════════════════════════════════════════
 * Converts rendered scene clips or full stitched videos to optimized GIF.
 * Uses FFmpeg's two-pass palette approach for high-quality GIF output.
 *
 * Supports:
 *   - Single scene → GIF
 *   - Full video → GIF
 *   - Custom resolution scaling (default: 480px width)
 *   - Frame rate control (default: 15fps for GIF)
 *   - Loop control
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../../config/logger';
import type { SceneClipResult, AspectRatio } from '../types';

const execFileAsync = promisify(execFile);

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface GifExportOptions {
  /** Width in pixels. Height auto-calculated. Default 480. */
  width?: number;
  /** Frames per second. Default 15. */
  fps?: number;
  /** Loop count. 0 = infinite. Default 0. */
  loop?: number;
  /** Maximum duration in seconds (truncate if longer). Default: full length. */
  maxDurationSec?: number;
  /** Output directory. */
  outputDir: string;
  /** Output filename (without extension). */
  filename?: string;
}

export interface GifExportResult {
  gifPath: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FFmpeg helper
// ═══════════════════════════════════════════════════════════════════════════════

async function ffmpeg(args: string[], timeoutMs = 5 * 60 * 1000): Promise<void> {
  try {
    await execFileAsync('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 128 * 1024 * 1024 });
  } catch (err: any) {
    const msg = err.stderr?.slice(-500) || err.message;
    throw new Error(`FFmpeg GIF export error: ${msg}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Export a video file (MP4) to an optimized GIF using two-pass palette method.
 */
export async function exportToGif(
  inputPath: string,
  options: GifExportOptions,
): Promise<GifExportResult> {
  const width = options.width ?? 480;
  const fps = options.fps ?? 15;
  const loop = options.loop ?? 0;
  const filename = options.filename ?? 'output';

  await fs.mkdir(options.outputDir, { recursive: true });

  const palettePath = path.join(options.outputDir, `${filename}_palette.png`);
  const gifPath = path.join(options.outputDir, `${filename}.gif`);

  // Build filter string
  const scaleFilter = `scale=${width}:-1:flags=lanczos`;
  const fpsFilter = `fps=${fps}`;
  const durationArgs = options.maxDurationSec ? ['-t', String(options.maxDurationSec)] : [];

  try {
    // Pass 1: Generate palette
    await ffmpeg([
      '-y', '-i', inputPath,
      ...durationArgs,
      '-vf', `${fpsFilter},${scaleFilter},palettegen=stats_mode=diff`,
      palettePath,
    ]);

    // Pass 2: Render GIF using palette
    await ffmpeg([
      '-y', '-i', inputPath, '-i', palettePath,
      ...durationArgs,
      '-lavfi', `${fpsFilter},${scaleFilter} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      '-loop', String(loop),
      gifPath,
    ]);

    // Get file stats
    const stat = await fs.stat(gifPath);

    // Get dimensions via ffprobe
    let gifHeight = 0;
    let durationSec = 0;
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error', '-show_streams', '-show_format', '-of', 'json', gifPath,
      ], { timeout: 15_000 });
      const info = JSON.parse(stdout);
      const stream = info.streams?.[0];
      gifHeight = stream?.height || 0;
      durationSec = parseFloat(info.format?.duration || '0');
    } catch { /* non-fatal */ }

    logger.info(`[GifExport] Exported GIF: ${gifPath} (${(stat.size / 1024).toFixed(0)}KB, ${width}x${gifHeight}, ${durationSec.toFixed(1)}s)`);

    return {
      gifPath,
      fileSizeBytes: stat.size,
      width,
      height: gifHeight,
      durationSec,
      fps,
    };

  } finally {
    // Cleanup palette
    await fs.unlink(palettePath).catch(() => {});
  }
}

/**
 * Export a scene clip to GIF.
 */
export async function exportSceneToGif(
  clip: SceneClipResult,
  options: GifExportOptions,
): Promise<GifExportResult> {
  return exportToGif(clip.clipPath, {
    ...options,
    filename: options.filename ?? `scene_${clip.sceneId}`,
  });
}

/**
 * Export all scene clips as individual GIFs.
 */
export async function exportAllScenesToGif(
  clips: SceneClipResult[],
  options: GifExportOptions,
): Promise<GifExportResult[]> {
  const results: GifExportResult[] = [];

  for (const clip of clips) {
    try {
      const result = await exportSceneToGif(clip, options);
      results.push(result);
    } catch (err: any) {
      logger.warn(`[GifExport] Failed to export scene ${clip.sceneId} to GIF: ${err.message}`);
    }
  }

  return results;
}
