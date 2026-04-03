/**
 * Brand Asset Library API Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * POST   /api/brand-assets/upload           — Upload + enqueue processing
 * GET    /api/brand-assets                  — List brand assets (paginated, filtered)
 * GET    /api/brand-assets/:id              — Get single asset with full processing result
 * PATCH  /api/brand-assets/:id/role        — Override usage role
 * POST   /api/brand-assets/:id/reprocess   — Re-run processing pipeline
 * DELETE /api/brand-assets/:id             — Soft-delete asset
 * GET    /api/brand-assets/palette/:ids    — Merged palette for a set of asset IDs
 * POST   /api/brand-assets/slots           — Resolve asset → scene slot assignments
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { authenticate } from '../middleware/authMiddleware';
import { uploadLimiter } from '../middleware/rateLimiter';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config/env';
import { uploadAsset, validateAssetUpload, deleteAsset, getImageDimensions } from '../services/storageService';
import {
  processBrandAsset,
  resolveAssetSlotsForAd,
  mergeBrandPalette,
  retryFailedAsset,
  type UsageRole,
} from '../services/brandAssetProcessor';
import { logger } from '../config/logger';

const router = Router();
router.use(authenticate);

// Multer: memory storage, 50MB limit for brand assets
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ── Validation Schemas ─────────────────────────────────────────────────────

const VALID_ROLES: UsageRole[] = [
  'logo_slot', 'product_slot', 'screenshot_slot',
  'brand_reveal_slot', 'background_slot', 'accent_slot',
];

const VALID_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/svg+xml',
  'image/gif', 'image/avif', 'image/tiff',
];

// ── POST /api/brand-assets/upload ─────────────────────────────────────────

router.post(
  '/upload',
  uploadLimiter,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new AppError('No file provided', 400);

      const { mimetype, size, buffer, originalname } = req.file;

      // Validate mime type
      if (!VALID_MIME_TYPES.includes(mimetype)) {
        throw new AppError(
          `Unsupported file type: ${mimetype}. Supported: JPEG, PNG, WebP, SVG, GIF, AVIF`,
          400, 'UNSUPPORTED_FILE_TYPE'
        );
      }

      // Max 50MB
      if (size > 50 * 1024 * 1024) {
        throw new AppError('File too large. Maximum size is 50MB', 413, 'FILE_TOO_LARGE');
      }

      const workspaceId = req.user!.workspaceId!;
      const name = (req.body.name || originalname).slice(0, 200);
      const brandId = req.body.brandId || null;

      // Get dimensions
      const { width, height } = await getImageDimensions(buffer, mimetype).catch(() => ({ width: null, height: null }));

      // Upload original to S3
      const { s3Key, cdnUrl, thumbnailUrl } = await uploadAsset({
        workspaceId,
        buffer,
        mimeType: mimetype,
        filename: originalname,
        folder: 'brand-assets',
      });

      // Insert DB record
      const [asset] = await db('brand_assets').insert({
        workspace_id: workspaceId,
        brand_id: brandId,
        uploaded_by: req.user!.userId,
        name,
        original_name: originalname,
        mime_type: mimetype,
        size_bytes: size,
        width: width ?? null,
        height: height ?? null,
        s3_key: s3Key,
        s3_bucket: config.S3_BUCKET_ASSETS,
        cdn_url: cdnUrl,
        thumbnail_url: thumbnailUrl ?? null,
        processing_status: 'pending',
        asset_type: 'other', // will be updated after processing
        created_at: new Date(),
        updated_at: new Date(),
      }).returning('*');

      // Trigger async processing pipeline
      // In production this would be pushed to a BullMQ job queue.
      // Here we fire-and-forget after sending the response.
      setImmediate(async () => {
        try {
          await processBrandAsset(asset.id, buffer, mimetype, originalname, workspaceId);
          logger.info('Brand asset processed successfully', { assetId: asset.id });
        } catch (err: any) {
          logger.error('Brand asset processing failed', { assetId: asset.id, err: err.message });
          await db('brand_assets').where({ id: asset.id }).update({
            processing_status: 'failed',
            processing_error: err.message,
            updated_at: new Date(),
          });
        }
      });

      res.status(201).json({
        asset: formatAsset(asset),
        message: 'Asset uploaded successfully. AI processing has started.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/brand-assets ──────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId!;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 24));
    const assetType = req.query.type as string || undefined;
    const search = req.query.search as string || undefined;
    const brandId = req.query.brandId as string || undefined;
    const status = req.query.status as string || undefined;
    const readyOnly = req.query.readyOnly === 'true';

    let query = db('brand_assets')
      .where({ workspace_id: workspaceId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');

    if (assetType) query = query.where('asset_type', assetType);
    if (search) query = query.whereILike('name', `%${search}%`);
    if (brandId) query = query.where('brand_id', brandId);
    if (status) query = query.where('processing_status', status);
    if (readyOnly) query = query.where('processing_status', 'ready');

    const total = await query.clone().count('id as count').first();
    const assets = await query.limit(limit).offset((page - 1) * limit).select('*');

    res.json({
      assets: assets.map(formatAsset),
      pagination: {
        page,
        limit,
        total: parseInt(total?.count as string) || 0,
        pages: Math.ceil((parseInt(total?.count as string) || 0) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/brand-assets/palette/:ids ────────────────────────────────────

router.get('/palette/:ids', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assetIds = req.params.ids.split(',').filter(Boolean).slice(0, 20);
    if (!assetIds.length) {
      return res.json({ palette: [] });
    }

    // Verify assets belong to this workspace
    const workspaceId = req.user!.workspaceId!;
    const verified = await db('brand_assets')
      .whereIn('id', assetIds)
      .where({ workspace_id: workspaceId })
      .pluck('id');

    const palette = await mergeBrandPalette(verified);
    res.json({ palette, count: palette.length });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/brand-assets/slots ──────────────────────────────────────────

router.post('/slots', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      assetIds: z.array(z.string().uuid()).min(1).max(20),
      sceneRoles: z.array(z.string()).min(1).max(10),
    });

    const { assetIds, sceneRoles } = schema.parse(req.body);
    const workspaceId = req.user!.workspaceId!;

    // Verify ownership
    const verified = await db('brand_assets')
      .whereIn('id', assetIds)
      .where({ workspace_id: workspaceId })
      .pluck('id');

    const slots = await resolveAssetSlotsForAd(verified, sceneRoles);
    const palette = await mergeBrandPalette(verified);

    res.json({ slots, palette });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/brand-assets/:id ─────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId!;
    const asset = await db('brand_assets')
      .where({ id: req.params.id, workspace_id: workspaceId })
      .whereNull('deleted_at')
      .first();

    if (!asset) throw new AppError('Asset not found', 404);
    res.json({ asset: formatAsset(asset) });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/brand-assets/:id/role ─────────────────────────────────────

router.patch('/:id/role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      role: z.enum(VALID_ROLES as [UsageRole, ...UsageRole[]]),
    });

    const { role } = schema.parse(req.body);
    const workspaceId = req.user!.workspaceId!;

    const [updated] = await db('brand_assets')
      .where({ id: req.params.id, workspace_id: workspaceId })
      .whereNull('deleted_at')
      .update({
        user_role_override: role,
        updated_at: new Date(),
      })
      .returning('*');

    if (!updated) throw new AppError('Asset not found', 404);
    res.json({ asset: formatAsset(updated) });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/brand-assets/:id/reprocess ──────────────────────────────────

router.post('/:id/reprocess', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId!;
    const asset = await db('brand_assets')
      .where({ id: req.params.id, workspace_id: workspaceId })
      .whereNull('deleted_at')
      .first();

    if (!asset) throw new AppError('Asset not found', 404);

    // Re-fetch original from S3 (in production)
    // For now, reset processing status
    await retryFailedAsset(asset.id);

    res.json({ message: 'Reprocessing queued', assetId: asset.id });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/brand-assets/:id ─────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user!.workspaceId!;

    const [deleted] = await db('brand_assets')
      .where({ id: req.params.id, workspace_id: workspaceId })
      .whereNull('deleted_at')
      .update({
        deleted_at: new Date(),
        deleted_by: req.user!.userId,
        updated_at: new Date(),
      })
      .returning('id');

    if (!deleted) throw new AppError('Asset not found', 404);
    res.json({ message: 'Asset deleted', id: deleted.id });
  } catch (err) {
    next(err);
  }
});

// ── Format Helper ──────────────────────────────────────────────────────────

function formatAsset(asset: any) {
  return {
    id: asset.id,
    name: asset.name,
    originalName: asset.original_name,
    mimeType: asset.mime_type,
    sizeBytes: asset.size_bytes,
    width: asset.width,
    height: asset.height,
    cdnUrl: asset.cdn_url,
    thumbnailUrl: asset.thumbnail_url,
    // Processing
    processingStatus: asset.processing_status,
    processingError: asset.processing_error,
    // Classification
    assetType: asset.asset_type,
    usageRole: asset.user_role_override || asset.usage_role,
    classificationConfidence: asset.classification_confidence,
    aiAnalysis: asset.ai_analysis,
    // Processed variants
    cutoutUrl: asset.cutout_cdn_url,
    vectorUrl: asset.vector_cdn_url,
    enhancedUrl: asset.enhanced_cdn_url,
    // Colors
    extractedPalette: asset.extracted_palette,
    primaryColor: asset.primary_color,
    hasAlpha: asset.has_alpha,
    // Motion
    recommendedMotion: asset.recommended_motion,
    recommendedTransition: asset.recommended_transition,
    placementHints: asset.scene_placement_hints,
    // Meta
    brandId: asset.brand_id,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
  };
}

export default router;
