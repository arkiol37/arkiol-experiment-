// src/lib/api-key-auth.ts
// Validates API keys sent as Bearer tokens for programmatic access
// Usage: const user = await validateApiKey(req);

import { detectCapabilities } from '@arkiol/shared';
import "server-only";
import { NextRequest } from "next/server";
import { prisma }      from "./prisma";
import { createHash }  from "crypto";
import { ApiError }    from "./types";

export interface ApiKeyUser {
  id:          string;
  email:       string;
  role:        string;
  orgId:       string | null;
  permissions: string[];
  authMethod:  "api_key";
}

/**
 * Validates an API key from Authorization: Bearer header.
 * Falls back to session auth if no Bearer token present.
 */
export async function validateApiKey(req: NextRequest): Promise<ApiKeyUser> {
  if (!detectCapabilities().database) {
    throw new ApiError(503, "API key authentication requires a configured database.");
  }
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer nxr_")) {
    throw new ApiError(401, "Missing or invalid API key. Use Authorization: Bearer nxr_...");
  }

  const rawKey = authHeader.replace("Bearer ", "").trim();
  const hash   = createHash("sha256").update(rawKey).digest("hex");

  const apiKey = await prisma.apiKey.findUnique({
    where:   { keyHash: hash },
    include: { user: { select: { id: true, email: true, role: true, orgId: true } } },
  });

  if (!apiKey)            throw new ApiError(401, "Invalid API key");
  if (apiKey.isRevoked)   throw new ApiError(401, "API key has been revoked");
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    throw new ApiError(401, "API key has expired");
  }

  // Update last used timestamp (fire and forget)
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data:  { lastUsedAt: new Date() },
  }).catch(() => {});

  return {
    id:          apiKey.user.id,
    email:       apiKey.user.email,
    role:        apiKey.user.role,
    orgId:       apiKey.user.orgId,
    permissions: apiKey.permissions,
    authMethod:  "api_key",
  };
}

/**
 * Check if an API key has a specific permission
 */
export function apiKeyHasPermission(
  user:       ApiKeyUser,
  permission: "generate" | "read" | "export" | "delete"
): boolean {
  return user.permissions.includes(permission);
}
