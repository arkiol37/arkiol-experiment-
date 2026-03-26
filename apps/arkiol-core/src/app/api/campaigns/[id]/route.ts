// src/app/api/campaigns/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../../lib/prisma";
import { getAuthUser, requirePermission } from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable} from "../../../../lib/error-handling";
import { ApiError }          from "../../../../lib/types";
import { z }                 from "zod";

// ── GET /api/campaigns/[id] ────────────────────────────────────────────────
export const GET = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  if (!detectCapabilities().database) return dbUnavailable();


  const user   = await getAuthUser();
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });

  const campaign = await prisma.campaign.findFirst({
    where:   { id: params.id, orgId: dbUser?.orgId ?? "" },
    include: {
      brand:  { select: { id: true, name: true, primaryColor: true, secondaryColor: true } },
      assets: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, format: true, category: true,
          width: true, height: true, brandScore: true,
          layoutFamily: true, mimeType: true, createdAt: true,
        },
      },
      jobs: {
        orderBy: { createdAt: "desc" },
        take:    5,
        select: { id: true, type: true, status: true, progress: true, createdAt: true, completedAt: true },
      },
      _count: { select: { assets: true, jobs: true } },
    },
  });

  if (!campaign) throw new ApiError(404, "Campaign not found");

  return NextResponse.json({ campaign });
});

// ── PATCH /api/campaigns/[id] ─────────────────────────────────────────────
const UpdateCampaignSchema = z.object({
  name:        z.string().min(1).max(120).optional(),
  status:      z.enum(["PENDING", "CANCELLED"]).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  channels:    z.array(z.string()).optional(),
  metadata:    z.record(z.unknown()).optional(),
});

export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user   = await getAuthUser();
  requirePermission(user.role, "CREATE_CAMPAIGN");
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });

  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, orgId: dbUser?.orgId ?? "" },
  });
  if (!campaign) throw new ApiError(404, "Campaign not found");

  // Cannot edit completed/failed campaigns
  if (["COMPLETED", "FAILED"].includes(campaign.status)) {
    throw new ApiError(409, `Cannot edit a ${campaign.status.toLowerCase()} campaign`);
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = UpdateCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.campaign.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.name        ? { name: parsed.data.name }               : {}),
      ...(parsed.data.status      ? { status: parsed.data.status as any }    : {}),
      ...(parsed.data.channels    ? { channels: parsed.data.channels }       : {}),
      ...(parsed.data.scheduledAt !== undefined ? { scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null } : {}),
    },
  });

  return NextResponse.json({ campaign: updated });
});

// ── DELETE /api/campaigns/[id] ────────────────────────────────────────────
export const DELETE = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user   = await getAuthUser();
  requirePermission(user.role, "DELETE_CAMPAIGN");
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });

  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, orgId: dbUser?.orgId ?? "" },
  });
  if (!campaign) throw new ApiError(404, "Campaign not found");

  if (campaign.status === "RUNNING") {
    throw new ApiError(409, "Cannot delete a running campaign. Cancel it first.");
  }

  // Delete all associated assets from DB (S3 cleanup should be done async)
  await prisma.$transaction([
    prisma.asset.deleteMany({ where: { campaignId: params.id } }),
    prisma.job.deleteMany({ where: { campaignId: params.id } }),
    prisma.campaign.delete({ where: { id: params.id } }),
  ]);

  return NextResponse.json({ deleted: true, campaignId: params.id });
});
