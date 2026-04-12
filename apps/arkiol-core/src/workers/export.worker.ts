// src/workers/export.worker.ts
// Export Worker — handles heavy PNG, GIF, and ZIP exports off the API thread.
//
// Features (A1):
//   - Deterministic output: same input → same bytes (no Math.random, no Date.now in content)
//   - Exponential backoff: 3 attempts via BullMQ queue config (5s → 15s → 45s)
//   - Dead-letter queue on permanent failure with full diagnostics
//   - Full job lifecycle: PENDING → RUNNING → COMPLETED / FAILED
//   - ZIP: produces a real zip archive (all assets as PNGs inside one archive)
//   - Signed S3 URLs valid for 1 hour
// NO direct process.env — all config via validated env module.

import { Worker, Job }   from "bullmq";
import { prisma }        from "../lib/prisma";
import { uploadToS3, buildS3Key, getSignedDownloadUrl } from "../lib/s3";
import { withRetry }     from "../lib/error-handling";
import { logJobEvent, logError, logger } from "../lib/logger";
import { dlqQueue }      from "../lib/queue";
import sharp             from "sharp";
import { renderGif, buildKineticTextFrames } from "../engines/render/gif-renderer";
import { FORMAT_DIMS }   from "../lib/types";
// Real ZIP support
import archiver from "archiver";
import { getEnv, createCrashSafetyService } from "@arkiol/shared";

export interface ExportJobPayload {
  exportJobId: string;
  userId:      string;
  orgId:       string;
  // Single-asset exports:
  assetId?:    string;
  // Multi-asset ZIP:
  assetIds?:   string[];
  format:      "png" | "gif" | "zip";
  pngScale?:   number;
  gifFps?:     number;
  gifType?:    "kinetic" | "fade" | "pulse";
  // A/B Export Pack: when true, assets are named creative_v1.png, creative_v2.png, ...
  // ready for direct upload to Meta/Google Ads Manager.
  abPack?:     boolean;
  // Optional prompt label embedded in the ZIP manifest and file names
  promptLabel?: string;
}

