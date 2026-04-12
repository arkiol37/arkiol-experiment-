// src/app/api/assets/[id]/route.ts
// FIX: Added SVG data-URL fallback when S3 is not configured.
// getSignedDownloadUrl throws when AWS credentials are absent — wrapped in try/catch.
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable} from "../../../../lib/error-handling";
import { getSignedDownloadUrl, deleteFromS3 } from "../../../../lib/s3";
import { ApiError }          from "../../../../lib/types";
import { z }                 from "zod";

// GET /api/assets/[id]
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

  const hasS3 = detectCapabilities().storage;
  const isInline = !asset.s3Key || asset.s3Key.startsWith('inline:');

  // Resolve download URL: S3 signed URL or SVG data URL fallback
  let downloadUrl: string | null = null;
  let svgUrl:      string | null = null;

  if (!isInline && hasS3) {
    downloadUrl = await getSignedDownloadUrl(asset.s3Key, 3600).catch(() => null);
    const svgKey = asset.metadata ? (asset.metadata as any)?.svgKey : null;
    svgUrl = svgKey ? await getSignedDownloadUrl(svgKey, 3600).catch(() => null) : null;
  }

  // Inline SVG fallback — returned as data URL so <img> tags render it
  if (!downloadUrl && (asset as any).svgSource) {
    downloadUrl = `data:image/svg+xml;base64,${Buffer.from((asset as any).svgSource).toString('base64')}`;
    svgUrl = downloadUrl;
  }

  // Also check metadata.thumbnailUrl stored by inlineGenerate
  const metaThumbnail = (asset.metadata as any)?.thumbnailUrl ?? null;
  if (!downloadUrl && metaThumbnail) {
    downloadUrl = metaThumbnail;
  }

  return NextResponse.json({
    asset: {
      ...asset,
      svgSource:   undefined, // don't send raw SVG in response (can be large)
      downloadUrl,
      svgUrl,
      thumbnailUrl: downloadUrl, // alias for consistent frontend access
    },
  });
});

// PATCH /api/assets/[id]
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
  if (!parsed.success) throw new ApiError(400, "Invalid update data");

  const updated = await prisma.asset.update({
    where: { id: params.id },
    data:  parsed.data,
  });

  return NextResponse.json({ asset: updated });
});

// DELETE /api/assets/[id]
export const DELETE = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user  = await getRequestUser(req);
  requirePermission(user.role, "DELETE_ASSETS");

  const asset = await prisma.asset.findFirst({ where: { id: params.id, userId: user.id } });
  if (!asset) throw new ApiError(404, "Asset not found");

  if (detectCapabilities().storage && asset.s3Key && !asset.s3Key.startsWith('inline:')) {
    await deleteFromS3(asset.s3Key).catch(() => {});
    const svgKey = (asset.metadata as any)?.svgKey;
    if (svgKey) await deleteFromS3(svgKey).catch(() => {});
  }

  await prisma.asset.delete({ where: { id: params.id } });

  return NextResponse.json({ deleted: true });
});
