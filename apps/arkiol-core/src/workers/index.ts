// src/workers/index.ts
// Combined worker entry point — starts all background workers in a single process.
// Run with: npm run worker:prod
// validateSharedEnv() is called FIRST before any worker is imported.
// All Redis/config reads in worker files use getEnv() which depends on this call.

import { validateSharedEnv, getEnv } from "@arkiol/shared";
import { logger }            from "../lib/logger";
import { registerFonts }     from "../engines/render/font-registry";
import { initUltimateFonts } from "../engines/render/font-registry-ultimate";

// ── Boot: validate environment before anything else ───────────────────────────
validateSharedEnv();

// ── 1. Register bundled fonts with node-canvas ────────────────────────────────
const fontResult = registerFonts();
if (!fontResult.ok) {
  logger.warn({ error: fontResult.error }, "[workers] Font registration issues — text metrics may drift");
} else if (fontResult.registered > 0) {
  logger.info({ count: fontResult.registered }, "[workers] Bundled fonts registered with canvas");
} else {
  logger.info("[workers] No canvas available (serverless env) — font fallback active");
}

// ── Worker startup ─────────────────────────────────────────────────────────────
async function startWorkers() {
  const env = getEnv();
  logger.info("╔══════════════════════════════════════════════╗");
  logger.info("║        Arkiol Worker Process                 ║");
  logger.info(`║   ENV:   ${env.NODE_ENV.padEnd(35)}║`);
  logger.info(`║   Redis: ${env.REDIS_HOST.padEnd(35)}║`);
  logger.info("╚══════════════════════════════════════════════╝\n");

  // ── 2. Download and register Ultimate Google Fonts ─────────────────────────
  // Must run before any render job is processed. Downloads missing TTFs from
  // Google Fonts CDN to /tmp/arkiol-fonts/ and registers them with node-canvas.
  // Idempotent — skips files already cached from a prior worker startup.
  logger.info("[workers] Initialising Ultimate font set (Google Fonts)...");
  const ultimateFontResult = await initUltimateFonts();
  if (!ultimateFontResult.ok) {
    logger.warn(
      { errors: ultimateFontResult.errors },
      "[workers] Ultimate font init had errors — some fonts may fall back to system stack"
    );
  } else {
    logger.info(
      { registered: ultimateFontResult.registered, downloaded: ultimateFontResult.downloaded },
      "[workers] Ultimate fonts ready"
    );
  }

  logger.info("[workers] Starting generation worker...");
  await import("./generation.worker");

  logger.info("[workers] Starting export worker...");
  await import("./export.worker");

  logger.info("[workers] Starting webhook delivery worker...");
  await import("./webhook.worker");

  logger.info("[workers] All workers running. Press Ctrl+C to stop.");
}

startWorkers().catch((err) => {
  console.error("[workers] Fatal startup error:", err);
  process.exit(1);
});

// Graceful shutdown
let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "[workers] Received signal -- graceful shutdown");
  setTimeout(() => {
    logger.info("[workers] Shutdown complete");
    process.exit(0);
  }, 5000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
process.on("uncaughtException",  (err: Error)    => logger.error({ err },    "[workers] Uncaught exception"));
process.on("unhandledRejection", (reason: unknown) => logger.error({ reason }, "[workers] Unhandled rejection"));
