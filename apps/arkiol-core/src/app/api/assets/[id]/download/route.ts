// src/app/api/assets/[id]/download/route.ts
// GET /api/assets/:id/download — redirect to the asset download URL.
// For S3-backed assets: redirects to a short-lived signed URL.
// For inline SVG assets: streams the SVG directly as a download.
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../../../lib/prisma";
import { getRequestUser }    from "../../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../../lib/error-handling";
import { getSignedDownloadUrl } from "../../../../../lib/s3";
import { ApiError }          from "../../../../../lib/types";

export const GET = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user  = await getRequestUser(req);
  const asset = await prisma.asset.findFirst({
    where:  { id: params.id, userId: user.id },
    select: { id: true, name: true, format: true, mimeType: true, s3Key: true, svgSource: true },
  });
  if (!asset) throw new ApiError(404, "Asset not found");

  const filename = `${asset.name ?? asset.id}.${asset.format ?? 'png'}`.replace(/[^a-z0-9._-]/gi, '_');

  // S3-backed: redirect to signed URL
  if (asset.s3Key && !asset.s3Key.startsWith('inline:') && detectCapabilities().storage) {
    const url = await getSignedDownloadUrl(asset.s3Key, 300).catch(() => null);
    if (url) {
      return NextResponse.redirect(url);
    }
  }

  // Inline SVG fallback: stream directly
  if ((asset as any).svgSource) {
    return new NextResponse((asset as any).svgSource, {
      headers: {
        'Content-Type':        'image/svg+xml',
        'Content-Disposition': `attachment; filename="${filename}.svg"`,
        'Cache-Control':       'no-store',
      },
    });
  }

  throw new ApiError(404, "Asset file not found");
});
