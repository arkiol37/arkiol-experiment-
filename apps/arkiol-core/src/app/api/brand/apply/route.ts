// src/app/api/brand/apply/route.ts
// C1: Brand Kit Memory — one-click apply brand kit to new generations
// POST /api/brand/apply — apply a brand kit to an asset (element-level)
// Returns element updates to apply in the editor

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getRequestUser }   from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../lib/error-handling";
import { ApiError }      from "../../../../lib/types";
import { prisma }        from "../../../../lib/prisma";
import { z }             from "zod";

const ApplyBrandSchema = z.object({
  brandId:  z.string(),
  elements: z.array(z.object({
    id:         z.string(),
    type:       z.enum(["text", "image", "shape", "logo"]),
    fontFamily: z.string().optional(),
    color:      z.string().optional(),
    fill:       z.string().optional(),
  })),
  // Brand consistency lock: if true, only brand colors/fonts are allowed
  lockToBrand: z.boolean().default(false),
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);

  const body   = await req.json().catch(() => ({}));
  const parsed = ApplyBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { brandId, elements, lockToBrand } = parsed.data;

  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });
  if (!dbUser?.orgId) throw new ApiError(403, "No organization");

  const brand = await prisma.brand.findFirst({
    where: { id: brandId, orgId: dbUser.orgId },
  });
  if (!brand) throw new ApiError(404, "Brand not found");

  // Determine font hierarchy
  const displayFont = brand.fontDisplay ?? "Georgia";
  const bodyFont    = brand.fontBody    ?? "Arial";
  const primary     = brand.primaryColor   ?? "#4f6ef7";
  const secondary   = brand.secondaryColor ?? "#a855f7";
  const accent      = brand.accentColors?.[0] ?? primary;

  // Apply brand to each element
  type BrandElement = z.infer<typeof ApplyBrandSchema>["elements"][number];
  const updates = elements.map((el: BrandElement, idx: number) => {
    const update: Record<string, any> = { id: el.id };

    if (el.type === "text") {
      // First text element gets display font (headline), rest get body font
      update.fontFamily = idx === 0 ? displayFont : bodyFont;
      // Apply primary color to first text, secondary to others
      update.color = idx === 0 ? "#ffffff" : (idx === 1 ? primary : secondary);
    }

    if (el.type === "shape") {
      update.fill = idx === 0 ? primary : secondary;
    }

    return update;
  });

  // Violations if lockToBrand is true — check for non-brand colors
  const brandColors = new Set([
    primary.toLowerCase(),
    secondary.toLowerCase(),
    accent.toLowerCase(),
    "#ffffff",
    "#000000",
    ...(brand.accentColors ?? []).map((c: string) => c.toLowerCase()),
  ]);

  const violations: string[] = [];
  if (lockToBrand) {
    for (const el of elements) {
      const c = (el.color ?? el.fill ?? "").toLowerCase();
      if (c && !brandColors.has(c)) {
        violations.push(`Element ${el.id}: color ${c} is not in brand palette`);
      }
    }
  }

  return NextResponse.json({
    brandId,
    brandName:    brand.name,
    appliedFonts: { display: displayFont, body: bodyFont },
    appliedColors: { primary, secondary, accent },
    updates,
    violations,
    lockToBrand,
  });
});
