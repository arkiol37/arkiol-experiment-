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
//
// Failure policy: this endpoint powers the gallery landing page. Any hard
// failure here makes the dashboard show a red banner instead of an empty
// state, which is a worse UX than "No designs yet". We therefore degrade to a
// 200 empty payload on unexpected errors, and only return an HTTP error when
// the caller genuinely can't proceed (auth / capabilities missing).
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const url        = new URL(req.url);
  const pageRaw    = parseInt(url.searchParams.get("page") ?? "1");
  const limitRaw   = parseInt(url.searchParams.get("limit") ?? "20");
  const page       = Number.isFinite(pageRaw)  && pageRaw  > 0 ? pageRaw  : 1;
  const limit      = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const format     = url.searchParams.get("format");
  const category   = url.searchParams.get("category");
  const campaignId = url.searchParams.get("campaignId");
  const tag        = url.searchParams.get("tag");
  const search     = url.searchParams.get("q");
  const sortBy     = url.searchParams.get("sort") === "brandScore" ? "brandScore" : "createdAt";

  // Auth resolution is the only path that should yield 401/503. Anything else
  // past this point must never bubble up to the 500 branch — we render empty.
  let user: { id: string; role: string; orgId: string; email: string };
  try {
    user = await getRequestUser(req);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error("[api/assets] Unexpected auth failure:", err);
    throw new ApiError(401, "Authentication required");
  }

  let assets: any[] = [];
  let total = 0;
  let thisWeek = 0;

  try {
    assets = await prisma.asset.findMany({
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

    total = await prisma.asset.count({ where: { userId: user.id } });

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    thisWeek = await prisma.asset.count({
      where: { userId: user.id, createdAt: { gte: weekAgo } },
    });
  } catch (dbErr: any) {
    console.error("[api/assets] Database query failed:", dbErr?.message ?? dbErr);
    return NextResponse.json({ assets: [], total: 0, thisWeek: 0, page, limit, dbError: true });
  }

  const hasS3 = (() => {
    try { return detectCapabilities().storage; } catch { return false; }
  })();

  // Resolve thumbnailUrl for each asset. Every map entry is wrapped so one
  // bad row can't reject the whole Promise.all and tip the request into 500.
  const withUrls = await Promise.all(
    assets.map(async (a: any) => {
      try {
        let thumbnailUrl: string | null = null;
        let downloadUrl:  string | null = null;

        if (a.s3Key && !a.s3Key.startsWith('inline:') && hasS3) {
          try {
            const url = await getSignedDownloadUrl(a.s3Key, 3600).catch(() => null);
            thumbnailUrl = url;
            downloadUrl  = url;
          } catch { /* no-op */ }
        }

        if (!thumbnailUrl && a.svgSource) {
          try {
            thumbnailUrl = `data:image/svg+xml;base64,${Buffer.from(String(a.svgSource), 'utf8').toString('base64')}`;
          } catch { /* no-op */ }
        }

        const { svgSource: _omit, ...rest } = a;
        return { ...rest, thumbnailUrl, downloadUrl };
      } catch (err) {
        console.warn(`[api/assets] Row hydration failed for ${a?.id}:`, err);
        const { svgSource: _omit, ...rest } = a ?? {};
        return { ...rest, thumbnailUrl: null, downloadUrl: null };
      }
    })
  ).catch((err) => {
    console.error("[api/assets] Promise.all hydration failed:", err);
    return [] as any[];
  });

  try {
    return NextResponse.json({ assets: withUrls, total, thisWeek, page, limit });
  } catch (err) {
    console.error("[api/assets] Response serialization failed:", err);
    return NextResponse.json({ assets: [], total: 0, thisWeek: 0, page, limit, responseError: true });
  }
});

// DELETE /api/assets
const DeleteSchema = z.object({
  assetIds: z.array(z.string()).min(1).max(50),
});

export const DELETE = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "DELETE_ASSETS");

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
