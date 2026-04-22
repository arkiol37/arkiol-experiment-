// apps/render-backend/src/routes/generate.ts
//
// POST /generate
//
// The Vercel frontend has already:
//   1. Authenticated the user and resolved org / founder status.
//   2. Enforced plan, rate limit, concurrency, and credit rules.
//   3. Created the Job row in Postgres with status=PENDING.
//
// This endpoint takes the jobId + the same generation inputs the
// frontend validated and hands them to the heavy inline pipeline.
// We respond 202 immediately; the frontend polls /status/:jobId.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { scheduleRenderGeneration } from '../lib/runGeneration';

export const generateRouter = Router();

const GenerateBodySchema = z.object({
  jobId:                z.string().min(1),
  userId:               z.string().min(1),
  orgId:                z.string().min(1),
  prompt:               z.string().min(1),
  formats:              z.array(z.string()).min(1),
  stylePreset:          z.string().default('auto'),
  variations:           z.number().int().min(1),
  brandId:              z.string().nullable().optional(),
  campaignId:           z.string().nullable().optional(),
  includeGif:           z.boolean().default(false),
  locale:               z.string().default('en'),
  archetypeOverride:    z
    .object({
      archetypeId: z.string(),
      presetId:    z.string(),
    })
    .optional(),
  expectedCreditCost:   z.number().default(0),
  briefSnapshot:        z.unknown().optional(),
});

generateRouter.post('/', async (req: Request, res: Response) => {
  const parsed = GenerateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error:   'Invalid generation payload',
      details: parsed.error.flatten(),
    });
    return;
  }

  const input = parsed.data;

  // The job row must already exist — the frontend creates it before
  // dispatching here. If it's missing something went wrong upstream
  // and we refuse rather than silently create a new one (the frontend
  // holds the canonical credit / plan accounting).
  const existing = await prisma.job.findUnique({ where: { id: input.jobId } });
  if (!existing) {
    res.status(404).json({ error: `Job ${input.jobId} not found in database` });
    return;
  }

  scheduleRenderGeneration({
    jobId:              input.jobId,
    userId:             input.userId,
    orgId:              input.orgId,
    prompt:             input.prompt,
    formats:            input.formats,
    stylePreset:        input.stylePreset,
    variations:         input.variations,
    brandId:            input.brandId ?? null,
    campaignId:         input.campaignId ?? null,
    includeGif:         input.includeGif,
    locale:             input.locale,
    archetypeOverride:  input.archetypeOverride,
    expectedCreditCost: input.expectedCreditCost,
    briefSnapshot:      input.briefSnapshot,
  });

  res.status(202).json({
    jobId:      input.jobId,
    status:     existing.status,
    accepted:   true,
    durability: 'render_backend',
  });
});
