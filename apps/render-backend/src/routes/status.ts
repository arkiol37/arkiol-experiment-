// apps/render-backend/src/routes/status.ts
//
// GET /status/:jobId
//
// Lightweight status endpoint used for direct diagnostics (curl,
// ops dashboards, retries from non-Vercel clients). The primary
// status surface for end users is still the Vercel frontend's
// /api/jobs?id=<id> — this endpoint exists so the Render service
// is fully self-contained and can be hit independently.
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';

export const statusRouter = Router();

statusRouter.get('/:jobId', async (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  if (!jobId) {
    res.status(400).json({ error: 'Missing jobId' });
    return;
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id:          true,
      type:        true,
      status:      true,
      progress:    true,
      attempts:    true,
      maxAttempts: true,
      createdAt:   true,
      startedAt:   true,
      completedAt: true,
      failedAt:    true,
      result:      true,
    },
  });

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const rawResult = (job.result ?? {}) as Record<string, unknown>;
  const progressStage = (rawResult.progressStage as string) ?? null;
  const progressLabel = (rawResult.progressLabel as string) ?? null;

  res.json({
    jobId:         job.id,
    type:          job.type,
    status:        job.status,
    progress:      job.progress,
    progressStage,
    progressLabel,
    attempts:      job.attempts,
    maxAttempts:   job.maxAttempts,
    createdAt:     job.createdAt,
    startedAt:     job.startedAt,
    completedAt:   job.completedAt,
    failedAt:      job.failedAt,
    error:         job.status === 'FAILED' ? (rawResult.error ?? null) : null,
  });
});
