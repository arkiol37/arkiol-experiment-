// src/app/api/auth/reset-password/route.ts
// NO direct process.env — all config via validated env module.
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../../lib/prisma";
import { hashPassword, validatePasswordStrength } from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../lib/error-handling";
import { rateLimit }         from "../../../../lib/rate-limit";
import { sendEmail }         from "../../../../lib/email";
import { ApiError }          from "../../../../lib/types";
import { randomBytes, createHash } from "crypto";
import { z }                 from "zod";
import { getEnv }            from "@arkiol/shared";

const RequestSchema = z.object({
  email: z.string().email(),
});

const ResetSchema = z.object({
  token:    z.string().min(64).max(128),
  password: z.string().min(8).max(128),
});

// ── POST /api/auth/reset-password — request reset email ───────────────────
export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = await rateLimit(ip, "auth");
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Please wait." }, { status: 429 });
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  // Always return success to prevent email enumeration
  if (!user) {
    return NextResponse.json({
      success: true,
      message: "If an account exists with that email, a reset link has been sent.",
    });
  }

  // Generate secure reset token
  const rawToken  = randomBytes(48).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Store token hash in verification token table
  await prisma.verificationToken.upsert({
    where:  { identifier: `reset:${user.email}` },
    update: { token: tokenHash, expires: expiresAt },
    create: { identifier: `reset:${user.email}`, token: tokenHash, expires: expiresAt },
  });

  // Send reset email
  const resetUrl = `${getEnv().NEXTAUTH_URL ?? ""}/auth/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

  await sendEmail({
    to:      user.email,
    subject: "Reset your Arkiol password",
    text:    `Click this link to reset your password (expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
    html:    `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #4f6ef7;">Reset Your Password</h2>
        <p>Click the button below to reset your password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #4f6ef7; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
          Reset Password
        </a>
        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  }).catch(console.error);

  return NextResponse.json({
    success: true,
    message: "If an account exists with that email, a reset link has been sent.",
  });
});

// ── PUT /api/auth/reset-password — complete reset with token ──────────────
export const PUT = withErrorHandling(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = await rateLimit(ip, "auth");
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = ResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token or password", details: parsed.error.flatten() }, { status: 400 });
  }

  const { token, password } = parsed.data;
  const email = new URL(req.url).searchParams.get("email");
  if (!email) throw new ApiError(400, "Email parameter required");

  const pwError = validatePasswordStrength(password);
  if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

  // Find and validate token
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const record    = await prisma.verificationToken.findUnique({
    where: { identifier: `reset:${email}` },
  });

  if (!record || record.token !== tokenHash) {
    throw new ApiError(400, "Invalid or expired reset token");
  }
  if (record.expires < new Date()) {
    throw new ApiError(400, "Reset token has expired. Request a new one.");
  }

  // Update password and delete token
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({
      where: { email },
      data:  { passwordHash },
    }),
    prisma.verificationToken.delete({
      where: { identifier: `reset:${email}` },
    }),
  ]);

  return NextResponse.json({ success: true, message: "Password updated. Please sign in." });
});
