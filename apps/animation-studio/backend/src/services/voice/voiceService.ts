/**
 * Voice Generation Service — Animation Studio
 * 
 * Calls ElevenLabs TTS API, uploads MP3 to S3, returns CDN URL.
 * Handles: voice ID mapping, speed control, upload, duration estimation.
 * Gracefully returns null when API key is not configured or call fails.
 */
import { logger } from '../../config/logger';
import { config } from '../../config/env';
import { uploadRender } from '../storageService';
import type { SceneData } from '../../jobs/renderQueue';

// ── Voice ID mapping (ElevenLabs voice IDs) ───────────────────
const VOICE_MAP: Record<string, string> = {
  'Female:Confident:American English': 'EXAVITQu4vr4xnSDxMaL',
  'Female:Calm:American English':      'AZnzlk1XvdvUeBnXmlld',
  'Female:Energetic:American English': 'MF3mGyEYCl7XYWbV9V6O',
  'Female:Confident:British English':  'ThT5KcBeYPX3keUQqHPh',
  'Female:Calm:British English':       'AZnzlk1XvdvUeBnXmlld',
  'Male:Confident:American English':   'onwK4e9ZLuTAKqWW03F9',
  'Male:Energetic:American English':   'VR6AewLTigWG4xSOukaG',
  'Male:Calm:American English':        'pNInz6obpgDQGcFmaJgB',
  'Male:Confident:British English':    'SOYHLrjzK2X1ezoPC6cr',
  'Male:Calm:British English':         'GBv7mTt0atIp3Br8iCZy',
  'Neutral:Calm:American English':     'ErXwobaYiN019PkySvjV',
};
const DEFAULT_VOICE = 'EXAVITQu4vr4xnSDxMaL';

// ── Speed mapping ──────────────────────────────────────────────
const SPEED_MAP: Record<string, number> = {
  Slow: 0.80, Normal: 1.0, Fast: 1.15, 'Very Fast': 1.30,
};

function getVoiceId(gender: string, tone: string, accent: string): string {
  return VOICE_MAP[`${gender}:${tone}:${accent}`] || DEFAULT_VOICE;
}

// ── Generate & upload voiceover ────────────────────────────────
export async function generateAndUploadVoice(params: {
  renderJobId: string;
  workspaceId: string;
  scenes: SceneData[];
  voiceConfig: { gender: string; tone: string; accent: string; speed: string };
}): Promise<{ cdnUrl: string; voiceId: string; durationSeconds: number } | null> {
  const { renderJobId, workspaceId, scenes, voiceConfig } = params;

  const fullScript = scenes
    .sort((a, b) => a.position - b.position)
    .map(s => s.voiceoverScript?.trim())
    .filter(Boolean)
    .join(' ');

  if (!fullScript) {
    logger.info(`[Voice] No scripts for render ${renderJobId}`);
    return null;
  }

  if (!config.ELEVENLABS_API_KEY) {
    logger.warn('[Voice] ELEVENLABS_API_KEY not set — skipping voiceover');
    return null;
  }

  const voiceId = getVoiceId(voiceConfig.gender, voiceConfig.tone, voiceConfig.accent);
  const speed = SPEED_MAP[voiceConfig.speed] || 1.0;

  logger.info(`[Voice] Generating: ${fullScript.length} chars, voice=${voiceId}, speed=${speed}`);

  try {
    const res = await fetch(`${config.ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': config.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: fullScript,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error(`[Voice] ElevenLabs error ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    logger.info(`[Voice] Generated ${buf.length} bytes`);

    const { cdnUrl } = await uploadRender({
      workspaceId,
      renderId: renderJobId,
      buffer: buf,
      mimeType: 'audio/mpeg',
      filename: 'voiceover.mp3',
    });

    // Estimate duration from word count
    const words = fullScript.split(/\s+/).filter(Boolean).length;
    const durationSeconds = Math.ceil((words / 130) * 60 / speed);

    logger.info(`[Voice] Uploaded to ${cdnUrl}, ~${durationSeconds}s`);
    return { cdnUrl, voiceId, durationSeconds };

  } catch (err: any) {
    logger.error(`[Voice] Failed: ${err.message}`);
    return null;
  }
}

// ── Music track selection ──────────────────────────────────────
// Map mood+style to licensed music track CDN URLs.
// In production: integrate with Epidemic Sound / Artlist API.
// Returning null means no background music (gracefully handled).
export function selectMusicTrack(mood: string, style: string): string | null {
  // Catalog of pre-cleared tracks.
  // Keys match MOOD × STYLE combinations from StudioPage.
  // Replace empty strings with real CDN URLs to your licensed audio files.
  const catalog: Record<string, string> = {
    // e.g. 'Luxury:Cinematic Ambient': 'https://cdn.animation-studio.ai/music/luxury_cinematic.mp3',
  };

  const key = `${mood}:${style}`;
  const url = catalog[key] ?? catalog[`${mood}:`] ?? null;

  if (!url) logger.info(`[Music] No track for "${key}" — proceeding without music`);
  return url;
}
