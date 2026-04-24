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
//
// Schema is intentionally generous: it accepts both the canonical
// field names (formats, stylePreset, includeGif, archetypeOverride)
// and shorter aliases (format, style, animation, archetype) that
// the Vercel forwarder sends in parallel. Extra unknown fields are
// silently dropped (Zod default), so future additions on the
// Vercel side don't need a coordinated backend release.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { scheduleRenderGeneration } from '../lib/runGeneration';

export const generateRouter = Router();

const ArchetypeOverrideSchema = z
  .object({
    archetypeId: z.string().min(1).default('auto'),
    presetId:    z.string().min(1).default('auto'),
  })
  .partial()
  .transform((v) => ({
    archetypeId: v.archetypeId?.trim() || 'auto',
    presetId:    v.presetId?.trim()    || 'auto',
  }));

const GenerateBodySchema = z.object({
  // Identity / metadata — all required and supplied by Vercel.
  jobId:              z.string().min(1),
  userId:             z.string().min(1),
  orgId:              z.string().min(1),

  // Generation inputs.
  prompt:             z.string().min(1),
  // `formats` (canonical) OR `format` (singular alias). At least
  // one must resolve to a non-empty string array downstream.
  formats:            z.array(z.string()).min(1).optional(),
  format:             z.string().min(1).optional(),

  // Style preset — accept either `stylePreset` or `style`.
  stylePreset:        z.string().optional(),
  style:              z.string().optional(),

  variations:         z.coerce.number().int().min(1).default(1),
  brandId:            z.string().nullable().optional(),
  campaignId:         z.string().nullable().optional(),

  // Animation flag — accept either `includeGif` or `animation`.
  includeGif:         z.boolean().optional(),
  animation:          z.boolean().optional(),

  locale:             z.string().default('en'),

  // Archetype — top-level `archetype` shorthand or full
  // `archetypeOverride` object. Coerced to the same shape internally.
  archetype:          z.string().optional(),
  archetypeOverride:  ArchetypeOverrideSchema.optional(),

  expectedCreditCost: z.coerce.number().default(0),
  hqUpgrade:          z.boolean().optional(),
  youtubeThumbnailMode: z.string().optional(),

  // Optional — populated only on retry, the frontend never sends it.
  briefSnapshot:      z.unknown().optional(),
}).superRefine((v, ctx) => {
  // Require either `formats` (array) or `format` (single string).
  if ((!v.formats || v.formats.length === 0) && !v.format) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['formats'],
      message: 'Either `formats` (string[]) or `format` (string) is required.',
    });
  }
});

generateRouter.post('/', async (req: Request, res: Response, next) => {
  try {
  const parsed = GenerateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    // Log the failed payload (truncated) + Zod issues so the
    // operator can see the exact mismatch in Render's logs. We
    // truncate `prompt` because it can be long; everything else
    // is short metadata.
    const safeBody = {
      ...(typeof req.body === 'object' && req.body !== null ? req.body : {}),
      prompt: typeof req.body?.prompt === 'string'
        ? `${(req.body.prompt as string).slice(0, 64)}…`
        : req.body?.prompt,
    };
    // eslint-disable-next-line no-console
    console.warn(
      '[render-backend] /generate validation failed:',
      JSON.stringify({
        issues:  parsed.error.flatten(),
        bodyKeys: Object.keys(safeBody),
        body:    safeBody,
      }),
    );
    res.status(400).json({
      error:   'Invalid generation payload',
      details: parsed.error.flatten(),
    });
    return;
  }

  const v = parsed.data;

  // Normalise canonical fields.
  const formats: string[] = (v.formats && v.formats.length > 0)
    ? v.formats
    : (v.format ? [v.format] : []);
  const stylePreset: string = v.stylePreset ?? v.style ?? 'auto';
  const includeGif: boolean = v.includeGif ?? v.animation ?? false;
  const archetypeOverride =
    v.archetypeOverride ??
    (v.archetype
      ? { archetypeId: v.archetype, presetId: 'auto' }
      : undefined);

  // The job row must already exist — the frontend creates it before
  // dispatching here. If it's missing something went wrong upstream
  // and we refuse rather than silently create a new one (the frontend
  // holds the canonical credit / plan accounting).
  const existing = await prisma.job.findUnique({ where: { id: v.jobId } });
  if (!existing) {
    res.status(404).json({ error: `Job ${v.jobId} not found in database` });
    return;
  }

  scheduleRenderGeneration({
    jobId:              v.jobId,
    userId:             v.userId,
    orgId:              v.orgId,
    prompt:             v.prompt,
    formats,
    stylePreset,
    variations:         v.variations,
    brandId:            v.brandId ?? null,
    campaignId:         v.campaignId ?? null,
    includeGif,
    locale:             v.locale,
    archetypeOverride,
    expectedCreditCost: v.expectedCreditCost,
    briefSnapshot:      v.briefSnapshot,
  });

  res.status(202).json({
    jobId:      v.jobId,
    status:     existing.status,
    accepted:   true,
    durability: 'render_backend',
  });
  } catch (err) {
    // Express 4 doesn't auto-forward async rejections; without this
    // catch an unhandled rejection (e.g. Prisma can't reach the DB
    // during the job lookup) crashes the whole Render process.
    next(err);
  }
});