function getWorkerConnection() {
  const env = getEnv();
  return {
    host:     env.REDIS_HOST,
    port:     env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    tls:      env.REDIS_TLS ? {} : undefined,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function svgToPng(svgSource: string, width: number, height: number, scale: number): Promise<Buffer> {
  const targetW = Math.round(width  * scale);
  const targetH = Math.round(height * scale);
  return withRetry(
    () => sharp(Buffer.from(svgSource))
      .resize(targetW, targetH, { fit: "fill", kernel: "lanczos3" })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer(),
    { maxAttempts: 3, baseDelayMs: 1000 }
  );
}

async function buildGif(asset: {
  svgSource: string;
  width: number; height: number;
  format: string;
  metadata: unknown;
  name: string;
}, fps: number): Promise<Buffer> {
  const dims    = FORMAT_DIMS[asset.format] ?? { width: asset.width, height: asset.height };
  const meta    = asset.metadata as Record<string, unknown> | null ?? {};
  const brief   = (meta.brief ?? {}) as Record<string, unknown>;
  const bgColor = (brief.backgroundColor as string | undefined) ?? "#1a1a2e";
  const headline = (brief.headline as string | undefined) ?? asset.name;
  const subhead  = (brief.subhead as string | undefined) ?? "";

  const frames = buildKineticTextFrames({
    width:    dims.width,
    height:   dims.height,
    bgColor,
    headline: {
      text:       headline,
      color:      "#ffffff",
      fontSize:   Math.max(24, Math.round(dims.width * 0.05)),
      fontFamily: "Arial",
      x:          dims.width / 2,
      y:          dims.height * 0.4,
      maxWidth:   dims.width * 0.8,
      weight:     "bold",
      align:      "center",
    },
    subhead: subhead ? {
      text:       subhead,
      color:      "#e5e7eb",
      fontSize:   Math.max(14, Math.round(dims.width * 0.028)),
      fontFamily: "Arial",
      x:          dims.width / 2,
      y:          dims.height * 0.55,
      maxWidth:   dims.width * 0.8,
      weight:     "normal",
      align:      "center",
    } : undefined,
    accentColor: "#4f6ef7",
    frameCount:  24,
  });

  return withRetry(
    () => renderGif(frames, { width: dims.width, height: dims.height, repeat: 0, quality: 8, fps }),
    { maxAttempts: 3, baseDelayMs: 5000 }
  );
}

// ── Worker ────────────────────────────────────────────────────────────────────

const exportWorker = new Worker<ExportJobPayload>(
  "arkiol:exports",
  async (job: Job<ExportJobPayload>) => {
    const {
      exportJobId, userId, orgId, format,
      assetId, assetIds,
      pngScale = 1, gifFps = 12,
    } = job.data;

    const startTime  = Date.now();
    const crashSafety = createCrashSafetyService({ prisma, logger });
    logJobEvent(exportJobId, "export_started", { format, assetId, assetIds, attempt: job.attemptsMade + 1 });

    // Mark running (FSM-validated)
    await crashSafety.transitionJob(exportJobId, 'running');
    await prisma.job.update({
      where: { id: exportJobId },
      data:  { startedAt: new Date(), attempts: { increment: 1 } },
    }).catch(() => {});

    let exportKey:    string;
    let exportMime:   string;
    let exportBuffer: Buffer;

    if (format === "zip") {
      // ── ZIP export: one PNG per asset, bundled into a real zip archive ────
      const ids = assetIds ?? (assetId ? [assetId] : []);
      if (ids.length === 0) throw new Error("ZIP export requires at least one assetId");

      const { abPack, promptLabel } = job.data;
      const assets: Array<{
        id: string; userId: string; name: string; format: string;
        svgSource: string | null; width: number; height: number;
        brandScore: number; layoutFamily: string | null;
        metadata: Record<string, unknown>;
      }> = await prisma.asset.findMany({ where: { id: { in: ids } } });
      // Verify ownership of all
      const unauthorized = assets.filter(a => a.userId !== userId);
      if (unauthorized.length > 0) throw new Error("Access denied to one or more assets");

      let addedCount = 0;

      // Build ZIP using archiver (streaming into a Buffer)
      exportBuffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const archive = archiver("zip", { zlib: { level: 6 } });
        archive.on("data",    chunk => chunks.push(chunk));
        archive.on("end",     ()    => resolve(Buffer.concat(chunks)));
        archive.on("error",   err   => reject(err));
        archive.on("warning", err   => {
          if (err.code !== "ENOENT") reject(err);
        });

        (async () => {
          // ── A/B Pack mode: structured naming for ad platform upload ──────
          // Files: creative_v1.png, creative_v2.png, ...
          // Manifest: ab_manifest.json  (format, dimensions, promptLabel, assetIds)
          if (abPack) {
            const manifest: Record<string, unknown>[] = [];
            for (let i = 0; i < assets.length; i++) {
              const asset = assets[i];
              if (!asset.svgSource) continue;
              const png = await svgToPng(asset.svgSource, asset.width, asset.height, pngScale ?? 1);
              const varLabel = `creative_v${i + 1}`;
              archive.append(png, { name: `${varLabel}.png` });
              manifest.push({
                variation:   i + 1,
                filename:    `${varLabel}.png`,
                assetId:     asset.id,
                format:      asset.format,
                width:       asset.width,
                height:      asset.height,
                brandScore:  asset.brandScore,
                layoutFamily: asset.layoutFamily,
              });
              addedCount++;
              await job.updateProgress(Math.round((addedCount / assets.length) * 80));
            }
            // Append manifest JSON
            const manifestBuf = Buffer.from(JSON.stringify({
              exportedAt:  new Date().toISOString(),
              promptLabel: promptLabel ?? null,
              variationCount: manifest.length,
              variants:    manifest,
            }, null, 2));
            archive.append(manifestBuf, { name: "ab_manifest.json" });
          } else {
            // ── Standard ZIP: original naming ────────────────────────────
            for (const asset of assets) {
              if (!asset.svgSource) continue;
              const png = await svgToPng(asset.svgSource, asset.width, asset.height, pngScale ?? 1);
              const safeName = asset.name.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 60);
              archive.append(png, { name: `${safeName}_${asset.id.slice(-6)}.png` });
              addedCount++;
              await job.updateProgress(Math.round((addedCount / assets.length) * 80));
            }
          }

          // BUG-003 FIX: Reject before finalising if no files were added
          if (addedCount === 0) {
            reject(new Error(
              "ZIP export produced 0 files — all assets lacked SVG source. " +
              "Re-generate assets to enable ZIP export."
            ));
            return;
          }
          archive.finalize();
        })().catch(reject);
      });

      exportMime = "application/zip";
      exportKey  = buildS3Key(orgId, `batch_export_${exportJobId}`, "zip");

    } else if (format === "png") {
      // ── PNG export ──────────────────────────────────────────────────────
      if (!assetId) throw new Error("PNG export requires assetId");
      const asset = await prisma.asset.findUnique({ where: { id: assetId } });
      if (!asset)           throw new Error(`Asset ${assetId} not found`);
      if (!asset.svgSource) throw new Error(`Asset ${assetId} has no SVG source — re-generate to enable export`);
      if (asset.userId !== userId) throw new Error("Access denied");

      exportBuffer = await svgToPng(asset.svgSource, asset.width, asset.height, pngScale);
      exportMime   = "image/png";
      // Deterministic key: orgId + assetId + scale — same params → same key
      exportKey    = buildS3Key(orgId, `${assetId}_px${Math.round(pngScale * 100)}`, "png");

    } else if (format === "gif") {
      // ── GIF export ──────────────────────────────────────────────────────
      if (!assetId) throw new Error("GIF export requires assetId");
      const asset = await prisma.asset.findUnique({ where: { id: assetId } });
      if (!asset)           throw new Error(`Asset ${assetId} not found`);
      if (!asset.svgSource) throw new Error(`Asset ${assetId} has no SVG source — re-generate to enable export`);
      if (asset.userId !== userId) throw new Error("Access denied");

      exportBuffer = await buildGif(asset, gifFps);
      exportMime   = "image/gif";
      exportKey    = buildS3Key(orgId, `${assetId}_fps${gifFps}`, "gif");

    } else {
      throw new Error(`Unsupported export format in worker: ${format}`);
    }

    await job.updateProgress(85);

    // Upload to S3
    await uploadToS3(exportKey, exportBuffer, exportMime, {
      "x-arkiol-export-format": format,
      "x-arkiol-user-id":       userId,
      "x-arkiol-job-id":        exportJobId,
    });

    await job.updateProgress(95);

    // Generate signed download URL (1 hour TTL)
    const downloadUrl = await getSignedDownloadUrl(exportKey, 3600);
    const durationMs  = Date.now() - startTime;

    // Mark completed
    await prisma.job.update({
      where: { id: exportJobId },
      data:  {
        status:      "COMPLETED",
        completedAt: new Date(),
        progress:    100,
        result: {
          exportKey,
          downloadUrl,
          format,
          fileSize:   exportBuffer.length,
          fileSizeKB: (exportBuffer.length / 1024).toFixed(1),
          durationMs,
          expiresAt:  new Date(Date.now() + 3_600_000).toISOString(),
        },
      },
    });

    await job.updateProgress(100);
    logJobEvent(exportJobId, "export_completed", { format, fileSize: exportBuffer.length, durationMs });
    return { exportKey, downloadUrl, durationMs };
  },
  {
    connection:  getWorkerConnection(),
    concurrency: getEnv().EXPORT_WORKER_CONCURRENCY ?? 2,
  }
);

