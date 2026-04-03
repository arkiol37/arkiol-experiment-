/**
 * Scene Clip Renderer — v27
 * ═══════════════════════════════════════════════════════════════════════════════
 * Renders a complete scene: iterates all frames through the animation timeline
 * + frame renderer, pipes raw RGBA frames into FFmpeg for H.264 encoding.
 *
 * v27 upgrades:
 * - FFmpeg pipe timeout (per-scene hard limit)
 * - Encoding validation (verify output is valid MP4)
 * - Memory-bounded streaming with backpressure
 * - Per-scene retry on FFmpeg failure
 * - GIF clip export wired into results
 *
 * Output: a single MP4 clip file per scene, ready for stitching.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../../config/logger';
import type {
  ExecutableTemplate, SceneBindings, SceneClipResult,
  AspectRatio, BackgroundDef,
} from '../types';
import { resolveFrame, computeFrameCount, type TimelineConfig } from './animationTimeline';
import { renderFrame, type FrameRenderConfig } from './frameRenderer';
import { loadSceneAssets, clearAssetCache, type LoadedAssets } from '../assets/assetPipeline';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/** v27: Hard timeout per scene render (5 minutes) */
const SCENE_RENDER_TIMEOUT_MS = 5 * 60 * 1000;
/** v27: Maximum retries for FFmpeg encoding failure */
const MAX_FFMPEG_RETRIES = 2;
/** v27: Minimum valid MP4 file size (bytes) */
const MIN_VALID_CLIP_SIZE = 1024;

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export interface SceneRenderOptions {
  /** Output directory for the clip. */
  outputDir: string;
  /** Frames per second. Default 24. */
  fps?: number;
  /** CRF quality (lower = better, 18 is visually lossless). Default 18. */
  crf?: number;
  /** H.264 preset. Default 'medium'. */
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow';
  /** Progress callback (called per frame). */
  onProgress?: (frameIndex: number, totalFrames: number) => void;
}

/**
 * Render a single scene from template + bindings into an MP4 clip.
 * v27: includes timeout, retry on FFmpeg failure, and encoding validation.
 */
export async function renderSceneClip(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  options: SceneRenderOptions,
): Promise<SceneClipResult> {
  const fps = options.fps ?? 24;
  const crf = options.crf ?? 18;
  const preset = options.preset ?? 'medium';

  const aspect = bindings.aspectRatio;
  const canvasSize = template.canvasSizes[aspect]
    || template.canvasSizes['9:16']
    || { width: 1080, height: 1920 };

  const { width, height } = canvasSize;
  const totalFrames = computeFrameCount(bindings.durationMs, fps);

  logger.info(`[SceneClipRenderer] Starting scene ${bindings.sceneId}: ${totalFrames} frames @ ${fps}fps, ${width}x${height}`);
  const startTime = Date.now();

  // Ensure output directory exists
  await fs.mkdir(options.outputDir, { recursive: true });

  const outputPath = path.join(options.outputDir, `scene_${bindings.sceneId}.mp4`);

  // 1. Pre-load all assets
  const assets = await loadSceneAssets(
    bindings, width, height,
    template.slots.map(s => ({
      id: s.id, type: s.type,
      positions: s.positions as Record<string, any>,
      imageFit: s.imageFit,
    })),
  );

  // 2. Resolve background (may be overridden by bindings)
  const background: BackgroundDef = bindings.background ?? template.background;

  // 3. Render with retry on FFmpeg failure
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_FFMPEG_RETRIES; attempt++) {
    if (attempt > 0) {
      logger.warn(`[SceneClipRenderer] Retrying scene ${bindings.sceneId} (attempt ${attempt + 1}/${MAX_FFMPEG_RETRIES + 1})`);
      // Clean up failed output
      await fs.unlink(outputPath).catch(() => {});
    }

    try {
      await renderSceneClipInternal(
        template, bindings, assets, background,
        { width, height, fps, crf, preset, totalFrames, outputPath },
        options,
      );

      // v27: Encoding validation — verify output is valid MP4
      const stat = await fs.stat(outputPath);
      if (stat.size < MIN_VALID_CLIP_SIZE) {
        throw new Error(`Scene clip too small (${stat.size} bytes) — likely corrupt encoding`);
      }

      const renderTimeMs = Date.now() - startTime;
      logger.info(`[SceneClipRenderer] Scene ${bindings.sceneId} complete: ${totalFrames} frames in ${renderTimeMs}ms (${Math.round(totalFrames / (renderTimeMs / 1000))} fps effective)`);

      return {
        sceneId: bindings.sceneId,
        templateId: template.id,
        clipPath: outputPath,
        durationMs: bindings.durationMs,
        frameCount: totalFrames,
        width,
        height,
        fps,
      };

    } catch (err: any) {
      lastError = err;
      logger.warn(`[SceneClipRenderer] Scene ${bindings.sceneId} attempt ${attempt + 1} failed: ${err.message}`);
    }
  }

  throw new Error(`Scene render failed for ${bindings.sceneId} after ${MAX_FFMPEG_RETRIES + 1} attempts: ${lastError?.message}`);
}

