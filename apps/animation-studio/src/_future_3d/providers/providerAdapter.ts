/**
 * Provider Adapter — Animation Studio
 * 
 * Supports Runway ML, Pika Labs, Sora (OpenAI).
 * Features:
 *  - Schema validation of API responses
 *  - Exponential backoff polling with hard timeout
 *  - Rate limit detection and backoff
 *  - Primary/fallback provider chain
 *  - Job cancellation
 *  - Structured error mapping
 */
import { db } from '../config/database';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { decrypt } from '../services/encryptionService';
import { AppError } from '../middleware/errorHandler';
import { z } from 'zod';

// ── Types ──────────────────────────────────────────────────────
export type ProviderName = 'runway' | 'pika' | 'sora';

export interface VideoGenerationParams {
  prompt: string;
  negativePrompt?: string;
  durationSeconds: number;
  aspectRatio: '9:16' | '1:1' | '16:9';
  renderMode: 'Normal Ad' | 'Cinematic Ad';
  referenceImageUrl?: string;
}

export interface VideoGenerationResult {
  jobId: string;
  provider: ProviderName;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

// ── Structured provider errors ─────────────────────────────────
export class ProviderError extends Error {
  constructor(
    public provider: string,
    public statusCode: number,
    message: string,
    public retryable: boolean = false
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  providerName: string,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 30_000);
      await new Promise(r => setTimeout(r, backoffMs));
    }
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '60', 10);
        logger.warn(`[${providerName}] Rate limited — waiting ${retryAfter}s`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        lastError = new ProviderError(providerName, 429, 'Rate limited', true);
        continue;
      }
      return res;
    } catch (err: any) {
      lastError = err;
      logger.warn(`[${providerName}] Request failed (attempt ${attempt + 1}): ${err.message}`);
    }
  }
  throw lastError || new ProviderError(providerName, 0, 'Max retries exceeded', true);
}

// ── Runway ML Provider ─────────────────────────────────────────
const RunwayResponseSchema = z.object({ id: z.string() });
const RunwayPollSchema = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  output: z.array(z.string()).optional(),
  failure: z.string().optional(),
});

class RunwayProvider {
  name: ProviderName = 'runway';

  async generate(params: VideoGenerationParams, apiKey: string): Promise<VideoGenerationResult> {
    const aspectMap: Record<string, string> = { '9:16': '720:1280', '1:1': '1024:1024', '16:9': '1280:720' };
    const modelMap: Record<string, string> = {
      'Normal Ad':         'gen3a_turbo',
      'Cinematic Ad':      'gen3a',
      // Legacy aliases for existing DB records
      '2D Standard':       'gen3a_turbo',
      '2D Extended':       'gen3a_turbo',
      'Premium Cinematic': 'gen3a',
    };

    const body: Record<string, any> = {
      model: modelMap[params.renderMode] || 'gen3a_turbo',
      promptText: params.prompt,
      duration: params.durationSeconds,
      ratio: aspectMap[params.aspectRatio] || '1280:720',
    };
    if (params.referenceImageUrl) body.promptImage = params.referenceImageUrl;

    const res = await fetchWithRetry(
      `${config.RUNWAY_API_URL}/image_to_video`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': '2024-11-06',
        },
        body: JSON.stringify(body),
      },
      'Runway'
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new ProviderError('Runway', res.status, err?.message || `HTTP ${res.status}`, isRetryableStatus(res.status));
    }

    const data = RunwayResponseSchema.parse(await res.json());
    return { jobId: data.id, provider: this.name, status: 'queued' };
  }

  async poll(jobId: string, apiKey: string): Promise<VideoGenerationResult> {
    const res = await fetchWithRetry(
      `${config.RUNWAY_API_URL}/tasks/${jobId}`,
      { headers: { 'Authorization': `Bearer ${apiKey}`, 'X-Runway-Version': '2024-11-06' } },
      'Runway'
    );
    if (!res.ok) throw new ProviderError('Runway', res.status, `Poll HTTP ${res.status}`, isRetryableStatus(res.status));

    const data = RunwayPollSchema.parse(await res.json());
    const statusMap: Record<string, VideoGenerationResult['status']> = {
      PENDING: 'queued', RUNNING: 'processing', SUCCEEDED: 'complete', FAILED: 'failed', CANCELLED: 'failed',
    };

    return {
      jobId,
      provider: this.name,
      status: statusMap[data.status] || 'processing',
      videoUrl: data.output?.[0],
      error: data.failure,
    };
  }

  async cancel(jobId: string, apiKey: string): Promise<void> {
    await fetchWithRetry(
      `${config.RUNWAY_API_URL}/tasks/${jobId}/cancel`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'X-Runway-Version': '2024-11-06' } },
      'Runway', 1
    ).catch(() => {}); // Best-effort
  }
}

