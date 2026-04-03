/**
 * Internal Render Pipeline
 * ═══════════════════════════════════════════════════════════════════════════════
 * Top-level entry point for the template-driven rendering engine.
 *
 * Pipeline:
 *   1. Bridge: orchestrator output → SceneBindings
 *   2. Render: each scene → individual MP4 clip (via sceneClipRenderer)
 *   3. Stitch: concatenate clips + transitions via FFmpeg
 *   4. Audio: mix voice + music via FFmpeg
 *   5. Export: generate all aspect ratio variants
 *   6. Upload: push to S3, return CDN URLs
 *
 * This replaces the external provider path (ProviderAdapter → Runway/Pika/Sora)
 * while keeping FFmpeg as the assembly/export layer.
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../config/logger';
import type {
  InternalRenderResult, SceneClipResult, AspectRatio, ExecutableTemplate, SceneBindings,
} from '../types';
import type { PipelineContext } from '../../orchestrator/intelligenceOrchestrator';
import { renderAllSceneClips, renderScenePreview } from '../core/sceneClipRenderer';
import { bridgePipelineToRenderer, bridgeSimpleScene, type BridgeInput } from '../integrationBridge';
import { clearAssetCache } from '../assets/assetPipeline';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface InternalRenderOptions {
  renderJobId: string;
  workspaceId: string;
  /** Frames per second. Default 24. */
  fps?: number;
  /** H.264 quality (CRF). Default 18. */
  crf?: number;
  /** Encoding speed. Default 'medium'. */
  preset?: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow';
  /** Voice audio URL (optional). */
  voiceUrl?: string | null;
  /** Music audio URL (optional). */
  musicUrl?: string | null;
  /** Subtitle cues (optional). */
  subtitles?: Array<{ start: number; end: number; text: string }>;
  /** Voice volume (0–1). Default 1. */
  voiceVolume?: number;
  /** Music volume (0–1). Default 0.3. */
  musicVolume?: number;
  /** Transition between scenes. Default 'crossfade'. */
  transitionType?: 'fade' | 'crossfade' | 'dissolve' | 'none';
  /** Transition duration in seconds. Default 0.5. */
  transitionDuration?: number;
  /** Export to all 3 aspect ratios? Default false (only primary). */
  exportAllAspects?: boolean;
  /** Also export as GIF? Default false. */
  exportGif?: boolean;
  /** GIF export width (px). Default 480. */
  gifWidth?: number;
  /** Progress callback. */
  onProgress?: (stage: string, progress: number) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN RENDER FUNCTION — FROM PIPELINE CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Full internal render from an orchestrator PipelineContext.
 * This is the primary entry point when replacing the external provider path.
 */
