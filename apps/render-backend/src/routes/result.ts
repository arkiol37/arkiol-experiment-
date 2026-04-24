// apps/render-backend/src/routes/result.ts
//
// GET /result/:jobId
//
// Returns the full generation result once the job has reached a
// terminal status. For COMPLETED jobs this includes the asset list
// with thumbnail URLs (signed S3 or inline SVG fallback).
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';

export const resultRouter = Router();

resultRouter.get('/:jobId', async (req: Request, res: Response, next) => {
  try {
  const jobId = req.params.jobId;
  if (!jobId) {
    res.status(400).json({ error: 'Missing jobId' });
    return;
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id:          true,
      status:      true,
      progress:    true,
      result:      true,
      completedAt: true,
      failedAt:    true,
    },
  });

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  if (job.status !== 'COMPLETED' && job.status !== 'FAILED') {
    res.status(202).json({
      jobId:    job.id,
      status:   job.status,
      progress: job.progress,
      message:  'Job still running — poll /status/:jobId or retry.',
    });
    return;
  }

  if (job.status === 'FAILED') {
    const rawResult = (job.result ?? {}) as Record<string, unknown>;
    res.status(200).json({
      jobId:    job.id,
      status:   job.status,
      error:    rawResult.error ?? 'Generation failed',
      failedAt: job.failedAt,
    });
    return;
  }

  const rawResult = (job.result ?? {}) as Record<string, unknown>;
  const assetIds = (rawResult.assetIds as string[] | undefined) ?? [];

  const assets = assetIds.length
    ? await prisma.asset.findMany({
        where:  { id: { in: assetIds } },
        select: {
          id:           true,
          name:         true,
          format:       true,
          category:     true,
          width:        true,
          height:       true,
          fileSize:     true,
          brandScore:   true,
          layoutFamily: true,
          createdAt:    true,
          s3Key:        true,
          svgSource:    true,
          metadata:     true,
        },
      })
    : [];

  // Attach a thumbnail URL. The render backend doesn't own S3
  // signing infrastructure (Vercel's lib/s3 already handles that),
  // so we fall back to inline SVG data URLs — the frontend will
  // re-sign via its own /api/jobs endpoint if S3 is available.
  const assetsWithThumbnails = assets.map((a) => {
    const thumbnailUrl = a.svgSource
      ? `data:image/svg+xml;base64,${Buffer.from(a.svgSource).toString('base64')}`
      : null;
    return {
      id:           a.id,
      name:         a.name,
      format:       a.format,
      category:     a.category,
      width:        a.width,
      height:       a.height,
      fileSize:     a.fileSize,
      brandScore:   a.brandScore,
      layoutFamily: a.layoutFamily,
      createdAt:    a.createdAt,
      s3Key:        a.s3Key,
      thumbnailUrl,
      metadata:     a.metadata,
    };
  });

  res.json({
    jobId:       job.id,
    status:      job.status,
    completedAt: job.completedAt,
    creditCost:  rawResult.creditCost ?? 0,
    downloadUrl: rawResult.downloadUrl ?? null,
    exportKey:   rawResult.exportKey ?? null,
    format:      rawResult.format ?? null,
    fileSize:    rawResult.fileSize ?? null,
    assetCount:  assetsWithThumbnails.length,
    assets:      assetsWithThumbnails,
  });
  } catch (err) {
    next(err);
  }
});
