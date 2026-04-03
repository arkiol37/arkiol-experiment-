/**
 * Webhook Delivery Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 * Delivers render completion events to registered webhook endpoints with
 * retry logic, signature verification, and delivery tracking.
 */

import crypto from 'crypto';
import { logger } from '../../config/logger';

export interface WebhookConfig {
  id: string;
  workspaceId: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: Date;
  lastDeliveredAt: Date | null;
  failureCount: number;
}

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: {
    renderJobId: string;
    workspaceId: string;
    status: string;
    outputUrl?: string;
    thumbnailUrl?: string;
    platform?: string;
    placement?: string;
    sceneCount?: number;
    durationSec?: number;
    creditsCharged?: number;
    qualityScore?: number;
    error?: string;
  };
}

export interface WebhookDeliveryResult {
  webhookId: string;
  delivered: boolean;
  statusCode: number | null;
  attempts: number;
  error?: string;
  deliveredAt: Date | null;
}

// In-memory webhook registry (in production, this would be in the database)
const webhookRegistry = new Map<string, WebhookConfig[]>();

export function registerWebhook(config: Omit<WebhookConfig, 'createdAt' | 'lastDeliveredAt' | 'failureCount'>): WebhookConfig {
  const webhook: WebhookConfig = { ...config, createdAt: new Date(), lastDeliveredAt: null, failureCount: 0 };
  const existing = webhookRegistry.get(config.workspaceId) || [];
  existing.push(webhook);
  webhookRegistry.set(config.workspaceId, existing);
  logger.info(`[Webhook] Registered webhook ${config.id} for workspace ${config.workspaceId}`);
  return webhook;
}

export function getWebhooksForEvent(workspaceId: string, event: string): WebhookConfig[] {
  const hooks = webhookRegistry.get(workspaceId) || [];
  return hooks.filter(h => h.active && h.events.includes(event) && h.failureCount < 10);
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export async function deliverWebhook(
  webhook: WebhookConfig,
  payload: WebhookPayload,
  maxRetries = 3,
): Promise<WebhookDeliveryResult> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, webhook.secret);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Arkiol-Signature': signature,
          'X-Arkiol-Event': payload.event,
          'X-Arkiol-Timestamp': payload.timestamp,
          'X-Arkiol-Delivery-Attempt': String(attempt),
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        webhook.lastDeliveredAt = new Date();
        webhook.failureCount = 0;
        logger.info(`[Webhook] Delivered ${payload.event} to ${webhook.url} (attempt ${attempt})`);
        return { webhookId: webhook.id, delivered: true, statusCode: response.status, attempts: attempt, deliveredAt: new Date() };
      }

      if (response.status >= 400 && response.status < 500) {
        // Client error — don't retry
        webhook.failureCount++;
        return { webhookId: webhook.id, delivered: false, statusCode: response.status, attempts: attempt, error: `Client error: ${response.status}`, deliveredAt: null };
      }

      // Server error — retry with backoff
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    } catch (err: any) {
      if (attempt === maxRetries) {
        webhook.failureCount++;
        logger.warn(`[Webhook] Failed to deliver to ${webhook.url} after ${maxRetries} attempts: ${err.message}`);
        return { webhookId: webhook.id, delivered: false, statusCode: null, attempts: attempt, error: err.message, deliveredAt: null };
      }
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }

  return { webhookId: webhook.id, delivered: false, statusCode: null, attempts: maxRetries, error: 'Exhausted retries', deliveredAt: null };
}

export async function deliverRenderCompleteWebhook(
  workspaceId: string,
  renderJobId: string,
  status: string,
  data: Partial<WebhookPayload['data']>,
): Promise<WebhookDeliveryResult[]> {
  const event = status === 'complete' ? 'render.complete' : 'render.failed';
  const hooks = getWebhooksForEvent(workspaceId, event);
  if (hooks.length === 0) return [];

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data: { renderJobId, workspaceId, status, ...data },
  };

  const results = await Promise.all(hooks.map(h => deliverWebhook(h, payload)));
  return results;
}
