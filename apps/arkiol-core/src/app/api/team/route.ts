// src/app/api/team/route.ts
// NO direct process.env — all config via validated env module.
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../lib/auth";
import { createAuditLog } from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { ApiError }          from "../../../lib/types";
import { sendEmail }         from "../../../lib/email";
import { randomBytes }       from "crypto";
import { z }                 from "zod";
import { getEnv }            from "@arkiol/shared";

const InviteSchema = z.object({
  email: z.string().email(),
  role:  z.enum(["ADMIN", "MANAGER", "DESIGNER", "REVIEWER", "VIEWER"]),
  name:  z.string().max(100).optional(),
});

const UpdateRoleSchema = z.object({
  userId: z.string(),
  role:   z.enum(["ADMIN", "MANAGER", "DESIGNER", "REVIEWER", "VIEWER"]),
});

// ── GET /api/team — list org members ──────────────────────────────────────
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user   = await getRequestUser(req);
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, include: { org: true } });
  if (!dbUser?.orgId) throw new ApiError(403, "No organization");

  type TeamMember = {
    id: string; email: string; name: string | null; image: string | null;
    role: string; createdAt: Date; passwordHash: string | null;
    resetToken: string | null; resetTokenExpiry: Date | null;
    _count: { assets: number; jobs: number };
  };

  const members: TeamMember[] = await prisma.user.findMany({
    where:   { orgId: dbUser.orgId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, email: true, name: true, image: true,
      role: true, createdAt: true, passwordHash: true,
      resetToken: true, resetTokenExpiry: true,
      _count: { select: { assets: true, jobs: true } },
    },
  }) as TeamMember[];

  // Usage per member (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000);
  const usageByUser = await prisma.usage.groupBy({
    by:    ["userId"],
    where: { createdAt: { gte: thirtyDaysAgo } },
    _sum:  { credits: true },
  });
  const usageMap = new Map(usageByUser.map((u: { userId: string; _sum: { credits: number | null } }) => [u.userId, u._sum.credits ?? 0]));

  // Separate active members from pending invites (invited users have resetToken set and no passwordHash)
  const activeMembers  = members.filter((m: TeamMember) => m.passwordHash !== null || !m.resetToken);
  const pendingInvites = members
    .filter((m: TeamMember) => m.resetToken && m.passwordHash === null)
    .map((m: TeamMember) => ({
      id:        m.id,
      email:     m.email,
      role:      m.role,
      createdAt: m.createdAt,
      expiresAt: m.resetTokenExpiry ?? new Date(Date.now() + 7 * 86400 * 1000),
    }));

  const currentMember = members.find((m: TeamMember) => m.id === user.id) ?? null;

  return NextResponse.json({
    members: activeMembers.map(m => ({
      id: m.id, email: m.email, name: m.name, role: m.role,
      createdAt: m.createdAt, _count: m._count,
      creditsUsed30d: usageMap.get(m.id) ?? 0,
    })),
    pendingInvites,
    currentUser: currentMember ? {
      id: currentMember.id, email: currentMember.email,
      name: currentMember.name, role: currentMember.role,
      createdAt: currentMember.createdAt, _count: currentMember._count,
    } : null,
    org: {
      id:          dbUser.org?.id,
      name:        dbUser.org?.name,
      plan:        dbUser.org?.plan,
      creditLimit: dbUser.org?.creditLimit,
      creditsUsed: dbUser.org?.creditsUsed,
      ssoEnabled:  dbUser.org?.ssoEnabled,
      mfaRequired: dbUser.org?.mfaRequired,
    },
  });
});

