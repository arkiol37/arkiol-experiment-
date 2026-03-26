// src/app/api/admin/bootstrap/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER BOOTSTRAP ENDPOINT
// Promotes an existing user account to SUPER_ADMIN with full platform access.
//
// Security:
//   - Requires BOOTSTRAP_SECRET env var (min 32 chars) to be set server-side.
//   - Request must include { email, secret } matching that env var.
//   - Only works when the user account already exists in the DB.
//   - Can only be called when DB is configured (no-op otherwise).
//   - Once a SUPER_ADMIN exists, this route still works but is idempotent.
//   - No session or auth token required — designed for initial setup.
//
// Usage (curl):
//   curl -X POST https://your-app.vercel.app/api/admin/bootstrap \
//     -H "Content-Type: application/json" \
//     -d '{"email":"you@company.com","secret":"<BOOTSTRAP_SECRET value>"}'
//
// After bootstrapping, log out and log back in to receive the new role in JWT.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Only available when DB is configured
  const { detectCapabilities } = await import("@arkiol/shared");
  if (!detectCapabilities().database) {
    return NextResponse.json(
      { error: "Database not configured. Set DATABASE_URL to enable bootstrapping." },
      { status: 503 }
    );
  }

  // BOOTSTRAP_SECRET must be set and at least 32 characters
  const bootstrapSecret = process.env.BOOTSTRAP_SECRET ?? "";
  if (bootstrapSecret.length < 32) {
    return NextResponse.json(
      {
        error: "Bootstrap not available. Set BOOTSTRAP_SECRET (min 32 chars) in Vercel environment variables.",
        hint:  "Generate one with: openssl rand -hex 32",
      },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { email, secret } = body ?? {};

  // Validate inputs
  if (typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }
  if (typeof secret !== "string") {
    return NextResponse.json({ error: "Missing secret." }, { status: 400 });
  }

  // Constant-time secret comparison to prevent timing attacks
  const { timingSafeEqual } = await import("crypto");
  const secretBuf  = Buffer.from(secret);
  const expectedBuf = Buffer.from(bootstrapSecret);
  const secretsMatch =
    secretBuf.length === expectedBuf.length &&
    timingSafeEqual(secretBuf, expectedBuf);

  if (!secretsMatch) {
    // Deliberate vague error — don't confirm whether secret is wrong vs email
    return NextResponse.json(
      { error: "Bootstrap failed. Check your secret and try again." },
      { status: 403 }
    );
  }

  // Look up the user
  const { prisma } = await import("../../../../lib/prisma");
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, name: true, role: true, orgId: true },
  });

  if (!user) {
    return NextResponse.json(
      {
        error: `No account found for ${email}. Register first, then run bootstrap.`,
      },
      { status: 404 }
    );
  }

  // Already a SUPER_ADMIN — idempotent
  if (user.role === "SUPER_ADMIN") {
    return NextResponse.json({
      success:  true,
      message:  `${email} is already SUPER_ADMIN. No changes made.`,
      role:     user.role,
      orgId:    user.orgId,
    });
  }

  // Promote to SUPER_ADMIN
  await prisma.user.update({
    where: { id: user.id },
    data:  { role: "SUPER_ADMIN" },
  });

  // Also upgrade org plan to STUDIO so billing UI shows correct state
  if (user.orgId) {
    await prisma.org.update({
      where: { id: user.orgId },
      data: {
        plan:               "STUDIO",
        subscriptionStatus: "ACTIVE",
        // Grant a large credit balance so the dashboard doesn't show empty
        creditBalance:      999_999,
        dailyCreditBalance: 9_999,
      },
    });
  }

  console.info(`[bootstrap] Promoted ${email} (${user.id}) to SUPER_ADMIN`);

  return NextResponse.json({
    success: true,
    message: `✓ ${email} promoted to SUPER_ADMIN with Studio plan. Log out and back in to activate.`,
    role:    "SUPER_ADMIN",
    orgId:   user.orgId,
    next:    "Sign out, then sign back in. Your JWT will contain the new role.",
  });
}
