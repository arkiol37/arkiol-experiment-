// src/app/api/auth/register/route.ts
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities }        from "@arkiol/shared";
import { prisma }                    from "../../../../lib/prisma";
import { hashPassword, validatePasswordStrength } from "../../../../lib/auth";
import { rateLimit }                 from "../../../../lib/rate-limit";
import { z }                         from "zod";

// Founder email — read server-side only, never from request body
function getFounderEmail(): string | null {
  const v = process.env.FOUNDER_EMAIL?.toLowerCase().trim();
  return v && v.length > 0 ? v : null;
}

const RegisterSchema = z.object({
  email:       z.string().email("Invalid email address"),
  password:    z.string().min(8).max(128),
  name:        z.string().min(1).max(100).optional(),
  orgName:     z.string().min(2).max(100).optional(),
  inviteToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  // ── Capability guard ───────────────────────────────────────────────────────
  if (!detectCapabilities().database) {
    return NextResponse.json(
      { error: "Database not configured. Add DATABASE_URL to your environment variables." },
      { status: 503 }
    );
  }

  // ── Rate limit ─────────────────────────────────────────────────────────────
  try {
    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
    const rl = await rateLimit(ip, "auth");
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please wait 15 minutes." },
        { status: 429 }
      );
    }
  } catch {
    // Rate limiter unavailable — continue without it
  }

  // ── Parse + validate body ──────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.errors[0]?.message ?? "Invalid registration data";
    return NextResponse.json({ error: first }, { status: 400 });
  }

  const { email, password, name, orgName } = parsed.data;

  // ── Password strength ──────────────────────────────────────────────────────
  const pwError = validatePasswordStrength(password);
  if (pwError) {
    return NextResponse.json({ error: pwError }, { status: 400 });
  }

  // ── Duplicate email check ──────────────────────────────────────────────────
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }
  } catch (err: any) {
    console.error("[register] DB check failed:", err?.message ?? err);
    return NextResponse.json(
      { error: "Database connection failed. Please check DATABASE_URL.", detail: err?.message },
      { status: 503 }
    );
  }

  const passwordHash = await hashPassword(password);
  const isFounder    = email.toLowerCase().trim() === (getFounderEmail() ?? "___no_match___");

  // ── Build org slug ─────────────────────────────────────────────────────────
  const displayName = name?.trim() || email.split("@")[0];
  const baseSlug = (orgName ?? displayName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  let finalSlug = baseSlug;
  try {
    const slugTaken = await prisma.org.findUnique({ where: { slug: baseSlug } });
    if (slugTaken) finalSlug = `${baseSlug}-${Date.now()}`;
  } catch {
    finalSlug = `${baseSlug}-${Date.now()}`;
  }

  // ── Create org + user in a transaction ────────────────────────────────────
  let org: any, user: any;
  try {
    [org, user] = await prisma.$transaction(async (tx: any) => {
      // Create org — start with fields that definitely exist in all migrations
      const newOrg = await tx.org.create({
        data: {
          name:              isFounder ? "Arkiol Founder Workspace" : `${displayName}'s Workspace`,
          slug:              finalSlug,
          plan:              isFounder ? "STUDIO" : "FREE",
          subscriptionStatus: "ACTIVE",
          // creditBalance and dailyCreditBalance added in unified_platform migration
          // set to 0 initially; updated below for founder
          creditBalance:      0,
          dailyCreditBalance: 0,
          creditLimit:        isFounder ? 999_999 : 500,
        },
      });

      const newUser = await tx.user.create({
        data: {
          email,
          name:         displayName,
          passwordHash,
          orgId:        newOrg.id,
          role:         isFounder ? "SUPER_ADMIN" : "DESIGNER",
        },
      });

      return [newOrg, newUser];
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[register] Transaction failed:", msg);
    // Surface real error — helps debugging while keeping response clean
    return NextResponse.json(
      {
        error:  "Account creation failed. Please try again.",
        detail: process.env.NODE_ENV !== "production" ? msg : undefined,
        code:   err?.code,
      },
      { status: 500 }
    );
  }

  // ── Founder: top up credits after org creation ─────────────────────────────
  if (isFounder && org?.id) {
    try {
      await prisma.org.update({
        where: { id: org.id },
        data: {
          creditBalance:      999_999,
          dailyCreditBalance: 9_999,
          // Enable all premium feature flags
          canUseStudioVideo:  true,
          canUseGifMotion:    true,
          canBatchGenerate:   true,
          canUseZipExport:    true,
          canUseAutomation:   true,
          maxConcurrency:     10,
          maxDailyVideoJobs:  100,
          maxFormatsPerRun:   9,
          maxVariationsPerRun: 5,
        },
      });
    } catch (err: any) {
      // Non-fatal — founder still has SUPER_ADMIN role which bypasses gating
      console.warn("[register] Founder credit top-up failed (non-fatal):", err?.message);
    }
  }

  return NextResponse.json(
    {
      success: true,
      user:    { id: user.id, email: user.email, name: user.name, role: user.role },
      org:     { id: org.id,  name: org.name,  plan: org.plan },
      message: "Account created. Please sign in.",
    },
    { status: 201 }
  );
}
