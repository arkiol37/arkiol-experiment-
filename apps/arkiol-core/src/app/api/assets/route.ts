// src/app/api/assets/route.ts
// FIX: Added thumbnailUrl to asset responses.
// When S3 is configured: thumbnailUrl = signed S3 download URL.
// When S3 is absent:     thumbnailUrl = inline SVG as base64 data URL.
// The gallery UI reads thumbnailUrl for preview rendering.
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma } from "../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { getSignedDownloadUrl, deleteFromS3 } from "../../../lib/s3";
import { ApiError } from "../../../lib/types";
import { z }        from "zod";

export const maxDuration = 30;

// GET /api/assets
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);

  const url        = new URL(req.url);
  const page       = parseInt(url.searchParams.get("page") ?? "1");
  const limit      = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);
  const format     = url.searchParams.get("format");
  const category   = url.searchParams.get("category");
  const campaignId = url.searchParams.get("campaignId");
  const tag        = url.searchParams.get("tag");
  const search     = url.searchParams.get("q");
  const sortBy     = url.searchParams.get("sort") === "brandScore" ? "brandScore" : "createdAt";

  const assets = await prisma.asset.findMany({
    where: {
      userId: user.id,
      ...(format     ? { format }     : {}),
      ...(category   ? { category }   : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(tag        ? { tags: { has: tag } } : {}),
      ...(search     ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    orderBy: sortBy === "brandScore" ? { brandScore: "desc" } : { createdAt: "desc" },
    skip:    (page - 1) * limit,
    take:    limit,
    select: {
      id: true, name: true, format: true, category: true,
      mimeType: true, width: true, height: true, fileSize: true,
      tags: true, layoutFamily: true, brandScore: true,
      hierarchyValid: true, s3Key: true, s3Bucket: true,
      svgSource: true,
      campaignId: true, createdAt: true,
    },
  });

  const total = await prisma.asset.count({ where: { userId: user.id } });

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thisWeek = await prisma.asset.count({
    where: { userId: user.id, createdAt: { gte: weekAgo } },
  });

  const hasS3 = detectCapabilities().storage;

  // Resolve thumbnailUrl for each asset
  const withUrls = await Promise.all(
    assets.map(async (a: any) => {
      let thumbnailUrl: string | null = null;
      let downloadUrl:  string | null = null;

      if (a.s3Key && !a.s3Key.startsWith('inline:') && hasS3) {
        try {
          const url = await getSignedDownloadUrl(a.s3Key, 3600).catch(() => null);
          thumbnailUrl = url;
          downloadUrl  = url;
        } catch { /* no-op */ }
      }

      // Inline SVG fallback: encode as data URL so the <img> tag renders it
      if (!thumbnailUrl && a.svgSource) {
        thumbnailUrl = `data:image/svg+xml;base64,${Buffer.from(a.svgSource).toString('base64')}`;
      }

      // Omit raw svgSource from list response (can be large; use /api/assets/[id] for full data)
      const { svgSource: _omit, ...rest } = a;
      return { ...rest, thumbnailUrl, downloadUrl };
    })
  );

  return NextResponse.json({ assets: withUrls, total, thisWeek, page, limit });
});

// DELETE /api/assets
const DeleteSchema = z.object({
  assetIds: z.array(z.string()).min(1).max(50),
});

export const DELETE = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "DELETE_ASSETS" as any);

  const body   = await req.json().catch(() => ({}));
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Invalid request body");

  const { assetIds } = parsed.data;

  const assets = await prisma.asset.findMany({
    where:  { id: { in: assetIds }, userId: user.id },
    select: { id: true, s3Key: true },
  });

  if (assets.length === 0) throw new ApiError(404, "No matching assets found");

  // Delete from S3
  if (detectCapabilities().storage) {
    await Promise.allSettled(
      assets
        .filter((a: any) => a.s3Key && !a.s3Key.startsWith('inline:'))
        .map((a: any) => deleteFromS3(a.s3Key!).catch(() => {}))
    );
  }

  await prisma.asset.deleteMany({ where: { id: { in: assets.map((a: any) => a.id) } } });

  return NextResponse.json({ deleted: assets.length });
});
