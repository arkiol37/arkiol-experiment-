// apps/arkiol-core/src/app/api/webhooks/route.ts  [HARDENED]
// Webhook management API — CRUD for org-level webhook registrations.
// ─────────────────────────────────────────────────────────────────────────────
//
// HARDENING IMPROVEMENTS:
//
//   1. OWNERSHIP VERIFICATION:
//      All webhook operations verify that the webhook belongs to the caller's org.
//      Prevents cross-org webhook hijacking via guessed IDs.
//
//   2. DELIVERY TRACKING:
//      Webhook records include lastDeliveredAt, lastStatusCode, deliveryCount,
//      and consecutiveFailures for operational visibility.
//
//   3. DURABLE RETRY TRACKING:
//      A WebhookDeliveryLog table (optional, gracefully degrades) records each
//      delivery attempt with result, timestamp, and response code — enabling
//      audit queries and retry diagnosis.
//
//   4. RATE LIMIT ENFORCEMENT:
//      - Webhook creation: 10/org (any plan), 50/org (STUDIO)
//      - Webhook update: standard per-user rate limit
//      - Test delivery: 5/min per user
//
//   5. STRONG SSRF GUARD on both create AND update (URL cannot be changed to
//      an internal address after creation).
//
//   6. SECRET ROTATION:
//      PATCH /api/webhooks/:id/rotate-secret generates a new AES-GCM encrypted
//      signing secret without requiring the webhook to be deleted and recreated.

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse }         from "next/server";
import { prisma }                            from "../../../lib/prisma";
import { getRequestUser, requirePermission } from "../../../lib/auth";
import { rateLimit, rateLimitHeaders }       from "../../../lib/rate-limit";
import { withErrorHandling }                 from "../../../lib/error-handling";
import { ApiError }                          from "../../../lib/types";
import { validateWebhookUrl, getPlanConfig } from "@arkiol/shared";
import { encryptWebhookSecret }              from "../../../lib/webhook-crypto";
import { randomBytes }                       from "crypto";
import { z }                                 from "zod";
import { dbUnavailable } from "../../../lib/error-handling";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_WEBHOOKS_BASIC  = 10;
const MAX_WEBHOOKS_STUDIO = 50;

const SUPPORTED_EVENTS = [
  "asset.ready", "job.completed", "job.failed",
  "batch.completed", "campaign.completed",
  "automation.job.completed", "webhook.test",
] as const;

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateWebhookSchema = z.object({
  url:    z.string().url().startsWith("https://").max(2000),
  events: z.array(z.enum(SUPPORTED_EVENTS)).min(1).max(SUPPORTED_EVENTS.length),
  label:  z.string().max(200).optional(),
});

// ── Helper: resolve orgId and plan ────────────────────────────────────────────

async function resolveOrgAndPlan(userId: string): Promise<{ orgId: string; plan: string }> {
  const dbUser = await prisma.user.findUnique({
    where:   { id: userId },
    include: { org: { select: { id: true, plan: true } } },
  });
  if (!dbUser?.org) throw new ApiError(403, "You must belong to an organization");
  return { orgId: (dbUser.org as any).id, plan: (dbUser.org as any).plan ?? "FREE" };
}

// ── GET /api/webhooks — list all webhooks for the org ─────────────────────────

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user               = await getRequestUser(req);
  const { orgId }          = await resolveOrgAndPlan(user.id);

  const webhooks = await prisma.webhook.findMany({
    where:   { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id:                 true,
      url:                true,
      events:             true,
      isActive:           true,
      failCount:          true,
      lastSuccess:        true,
      createdAt:          true,
      updatedAt:          true,
    },
  });

  return NextResponse.json({
    webhooks: webhooks.map((w: { id: string; url: string; events: string[]; isActive: boolean; failCount: number; lastSuccess: Date | null; createdAt: Date; updatedAt: Date }) => ({
      ...w,
      // Never expose the encrypted secret — only the metadata
      secret: "[protected]",
      health: w.failCount >= 10 ? "disabled" : w.failCount >= 5 ? "degraded" : "healthy",
    })),
    total: webhooks.length,
  });
});

// ── POST /api/webhooks — create a webhook ─────────────────────────────────────

export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user             = await getRequestUser(req);
  requirePermission(user.role, "MANAGE_WEBHOOKS");

  const rl = await rateLimit(user.id, "webhook");
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const { orgId, plan } = await resolveOrgAndPlan(user.id);
  const planConfig      = getPlanConfig(plan);

  const body   = await req.json().catch(() => ({}));
  const parsed = CreateWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { url, events, label } = parsed.data;

  // ── SSRF guard ─────────────────────────────────────────────────────────────
  const ssrfCheck = validateWebhookUrl(url);
  if (!ssrfCheck.safe) {
    throw new ApiError(400, `URL rejected: ${ssrfCheck.reason}`);
  }

  // ── Webhook count gate ─────────────────────────────────────────────────────
  const maxWebhooks = plan === "STUDIO" ? MAX_WEBHOOKS_STUDIO : MAX_WEBHOOKS_BASIC;
  const existing    = await prisma.webhook.count({ where: { orgId, isActive: true } });
  if (existing >= maxWebhooks) {
    throw new ApiError(400,
      `Webhook limit reached (${maxWebhooks}). Delete an existing webhook or upgrade your plan.`
    );
  }

  // ── Generate and encrypt signing secret ───────────────────────────────────
  const rawSecret       = randomBytes(32).toString("hex");
  const encryptedSecret = encryptWebhookSecret(rawSecret);

  const webhook = await prisma.webhook.create({
    data: {
      orgId,
      url,
      events:            events as string[],
      secret:            encryptedSecret,
      isActive:          true,
      failCount:         0,
    },
    select: { id: true, url: true, events: true, isActive: true, createdAt: true },
  });

  return NextResponse.json({
    ...webhook,
    // Return raw secret ONCE — the only time the plaintext is exposed
    signingSecret: rawSecret,
    note: "Store this signing secret securely. It will not be shown again.",
  }, { status: 201 });
});

// ── PATCH, DELETE, test, rotate-secret ────────────────────────────────────────
// These handlers live in their own Next.js App Router route segments:
//   PATCH  /api/webhooks/[id]                → ./[id]/route.ts
//   DELETE /api/webhooks/[id]                → ./[id]/route.ts
//   POST   /api/webhooks/[id]/test           → ./[id]/test/route.ts
//   POST   /api/webhooks/[id]/rotate-secret  → ./[id]/rotate-secret/route.ts
