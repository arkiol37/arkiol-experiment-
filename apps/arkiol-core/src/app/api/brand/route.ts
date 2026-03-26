// src/app/api/brand/route.ts
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../lib/prisma";
import { getAuthUser, requirePermission } from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { ApiError }          from "../../../lib/types";
import { z }                 from "zod";

const CreateBrandSchema = z.object({
  name:           z.string().min(1).max(100),
  primaryColor:   z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#4f6ef7"),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#a855f7"),
  accentColors:   z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(6).default([]),
  fontDisplay:    z.string().max(80).default("Georgia"),
  fontBody:       z.string().max(80).default("Arial"),
  fontMono:       z.string().max(80).default("Courier New"),
  voiceAttribs:   z.record(z.number().min(0).max(100)).default({}),
  logoUrl:        z.string().url().optional().or(z.literal("")),
});

const UpdateBrandSchema = CreateBrandSchema.partial();

// ── GET /api/brand ─────────────────────────────────────────────────────────
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user   = await getAuthUser();
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });
  if (!dbUser?.orgId) throw new ApiError(403, "No organization");

  const brands = await prisma.brand.findMany({
    where:   { orgId: dbUser.orgId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { campaigns: true } },
    },
  });

  return NextResponse.json({ brands });
});

// ── POST /api/brand ────────────────────────────────────────────────────────
export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getAuthUser();
  requirePermission(user.role, "EDIT_BRAND");

  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });
  if (!dbUser?.orgId) throw new ApiError(403, "No organization");

  const body   = await req.json().catch(() => ({}));
  const parsed = CreateBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const brand = await prisma.brand.create({
    data: {
      orgId:          dbUser.orgId,
      name:           parsed.data.name,
      primaryColor:   parsed.data.primaryColor,
      secondaryColor: parsed.data.secondaryColor,
      accentColors:   parsed.data.accentColors,
      fontDisplay:    parsed.data.fontDisplay,
      fontBody:       parsed.data.fontBody,
      fontMono:       parsed.data.fontMono,
      voiceAttribs:   parsed.data.voiceAttribs,
      logoUrl:        parsed.data.logoUrl || null,
    },
  });

  return NextResponse.json({ brand }, { status: 201 });
});

// ── PATCH /api/brand ─────────────────────────────────────────────────────
export const PATCH = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getAuthUser();
  requirePermission(user.role, "EDIT_BRAND");

  const url     = new URL(req.url);
  const brandId = url.searchParams.get("id");
  if (!brandId) throw new ApiError(400, "Brand ID required (?id=...)");

  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });
  const brand  = await prisma.brand.findFirst({ where: { id: brandId, orgId: dbUser?.orgId ?? "" } });
  if (!brand) throw new ApiError(404, "Brand not found");

  const body   = await req.json().catch(() => ({}));
  const parsed = UpdateBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.brand.update({
    where: { id: brandId },
    data:  { ...parsed.data, updatedAt: new Date() },
  });

  return NextResponse.json({ brand: updated });
});

// ── DELETE /api/brand ─────────────────────────────────────────────────────
export const DELETE = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getAuthUser();
  requirePermission(user.role, "EDIT_BRAND");

  const url     = new URL(req.url);
  const brandId = url.searchParams.get("id");
  if (!brandId) throw new ApiError(400, "Brand ID required");

  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });
  const brand  = await prisma.brand.findFirst({ where: { id: brandId, orgId: dbUser?.orgId ?? "" } });
  if (!brand) throw new ApiError(404, "Brand not found");

  // Check no active campaigns
  const activeCampaigns = await prisma.campaign.count({
    where: { brandId, status: { in: ["PENDING", "RUNNING"] } },
  });
  if (activeCampaigns > 0) {
    throw new ApiError(409, "Cannot delete brand with active campaigns");
  }

  await prisma.brand.delete({ where: { id: brandId } });
  return NextResponse.json({ deleted: true });
});