// ── Pika Labs Provider ─────────────────────────────────────────
const PikaResponseSchema = z.object({ id: z.string() });
const PikaPollSchema = z.object({
  status: z.string(),
  videos: z.array(z.object({ url: z.string() })).optional(),
  error: z.string().optional(),
});

class PikaProvider {
  name: ProviderName = 'pika';

  async generate(params: VideoGenerationParams, apiKey: string): Promise<VideoGenerationResult> {
    const res = await fetchWithRetry(
      `${config.PIKA_API_URL}/generate`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptText: params.prompt,
          frameRate: 24,
          options: { aspectRatio: params.aspectRatio, duration: params.durationSeconds },
        }),
      },
      'Pika'
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new ProviderError('Pika', res.status, err?.message || `HTTP ${res.status}`, isRetryableStatus(res.status));
    }

    const data = PikaResponseSchema.parse(await res.json());
    return { jobId: data.id, provider: this.name, status: 'queued' };
  }

  async poll(jobId: string, apiKey: string): Promise<VideoGenerationResult> {
    const res = await fetchWithRetry(
      `${config.PIKA_API_URL}/generate/${jobId}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } },
      'Pika'
    );
    if (!res.ok) throw new ProviderError('Pika', res.status, `Poll HTTP ${res.status}`, isRetryableStatus(res.status));

    const data = PikaPollSchema.parse(await res.json());
    const status: VideoGenerationResult['status'] =
      data.status === 'finished' ? 'complete' : data.status === 'error' ? 'failed' : 'processing';

    return { jobId, provider: this.name, status, videoUrl: data.videos?.[0]?.url, error: data.error };
  }

  async cancel(_jobId: string, _apiKey: string): Promise<void> {}
}

// ── Sora (OpenAI) Provider ─────────────────────────────────────
const SoraResponseSchema = z.object({ id: z.string() });
const SoraPollSchema = z.object({
  status: z.string(),
  data: z.array(z.object({ url: z.string() })).optional(),
  error: z.object({ message: z.string() }).optional(),
});

class SoraProvider {
  name: ProviderName = 'sora';

  async generate(params: VideoGenerationParams, apiKey: string): Promise<VideoGenerationResult> {
    const resMap: Record<string, string> = { '9:16': '720x1280', '1:1': '1024x1024', '16:9': '1280x720' };

    const res = await fetchWithRetry(
      `${config.SORA_API_URL}/video/generations`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'sora-1.0-turbo',
          prompt: params.prompt,
          duration: params.durationSeconds,
          resolution: resMap[params.aspectRatio] || '1280x720',
          n: 1,
        }),
      },
      'Sora'
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new ProviderError('Sora', res.status, err?.error?.message || `HTTP ${res.status}`, isRetryableStatus(res.status));
    }

    const data = SoraResponseSchema.parse(await res.json());
    return { jobId: data.id, provider: this.name, status: 'queued' };
  }

  async poll(jobId: string, apiKey: string): Promise<VideoGenerationResult> {
    const res = await fetchWithRetry(
      `${config.SORA_API_URL}/video/generations/${jobId}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } },
      'Sora'
    );
    if (!res.ok) throw new ProviderError('Sora', res.status, `Poll HTTP ${res.status}`, isRetryableStatus(res.status));

    const data = SoraPollSchema.parse(await res.json());
    const status: VideoGenerationResult['status'] =
      data.status === 'succeeded' ? 'complete' : data.status === 'failed' ? 'failed' : 'processing';

    return { jobId, provider: this.name, status, videoUrl: data.data?.[0]?.url, error: data.error?.message };
  }

  async cancel(_jobId: string, _apiKey: string): Promise<void> {}
}

// ── Provider Registry ──────────────────────────────────────────
const PROVIDERS: Record<ProviderName, RunwayProvider | PikaProvider | SoraProvider> = {
  runway: new RunwayProvider(),
  pika: new PikaProvider(),
  sora: new SoraProvider(),
};

// ── Provider Adapter ───────────────────────────────────────────
export class ProviderAdapter {
  constructor(private workspaceId: string) {}

