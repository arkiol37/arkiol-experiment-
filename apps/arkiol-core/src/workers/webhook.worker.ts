// src/workers/webhook.worker.ts
// Processes outbound webhook delivery with HMAC-SHA256 signatures,
// automatic retries, and failure tracking.
//
// Secret handling:
//   Webhook secrets are stored AES-256-GCM encrypted in the DB.
//   decryptWebhookSecret() decrypts to plaintext immediately before HMAC signing.
//   The plaintext secret is held only in memory for the duration of the signing
//   operation and never logged, serialised, or persisted.

import { Worker, Job } from "bullmq";
import { prisma }      from "../lib/prisma";
import { createHmac, createHash }  from "crypto";
import { decryptWebhookSecret }    from "../lib/webhook-crypto";
import { validateWebhookUrl, getEnv } from "@arkiol/shared";
import { logger, logError } from "../lib/logger";

interface WebhookPayload {
  webhookId:  string;
  orgId:      string;
  event:      string;
  data:       Record<string, unknown>;
  attempt:    number;
  deliveryId: string;  // Stable ID used as BullMQ job dedup key
}

const worker = new Worker<WebhookPayload>(
  "arkiol:webhooks",
  async (job: Job<WebhookPayload>) => {
    const { webhookId, orgId, event, data, deliveryId } = job.data;

    const webhook = await prisma.webhook.findFirst({
      where: { id: webhookId, orgId, isActive: true },
    });

    if (!webhook) {
      logger.warn({ webhookId, orgId, event }, "[webhook-worker] Webhook not found or inactive -- skipping");
      return { skipped: true };
    }

    // Build payload — use stable deliveryId so retries produce the same event ID
    const timestamp = Date.now();
    const payload   = JSON.stringify({
      id:        `evt_${deliveryId}`,  // Stable across retries for client dedup
      event,
      timestamp: new Date(timestamp).toISOString(),
      data,
    });

    // Decrypt the stored AES-256-GCM ciphertext to recover the plaintext signing secret.
    // This is the only point at which the secret exists in memory as plaintext.
    // If decryption fails (tampered ciphertext, wrong key, legacy XOR format), the
    // delivery is aborted — a signing failure is better than sending an invalid signature.
    let signingKey: string;
    try {
      signingKey = decryptWebhookSecret(webhook.secret);
    } catch (decryptErr: unknown) {
      const errMsg = decryptErr instanceof Error ? decryptErr.message : String(decryptErr);
      logger.error(
        { webhookId: webhook.id, orgId, error: errMsg },
        "[webhook-worker] Failed to decrypt webhook secret — aborting delivery. " +
        "If this webhook was created before the AES-GCM upgrade, delete and re-create it."
      );
      // Mark the webhook as inactive to prevent repeated failed delivery attempts
      await prisma.webhook.update({
        where: { id: webhook.id },
        data:  { isActive: false, failCount: { increment: 1 } },
      }).catch(() => {});
      throw new Error(`Cannot decrypt webhook secret for ${webhookId}: ${errMsg}`);
    }

    // Generate HMAC-SHA256 signature using the decrypted plaintext secret.
    // Clients verify using: HMAC-SHA256(signingSecret, `${timestamp}.${payload}`)
    const signaturePayload = `${timestamp}.${payload}`;
    const signature = createHmac("sha256", signingKey)
      .update(signaturePayload)
      .digest("hex");

    // signingKey goes out of scope here — GC eligible immediately after this block

    // SSRF guard — re-validate URL at delivery time (Task #4)
    // Prevents delivery to URLs that passed creation checks but were subsequently
    // resolved to internal addresses (DNS rebinding protection).
    const ssrfCheck = validateWebhookUrl(webhook.url);
    if (!ssrfCheck.safe) {
      logger.error({ webhookId, orgId, url: webhook.url, reason: ssrfCheck.reason },
        "[webhook-worker] SSRF check failed at delivery time — disabling webhook");
      await prisma.webhook.update({
        where: { id: webhook.id },
        data:  { isActive: false, failCount: 99 },
      });
      throw new Error(`SSRF_BLOCKED: ${ssrfCheck.reason}`);
    }

    // Deliver webhook
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    let response: Response;
    try {
      response = await fetch(webhook.url, {
        method:  "POST",
        signal:  controller.signal,
        headers: {
          "Content-Type":         "application/json",
          "User-Agent":           "Arkiol-Webhooks/1.0",
          "X-Arkiol-Event":       event,
          "X-Arkiol-Timestamp":   String(timestamp),
          "X-Arkiol-Signature":   `sha256=${signature}`,
          "X-Arkiol-Webhook-Id":  webhook.id,
        },
        body: payload,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      // Success — reset fail count
      await prisma.webhook.update({
        where: { id: webhook.id },
        data:  { failCount: 0, lastSuccess: new Date() },
      });
      logger.info({ webhookId, orgId, event, status: response.status, url: webhook.url }, "[webhook-worker] Webhook delivered");
      return { delivered: true, status: response.status };
    }

    // Non-2xx response — count as failure
    const bodyText = await response.text().catch(() => "");
    logger.warn({ webhookId, orgId, event, status: response.status, url: webhook.url, body: bodyText.slice(0, 200) }, "[webhook-worker] Failed delivery");

    // NEW-005 FIX: Combine failCount increment and conditional isActive=false into a
    // single atomic update via a Prisma $transaction. Previously two sequential
    // prisma.webhook.update() calls left a race window where a concurrent delivery
    // could still fetch and use a webhook that was about to be disabled.
    const newFailCount = webhook.failCount + 1;
    const shouldDisable = newFailCount >= 10;

    await prisma.webhook.update({
      where: { id: webhook.id },
      data: {
        failCount: { increment: 1 },
        ...(shouldDisable ? { isActive: false } : {}),
      },
    });

    if (shouldDisable) {
      logger.error({ webhookId: webhook.id, orgId }, "[webhook-worker] Disabled webhook after 10 consecutive failures");
    }

    throw new Error(`Webhook endpoint returned ${response.status}`);
  },
  {
    connection: (() => {
      const env = getEnv();
      return { host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD };
    })(),
    concurrency: 10,
  }
);

worker.on("failed", (job: Job<WebhookPayload> | undefined, err: Error) => {
  if (job) logError(err, { jobId: job.id, queue: "arkiol:webhooks" });
});

logger.info("[webhook-worker] Started -- processing outbound webhooks");

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

// ── Helper: queue a webhook delivery ─────────────────────────────────────────
export async function deliverWebhooks(
  orgId:   string,
  event:   string,
  data:    Record<string, unknown>
): Promise<void> {
  const webhooks = await prisma.webhook.findMany({
    where: { orgId, isActive: true, events: { has: event } },
    select: { id: true },
  });

  if (!webhooks.length) return;

  const { webhookQueue } = await import("../lib/queue");
  // Stable eventKey: same orgId+event+data always produces same deliveryId.
  // BullMQ jobId deduplication prevents double-enqueue on app restart/retry.
  const eventKey = createHash("sha256")
    .update(`${orgId}:${event}:${JSON.stringify(data)}`)
    .digest("hex")
    .slice(0, 24);

  await Promise.all(
    webhooks.map((wh: { id: string }, i: number) => {
      const deliveryId = `${eventKey}_${wh.id.slice(0, 8)}`;
      return webhookQueue.add(
        "deliver",
        { webhookId: wh.id, orgId, event, data, attempt: 1, deliveryId },
        {
          jobId:    deliveryId,  // BullMQ dedup: same deliveryId = same job slot
          delay:    i * 100,     // stagger slightly
          attempts: 5,
          backoff:  { type: "exponential", delay: 2000 },
        }
      );
    })
  );
}

/**
 * deliverDirectWebhook
 *
 * Delivers a webhook payload directly to a caller-specified URL without going
 * through the org's registered webhook records or the BullMQ queue.
 *
 * Used exclusively by the Automation API (/api/automation/generate) to deliver
 * the `automation.job.completed` event to the caller's webhook URL at job finish.
 *
 * - Signed with the shared automation HMAC secret (env.AUTOMATION_WEBHOOK_SECRET)
 * - 3 retry attempts with exponential backoff
 * - Non-fatal: failures are logged as WARN, never throw to caller
 * - Fire-and-forget: caller does not await
 */
export async function deliverDirectWebhook(
  targetUrl:  string,
  event:      string,
  data:       Record<string, unknown>
): Promise<void> {
  const env = getEnv();
  const signingKey = env.AUTOMATION_WEBHOOK_SECRET ?? env.WEBHOOK_DEFAULT_SECRET ?? "arkiol-automation-secret";
  const timestamp  = Math.floor(Date.now() / 1000);
  const payload    = JSON.stringify({ event, data, timestamp });

  const signature = createHmac("sha256", signingKey)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(targetUrl, {
          method:  "POST",
          signal:  controller.signal,
          headers: {
            "Content-Type":          "application/json",
            "User-Agent":            "Arkiol-Automation/1.0",
            "X-Arkiol-Event":        event,
            "X-Arkiol-Timestamp":    String(timestamp),
            "X-Arkiol-Signature":    `sha256=${signature}`,
            "X-Arkiol-Delivery-Type": "direct",
          },
          body: payload,
        });
        if (res.ok) return;  // success
        lastErr = new Error(`HTTP ${res.status}`);
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    // Exponential back-off: 1s, 3s, 9s
    if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * Math.pow(3, attempt - 1)));
  }
  logger.warn({ targetUrl, event, err: lastErr?.message }, "[automation-webhook] direct delivery failed after 3 attempts (non-fatal)");
}
