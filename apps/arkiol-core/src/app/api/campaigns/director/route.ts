// src/app/api/campaigns/director/route.ts
// Campaign Creative Director API
// ─────────────────────────────────────────────────────────────────────────────
//
// POST /api/campaigns/director
//
// Generates a complete CampaignPlan from a single prompt, then optionally
// queues all format generation jobs.
//
// Request body:
//   {
//     prompt:           string     — campaign brief (10–2000 chars)
//     brandId?:         string     — optional brand for colour/tone alignment
//     requestedFormats?:string[]   — explicit formats (defaults to objective-based)
//     queueJobs?:       boolean    — whether to immediately queue generation (default: false)
//     seed?:            string     — override seed for reproducibility
//   }
//
// Response:
//   {
//     campaignPlan:     CampaignPlan
//     jobIds?:          string[]     — if queueJobs=true, created job IDs
//     estimatedCredits: number
//   }

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from "next/server";
import { getServerSession }          from "next-auth";
import { authOptions }               from "../../../../lib/auth";
import { buildCampaignPlan, campaignFormatToGenerationPayload } from "../../../../engines/campaign/creative-director";
import { prisma }                    from "../../../../lib/prisma";
import { logger }                    from "../../../../lib/logger";
import { recordCampaignMetrics }     from "../../../../lib/observability";
import { z }                         from "zod";
import { dbUnavailable } from "../../../../lib/error-handling";

const DirectorRequestSchema = z.object({
  prompt:           z.string().min(10).max(2000),
  brandId:          z.string().optional(),
  requestedFormats: z.array(z.string()).max(10).optional(),
  queueJobs:        z.boolean().default(false),
  seed:             z.string().max(64).optional(),
});

export async function POST(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = DirectorRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validation error" }, { status: 400 });
  }

  const { prompt, brandId, requestedFormats, queueJobs, seed } = parsed.data;
  const userId = session.user.id;
  const orgId  = (session.user as any).orgId ?? userId;

  // Fetch brand colour if brandId provided
  let brandPrimaryColor: string | undefined;
  if (brandId) {
    const brand = await prisma.brand.findUnique({
      where:  { id: brandId },
      select: { primaryColor: true },
    }).catch(() => null);
    brandPrimaryColor = brand?.primaryColor ?? undefined;
  }

  // Build campaign plan
  const campaignPlan = buildCampaignPlan({
    prompt,
    brandId,
    brandPrimaryColor,
    requestedFormats,
    seed,
  });

  // Record observability
  recordCampaignMetrics({
    campaignId:      campaignPlan.campaignId,
    orgId,
    objective:       campaignPlan.objective,
    formatCount:     campaignPlan.formats.length,
    estimatedCredits: campaignPlan.estimatedCredits,
  });

  logger.info({
    campaignId: campaignPlan.campaignId,
    userId,
    orgId,
    objective:  campaignPlan.objective,
    formats:    campaignPlan.formats.length,
  }, "[director] Campaign plan built");

  // Optionally queue generation jobs
  let jobIds: string[] | undefined;
  if (queueJobs) {
    try {
      const { generationQueue } = await import("../../../../lib/queue");
      jobIds = [];

      for (const formatPlan of campaignPlan.formats) {
        const payload = campaignFormatToGenerationPayload(campaignPlan, formatPlan, userId, orgId);

        // Create DB job record
        const job = await prisma.job.create({
          data: {
            type:      "GENERATE_ASSETS",
            status:    "PENDING",
            userId,
            orgId,
            campaignId: campaignPlan.campaignId,
            payload:    payload as any,
          },
        });

        await generationQueue.add("generate", {
          jobId:  job.id,
          ...payload,
        }, {
          priority: formatPlan.role === "hero" ? 1 : 5,
        });

        jobIds.push(job.id);
      }

      logger.info({ campaignId: campaignPlan.campaignId, jobCount: jobIds.length }, "[director] Jobs queued");
    } catch (err: any) {
      logger.error({ err: err.message, campaignId: campaignPlan.campaignId }, "[director] Queue failed");
      // Don't fail the response — plan is still valid
    }
  }

  return NextResponse.json({
    campaignPlan,
    jobIds,
    estimatedCredits: campaignPlan.estimatedCredits,
  });
}
