// apps/arkiol-core/src/app/api/webhooks/[id]/rotate-secret/route.ts
// POST /api/webhooks/[id]/rotate-secret — generate a new signing secret.

import "server-only";
import { detectCapabilities }        from "@arkiol/shared";
import { NextRequest, NextResponse } from "next/server";
import { prisma }                    from "../../../../../lib/prisma";
import { getRequestUser }            from "../../../../../lib/auth";
import { withErrorHandling }         from "../../../../../lib/error-handling";
import { ApiError }                  from "../../../../../lib/types";
import { encryptWebhookSecret }      from "../../../../../lib/webhook-crypto";
import { randomBytes }               from "crypto";
import { dbUnavailable }             from "../../../../../lib/error-handling";

// ── Helper: resolve orgId ─────────────────────────────────────────────────────

async function resolveOrgId(userId: string): Promise<string> {
  const dbUser = await prisma.user.findUnique({
    where:   { id: userId },
    include: { org: { select: { id: true } } },
  });
  if (!dbUser?.org) throw new ApiError(403, "You must belong to an organization");
  return (dbUser.org as any).id;
}

// ── POST /api/webhooks/[id]/rotate-secret ────────────────────────────────────

export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: { id: string } }) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user  = await getRequestUser(req);
  const orgId = await resolveOrgId(user.id);

  const webhook = await prisma.webhook.findFirst({ where: { id: params.id, orgId } });
  if (!webhook) throw new ApiError(404, "Webhook not found");

  const rawSecret       = randomBytes(32).toString("hex");
  const encryptedSecret = encryptWebhookSecret(rawSecret);

  await prisma.webhook.update({
    where: { id: params.id },
    data:  { secret: encryptedSecret, failCount: 0 },  // reset fail count on rotation
  });

  return NextResponse.json({
    webhookId:     params.id,
    signingSecret: rawSecret,
    note: "Old signing secret is now invalidated. Update your endpoint verification immediately.",
  });
});
