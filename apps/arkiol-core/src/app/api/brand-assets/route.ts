/**
 * /api/brand-assets — Arkiol Core Brand Asset API
 *
 * GET   /api/brand-assets        — List brand assets for current org
 * POST  /api/brand-assets        — Upload & initiate processing
 * PATCH /api/brand-assets        — Update asset (role override)
 * DELETE /api/brand-assets       — Delete asset
 */
import { NextRequest, NextResponse } from 'next/server';
import { detectCapabilities } from '@arkiol/shared';
import { getServerSession , getRequestUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { dbUnavailable } from "../../../lib/error-handling";

// ── GET — List brand assets ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  try {
    const _ru = await getRequestUser(req).catch(() => null);
  const session = _ru ? { user: { id: _ru.id, email: _ru.email, orgId: _ru.orgId, role: _ru.role } } : null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { orgId: true },
    });

    if (!user?.orgId) {
      return NextResponse.json({ assets: [], total: 0 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '24')));
    const assetType = searchParams.get('type') as any || undefined;
    const processingStatus = searchParams.get('status') as any || undefined;
    const search = searchParams.get('search') || undefined;
    const brandId = searchParams.get('brandId') || undefined;
    const readyOnly = searchParams.get('readyOnly') === 'true';

    const where: any = {
      orgId: user.orgId,
      deletedAt: null,
    };

    if (assetType) where.assetType = assetType;
    if (processingStatus) where.processingStatus = processingStatus;
    if (readyOnly) where.processingStatus = 'ready';
    if (brandId) where.brandId = brandId;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [assets, total] = await Promise.all([
      prisma.brandUploadedAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.brandUploadedAsset.count({ where }),
    ]);

    return NextResponse.json({
      assets: assets.map(formatAsset),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Brand assets GET error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── DELETE — Soft-delete asset ─────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  try {
    const _ru = await getRequestUser(req).catch(() => null);
  const session = _ru ? { user: { id: _ru.id, email: _ru.email, orgId: _ru.orgId, role: _ru.role } } : null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { orgId: true },
    });

    if (!user?.orgId) return NextResponse.json({ error: 'No org' }, { status: 403 });

    await prisma.brandUploadedAsset.updateMany({
      where: { id, orgId: user.orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: session.user.id },
    });

    return NextResponse.json({ message: 'Deleted', id });
  } catch (err: any) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Brand assets DELETE error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── PATCH — Update role override ───────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  try {
    const _ru = await getRequestUser(req).catch(() => null);
  const session = _ru ? { user: { id: _ru.id, email: _ru.email, orgId: _ru.orgId, role: _ru.role } } : null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const body = await req.json();
    const { role } = body;

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { orgId: true },
    });

    if (!user?.orgId) return NextResponse.json({ error: 'No org' }, { status: 403 });

    const updated = await prisma.brandUploadedAsset.updateMany({
      where: { id, orgId: user.orgId, deletedAt: null },
      data: { userRoleOverride: role },
    });

    return NextResponse.json({ updated: updated.count });
  } catch (err: any) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Brand assets PATCH error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── Format helper ──────────────────────────────────────────────────────────

function formatAsset(asset: any) {
  return {
    id: asset.id,
    name: asset.name,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    cdnUrl: asset.cdnUrl,
    thumbnailUrl: asset.thumbnailUrl,
    processingStatus: asset.processingStatus,
    processingError: asset.processingError,
    assetType: asset.assetType,
    usageRole: asset.userRoleOverride || asset.usageRole,
    classificationConfidence: asset.classificationConfidence,
    aiAnalysis: asset.aiAnalysis,
    cutoutUrl: asset.cutoutCdnUrl,
    vectorUrl: asset.vectorCdnUrl,
    enhancedUrl: asset.enhancedCdnUrl,
    extractedPalette: asset.extractedPalette,
    primaryColor: asset.primaryColor,
    hasAlpha: asset.hasAlpha,
    recommendedMotion: asset.recommendedMotion,
    recommendedTransition: asset.recommendedTransition,
    placementHints: asset.scenePlacementHints,
    brandId: asset.brandId,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}