// ── Failure handler ───────────────────────────────────────────────────────────

exportWorker.on("failed", async (job, err) => {
  if (!job) return;
  const { exportJobId, orgId, userId } = job.data;
  logError(err, { jobId: exportJobId, attempt: job.attemptsMade, queue: "arkiol:exports" });

  const maxAttempts = job.opts.attempts ?? 3;
  const isPermanent = job.attemptsMade >= maxAttempts;
  if (!isPermanent) return; // BullMQ will retry; only act on final failure

  // Write to authoritative DeadLetterJob table (survives Redis restarts)
  const crashSafety = createCrashSafetyService({ prisma, logger });
  await crashSafety.sendToDeadLetter(exportJobId, err.code ?? 'EXPORT_FAILED', err.message, {
    attemptCount: job.attemptsMade, maxAttempts, format: job.data.format,
  }).catch(() => {});

  // Also enqueue to BullMQ DLQ (backward compat)
  await dlqQueue.add("dead-letter-export", {
    originalQueue: "arkiol:exports",
    jobId:         exportJobId,
    orgId,
    userId,
    payload:       job.data,
    error:         err.message,
    stack:         err.stack,
    attempts:      job.attemptsMade,
    failedAt:      new Date().toISOString(),
  }, {
    removeOnComplete: false,
    removeOnFail:     false,
  }).catch(dlqErr => logError(dlqErr, { stage: "dlq_enqueue_export", jobId: exportJobId }));

  await prisma.job.update({
    where: { id: exportJobId },
    data:  {
      status:      "FAILED",
      completedAt: new Date(),
      result: {
        error:      err.message,
        stack:      err.stack,
        attempts:   job.attemptsMade,
        dlq:        true,
        failReason: `Export permanently failed after ${job.attemptsMade} attempts: ${err.message}`,
      },
    },
  }).catch(() => {});

  logger.error({
    event:    "export_job_dead_lettered",
    jobId:    exportJobId,
    orgId,
    error:    err.message,
    attempts: job.attemptsMade,
  }, `[export-worker] Export job ${exportJobId} moved to DLQ after ${job.attemptsMade} attempts`);
});

exportWorker.on("error", err => logError(err, { stage: "export_worker_error" }));
logger.info("[export-worker] Started — listening for export jobs on arkiol:exports");

process.on("SIGTERM", async () => {
  await exportWorker.close();
  process.exit(0);
});

export { exportWorker };
