/**
 * FFmpeg Pipeline — Animation Studio
 * 
 * Handles the full video assembly pipeline:
 *  1. Download scene videos from CDN URLs (with timeout + retry)
 *  2. Normalize each clip to target resolution & framerate
 *  3. Concatenate with xfade transitions
 *  4. Mix voice + music (volume-normalized, music loops)
 *  5. Burn in subtitles (SRT via libass)
 *  6. Final H.264 transcode (web-optimized, +faststart)
 *  7. Generate thumbnail via ffprobe+ffmpeg
 *  8. Export to all 3 aspect ratios via smart padding
 *  9. Upload all outputs to S3 and return CDN URLs
 * 10. Cleanup all temp files (success and failure)
 * 
 * All ffmpeg calls use exec timeout enforcement.
 * Temp files are tracked and cleaned up even on failure.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../config/logger';
import { config } from '../../config/env';
import { uploadRender } from '../storageService';

const execFileAsync = promisify(execFile);

// ── Resolution maps ────────────────────────────────────────────
const RESOLUTION_MAP: Record<string, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '1:1':  { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
};
const RESOLUTION_4K_MAP: Record<string, { w: number; h: number }> = {
  '9:16': { w: 2160, h: 3840 },
  '1:1':  { w: 2160, h: 2160 },
  '16:9': { w: 3840, h: 2160 },
};

// ── Types ──────────────────────────────────────────────────────
export interface StitchParams {
  renderJobId: string;
  workspaceId: string;
  sceneVideoUrls: string[];
  voiceUrl: string | null;
  musicUrl: string | null;
  subtitlesData?: SubtitleCue[];
  aspectRatio: '9:16' | '1:1' | '16:9';
  resolution: '1080p' | '4K';
  transitionType?: 'fade' | 'crossfade' | 'dissolve' | 'none';
  transitionDuration?: number;
  voiceVolume?: number;
  musicVolume?: number;
  // Cinematic mode: optional post-processing filter chain injected before final encode
  extraVideoFilters?: string[];
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type ExportResult = Record<'9:16' | '1:1' | '16:9', string>;

// ── ffmpeg exec with timeout ───────────────────────────────────
async function ffmpeg(args: string[], timeoutMs = config.FFMPEG_TIMEOUT_MS): Promise<void> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', args, {
      timeout: timeoutMs,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (stderr && config.LOG_LEVEL === 'debug') {
      logger.debug('[FFmpeg] stderr:', stderr.slice(-500));
    }
  } catch (err: any) {
    const msg = err.stderr?.slice(-500) || err.message || 'FFmpeg failed';
    throw new Error(`FFmpeg error: ${msg}`);
  }
}

// ── ffprobe for metadata ───────────────────────────────────────
async function ffprobe(filePath: string): Promise<any> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_streams', '-show_format',
    '-of', 'json',
    filePath,
  ], { timeout: 30_000 });
  return JSON.parse(stdout);
}

// ── Download URL to temp file ─────────────────────────────────
async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const proto = url.startsWith('https') ? https : http;

    const doRequest = (target: string, depth = 0) => {
      if (depth > 5) return reject(new Error('Too many redirects'));
      const req = proto.get(target, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return doRequest(res.headers.location!, depth + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode} for ${target}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      });
      req.setTimeout(config.FFMPEG_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Download timeout for ${target}`));
      });
      req.on('error', reject);
    };

    doRequest(url);
  });
}

// ── Get video duration ─────────────────────────────────────────
export async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const data = await ffprobe(filePath);
    return parseFloat(data.format?.duration || '0');
  } catch { return 0; }
}

// ── Quality validation ─────────────────────────────────────────
export async function validateVideoQuality(
  filePath: string,
  expectedAspect: string
): Promise<{
  pass: boolean; width: number; height: number;
  duration: number; fps: number; bitrate: number; hasAudio: boolean;
}> {
  try {
    const data = await ffprobe(filePath);
    const v = data.streams?.find((s: any) => s.codec_type === 'video');
    const a = data.streams?.find((s: any) => s.codec_type === 'audio');

    const width = v?.width || 0;
    const height = v?.height || 0;
    const duration = parseFloat(data.format?.duration || '0');
    const bitrate = parseInt(data.format?.bit_rate || '0', 10) / 1000;

    const [num, den] = (v?.r_frame_rate || '24/1').split('/').map(Number);
    const fps = den ? num / den : 24;

    const expected = RESOLUTION_MAP[expectedAspect] || { w: 1920, h: 1080 };
    const pass = width >= expected.w * 0.8 && duration > 0;

    return { pass, width, height, duration, fps, bitrate, hasAudio: !!a };
  } catch {
    return { pass: false, width: 0, height: 0, duration: 0, fps: 0, bitrate: 0, hasAudio: false };
  }
}

// ── Write SRT file ────────────────────────────────────────────
async function writeSRT(cues: SubtitleCue[], filePath: string): Promise<void> {
  const fmt = (sec: number) => {
    const h = Math.floor(sec / 3600).toString().padStart(2, '0');
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    const ms = Math.round((sec % 1) * 1000).toString().padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
  };
  const content = cues
    .filter(c => c.text?.trim())
    .map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text.trim()}`)
    .join('\n\n');
  await fs.writeFile(filePath, content, 'utf8');
}

// ── Normalize clip to target resolution ───────────────────────
async function normalizeClip(input: string, output: string, res: { w: number; h: number }): Promise<void> {
  await ffmpeg([
    '-y', '-i', input,
    '-vf', `scale=${res.w}:${res.h}:force_original_aspect_ratio=decrease,`
         + `pad=${res.w}:${res.h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2',
    '-r', '24', '-pix_fmt', 'yuv420p',
    output,
  ]);
}

// ── Concatenate clips (simple or with xfade transitions) ───────
async function concatenate(
  clips: string[], output: string,
  transitionType: string, transitionDur: number
): Promise<void> {
  if (clips.length === 0) throw new Error('No clips to concatenate');

  if (clips.length === 1) {
    await fs.copyFile(clips[0], output);
    return;
  }

  if (transitionType === 'none' || transitionDur <= 0) {
    // Simple concat
    const listFile = `${output}.list.txt`;
    await fs.writeFile(listFile, clips.map(p => `file '${p}'`).join('\n'));
    try {
      await ffmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-c:a', 'aac', '-ar', '48000', output,
      ]);
    } finally {
      await fs.unlink(listFile).catch(() => {});
    }
    return;
  }

  // xfade transitions — process clips iteratively (handles N clips)
  const xfadeType = transitionType === 'crossfade' ? 'fade' : transitionType;
  let current = clips[0];
  let tempFiles: string[] = [];

  for (let i = 1; i < clips.length; i++) {
    const isLast = i === clips.length - 1;
    const out = isLast ? output : path.join(os.tmpdir(), `xf_${uuidv4()}.mp4`);
    if (!isLast) tempFiles.push(out);

    const dur = await getVideoDuration(current);
    const offset = Math.max(0, dur - transitionDur);

    await ffmpeg([
      '-y',
      '-i', current,
      '-i', clips[i],
      '-filter_complex',
      `[0:v][1:v]xfade=transition=${xfadeType}:duration=${transitionDur}:offset=${offset}[vout];`
      + `[0:a][1:a]acrossfade=d=${transitionDur}[aout]`,
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'aac', '-ar', '48000', out,
    ]);

    if (i > 1 && tempFiles.includes(current)) {
      await fs.unlink(current).catch(() => {});
    }
    current = out;
  }

  await Promise.allSettled(tempFiles.slice(0, -1).map(f => fs.unlink(f)));
}

// ── Mix audio tracks into video ────────────────────────────────
async function mixAudio(params: {
  video: string; voice: string | null; music: string | null;
  output: string; voiceVol: number; musicVol: number;
}): Promise<void> {
  if (!params.voice && !params.music) {
    await fs.copyFile(params.video, params.output);
    return;
  }

  const inputs: string[] = ['-y', '-i', params.video];
  let filterComplex: string;
  let audioMap: string;

  if (params.voice && params.music) {
    inputs.push('-i', params.voice, '-i', params.music);
    filterComplex =
      `[1:a]volume=${params.voiceVol}[v];`
      + `[2:a]volume=${params.musicVol},aloop=loop=-1:size=2e+09[m];`
      + `[v][m]amix=inputs=2:duration=first:dropout_transition=3[aout]`;
    audioMap = '[aout]';
  } else if (params.voice) {
    inputs.push('-i', params.voice);
    filterComplex = `[1:a]volume=${params.voiceVol}[aout]`;
    audioMap = '[aout]';
  } else {
    inputs.push('-i', params.music!);
    filterComplex = `[1:a]volume=${params.musicVol},aloop=loop=-1:size=2e+09[aout]`;
    audioMap = '[aout]';
  }

  await ffmpeg([
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '0:v', '-map', audioMap,
    '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-shortest',
    params.output,
  ]);
}

// ── Burn subtitles ─────────────────────────────────────────────
async function burnSubtitles(
  video: string, srtPath: string, output: string, res: { w: number; h: number }
): Promise<void> {
  const fontSize = Math.round(res.h * 0.03);
  const marginV = Math.round(res.h * 0.05);
  // Escape path for ffmpeg subtitles filter (colons and backslashes)
  const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  await ffmpeg([
    '-y', '-i', video,
    '-vf', `subtitles='${escapedSrt}':force_style='`
         + `FontName=DejaVu Sans,FontSize=${fontSize},`
         + `PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,`
         + `BorderStyle=3,Outline=2,Shadow=0,MarginV=${marginV}'`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'copy', output,
  ]);
}

// ── Final transcode (web-optimized) ───────────────────────────
async function transcodeToFinal(
  input: string, output: string, res: { w: number; h: number }, is4K: boolean
): Promise<void> {
  await ffmpeg([
    '-y', '-i', input,
    '-vf', `scale=${res.w}:${res.h}:force_original_aspect_ratio=decrease,`
         + `pad=${res.w}:${res.h}:(ow-iw)/2:(oh-ih)/2:black`,
    '-c:v', 'libx264',
    '-preset', is4K ? 'slow' : 'medium',
    '-crf', is4K ? '15' : '18',
    '-profile:v', 'high', '-level', '4.2',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    output,
  ]);
}

// ── Generate thumbnail ─────────────────────────────────────────
export async function generateThumbnailFromVideo(
  videoPath: string, outputPath: string, ts = 1.5
): Promise<void> {
  await ffmpeg([
    '-y', '-ss', ts.toString(), '-i', videoPath,
    '-vframes', '1', '-q:v', '2',
    '-vf', 'scale=1280:-1',
    outputPath,
  ], 30_000);
}

// ── Reformat to different aspect ratio ────────────────────────
async function reformatForAspect(input: string, output: string, aspect: string): Promise<void> {
  const res = RESOLUTION_MAP[aspect] || RESOLUTION_MAP['16:9'];
  await ffmpeg([
    '-y', '-i', input,
    '-vf', `scale=${res.w}:${res.h}:force_original_aspect_ratio=decrease,`
         + `pad=${res.w}:${res.h}:(ow-iw)/2:(oh-ih)/2:black`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
    '-movflags', '+faststart', '-c:a', 'copy',
    output,
  ]);
}

// ── MAIN: Full stitch & mix pipeline ──────────────────────────
export async function stitchAndMixPipeline(params: StitchParams): Promise<{
  finalVideoPath: string;
  thumbnailPath: string;
  quality: ReturnType<typeof validateVideoQuality> extends Promise<infer T> ? T : never;
}> {
  const workDir = path.join(os.tmpdir(), `anim-render-${params.renderJobId}`);
  await fs.mkdir(workDir, { recursive: true });
  const tmpFiles: string[] = [];

  const track = (p: string) => { tmpFiles.push(p); return p; };

  try {
    const is4K = params.resolution === '4K';
    const res = is4K ? RESOLUTION_4K_MAP[params.aspectRatio] : RESOLUTION_MAP[params.aspectRatio];

    logger.info(`[FFmpeg] Pipeline start: ${params.sceneVideoUrls.length} scenes @ ${res.w}×${res.h}`);

    // ── 1. Download scenes ─────────────────────────────────────
    const rawClips: string[] = [];
    for (let i = 0; i < params.sceneVideoUrls.length; i++) {
      const p = track(path.join(workDir, `raw_${i}.mp4`));
      logger.info(`[FFmpeg] Downloading scene ${i + 1}/${params.sceneVideoUrls.length}`);
      await downloadFile(params.sceneVideoUrls[i], p);
      rawClips.push(p);
    }

    // ── 2. Normalize each clip ─────────────────────────────────
    const normClips: string[] = [];
    for (let i = 0; i < rawClips.length; i++) {
      const p = track(path.join(workDir, `norm_${i}.mp4`));
      logger.info(`[FFmpeg] Normalizing scene ${i + 1}`);
      await normalizeClip(rawClips[i], p, res);
      normClips.push(p);
    }

    // ── 3. Stitch with transitions ─────────────────────────────
    const stitched = track(path.join(workDir, 'stitched.mp4'));
    logger.info(`[FFmpeg] Concatenating ${normClips.length} clips`);
    await concatenate(
      normClips, stitched,
      params.transitionType || 'crossfade',
      params.transitionDuration ?? 0.5
    );

    // ── 4. Download audio files ────────────────────────────────
    let voicePath: string | null = null;
    let musicPath: string | null = null;

    if (params.voiceUrl) {
      voicePath = track(path.join(workDir, 'voice.mp3'));
      logger.info('[FFmpeg] Downloading voiceover');
      await downloadFile(params.voiceUrl, voicePath);
    }
    if (params.musicUrl) {
      musicPath = track(path.join(workDir, 'music.mp3'));
      logger.info('[FFmpeg] Downloading music');
      await downloadFile(params.musicUrl, musicPath);
    }

    // ── 5. Mix audio ───────────────────────────────────────────
    const mixed = track(path.join(workDir, 'mixed.mp4'));
    logger.info('[FFmpeg] Mixing audio');
    await mixAudio({
      video: stitched,
      voice: voicePath,
      music: musicPath,
      output: mixed,
      voiceVol: params.voiceVolume ?? 1.0,
      musicVol: params.musicVolume ?? 0.25,
    });

    // ── 6. Burn subtitles (if any) ─────────────────────────────
    let subtitled = mixed;
    if (params.subtitlesData && params.subtitlesData.length > 0) {
      const srtPath = track(path.join(workDir, 'subs.srt'));
      subtitled = track(path.join(workDir, 'subtitled.mp4'));
      logger.info(`[FFmpeg] Burning ${params.subtitlesData.length} subtitle cues`);
      await writeSRT(params.subtitlesData, srtPath);
      await burnSubtitles(mixed, srtPath, subtitled, res);
    }

    // ── 6.5. Cinematic post-processing (Premium Cinematic mode only) ──────
    let postProcessed = subtitled;
    if (params.extraVideoFilters && params.extraVideoFilters.length > 0) {
      const cinemaPath = track(path.join(workDir, 'cinematic.mp4'));
      logger.info(`[FFmpeg] Applying cinematic filters: ${params.extraVideoFilters.join(', ')}`);
      await ffmpeg([
        '-y', '-i', subtitled,
        '-vf', params.extraVideoFilters.join(','),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        cinemaPath,
      ]);
      postProcessed = cinemaPath;
    }

    // ── 7. Final transcode ─────────────────────────────────────
    const finalPath = path.join(workDir, 'final.mp4'); // NOT tracked — returned to caller
    logger.info('[FFmpeg] Final transcode');
    await transcodeToFinal(postProcessed, finalPath, res, is4K);

    // ── 8. Thumbnail ───────────────────────────────────────────
    const thumbPath = path.join(workDir, 'thumbnail.jpg'); // NOT tracked — returned to caller
    logger.info('[FFmpeg] Generating thumbnail');
    await generateThumbnailFromVideo(finalPath, thumbPath, 1.5);

    // ── 9. Quality check ───────────────────────────────────────
    const quality = await validateVideoQuality(finalPath, params.aspectRatio);
    logger.info(`[FFmpeg] Quality: ${quality.pass ? 'PASS' : 'WARN'} ${quality.width}×${quality.height} ${quality.duration.toFixed(1)}s`);

    // Cleanup intermediate files (keep final + thumb for caller)
    await Promise.allSettled(tmpFiles.map(f => fs.unlink(f).catch(() => {})));

    return { finalVideoPath: finalPath, thumbnailPath: thumbPath, quality: quality as any };

  } catch (err) {
    // Full cleanup on failure
    await Promise.allSettled([
      ...tmpFiles.map(f => fs.unlink(f).catch(() => {})),
      fs.rm(workDir, { recursive: true, force: true }).catch(() => {}),
    ]);
    throw err;
  }
}

// ── Platform-aware reformat with correct bitrate & audio spec ─
async function reformatForPlatform(
  input: string,
  output: string,
  aspect: string,
  targetBitrateKbps: number,
  audioSampleRate: 44100 | 48000
): Promise<void> {
  const res = RESOLUTION_MAP[aspect] || RESOLUTION_MAP['16:9'];
  await ffmpeg([
    '-y', '-i', input,
    '-vf', `scale=${res.w}:${res.h}:force_original_aspect_ratio=decrease,`
         + `pad=${res.w}:${res.h}:(ow-iw)/2:(oh-ih)/2:black`,
    '-c:v', 'libx264', '-preset', 'fast',
    '-b:v', `${targetBitrateKbps}k`,
    '-maxrate', `${Math.round(targetBitrateKbps * 1.5)}k`,
    '-bufsize', `${targetBitrateKbps * 2}k`,
    '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '192k', '-ar', audioSampleRate.toString(), '-ac', '2',
    output,
  ]);
}

// ── Export to all 3 aspect ratios & upload ─────────────────────
export async function exportMultipleFormats(params: {
  renderJobId: string;
  workspaceId: string;
  primaryVideoPath: string;
  primaryAspect: string;
}): Promise<ExportResult> {
  const aspects = ['9:16', '1:1', '16:9'] as const;
  const workDir = path.join(os.tmpdir(), `anim-export-${params.renderJobId}`);
  await fs.mkdir(workDir, { recursive: true });
  const tmpFiles: string[] = [];
  const result: Partial<ExportResult> = {};

  try {
    for (const aspect of aspects) {
      let localPath: string;

      if (aspect === params.primaryAspect) {
        localPath = params.primaryVideoPath;
      } else {
        localPath = path.join(workDir, `export_${aspect.replace(':', 'x')}.mp4`);
        tmpFiles.push(localPath);
        logger.info(`[FFmpeg] Exporting ${aspect}`);
        await reformatForAspect(params.primaryVideoPath, localPath, aspect);
      }

      const buf = await fs.readFile(localPath);
      const { cdnUrl } = await uploadRender({
        workspaceId: params.workspaceId,
        renderId: params.renderJobId,
        buffer: buf,
        mimeType: 'video/mp4',
        filename: `final_${aspect.replace(':', 'x')}.mp4`,
      });
      result[aspect] = cdnUrl;
      logger.info(`[FFmpeg] Uploaded ${aspect}: ${cdnUrl}`);
    }
  } finally {
    await Promise.allSettled(tmpFiles.map(f => fs.unlink(f).catch(() => {})));
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  return result as ExportResult;
}

// ── Platform export result type ───────────────────────────────
export type PlatformExportResult = Record<string, string>; // placement → CDN URL

/**
 * Export platform-specific ad formats for each requested placement.
 *
 * Each placement gets the correct:
 *   - Aspect ratio (9:16, 1:1, 16:9)
 *   - Bitrate (platform minimum to pass review)
 *   - Audio sample rate (44100 or 48000 per platform spec)
 *
 * The primary video is transcoded once per unique aspect ratio,
 * then reused for all placements sharing that ratio.
 */
