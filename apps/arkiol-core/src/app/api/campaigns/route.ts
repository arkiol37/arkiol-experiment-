// src/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma } from "../../../lib/prisma";
import { getAuthUser, requirePermission } from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { rateLimit, rateLimitHeaders } from "../../../lib/rate-limit";
import { generationQueue }   from "../../../lib/queue";
import { ApiError }          from "../../../lib/types";
import { z }                 from "zod";

// Vercel route config — replaces vercel.json functions block
export const maxDuration = 15;


const CreateCampaignSchema = z.object({
  name:        z.string().min(1).max(120),
  prompt:      z.string().min(10).max(2000),
  formats:     z.array(z.string()).min(1).max(20),
  stylePreset: z.string().default("modern_minimal"),
  brandId:     z.string().optional(),
  channels:    z.array(z.string()).default([]),
  scheduledAt: z.string().datetime().optional(),
  variations:  z.number().int().min(1).max(5).default(1),
  includeGif:  z.boolean().default(false),
  autoStart:   z.boolean().default(true),
});

// ── GET /api/campaigns ─────────────────────────────────────────────────────
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getAuthUser();

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id }, select: { orgId: true }
  });
  if (!dbUser?.orgId) throw new ApiError(403, "No organization");

  const url    = new URL(req.url);
  const status = url.searchParams.get("status");
  const page   = parseInt(url.searchParams.get("page") ?? "1");
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);

  const campaigns = await prisma.campaign.findMany({
    where: {
      orgId: dbUser.orgId,
      ...(status ? { status: status as any } : {}),
    },
    include: {
      brand:  { select: { id: true, name: true, primaryColor: true } },
      _count: { select: { assets: true, jobs: true } },
    },
    orderBy: { createdAt: "desc" },
    skip:    (page - 1) * limit,
    take:    limit,
  });

  const total = await prisma.campaign.count({
    where: { orgId: dbUser.orgId, ...(status ? { status: status as any } : {}) }
  });

  return NextResponse.json({ campaigns, total, page, limit });
});

// ── POST /api/campaigns ────────────────────────────────────────────────────
export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getAuthUser();
  requirePermission(user.role, "CREATE_CAMPAIGN");

  // Rate limit campaign creation — expensive operation
  const rl = await rateLimit(user.id, "generate");
  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before creating another campaign." },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id }, include: { org: true }
  });
  if (!dbUser?.org) throw new ApiError(403, "No organization");

  const body   = await req.json().catch(() => ({}));
  const parsed = CreateCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // Validate brand
  if (input.brandId) {
    const brand = await prisma.brand.findFirst({ where: { id: input.brandId, orgId: dbUser.org.id } });
    if (!brand) throw new ApiError(404, "Brand not found");
  }

  // Create campaign
  const campaign = await prisma.campaign.create({
    data: {
      orgId:       dbUser.org.id,
      brandId:     input.brandId,
      name:        input.name,
      prompt:      input.prompt,
      formats:     input.formats,
      stylePreset: input.stylePreset,
      channels:    input.channels,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      status:      input.autoStart ? "PENDING" : "PENDING",
    },
  });

  // Auto-start generation if requested
  if (input.autoStart) {
    const job = await prisma.job.create({
      data: {
        type:       "GENERATE_ASSETS",
        status:     "PENDING",
        userId:     user.id,
        orgId:      dbUser.org.id,
        campaignId: campaign.id,
        payload:    { ...input, campaignId: campaign.id } as any,
      },
    });

    await generationQueue.add("generate", {
      jobId:       job.id,
      userId:      user.id,
      orgId:       dbUser.org.id,
      prompt:      input.prompt,
      formats:     input.formats,
      stylePreset: input.stylePreset,
      variations:  input.variations,
      brandId:     input.brandId,
      campaignId:  campaign.id,
      includeGif:  input.includeGif,
    }, { jobId: job.id, attempts: 3, backoff: { type: "exponential", delay: 2000 } });
  }

  return NextResponse.json({ campaign }, { status: 201 });
});
