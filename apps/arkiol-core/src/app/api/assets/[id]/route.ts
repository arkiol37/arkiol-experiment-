// src/app/api/assets/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable} from "../../../../lib/error-handling";
import { getSignedDownloadUrl, deleteFromS3 } from "../../../../lib/s3";
import { ApiError }          from "../../../../lib/types";
import { z }                 from "zod";

// ── GET /api/assets/[id] ──────────────────────────────────────────────────
export const GET = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  if (!detectCapabilities().database) return dbUnavailable();


  const user  = await getRequestUser(req);
  const asset = await prisma.asset.findFirst({
    where:   { id: params.id, userId: user.id },
    include: { campaign: { select: { id: true, name: true } } },
  });
  if (!asset) throw new ApiError(404, "Asset not found");

  // Generate a 1-hour signed download URL
  const downloadUrl = await getSignedDownloadUrl(asset.s3Key, 3600);

  // Generate SVG download URL if stored separately
  const svgKey  = asset.metadata ? (asset.metadata as any)?.svgKey : null;
  const svgUrl  = svgKey ? await getSignedDownloadUrl(svgKey, 3600).catch(() => null) : null;

  return NextResponse.json({
    asset: {
      ...asset,
      svgSource:   undefined, // Don't return raw SVG in single fetch (too large)
      downloadUrl,
      svgUrl,
    },
  });
});

// ── PATCH /api/assets/[id] ────────────────────────────────────────────────
const UpdateAssetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user  = await getRequestUser(req);
  const asset = await prisma.asset.findFirst({ where: { id: params.id, userId: user.id } });
  if (!asset) throw new ApiError(404, "Asset not found");

  const body   = await req.json().catch(() => ({}));
  const parsed = UpdateAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.asset.update({
    where: { id: params.id },
    data:  { ...parsed.data },
  });

  return NextResponse.json({ asset: updated });
});

// ── DELETE /api/assets/[id] ───────────────────────────────────────────────
export const DELETE = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "DELETE_ASSETS");

  const asset = await prisma.asset.findFirst({ where: { id: params.id, userId: user.id } });
  if (!asset) throw new ApiError(404, "Asset not found");

  // Delete from S3 (ignore errors — DB record still removed)
  await deleteFromS3(asset.s3Key).catch(console.warn);
  const svgKey = (asset.metadata as any)?.svgKey;
  if (svgKey) await deleteFromS3(svgKey).catch(console.warn);

  await prisma.asset.delete({ where: { id: params.id } });
  return NextResponse.json({ deleted: true, assetId: params.id });
});