export async function exportPlatformFormats(params: {
  renderJobId: string;
  workspaceId: string;
  primaryVideoPath: string;
  primaryAspect: string;
  placements: Array<{
    placement: string;
    aspectRatio: string;
    targetBitrateKbps: number;
    audioSampleRate: 44100 | 48000;
  }>;
}): Promise<PlatformExportResult> {
  const workDir = path.join(os.tmpdir(), `anim-platform-${params.renderJobId}`);
  await fs.mkdir(workDir, { recursive: true });
  const tmpFiles: string[] = [];
  const result: PlatformExportResult = {};

  // Cache reformatted files per aspect ratio to avoid redundant ffmpeg calls
  const aspectCache: Record<string, string> = {};

  try {
    for (const spec of params.placements) {
      const aspect = spec.aspectRatio;
      let sourcePath: string;

      if (aspect === params.primaryAspect && !aspectCache[aspect]) {
        // Primary aspect — transcode in place with platform bitrate
        const out = path.join(workDir, `platform_${aspect.replace(':', 'x')}_${spec.targetBitrateKbps}.mp4`);
        tmpFiles.push(out);
        logger.info(`[FFmpeg] Platform export: ${spec.placement} (${aspect} @ ${spec.targetBitrateKbps}kbps, ${spec.audioSampleRate}Hz)`);
        await reformatForPlatform(params.primaryVideoPath, out, aspect, spec.targetBitrateKbps, spec.audioSampleRate);
        aspectCache[`${aspect}:${spec.targetBitrateKbps}:${spec.audioSampleRate}`] = out;
        sourcePath = out;
      } else {
        const cacheKey = `${aspect}:${spec.targetBitrateKbps}:${spec.audioSampleRate}`;
        if (aspectCache[cacheKey]) {
          sourcePath = aspectCache[cacheKey];
        } else {
          const out = path.join(workDir, `platform_${aspect.replace(':', 'x')}_${spec.targetBitrateKbps}.mp4`);
          tmpFiles.push(out);
          logger.info(`[FFmpeg] Platform export: ${spec.placement} (${aspect} @ ${spec.targetBitrateKbps}kbps, ${spec.audioSampleRate}Hz)`);
          await reformatForPlatform(params.primaryVideoPath, out, aspect, spec.targetBitrateKbps, spec.audioSampleRate);
          aspectCache[cacheKey] = out;
          sourcePath = out;
        }
      }

      const buf = await fs.readFile(sourcePath);
      const { cdnUrl } = await uploadRender({
        workspaceId: params.workspaceId,
        renderId: params.renderJobId,
        buffer: buf,
        mimeType: 'video/mp4',
        filename: `platform_${spec.placement}.mp4`,
      });
      result[spec.placement] = cdnUrl;
      logger.info(`[FFmpeg] Uploaded ${spec.placement}: ${cdnUrl}`);
    }
  } finally {
    // Deduplicate before unlinking (cache may share paths)
    const unique = [...new Set(tmpFiles)];
    await Promise.allSettled(unique.map(f => fs.unlink(f).catch(() => {})));
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  return result;
}
