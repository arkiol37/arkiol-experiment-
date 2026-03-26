/**
 * Storage Service — Animation Studio
 * 
 * AWS S3 operations with CloudFront CDN.
 * Supports: upload assets, upload renders, presigned URLs, GDPR deletion.
 */
import {
  S3Client, PutObjectCommand, DeleteObjectCommand,
  DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import sharp from 'sharp';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger';
import { config } from '../config/env';
import { AppError } from '../middleware/errorHandler';

const s3 = new S3Client({
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
});

const CDN_BASE = config.CDN_URL.replace(/\/$/, '');

function toCdnUrl(key: string): string {
  return `${CDN_BASE}/${key}`;
}

// ── Allowed asset MIME types ───────────────────────────────────
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac'];
const ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES];

const MAX_ASSET_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

export function validateAssetUpload(mimeType: string, sizeBytes: number): void {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new AppError(
      `File type "${mimeType}" is not allowed. Supported: images, videos, audio.`,
      400, 'INVALID_FILE_TYPE'
    );
  }
  if (sizeBytes > MAX_ASSET_SIZE_BYTES) {
    throw new AppError(
      `File too large (${Math.round(sizeBytes / 1048576)}MB). Maximum: 500MB.`,
      400, 'FILE_TOO_LARGE'
    );
  }
}

// ── Upload asset ───────────────────────────────────────────────
export async function uploadAsset(params: {
  workspaceId: string;
  buffer: Buffer;
  mimeType: string;
  filename: string;
  folder?: string;
}): Promise<{ s3Key: string; cdnUrl: string; thumbnailUrl?: string }> {
  const ext = path.extname(params.filename).toLowerCase() || '.bin';
  const folder = params.folder || 'assets';
  const key = `${folder}/${params.workspaceId}/${uuidv4()}${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: config.S3_BUCKET_ASSETS,
    Key: key,
    Body: params.buffer,
    ContentType: params.mimeType,
    CacheControl: 'max-age=31536000',
  }));

  let thumbnailUrl: string | undefined;

  // Generate thumbnail for images
  if (ALLOWED_IMAGE_TYPES.includes(params.mimeType) && params.mimeType !== 'image/svg+xml') {
    try {
      const thumbBuf = await sharp(params.buffer)
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      const thumbKey = key.replace(ext, '_thumb.jpg');
      await s3.send(new PutObjectCommand({
        Bucket: config.S3_BUCKET_ASSETS,
        Key: thumbKey,
        Body: thumbBuf,
        ContentType: 'image/jpeg',
        CacheControl: 'max-age=31536000',
      }));
      thumbnailUrl = toCdnUrl(thumbKey);
    } catch (err: any) {
      logger.warn(`[Storage] Thumbnail generation failed: ${err.message}`);
    }
  }

  return { s3Key: key, cdnUrl: toCdnUrl(key), thumbnailUrl };
}

// ── Upload arbitrary buffer (brand asset processing variants) ──
/**
 * Upload a raw buffer to S3 under a specific key.
 * Used by the brand asset processing pipeline for cutouts, vectors, enhanced variants.
 */
export async function uploadBuffer(params: {
  key: string;
  buffer: Buffer;
  mimeType: string;
  workspaceId: string;
}): Promise<{ cdnUrl: string }> {
  await s3.send(new PutObjectCommand({
    Bucket: config.S3_BUCKET_ASSETS,
    Key: params.key,
    Body: params.buffer,
    ContentType: params.mimeType,
    CacheControl: 'max-age=31536000',
    Metadata: { workspaceId: params.workspaceId },
  }));
  return { cdnUrl: toCdnUrl(params.key) };
}

// ── Upload render output ───────────────────────────────────────
export async function uploadRender(params: {
  workspaceId: string;
  renderId: string;
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<{ s3Key: string; cdnUrl: string }> {
  const ext = path.extname(params.filename).toLowerCase() || '.mp4';
  const key = `renders/${params.workspaceId}/${params.renderId}/${params.filename}`;

  await s3.send(new PutObjectCommand({
    Bucket: config.S3_BUCKET_RENDERS,
    Key: key,
    Body: params.buffer,
    ContentType: params.mimeType,
    CacheControl: 'max-age=86400',
  }));

  return { s3Key: key, cdnUrl: toCdnUrl(key) };
}

// ── Delete single asset ────────────────────────────────────────
export async function deleteAsset(key: string, bucket: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  logger.info(`[Storage] Deleted ${bucket}/${key}`);
}

// ── Presigned upload URL (for direct browser upload) ──────────
export async function getPresignedUploadUrl(params: {
  workspaceId: string;
  mimeType: string;
  filename: string;
}): Promise<{ url: string; fields: Record<string, string>; key: string; cdnUrl: string }> {
  validateAssetUpload(params.mimeType, 0);

  const ext = path.extname(params.filename).toLowerCase() || '.bin';
  const key = `assets/${params.workspaceId}/${uuidv4()}${ext}`;

  const { url, fields } = await createPresignedPost(s3, {
    Bucket: config.S3_BUCKET_ASSETS,
    Key: key,
    Conditions: [
      ['content-length-range', 1, MAX_ASSET_SIZE_BYTES],
      ['eq', '$Content-Type', params.mimeType],
    ],
    Fields: { 'Content-Type': params.mimeType },
    Expires: 300, // 5 minutes
  });

  return { url, fields, key, cdnUrl: toCdnUrl(key) };
}

// ── Presigned download URL (signed CloudFront / S3) ───────────
export async function getPresignedDownloadUrl(
  key: string, bucket: string, expiresInSecs = 3600
): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSecs }
  );
}

// ── GDPR: delete all workspace assets and renders ─────────────
export async function deleteWorkspaceAssets(workspaceId: string): Promise<number> {
  let deleted = 0;

  const prefixes = [
    { bucket: config.S3_BUCKET_ASSETS, prefix: `assets/${workspaceId}/` },
    { bucket: config.S3_BUCKET_RENDERS, prefix: `renders/${workspaceId}/` },
  ];

  for (const { bucket, prefix } of prefixes) {
    let continuationToken: string | undefined;
    do {
      const list = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));

      if (list.Contents?.length) {
        const objects = list.Contents.map(o => ({ Key: o.Key! }));
        await s3.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects, Quiet: true },
        }));
        deleted += objects.length;
        logger.info(`[Storage] GDPR deleted ${objects.length} objects from ${bucket}/${prefix}`);
      }

      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  return deleted;
}

// ── Get image dimensions ───────────────────────────────────────
export async function getImageDimensions(
  buffer: Buffer, mimeType: string
): Promise<{ width?: number; height?: number }> {
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType) || mimeType === 'image/svg+xml') return {};
  try {
    const meta = await sharp(buffer).metadata();
    return { width: meta.width, height: meta.height };
  } catch { return {}; }
}
