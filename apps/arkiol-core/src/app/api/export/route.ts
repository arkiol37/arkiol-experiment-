// src/app/api/export/route.ts
// Export API — A1 requirements:
//  • Deterministic output: same SVG + params → same bytes
//  • No silent failures: every error is logged and returned clearly
//  • Retry policy: 3 attempts, exponential backoff (5s→15s→45s) via BullMQ
//  • Heavy exports (PNG, GIF, ZIP) run in worker; light ones (SVG, JSON) are served inline
//  • Dead-letter on permanent failure
//  • ZIP: always produces a real ZIP archive (via worker for multi-asset; inline for single)

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../lib/auth";
import { isOwnerRole } from "../../../lib/ownerAccess";
import { rateLimit, rateLimitHeaders } from "../../../lib/rate-limit";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { ApiError, EXPORT_PROFILES, ArkiolCategory } from "../../../lib/types";
import { exportQueue }       from "../../../lib/queue";
import { z }                 from "zod";
import { logError }          from "../../../lib/logger";
import { loadOrgSnapshot, assertEnforcement } from "../../../lib/planGate";
import { checkZipExport, checkGifAccess, preflightJob,
         createExportIdempotencyGuard } from "@arkiol/shared";

// Vercel route config — replaces vercel.json functions block
export const maxDuration = 60;

/** Prisma Asset row — typed locally because the prisma client uses a lazy `any` proxy. */
interface AssetRow {
  id: string; userId: string; orgId: string | null; campaignId: string | null;
  name: string; format: string; category: string; mimeType: string;
  s3Key: string; s3Bucket: string; s3Path: string | null;
  width: number; height: number; fileSize: number;
  tags: string[]; layoutFamily: string | null; svgSource: string | null;
  metadata: Record<string, unknown>; brandScore: number; hierarchyValid: boolean;
  retainUntil: Date | null; createdAt: Date; updatedAt: Date;
}

const ExportSchema = z.object({
  assetIds:    z.array(z.string().min(1)).min(1).max(50),
  format:      z.enum(["svg", "png", "gif", "json", "zip"]),
  pngScale:    z.number().min(0.5).max(3).default(1),
  gifFps:      z.number().int().min(6).max(30).default(12),
  gifType:     z.enum(["kinetic", "fade", "pulse"]).default("kinetic"),
  // A/B Export: when true + format=zip, produces creative_v1.png / creative_v2.png structure
  // with ab_manifest.json ready for Meta/Google Ads Manager bulk upload.
  // Requires canUseZipExport (CREATOR+).
  abPack:      z.boolean().default(false),
  promptLabel: z.string().max(200).optional(),
});

// Idempotency guard — prevents duplicate export jobs within 60s window (Task #5)
const exportIdempotencyGuard = createExportIdempotencyGuard(prisma);

