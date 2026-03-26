/**
 * Assets API — Animation Studio
 * 
 * POST   /api/assets/upload         — Upload asset (multipart)
 * GET    /api/assets/presigned      — Get presigned upload URL
 * GET    /api/assets                — List assets (paginated)
 * GET    /api/assets/:id            — Get single asset
 * DELETE /api/assets/:id            — Soft-delete asset + S3
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { authenticate } from '../middleware/authMiddleware';
import { uploadLimiter } from '../middleware/rateLimiter';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config/env';
import {
  uploadAsset, validateAssetUpload, deleteAsset,
  getPresignedUploadUrl, getImageDimensions,
} from '../services/storageService';

const router = Router();
router.use(authenticate);

// Multer: memory storage, 500 MB limit — mime/size validated in route
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// ── POST /api/assets/upload ────────────────────────────────────
router.post(
  '/upload',
  uploadLimiter,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new AppError('No file provided', 400);

      validateAssetUpload(req.file.mimetype, req.file.size);

      const workspaceId = req.user!.workspaceId!;
      const name = (req.body.name || req.file.originalname).slice(0, 200);
      const brandId = req.body.brandId || null;

      // Check workspace storage quota
      const ws = await db('workspaces').where({ id: workspaceId }).select('storage_used_bytes', 'storage_limit_bytes').first();
      if (ws && ws.storage_limit_bytes > 0 && ws.storage_used_bytes + req.file.size > ws.storage_limit_bytes) {
        throw new AppError(
          'Storage quota exceeded. Delete existing assets or upgrade your plan.',
          402, 'STORAGE_QUOTA_EXCEEDED'
        );
      }

      const { width, height } = await getImageDimensions(req.file.buffer, req.file.mimetype);
      const { s3Key, cdnUrl, thumbnailUrl } = await uploadAsset({
        workspaceId,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        filename: req.file.originalname,
      });

      const assetType = detectAssetType(req.file.mimetype, req.file.originalname);

      const [asset] = await db('assets').insert({
        workspace_id: workspaceId,
        brand_id: brandId,
        uploaded_by: req.user!.userId,
        name,
        original_name: req.file.originalname,
        type: assetType,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        width: width ?? null,
        height: height ?? null,
        s3_key: s3Key,
        s3_bucket: config.S3_BUCKET_ASSETS,
        cdn_url: cdnUrl,
        thumbnail_url: thumbnailUrl ?? null,
      }).returning('*');

      await db('workspaces').where({ id: workspaceId }).update({
        storage_used_bytes: db.raw(`storage_used_bytes + ${req.file.size}`),
      });

      res.status(201).json(asset);
    } catch (err) { next(err); }
  }
);

// ── GET /api/assets/presigned ──────────────────────────────────
router.get('/presigned', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mimeType, filename } = z.object({
      mimeType: z.string().min(1),
      filename: z.string().min(1).max(255),
    }).parse(req.query);

    validateAssetUpload(mimeType, 0);
    const result = await getPresignedUploadUrl({
      workspaceId: req.user!.workspaceId!,
      mimeType,
      filename,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/assets ────────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, brandId, search, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let q = db('assets').where({ workspace_id: req.user!.workspaceId, deleted: false });
    if (type) q = q.where({ type });
    if (brandId) q = q.where({ brand_id: brandId });
    if (search) q = q.where('name', 'ilike', `%${search}%`);

    const [assets, [{ count }]] = await Promise.all([
      q.clone().select(
        'id', 'name', 'type', 'mime_type', 'size_bytes',
        'cdn_url', 'thumbnail_url', 'width', 'height',
        'brand_id', 'created_at'
      ).orderBy('created_at', 'desc').limit(Number(limit)).offset(offset),
      q.clone().count('* as count'),
    ]);

    res.json({ assets, total: Number(count), page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
});

// ── GET /api/assets/:id ────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asset = await db('assets')
      .where({ id: req.params.id, workspace_id: req.user!.workspaceId, deleted: false })
      .first();
    if (!asset) throw new AppError('Asset not found', 404);
    res.json(asset);
  } catch (err) { next(err); }
});

// ── DELETE /api/assets/:id ─────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asset = await db('assets')
      .where({ id: req.params.id, workspace_id: req.user!.workspaceId, deleted: false })
      .first();
    if (!asset) throw new AppError('Asset not found', 404);

    await db('assets').where({ id: asset.id }).update({
      deleted: true,
      deleted_at: new Date(),
    });

    await db('workspaces').where({ id: req.user!.workspaceId }).update({
      storage_used_bytes: db.raw(`GREATEST(0, storage_used_bytes - ${asset.size_bytes})`),
    });

    // Async S3 deletion — don't block the response
    Promise.all([
      deleteAsset(asset.s3_key, asset.s3_bucket),
      asset.thumbnail_url
        ? deleteAsset(asset.s3_key.replace(/\.[^.]+$/, '_thumb.jpg'), asset.s3_bucket)
        : Promise.resolve(),
    ]).catch(err => console.error('[Storage] S3 delete error:', err.message));

    res.json({ message: 'Asset deleted' });
  } catch (err) { next(err); }
});

function detectAssetType(mimeType: string, filename: string): string {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  const name = filename.toLowerCase();
  if (name.includes('logo')) return 'logo';
  if (name.includes('product')) return 'product';
  if (name.includes('pattern') || name.includes('texture')) return 'texture';
  if (mimeType.startsWith('image/')) return 'image';
  return 'other';
}

export default router;
