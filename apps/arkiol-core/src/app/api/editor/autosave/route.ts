// src/app/api/editor/autosave/route.ts
// B2: Auto-save + crash recovery using dedicated EditorDraft model
//
// POST /api/editor/autosave  — upsert draft OR create checkpoint
// GET  /api/editor/autosave  — fetch latest draft + checkpoints for a project
// DELETE /api/editor/autosave — clear drafts for a project (after manual save)
//
// F-01 FIX: All reads and writes are scoped by BOTH userId AND orgId.
// A projectId is considered owned by the user+org pair that created it.
// Any attempt to read or write another user's projectId returns 403/404.

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getAuthUser }       from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../lib/error-handling";
import { ApiError }          from "../../../../lib/types";
import { prisma }            from "../../../../lib/prisma";
import { z }                 from "zod";

const MAX_DRAFT_BYTES    = 512_000; // 512 KB
const MAX_CHECKPOINTS    = 10;      // keep last 10 checkpoints per project
const CHECKPOINT_TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days

const AutosaveSchema = z.object({
  projectId:  z.string().min(1).max(128).regex(/^[a-zA-Z0-9_\-]+$/, "projectId must be alphanumeric"),
  elements:   z.array(z.record(z.unknown())), // EditorElement[] — loosely typed for speed
  checkpoint: z.boolean().default(false),
  label:      z.string().max(120).optional(),
});

// ── F-01 FIX: Ownership helper ────────────────────────────────────────────────
// Returns the user's orgId (required for all autosave operations).
// Throws 403 if the user has no org (cannot own a project without one).
async function resolveUserOrg(userId: string): Promise<string> {
  const dbUser = await prisma.user.findUnique({
    where:  { id: userId },
    select: { orgId: true },
  });
  if (!dbUser?.orgId) throw new ApiError(403, "You must belong to an organization to use the editor.");
  return dbUser.orgId;
}

// Checks whether a projectId is already claimed by a DIFFERENT user/org.
// A project is "unclaimed" if no draft or checkpoint rows exist for it yet.
// If rows exist, they must ALL belong to the requesting user+org, otherwise 403.
async function assertProjectOwnership(projectId: string, userId: string, orgId: string): Promise<void> {
  // Look for any existing row for this projectId that belongs to a different user or org
  const alien = await prisma.editorDraft.findFirst({
    where: {
      projectId,
      OR: [
        { userId: { not: userId } },
        { orgId:  { not: orgId  } },
      ],
    },
    select: { id: true },
  });
  if (alien) {
    throw new ApiError(403, "Project not found or access denied.");
  }
}

// ── POST /api/editor/autosave ─────────────────────────────────────────────────
export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user  = await getAuthUser();
  const orgId = await resolveUserOrg(user.id); // F-01: org required

  const body   = await req.json().catch(() => null);
  if (!body) throw new ApiError(400, "Request body required");

  const parsed = AutosaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { projectId, elements, checkpoint, label } = parsed.data;

  // F-01: Assert this projectId belongs to the authenticated user+org.
  // Prevents any cross-user overwrite even if the caller knows another user's projectId.
  await assertProjectOwnership(projectId, user.id, orgId);

  // Size guard
  const serialized = JSON.stringify(elements);
  if (serialized.length > MAX_DRAFT_BYTES) {
    return NextResponse.json(
      { error: `Autosave payload too large (${(serialized.length / 1024).toFixed(0)} KB, max 512 KB)` },
      { status: 413 }
    );
  }

  const now = new Date();

  if (checkpoint) {
    // Create new checkpoint row — scoped to user+org
    await prisma.editorDraft.create({
      data: {
        userId:    user.id,
        orgId,                     // F-01: always use resolved orgId
        projectId,
        type:      "checkpoint",
        label:     label ?? `Checkpoint ${now.toLocaleTimeString()}`,
        elements,
      },
    });

    // Prune old checkpoints beyond MAX_CHECKPOINTS (count-based) — scoped to user+org
    const old = await prisma.editorDraft.findMany({
      where:   { userId: user.id, orgId, projectId, type: "checkpoint" },
      orderBy: { createdAt: "desc" },
      skip:    MAX_CHECKPOINTS,
      select:  { id: true },
    });
    if (old.length > 0) {
      await prisma.editorDraft.deleteMany({
        where: { id: { in: old.map(o => o.id) } },
      });
    }

    // BUG-011 FIX: CHECKPOINT_TTL_MS was defined but never enforced.
    // Also prune any checkpoints older than 7 days regardless of count.
    await prisma.editorDraft.deleteMany({
      where: {
        userId:    user.id,
        orgId,                     // F-01: scoped to org
        projectId,
        type:      "checkpoint",
        createdAt: { lt: new Date(now.getTime() - CHECKPOINT_TTL_MS) },
      },
    });
  } else {
    // Upsert the single draft for this user+org+project (delete existing, insert new)
    // Using deleteMany + create in a transaction for atomicity
    await prisma.$transaction([
      prisma.editorDraft.deleteMany({
        where: { userId: user.id, orgId, projectId, type: "draft" }, // F-01: orgId in where
      }),
      prisma.editorDraft.create({
        data: {
          userId:    user.id,
          orgId,                   // F-01: always use resolved orgId
          projectId,
          type:      "draft",
          label:     null,
          elements,
        },
      }),
    ]);
  }

  return NextResponse.json({
    saved:     true,
    type:      checkpoint ? "checkpoint" : "draft",
    projectId,
    savedAt:   now.toISOString(),
    sizeBytes: serialized.length,
  });
});