  private async getProviderConfig(isPrimary: boolean): Promise<{ provider: ProviderName; apiKey: string } | null> {
    // Check workspace-level custom key
    const wsConfig = await db('provider_configs')
      .where({ workspace_id: this.workspaceId, enabled: true, is_primary: isPrimary })
      .first();

    if (wsConfig?.api_key_encrypted) {
      try {
        const apiKey = decrypt(wsConfig.api_key_encrypted);
        return { provider: wsConfig.provider as ProviderName, apiKey };
      } catch (err) {
        logger.error(`[Provider] Failed to decrypt key for workspace ${this.workspaceId}:`, err);
      }
    }

    // Fall back to platform keys
    if (isPrimary) {
      if (config.RUNWAY_API_KEY) return { provider: 'runway', apiKey: config.RUNWAY_API_KEY };
      if (config.PIKA_API_KEY) return { provider: 'pika', apiKey: config.PIKA_API_KEY };
      if (config.SORA_API_KEY) return { provider: 'sora', apiKey: config.SORA_API_KEY };
    } else {
      if (config.PIKA_API_KEY) return { provider: 'pika', apiKey: config.PIKA_API_KEY };
      if (config.RUNWAY_API_KEY) return { provider: 'runway', apiKey: config.RUNWAY_API_KEY };
    }

    return null;
  }

  async generateWithFallback(params: VideoGenerationParams): Promise<VideoGenerationResult> {
    const primary = await this.getProviderConfig(true);
    if (!primary) {
      throw new AppError(
        'No AI video provider configured. Add a provider API key in Settings → Providers.',
        503,
        'NO_PROVIDER'
      );
    }

    const primaryProvider = PROVIDERS[primary.provider];
    if (!primaryProvider) {
      throw new AppError(`Provider "${primary.provider}" is not supported`, 400, 'UNSUPPORTED_PROVIDER');
    }

    try {
      logger.info(`[Provider] Generating with ${primary.provider}`);
      const result = await primaryProvider.generate(params, primary.apiKey);
      return result;
    } catch (err: any) {
      logger.warn(`[Provider] Primary (${primary.provider}) failed: ${err.message}`);

      // Check if auto-fallback is enabled
      const wsConfig = await db('provider_configs')
        .where({ workspace_id: this.workspaceId, is_primary: true })
        .first();

      if (wsConfig?.auto_fallback === false) {
        throw new AppError(`Primary provider failed: ${err.message}`, 503, 'PROVIDER_FAILED');
      }

      // Try fallback
      const fallback = await this.getProviderConfig(false);
      if (!fallback || fallback.provider === primary.provider) {
        throw new AppError(
          `Primary provider (${primary.provider}) failed and no fallback available: ${err.message}`,
          503, 'NO_FALLBACK'
        );
      }

      logger.info(`[Provider] Falling back to ${fallback.provider}`);
      try {
        const fallbackProvider = PROVIDERS[fallback.provider];
        return await fallbackProvider.generate(params, fallback.apiKey);
      } catch (fallbackErr: any) {
        throw new AppError(
          `Both providers failed. Primary: ${err.message}. Fallback: ${fallbackErr.message}`,
          503, 'ALL_PROVIDERS_FAILED'
        );
      }
    }
  }

  async pollResult(jobId: string, providerName: ProviderName): Promise<VideoGenerationResult> {
    const pc = await db('provider_configs')
      .where({ workspace_id: this.workspaceId, provider: providerName, enabled: true })
      .first();

    let apiKey: string;
    if (pc?.api_key_encrypted) {
      apiKey = decrypt(pc.api_key_encrypted);
    } else {
      const platformKey = {
        runway: config.RUNWAY_API_KEY,
        pika: config.PIKA_API_KEY,
        sora: config.SORA_API_KEY,
      }[providerName];

      if (!platformKey) {
        throw new AppError(`No API key found for provider: ${providerName}`, 503, 'NO_API_KEY');
      }
      apiKey = platformKey;
    }

    const provider = PROVIDERS[providerName];
    if (!provider) throw new AppError(`Unknown provider: ${providerName}`, 400, 'UNSUPPORTED_PROVIDER');

    return provider.poll(jobId, apiKey);
  }

  async cancelJob(jobId: string, providerName: ProviderName): Promise<void> {
    try {
      const pc = await db('provider_configs')
        .where({ workspace_id: this.workspaceId, provider: providerName, enabled: true })
        .first();

      const apiKey = pc?.api_key_encrypted
        ? decrypt(pc.api_key_encrypted)
        : (config as any)[`${providerName.toUpperCase()}_API_KEY`] || '';

      if (!apiKey) return;
      await PROVIDERS[providerName].cancel(jobId, apiKey);
    } catch (err: any) {
      logger.warn(`[Provider] Cancel failed for ${providerName}/${jobId}: ${err.message}`);
    }
  }
}
