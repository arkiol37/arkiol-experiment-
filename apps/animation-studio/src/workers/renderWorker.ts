/**
 * Render Worker — Animation Studio
 * 
 * Standalone process: `npm run worker`
 * 
 * - Registers the Bull queue processor (imported from renderQueue.ts)
 * - Handles graceful shutdown (drain in-flight jobs before exit)
 * - Health-check logging every 30s
 * - Crash protection via unhandledRejection/uncaughtException handlers
 */
import 'dotenv/config';

// Validate env schema before anything else
import '../config/env';
import { config } from '../config/env';

import { renderQueue, deadLetterQueue } from '../jobs/renderQueue';
import { logger } from '../config/logger';
import { db } from '../config/database';
import { redis } from '../config/redis';

logger.info('[Worker] Animation Studio Render Worker starting...');

let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`[Worker] ${signal} received — starting graceful shutdown`);

  // Stop accepting new jobs
  try {
    await renderQueue.pause(true /* local */);
    logger.info('[Worker] Queue paused');
  } catch (err: any) {
    logger.error('[Worker] Failed to pause queue:', err.message);
  }

  // Wait up to 10 minutes for active jobs to finish
  const DRAIN_TIMEOUT = 10 * 60 * 1000;
  const deadline = Date.now() + DRAIN_TIMEOUT;

  const waitForDrain = async () => {
    while (Date.now() < deadline) {
      const active = await renderQueue.getActiveCount().catch(() => 0);
      if (active === 0) break;
      logger.info(`[Worker] Waiting for ${active} active job(s) to complete...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  };

  try {
    await waitForDrain();
  } catch (err: any) {
    logger.warn('[Worker] Drain wait error:', err.message);
  }

  // Close queues and connections
  try {
    await Promise.allSettled([
      renderQueue.close(),
      deadLetterQueue.close(),
    ]);
    await Promise.allSettled([
      db.destroy(),
      redis.disconnect(),
    ]);
    logger.info('[Worker] Graceful shutdown complete');
    process.exit(0);
  } catch (err: any) {
    logger.error('[Worker] Shutdown error:', err.message);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason: any) => {
  logger.error('[Worker] Unhandled rejection:', reason?.message || reason);
  // Don't exit — let Bull retry mechanism handle job failures
});

process.on('uncaughtException', (err) => {
  logger.error('[Worker] Uncaught exception:', err);
  process.exit(1);
});

// ── Health metrics every 30s ───────────────────────────────────
const metricsInterval = setInterval(async () => {
  if (shuttingDown) return;
  try {
    const [waiting, active, failed, completed, delayed] = await Promise.all([
      renderQueue.getWaitingCount(),
      renderQueue.getActiveCount(),
      renderQueue.getFailedCount(),
      renderQueue.getCompletedCount(),
      renderQueue.getDelayedCount(),
    ]);
    logger.info('[Worker] Metrics', { waiting, active, failed, completed, delayed });
  } catch (err: any) {
    logger.warn('[Worker] Metrics error:', err.message);
  }
}, 30_000);

metricsInterval.unref();

logger.info(`[Worker] Ready — concurrency: ${config.RENDER_CONCURRENCY}`);
