// src/app/api/api-keys/route.ts
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { prisma }            from "../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../lib/error-handling";
import { ApiError }          from "../../../lib/types";
import { randomBytes, createHash } from "crypto";
import { rateLimit }               from "../../../lib/rate-limit";
import { z }                 from "zod";

const CreateKeySchema = z.object({
  name:        z.string().min(1).max(100),
  permissions: z.array(z.enum(["generate", "read", "export", "delete"])).default(["generate", "read"]),
  expiresIn:   z.enum(["30d", "90d", "1y", "never"]).default("never"),
});

function generateApiKey(): { key: string; hash: string; prefix: string } {
  const raw    = "nxr_live_" + randomBytes(32).toString("hex");
  const hash   = createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 16);
  return { key: raw, hash, prefix };
}

function expiresAtDate(expiresIn: string): Date | null {
  if (expiresIn === "never") return null;
  const days = expiresIn === "30d" ? 30 : expiresIn === "90d" ? 90 : 365;
  return new Date(Date.now() + days * 86400 * 1000);
}

// ── GET /api/api-keys ──────────────────────────────────────────────────────
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "MANAGE_API_KEYS");

  const keys = await prisma.apiKey.findMany({
    where:   { userId: user.id, isRevoked: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, keyPrefix: true, permissions: true,
      lastUsedAt: true, expiresAt: true, createdAt: true,
      // Never return keyHash
    },
  });

  return NextResponse.json({
    keys: keys.map(k => ({
      ...k,
      isExpired: k.expiresAt ? k.expiresAt < new Date() : false,
    })),
  });
});

// ── POST /api/api-keys — create new key ───────────────────────────────────
export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "MANAGE_API_KEYS");

  const rl = await rateLimit(user.id, "api");
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // Max 10 active keys per user
  const count = await prisma.apiKey.count({ where: { userId: user.id, isRevoked: false } });
  if (count >= 10) throw new ApiError(409, "Maximum of 10 active API keys per user");

  const body   = await req.json().catch(() => ({}));
  const parsed = CreateKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { key, hash, prefix } = generateApiKey();
  const expiresAt = expiresAtDate(parsed.data.expiresIn);

  const apiKey = await prisma.apiKey.create({
    data: {
      userId:      user.id,
      name:        parsed.data.name,
      keyHash:     hash,
      keyPrefix:   prefix,
      permissions: parsed.data.permissions,
      expiresAt,
    },
    select: { id: true, name: true, keyPrefix: true, permissions: true, expiresAt: true, createdAt: true },
  });

  return NextResponse.json({
    apiKey,
    key, // Only returned ONCE at creation — cannot be retrieved again
    message: "Store this API key securely — it will not be shown again.",
  }, { status: 201 });
});

// ── DELETE /api/api-keys — revoke a key ───────────────────────────────────
export const DELETE = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user  = await getRequestUser(req);
  requirePermission(user.role, "MANAGE_API_KEYS");
  const keyId = new URL(req.url).searchParams.get("id");
  if (!keyId) throw new ApiError(400, "Key ID required (?id=...)");

  const key = await prisma.apiKey.findFirst({ where: { id: keyId, userId: user.id } });
  if (!key) throw new ApiError(404, "API key not found");

  await prisma.apiKey.update({ where: { id: keyId }, data: { isRevoked: true } });
  return NextResponse.json({ revoked: true, keyId });
});