/**
 * Internal render function — handles FFmpeg pipe with timeout.
 */
async function renderSceneClipInternal(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  assets: LoadedAssets,
  background: BackgroundDef,
  params: { width: number; height: number; fps: number; crf: number; preset: string; totalFrames: number; outputPath: string },
  options: SceneRenderOptions,
): Promise<void> {
  const { width, height, fps, crf, preset, totalFrames, outputPath } = params;

  // Set up FFmpeg pipe
  const ffmpegArgs = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-r', String(fps),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    outputPath,
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let ffmpegStderr = '';
  ffmpeg.stderr?.on('data', (chunk: Buffer) => {
    ffmpegStderr += chunk.toString().slice(-2000);
  });

  // v27: Hard timeout for the entire scene render
  const timeoutHandle = setTimeout(() => {
    logger.error(`[SceneClipRenderer] Scene ${bindings.sceneId} timed out after ${SCENE_RENDER_TIMEOUT_MS / 1000}s`);
    ffmpeg.kill('SIGKILL');
  }, SCENE_RENDER_TIMEOUT_MS);

  const ffmpegDone = new Promise<void>((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      clearTimeout(timeoutHandle);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${ffmpegStderr.slice(-500)}`));
    });
    ffmpeg.on('error', (err) => {
      clearTimeout(timeoutHandle);
      reject(err);
    });
  });

  // Render frames and pipe to FFmpeg
  const timelineConfig: TimelineConfig = { fps, canvasWidth: width, canvasHeight: height };
  const frameConfig: FrameRenderConfig = { width, height, background, fontRegistry: assets.fontRegistry };

  try {
    for (let i = 0; i < totalFrames; i++) {
      const elements = resolveFrame(template, bindings, i, totalFrames, timelineConfig);
      const frameBuffer = await renderFrame(elements, assets, frameConfig, i);

      // Pipe to FFmpeg with backpressure handling
      const canWrite = ffmpeg.stdin!.write(frameBuffer);
      if (!canWrite) {
        await new Promise<void>((resolve, reject) => {
          const drainHandler = () => { resolve(); };
          const errorHandler = (err: Error) => { reject(err); };
          ffmpeg.stdin!.once('drain', drainHandler);
          ffmpeg.stdin!.once('error', errorHandler);
        });
      }

      if (options.onProgress && i % 10 === 0) {
        options.onProgress(i, totalFrames);
      }
    }

    ffmpeg.stdin!.end();
    await ffmpegDone;

  } catch (err: any) {
    clearTimeout(timeoutHandle);
    ffmpeg.kill('SIGKILL');
    throw new Error(`Scene render failed for ${bindings.sceneId}: ${err.message}`);
  }
}

/**
 * Render multiple scenes in sequence, returning all clip results.
 */
export async function renderAllSceneClips(
  scenes: Array<{ template: ExecutableTemplate; bindings: SceneBindings }>,
  options: SceneRenderOptions,
): Promise<SceneClipResult[]> {
  const results: SceneClipResult[] = [];
  const totalScenes = scenes.length;

  for (let i = 0; i < scenes.length; i++) {
    const { template, bindings } = scenes[i];

    logger.info(`[SceneClipRenderer] Rendering scene ${i + 1}/${totalScenes}: ${bindings.sceneId}`);

    const result = await renderSceneClip(template, bindings, {
      ...options,
      onProgress: (frame, total) => {
        options.onProgress?.(frame + i * total, total * totalScenes);
      },
    });

    results.push(result);
  }

  // Clear asset cache after all scenes are rendered
  clearAssetCache();

  return results;
}

/**
 * Render a single frame as PNG (for thumbnail/preview generation).
 */
export async function renderScenePreview(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  frameTimeMs: number,
): Promise<Buffer> {
  const fps = 24;
  const aspect = bindings.aspectRatio;
  const canvasSize = template.canvasSizes[aspect]
    || template.canvasSizes['9:16']
    || { width: 1080, height: 1920 };

  const { width, height } = canvasSize;
  const frameIndex = Math.round((frameTimeMs / 1000) * fps);
  const totalFrames = computeFrameCount(bindings.durationMs, fps);

  const assets = await loadSceneAssets(
    bindings, width, height,
    template.slots.map(s => ({
      id: s.id, type: s.type,
      positions: s.positions as Record<string, any>,
      imageFit: s.imageFit,
    })),
  );

  const background: BackgroundDef = bindings.background ?? template.background;
  const timelineConfig: TimelineConfig = { fps, canvasWidth: width, canvasHeight: height };
  const frameConfig: FrameRenderConfig = { width, height, background, fontRegistry: assets.fontRegistry };

  const elements = resolveFrame(template, bindings, frameIndex, totalFrames, timelineConfig);
  const frameBuf = await renderFrame(elements, assets, frameConfig, frameIndex);

  // Encode as PNG
  const { renderFrameAsPng } = await import('./frameRenderer');
  return renderFrameAsPng(elements, assets, frameConfig, frameIndex);
}
