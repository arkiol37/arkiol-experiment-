// src/app/api/assets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma } from "../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { getSignedDownloadUrl, deleteFromS3 } from "../../../lib/s3";
import { ApiError } from "../../../lib/types";
import { z }        from "zod";

// Vercel route config — replaces vercel.json functions block
export const maxDuration = 30;


// ── GET /api/assets ────────────────────────────────────────────────────────
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
      campaignId: true, createdAt: true,
    },
  });

  const total = await prisma.asset.count({ where: { userId: user.id } });

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thisWeek = await prisma.asset.count({
    where: { userId: user.id, createdAt: { gte: weekAgo } },
  });

  // Generate time-limited signed URLs for each asset
  const withUrls = await Promise.all(
    assets.map(async a => ({
      ...a,
      downloadUrl: await getSignedDownloadUrl(a.s3Key, 3600).catch(() => null),
    }))
  );

  return NextResponse.json({ assets: withUrls, total, thisWeek, page, limit });
});

// ── DELETE /api/assets ─────────────────────────────────────────────────────
const DeleteSchema = z.object({
  assetIds: z.array(z.string()).min(1).max(50),
});

export const DELETE = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "DELETE_ASSETS");

  const body   = await req.json().catch(() => ({}));
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { assetIds } = parsed.data;

  // Verify ownership
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds }, userId: user.id },
    select: { id: true, s3Key: true, metadata: true },
  });
  if (assets.length !== assetIds.length) {
    throw new ApiError(404, "One or more assets not found or access denied");
  }

  // Delete from S3 — main key and SVG key (stored in metadata.svgKey)
  const s3Deletions: Promise<void>[] = [];
  for (const a of assets) {
    s3Deletions.push(deleteFromS3(a.s3Key));
    const svgKey = (a.metadata as any)?.svgKey;
    if (svgKey) s3Deletions.push(deleteFromS3(svgKey));
  }
  await Promise.allSettled(s3Deletions);

  // Delete from DB
  await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });

  return NextResponse.json({ deleted: assets.length });
});

// ── PATCH /api/assets — Update tags/name ──────────────────────────────────
const UpdateSchema = z.object({
  assetId: z.string(),
  name:    z.string().max(200).optional(),
  tags:    z.array(z.string().max(50)).max(20).optional(),
});

export const PATCH = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user   = await getRequestUser(req);
  const body   = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { assetId, ...updates } = parsed.data;

  const asset = await prisma.asset.findFirst({ where: { id: assetId, userId: user.id } });
  if (!asset) throw new ApiError(404, "Asset not found");

  const updated = await prisma.asset.update({
    where: { id: assetId },
    data:  updates,
  });

  return NextResponse.json({ asset: updated });
});