export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "EXPORT_ASSETS");

  const rl = await rateLimit(user.id, "export");
  if (!rl.success) {
    // BUG-004 FIX: Include Retry-After and X-RateLimit-* headers so clients can back off correctly.
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = ExportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { assetIds, format, pngScale, gifFps, gifType, abPack, promptLabel } = parsed.data;

  // Verify all assets belong to this user
  const assets: AssetRow[] = await prisma.asset.findMany({
    where: { id: { in: assetIds }, userId: user.id },
  });
  if (assets.length !== assetIds.length) {
    throw new ApiError(404, "One or more assets not found or access denied");
  }

  const dbUser = await prisma.user.findUnique({
    where:   { id: user.id },
    include: { org: true },
  });
  if (!dbUser?.org) throw new ApiError(403, "No organization");

  // ── Plan enforcement: ZIP and GIF export require specific plan features ────
  if (format === "zip" || format === "gif") {
    const snap = await loadOrgSnapshot(dbUser.org.id, user.role);
    if (!isOwnerRole(user.role)) {
      if (format === "zip") assertEnforcement(checkZipExport(snap));
      if (format === "gif") assertEnforcement(checkGifAccess(snap));
    }
  }

  // ── JSON: inline, no worker needed ───────────────────────────────────────
  if (format === "json") {
    const data = {
      exportedAt:  new Date().toISOString(),
      exportedBy:  user.email,
      count:       assets.length,
      assets: assets.map(a => ({
        id:             a.id,
        name:           a.name,
        format:         a.format,
        category:       a.category,
        dimensions:     `${a.width}x${a.height}`,
        fileSize:       a.fileSize,
        fileSizeKB:     (a.fileSize / 1024).toFixed(1),
        tags:           a.tags,
        layoutFamily:   a.layoutFamily,
        brandScore:     a.brandScore,
        hierarchyValid: a.hierarchyValid,
        createdAt:      a.createdAt,
        metadata:       a.metadata,
      })),
    };
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type":        "application/json",
        "Content-Disposition": `attachment; filename="arkiol-export-${Date.now()}.json"`,
      },
    });
  }

  // ── SVG: inline single asset only ────────────────────────────────────────
  if (format === "svg") {
    if (assets.length > 1) {
      throw new ApiError(400, "SVG export supports a single asset. Use 'zip' format for multiple assets.");
    }
    const asset = assets[0];
    // BUG-013 FIX: Respect EXPORT_PROFILES.supportsSvg — even if svgSource is present in
    // the DB (the pipeline always populates it), some formats (e.g. resume) must not be
    // exported as SVG per product policy.
    const profile = EXPORT_PROFILES[asset.format as ArkiolCategory];
    if (profile && !profile.supportsSvg) {
      throw new ApiError(
        400,
        `SVG export is not supported for the '${asset.format}' format. ` +
        `Use PNG export instead.`
      );
    }
    if (!asset.svgSource) {
      throw new ApiError(400, "SVG source not available for this asset. Re-generate to enable SVG export.");
    }
    return new NextResponse(asset.svgSource, {
      headers: {
        "Content-Type":        "image/svg+xml",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(asset.name)}.svg"`,
      },
    });
  }

  // ── ZIP: enqueue a single job that produces a real zip archive ────────────
  if (format === "zip") {
    // Idempotency: return existing job if duplicate request within 60s window
    const dupExport = await exportIdempotencyGuard.check({
      userId: user.id,
      orgId: dbUser.org.id,
      assetIds,
      format,
    });
    if (dupExport) {
      return NextResponse.json({
        queued: false,
        duplicate: true,
        jobId: dupExport.jobId,
        status: dupExport.status,
        message: `Duplicate export request: a ${format} export job already exists (id=${dupExport.jobId}). Poll /api/jobs?id=${dupExport.jobId} for status.`,
        idempotencyKey: dupExport.idempotencyKey,
      }, { status: 200 });
    }

    const assetsWithSvg = assets.filter(a => !!a.svgSource);
    if (assetsWithSvg.length === 0) {
      throw new ApiError(400, "None of the selected assets have SVG source available. Re-generate to enable export.");
    }

    const dbJob = await prisma.job.create({
      data: {
        type:        "EXPORT_BUNDLE",
        status:      "PENDING",
        userId:      user.id,
        orgId:       dbUser.org.id,
        progress:    0,
        maxAttempts: 3,
        payload: {
          userId:   user.id,
          orgId:    dbUser.org.id,
          assetIds: assetsWithSvg.map((a: { id: string }) => a.id),
          format:   "zip",
          pngScale,
          abPack:      abPack || undefined,
          promptLabel: promptLabel || undefined,
        },
      },
    });

    await exportQueue.add("export", {
      exportJobId: dbJob.id,
      userId:      user.id,
      orgId:       dbUser.org.id,
      assetIds:    assetsWithSvg.map((a: { id: string }) => a.id),
      format:      "zip",
      pngScale,
      abPack:      abPack || undefined,
      promptLabel: promptLabel || undefined,
    }, {
      jobId:    dbJob.id,
      attempts: 3,
      backoff:  { type: "exponential", delay: 5000 },
    }).catch(async (enqueueErr: Error) => {
      logError(enqueueErr, { stage: "zip_enqueue", jobId: dbJob.id });
      await prisma.job.update({
        where: { id: dbJob.id },
        data:  { status: "FAILED", result: { error: "Failed to enqueue ZIP job", detail: enqueueErr.message } },
      });
      throw new ApiError(503, `Export queue unavailable: ${enqueueErr.message}`);
    });

    return NextResponse.json({
      queued:       true,
      jobId:        dbJob.id,
      format:       "zip",
      totalAssets:  assetsWithSvg.length,
      skippedAssets: assets.length - assetsWithSvg.length,
      message:      `ZIP export queued. Poll /api/jobs?id=${dbJob.id} for status and download URL.`,
      estimatedSeconds: Math.round(assetsWithSvg.length * 8),
    }, { status: 202 });
  }

  // ── PNG / GIF: enqueue single-asset worker job ────────────────────────────
  if (format === "png" || format === "gif") {
    if (assets.length > 1) {
      throw new ApiError(400, `${format.toUpperCase()} export supports one asset at a time. Use 'zip' for multiple.`);
    }
    const asset = assets[0];
    if (!asset.svgSource) {
      throw new ApiError(400, "SVG source not available for this asset. Re-generate to enable PNG/GIF export.");
    }

    const dbJob = await prisma.job.create({
      data: {
        type:        "EXPORT_BUNDLE",
        status:      "PENDING",
        userId:      user.id,
        orgId:       dbUser.org.id,
        progress:    0,
        maxAttempts: 3,
        payload: {
          userId:   user.id,
          orgId:    dbUser.org.id,
          assetId:  asset.id,
          format,
          pngScale,
          gifFps,
          gifType,
        },
      },
    });

    await exportQueue.add("export", {
      exportJobId: dbJob.id,
      userId:      user.id,
      orgId:       dbUser.org.id,
      assetId:     asset.id,
      format,
      pngScale,
      gifFps,
      gifType,
    }, {
      jobId:    dbJob.id,
      attempts: 3,
      backoff:  { type: "exponential", delay: 5000 },
    }).catch(async (enqueueErr: Error) => {
      logError(enqueueErr, { stage: "export_enqueue", jobId: dbJob.id });
      await prisma.job.update({
        where: { id: dbJob.id },
        data:  { status: "FAILED", result: { error: "Failed to enqueue export job", detail: enqueueErr.message } },
      });
      throw new ApiError(503, `Export queue unavailable: ${enqueueErr.message}`);
    });

    return NextResponse.json({
      queued:           true,
      jobId:            dbJob.id,
      format,
      assetId:          asset.id,
      assetName:        asset.name,
      message:          `Export queued. Poll /api/jobs?id=${dbJob.id} for status and download URL.`,
      estimatedSeconds: format === "gif" ? 20 : 8,
    }, { status: 202 });
  }

  throw new ApiError(400, `Unsupported export format: ${format}`);
});