export async function runInternalRender(
  bridgeInput: BridgeInput,
  options: InternalRenderOptions,
): Promise<InternalRenderResult> {
  const startTime = Date.now();
  const { renderJobId } = options;
  const fps = options.fps ?? 24;

  logger.info(`[InternalPipeline] Starting internal render ${renderJobId}`);
  options.onProgress?.('bridge', 0);

  // 1. Bridge orchestrator output to scene bindings
  const { scenes } = bridgePipelineToRenderer(bridgeInput);

  if (scenes.length === 0) {
    throw new Error('No scenes to render');
  }

  // 2. Create work directory
  const workDir = path.join(os.tmpdir(), `arkiol-render-${renderJobId}-${uuidv4().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    // 3. Render all scene clips
    options.onProgress?.('rendering', 0.1);

    const clips = await renderAllSceneClips(scenes, {
      outputDir: path.join(workDir, 'clips'),
      fps,
      crf: options.crf,
      preset: options.preset,
      onProgress: (frame, total) => {
        options.onProgress?.('rendering', 0.1 + 0.6 * (frame / total));
      },
    });

    logger.info(`[InternalPipeline] ${clips.length} scene clips rendered`, { renderJobId });

    // 3b. QC validation of rendered clips
    options.onProgress?.('validating', 0.68);
    try {
      const { validateAllScenes } = await import('./core/sceneQCValidator');
      const qcResult = await validateAllScenes(clips, scenes);
      logger.info(`[InternalPipeline] QC validation: score=${qcResult.overallScore}, allPassed=${qcResult.allPassed}`, { renderJobId });
      if (!qcResult.allPassed) {
        const failedScenes = qcResult.results.filter(r => !r.passed);
        for (const failed of failedScenes) {
          logger.warn(`[InternalPipeline] QC failed for scene ${failed.sceneId}:`, {
            score: failed.score,
            issues: failed.issues.filter(i => i.severity === 'critical' || i.severity === 'error'),
          });
        }
        // Don't block rendering — log warnings and continue
      }
    } catch (qcErr: any) {
      logger.warn(`[InternalPipeline] QC validation skipped: ${qcErr.message}`);
    }

    // 4. Stitch clips together
    options.onProgress?.('stitching', 0.7);

    const stitchedPath = path.join(workDir, 'stitched.mp4');
    await stitchClips(clips, stitchedPath, options);

    // 5. Mix audio (voice + music)
    options.onProgress?.('mixing', 0.8);

    const mixedPath = path.join(workDir, 'mixed.mp4');
    const hasAudio = options.voiceUrl || options.musicUrl;
    if (hasAudio) {
      await mixAudio(stitchedPath, mixedPath, options);
    } else {
      await fs.copyFile(stitchedPath, mixedPath);
    }

    // 6. Burn subtitles (if provided)
    let finalPath = mixedPath;
    if (options.subtitles && options.subtitles.length > 0) {
      const subtitledPath = path.join(workDir, 'subtitled.mp4');
      await burnSubtitles(mixedPath, subtitledPath, options.subtitles, workDir);
      finalPath = subtitledPath;
    }

    // 7. Export multi-aspect (optional)
    options.onProgress?.('exporting', 0.9);

    const exports: Partial<Record<AspectRatio, string>> = {};
    const primaryAspect = bridgeInput.pipelineCtx.intent.aspectRatio as AspectRatio;
    exports[primaryAspect] = finalPath;

    if (options.exportAllAspects) {
      const otherAspects: AspectRatio[] = (['9:16', '1:1', '16:9'] as AspectRatio[])
        .filter(a => a !== primaryAspect);

      for (const aspect of otherAspects) {
        const exportPath = path.join(workDir, `export_${aspect.replace(':', 'x')}.mp4`);
        await reframeForAspect(finalPath, exportPath, aspect);
        exports[aspect] = exportPath;
      }
    }

    // 7b. GIF export (optional)
    let gifPath: string | undefined;
    if (options.exportGif) {
      try {
        const { exportToGif } = await import('./core/gifExport');
        const gifResult = await exportToGif(finalPath, {
          outputDir: workDir,
          filename: `render_${renderJobId}`,
          width: options.gifWidth ?? 480,
          fps: 15,
          maxDurationSec: 15,
        });
        gifPath = gifResult.gifPath;
        logger.info(`[InternalPipeline] GIF exported: ${gifResult.fileSizeBytes} bytes`, { renderJobId });
      } catch (gifErr: any) {
        logger.warn(`[InternalPipeline] GIF export failed (non-fatal): ${gifErr.message}`);
      }
    }

    // Calculate totals
    const totalDurationMs = clips.reduce((sum, c) => sum + c.durationMs, 0);
    const totalFrames = clips.reduce((sum, c) => sum + c.frameCount, 0);
    const renderTimeMs = Date.now() - startTime;

    options.onProgress?.('complete', 1);

    logger.info(`[InternalPipeline] Render ${renderJobId} complete`, {
      scenes: clips.length,
      totalFrames,
      totalDurationMs,
      renderTimeMs,
      fpsEffective: Math.round(totalFrames / (renderTimeMs / 1000)),
      hasGif: !!gifPath,
    });

    return {
      renderJobId,
      clips,
      stitchedPath: finalPath,
      exports,
      gifPath,           // v27: GIF path wired into result
      totalDurationMs,
      totalFrames,
      renderTimeMs,
    };

  } catch (err) {
    // Cleanup on failure
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Simplified render — directly from scene definitions, no pipeline context needed.
 */
export async function renderDirect(
  scenes: Array<{ template: ExecutableTemplate; bindings: SceneBindings }>,
  options: InternalRenderOptions,
): Promise<InternalRenderResult> {
  const startTime = Date.now();
  const { renderJobId } = options;
  const fps = options.fps ?? 24;

  const workDir = path.join(os.tmpdir(), `arkiol-render-${renderJobId}-${uuidv4().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const clips = await renderAllSceneClips(scenes, {
      outputDir: path.join(workDir, 'clips'),
      fps,
      crf: options.crf,
      preset: options.preset,
    });

    const stitchedPath = path.join(workDir, 'stitched.mp4');
    await stitchClips(clips, stitchedPath, options);

    const totalDurationMs = clips.reduce((sum, c) => sum + c.durationMs, 0);
    const totalFrames = clips.reduce((sum, c) => sum + c.frameCount, 0);

    return {
      renderJobId,
      clips,
      stitchedPath,
      exports: {},
      totalDurationMs,
      totalFrames,
      renderTimeMs: Date.now() - startTime,
    };
  } finally {
    clearAssetCache();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FFmpeg STITCH / AUDIO MIX / SUBTITLE / EXPORT (assembly layer)
// ═══════════════════════════════════════════════════════════════════════════════

import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

async function ffmpeg(args: string[], timeoutMs = 10 * 60 * 1000): Promise<void> {
  try {
    await execFileAsync('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
  } catch (err: any) {
    const msg = err.stderr?.slice(-500) || err.message || 'FFmpeg failed';
    throw new Error(`FFmpeg error: ${msg}`);
  }
}

/**
 * Stitch scene clips together with optional transitions.
 */
async function stitchClips(
  clips: SceneClipResult[],
  outputPath: string,
  options: InternalRenderOptions,
): Promise<void> {
  if (clips.length === 0) throw new Error('No clips to stitch');

  if (clips.length === 1) {
    // Single clip — just copy
    await fs.copyFile(clips[0].clipPath, outputPath);
    return;
  }

  const transitionType = options.transitionType ?? 'crossfade';
  const transitionDur = options.transitionDuration ?? 0.5;

  if (transitionType === 'none' || transitionDur <= 0) {
    // Simple concatenation
    const listFile = outputPath + '.list.txt';
    const content = clips.map(c => `file '${c.clipPath}'`).join('\n');
    await fs.writeFile(listFile, content, 'utf8');

    await ffmpeg([
      '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c', 'copy', '-movflags', '+faststart', outputPath,
    ]);

    await fs.unlink(listFile).catch(() => {});
    return;
  }

  // xfade transitions between clips
  // Build complex filter graph
  const inputs: string[] = [];
  clips.forEach(c => inputs.push('-i', c.clipPath));

  if (clips.length === 2) {
    // Simple 2-clip xfade
    const offset = Math.max(0, (clips[0].durationMs / 1000) - transitionDur);
    await ffmpeg([
      '-y', ...inputs,
      '-filter_complex',
      `[0:v][1:v]xfade=transition=${transitionType === 'crossfade' ? 'fade' : transitionType}:duration=${transitionDur}:offset=${offset}[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', outputPath,
    ]);
    return;
  }

  // Multi-clip xfade chain
  let filterComplex = '';
  let lastOutput = '0:v';
  let cumulativeOffset = 0;

  for (let i = 1; i < clips.length; i++) {
    cumulativeOffset += (clips[i - 1].durationMs / 1000) - transitionDur;
    const outLabel = i < clips.length - 1 ? `v${i}` : 'v';
    filterComplex += `[${lastOutput}][${i}:v]xfade=transition=fade:duration=${transitionDur}:offset=${Math.max(0, cumulativeOffset)}[${outLabel}];`;
    lastOutput = outLabel;
  }

  // Remove trailing semicolon
  filterComplex = filterComplex.replace(/;$/, '');

  await ffmpeg([
    '-y', ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', outputPath,
  ]);
}

/**
 * Mix voice and music audio tracks.
 */
async function mixAudio(
  videoPath: string,
  outputPath: string,
  options: InternalRenderOptions,
): Promise<void> {
  const inputs = ['-i', videoPath];
  const filterParts: string[] = [];
  let audioStreams = 0;

  if (options.voiceUrl) {
    inputs.push('-i', options.voiceUrl);
    const vol = options.voiceVolume ?? 1.0;
    filterParts.push(`[${audioStreams + 1}:a]volume=${vol}[voice]`);
    audioStreams++;
  }

  if (options.musicUrl) {
    inputs.push('-i', options.musicUrl);
    const vol = options.musicVolume ?? 0.3;
    filterParts.push(`[${audioStreams + 1}:a]volume=${vol},aloop=loop=-1:size=2e+09[music]`);
    audioStreams++;
  }

  if (audioStreams === 0) {
    await fs.copyFile(videoPath, outputPath);
    return;
  }

  // Build amix filter
  const mixInputs = [];
  if (options.voiceUrl) mixInputs.push('[voice]');
  if (options.musicUrl) mixInputs.push('[music]');

  if (mixInputs.length === 1) {
    filterParts.push(`${mixInputs[0]}anull[aout]`);
  } else {
    filterParts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=2[aout]`);
  }

  const filterComplex = filterParts.join(';');

  await ffmpeg([
    '-y', ...inputs,
    '-filter_complex', filterComplex,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
    '-shortest', '-movflags', '+faststart', outputPath,
  ]);
}

/**
 * Burn subtitles into video.
 */
async function burnSubtitles(
  videoPath: string,
  outputPath: string,
  subtitles: Array<{ start: number; end: number; text: string }>,
  workDir: string,
): Promise<void> {
  // Write SRT file
  const srtPath = path.join(workDir, 'subtitles.srt');
  const fmt = (sec: number) => {
    const h = Math.floor(sec / 3600).toString().padStart(2, '0');
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    const ms = Math.round((sec % 1) * 1000).toString().padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
  };
  const content = subtitles
    .filter(c => c.text?.trim())
    .map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text.trim()}`)
    .join('\n\n');
  await fs.writeFile(srtPath, content, 'utf8');

  // Burn with libass
  const escapedPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  await ffmpeg([
    '-y', '-i', videoPath,
    '-vf', `subtitles='${escapedPath}':force_style='FontSize=24,PrimaryColour=&HFFFFFF&,Alignment=2,MarginV=40'`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'copy', '-movflags', '+faststart', outputPath,
  ]);
}

/**
 * Reframe video to a different aspect ratio using smart padding.
 */
async function reframeForAspect(
  inputPath: string,
  outputPath: string,
  targetAspect: AspectRatio,
): Promise<void> {
  const resMap: Record<AspectRatio, { w: number; h: number }> = {
    '9:16': { w: 1080, h: 1920 },
    '1:1':  { w: 1080, h: 1080 },
    '16:9': { w: 1920, h: 1080 },
  };
  const { w, h } = resMap[targetAspect];

  await ffmpeg([
    '-y', '-i', inputPath,
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', outputPath,
  ]);
}