// ── POST /api/team — invite a new member ──────────────────────────────────
export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "MANAGE_TEAM");

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { orgId: true, org: { select: { name: true } } },
  });
  if (!dbUser?.orgId) throw new ApiError(403, "No organization");

  const body   = await req.json().catch(() => ({}));
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  // Check if user already exists
  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    if (existing.orgId === dbUser.orgId) {
      throw new ApiError(409, "User is already a member of this organization");
    }
    if (existing.orgId) {
      throw new ApiError(409, "User belongs to another organization");
    }
    // Add existing user to this org
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data:  { orgId: dbUser.orgId, role: parsed.data.role },
      select: { id: true, email: true, name: true, role: true },
    });

    // Notify existing user
    await sendEmail({
      to:      existing.email,
      subject: `You've been added to your organization on Arkiol`,
      text:    `Hi ${existing.name ?? "there"},\n\nYou have been added to ${dbUser.org?.name ?? "an organization"} on Arkiol with the role: ${parsed.data.role}.\n\nSign in at ${getEnv().NEXTAUTH_URL ?? ""}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
          <h2 style="color:#4f6ef7;">You've been added to ${dbUser.org?.name ?? "an organization"}</h2>
          <p>Your role is <strong>${parsed.data.role}</strong>.</p>
          <a href="${getEnv().NEXTAUTH_URL ?? ""}/dashboard" style="display:inline-block;padding:12px 24px;background:#4f6ef7;color:#fff;text-decoration:none;border-radius:8px;">
            Open Arkiol →
          </a>
        </div>
      `,
    }).catch(console.error);

    return NextResponse.json({ member: updated, status: "existing_user_added" }, { status: 201 });
  }

  // Generate a secure set-password token (not the password itself)
  const resetToken  = randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Create new user — no password yet; they set it via the invite link
  const newUser = await prisma.user.create({
    data: {
      email:            parsed.data.email,
      name:             parsed.data.name ?? null,
      role:             parsed.data.role,
      orgId:            dbUser.orgId,
      resetToken,
      resetTokenExpiry: tokenExpiry,
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  // Send invitation email with set-password link
  const setPasswordUrl = `${getEnv().NEXTAUTH_URL ?? ""}/auth/set-password?token=${resetToken}`;
  await sendEmail({
    to:      parsed.data.email,
    subject: `You've been invited to join ${dbUser.org?.name ?? "Arkiol"}`,
    text:    `Hi ${parsed.data.name ?? "there"},\n\nYou've been invited to join your organization on Arkiol.\n\nClick here to set your password and get started:\n${setPasswordUrl}\n\nThis link expires in 7 days.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#070810;color:#f9fafb;padding:40px;border-radius:12px;">
        <h1 style="color:#a5b4fc;font-size:24px;letter-spacing:0.2em;">ARKIOL</h1>
        <h2>You're invited!</h2>
        <p>You've been invited to join <strong>${dbUser.org?.name ?? "an organization"}</strong> as a <strong>${parsed.data.role}</strong>.</p>
        <p>Click the button below to set your password and start creating:</p>
        <a href="${setPasswordUrl}" style="display:inline-block;padding:14px 28px;background:#4f6ef7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin:16px 0;">
          Accept Invitation →
        </a>
        <p style="color:#6b7280;font-size:13px;margin-top:24px;">This link expires in 7 days. If you didn't expect this, you can safely ignore it.</p>
      </div>
    `,
  }).catch(console.error);

  return NextResponse.json({ member: newUser, status: "invited" }, { status: 201 });
});

// ── PATCH /api/team — update member role ──────────────────────────────────
export const PATCH = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "MANAGE_TEAM");

  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });
  const body   = await req.json().catch(() => ({}));
  const parsed = UpdateRoleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  // Verify target user is in same org
  const target = await prisma.user.findFirst({
    where: { id: parsed.data.userId, orgId: dbUser?.orgId ?? "" },
  });
  if (!target) throw new ApiError(404, "Team member not found");

  // Cannot demote yourself
  if (target.id === user.id) throw new ApiError(400, "Cannot change your own role");

  // Cannot set role higher than your own
  const roleHierarchy = ["VIEWER", "REVIEWER", "DESIGNER", "MANAGER", "ADMIN", "SUPER_ADMIN"];
  const callerLevel = roleHierarchy.indexOf(user.role);
  const targetLevel = roleHierarchy.indexOf(parsed.data.role);
  if (targetLevel > callerLevel) {
    throw new ApiError(403, "Cannot assign a role higher than your own");
  }

  const updated = await prisma.user.update({
    where: { id: parsed.data.userId },
    data:  { role: parsed.data.role },
    select: { id: true, email: true, name: true, role: true },
  });

  await createAuditLog({
    orgId:        dbUser?.orgId ?? "",
    userId:       user.id,
    action:       "team.role_updated",
    resourceId:   updated.id,
    resourceType: "user",
    metadata:     { previousRole: target.role, newRole: parsed.data.role },
  });

  return NextResponse.json({ member: updated });
});

// ── DELETE /api/team — remove a member ────────────────────────────────────
export const DELETE = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user   = await getRequestUser(req);
  requirePermission(user.role, "MANAGE_TEAM");
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { orgId: true } });

  const memberId = new URL(req.url).searchParams.get("userId");
  if (!memberId) throw new ApiError(400, "userId query parameter required");
  if (memberId === user.id) throw new ApiError(400, "Cannot remove yourself");

  const target = await prisma.user.findFirst({ where: { id: memberId, orgId: dbUser?.orgId ?? "" } });
  if (!target) throw new ApiError(404, "Team member not found");

  // Remove from org (don't delete the account)
  await prisma.user.update({ where: { id: memberId }, data: { orgId: null, role: "VIEWER" } });

  await createAuditLog({
    orgId:        dbUser?.orgId ?? "",
    userId:       user.id,
    action:       "team.member_removed",
    resourceId:   memberId,
    resourceType: "user",
    metadata:     { removedEmail: target.email, removedRole: target.role },
  });

  return NextResponse.json({ removed: true, userId: memberId });
});
