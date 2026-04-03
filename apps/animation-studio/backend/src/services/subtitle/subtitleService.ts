/**
 * Subtitle Generation Service — Animation Studio
 * 
 * Produces SubtitleCue[] (start/end/text) for FFmpeg SRT burn-in.
 * Strategy:
 *  1. Try ElevenLabs /with-timestamps for word-accurate timing
 *  2. Fall back to proportional word-distribution across scene duration
 */
import { logger } from '../../config/logger';
import { config } from '../../config/env';
import type { SubtitleCue } from '../ffmpeg/ffmpegPipeline';
import type { SceneData } from '../../jobs/renderQueue';

// ── ElevenLabs word-timed subtitles ───────────────────────────
async function getElevenLabsTimings(text: string, voiceId: string): Promise<SubtitleCue[] | null> {
  if (!config.ELEVENLABS_API_KEY) return null;

  try {
    const res = await fetch(
      `${config.ELEVENLABS_API_URL}/text-to-speech/${voiceId}/with-timestamps`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': config.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
        }),
        signal: AbortSignal.timeout(120_000),
      }
    );

    if (!res.ok) return null;
    const data = await res.json() as any;
    const al = data.alignment;
    if (!al?.characters || !al.character_start_times_seconds) return null;

    // Build word array from character alignment
    const words: { word: string; start: number; end: number }[] = [];
    let word = '';
    let wordStart = 0;

    for (let i = 0; i < al.characters.length; i++) {
      const ch: string = al.characters[i];
      const st: number = al.character_start_times_seconds[i];
      const en: number = al.character_end_times_seconds[i];

      if (ch === ' ' || i === al.characters.length - 1) {
        if (ch !== ' ') word += ch;
        if (word.trim()) words.push({ word: word.trim(), start: wordStart, end: en });
        word = '';
        wordStart = i < al.characters.length - 1 ? al.character_start_times_seconds[i + 1] : en;
      } else {
        if (!word) wordStart = st;
        word += ch;
      }
    }

    // Group into cues (≤7 words, ≤3 seconds)
    const cues: SubtitleCue[] = [];
    const MAX_WORDS = 7;
    const MAX_DUR = 3;

    for (let i = 0; i < words.length; ) {
      let j = i;
      while (j < words.length && j - i < MAX_WORDS && words[j].end - words[i].start < MAX_DUR) j++;
      if (j === i) j = i + 1; // Always advance at least 1

      const group = words.slice(i, j);
      cues.push({
        start: group[0].start,
        end: group[group.length - 1].end,
        text: group.map(w => w.word).join(' '),
      });
      i = j;
    }

    return cues;
  } catch (err: any) {
    logger.warn(`[Subtitles] ElevenLabs timing failed: ${err.message}`);
    return null;
  }
}

// ── Fallback: proportional distribution ───────────────────────
function distributeFallback(scenes: SceneData[], totalDuration: number): SubtitleCue[] {
  const scripts = scenes
    .sort((a, b) => a.position - b.position)
    .map(s => s.voiceoverScript?.trim())
    .filter(Boolean) as string[];

  if (!scripts.length) return [];

  const allWords = scripts.join(' ').split(/\s+/).filter(Boolean);
  if (!allWords.length) return [];

  const WPS = 130 / 60; // words per second at normal speed
  const MAX_WORDS = 6;
  const cues: SubtitleCue[] = [];
  let offset = 0;

  for (let i = 0; i < allWords.length && offset < totalDuration; i += MAX_WORDS) {
    const group = allWords.slice(i, i + MAX_WORDS);
    const dur = group.length / WPS;
    const end = Math.min(offset + dur, totalDuration - 0.1);
    cues.push({ start: offset, end, text: group.join(' ') });
    offset = end + 0.05;
  }

  return cues;
}

// ── Main export ────────────────────────────────────────────────
export async function generateSubtitles(params: {
  scenes: SceneData[];
  totalDurationSeconds: number;
  voiceId?: string;
}): Promise<SubtitleCue[]> {
  const scripts = params.scenes
    .sort((a, b) => a.position - b.position)
    .map(s => s.voiceoverScript?.trim())
    .filter(Boolean)
    .join(' ');

  if (!scripts) {
    logger.info('[Subtitles] No scripts — skipping');
    return [];
  }

  logger.info(`[Subtitles] Generating for ${params.totalDurationSeconds.toFixed(1)}s video`);

  if (params.voiceId && config.ELEVENLABS_API_KEY) {
    const cues = await getElevenLabsTimings(scripts, params.voiceId);
    if (cues?.length) {
      logger.info(`[Subtitles] ElevenLabs: ${cues.length} cues`);
      return cues;
    }
  }

  const fallback = distributeFallback(params.scenes, params.totalDurationSeconds);
  logger.info(`[Subtitles] Fallback: ${fallback.length} cues`);
  return fallback;
}