// ── GET /api/editor/autosave?projectId=xxx ────────────────────────────────────
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user      = await getAuthUser();
  const orgId     = await resolveUserOrg(user.id); // F-01: org required
  const url       = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const checkpointId = url.searchParams.get("checkpointId");

  if (!projectId) throw new ApiError(400, "projectId query parameter required");

  // F-01: Verify ownership before any read — prevents enumeration attacks.
  await assertProjectOwnership(projectId, user.id, orgId);

  // If fetching a specific checkpoint by ID (for restore)
  if (checkpointId) {
    const cp = await prisma.editorDraft.findFirst({
      where: { id: checkpointId, userId: user.id, orgId, projectId }, // F-01: orgId in where
    });
    if (!cp) throw new ApiError(404, "Checkpoint not found");
    return NextResponse.json({
      id:        cp.id,
      label:     cp.label,
      elements:  cp.elements,
      savedAt:   cp.createdAt.toISOString(),
    });
  }

  // Get latest draft — scoped to user+org
  const draft = await prisma.editorDraft.findFirst({
    where:   { userId: user.id, orgId, projectId, type: "draft" }, // F-01: orgId in where
    orderBy: { createdAt: "desc" },
  });

  // Get recent checkpoints — scoped to user+org
  const checkpoints = await prisma.editorDraft.findMany({
    where:   { userId: user.id, orgId, projectId, type: "checkpoint" }, // F-01: orgId in where
    orderBy: { createdAt: "desc" },
    take:    MAX_CHECKPOINTS,
    select:  { id: true, label: true, createdAt: true },
  });

  return NextResponse.json({
    projectId,
    hasDraft: !!draft,
    draft: draft ? {
      id:       draft.id,
      savedAt:  draft.createdAt.toISOString(),
      elements: draft.elements as unknown[],
      sizeBytes: JSON.stringify(draft.elements).length,
    } : null,
    checkpoints: checkpoints.map(c => ({
      id:      c.id,
      label:   c.label ?? "Checkpoint",
      savedAt: c.createdAt.toISOString(),
    })),
  });
});

// ── DELETE /api/editor/autosave?projectId=xxx — clear drafts after save ───────
export const DELETE = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user      = await getAuthUser();
  const orgId     = await resolveUserOrg(user.id); // F-01: org required
  const url       = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const type      = url.searchParams.get("type") ?? "draft"; // "draft" | "all"

  if (!projectId) throw new ApiError(400, "projectId query parameter required");

  // F-01: Verify ownership before delete — prevents cross-user deletions.
  await assertProjectOwnership(projectId, user.id, orgId);

  const where: Record<string, unknown> = { userId: user.id, orgId, projectId }; // F-01: orgId in where
  if (type !== "all") where.type = "draft";

  const { count } = await prisma.editorDraft.deleteMany({ where });

  return NextResponse.json({ deleted: true, count, projectId });
});
