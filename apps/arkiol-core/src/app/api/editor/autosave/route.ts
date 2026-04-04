// src/app/api/editor/autosave/route.ts
// B2: Auto-save + crash recovery using dedicated EditorDraft model
//
// POST /api/editor/autosave  — upsert draft OR create checkpoint
// GET  /api/editor/autosave  — fetch latest draft + checkpoints for a project
// DELETE /api/editor/autosave — clear drafts for a project (after manual save)
//
// FIX: Replaced getAuthUser() with getRequestUser(req) so that middleware-injected
// x-user-id headers are used first (fast path), falling back to getServerSession()
// only when headers are absent. This prevents 401/500 failures on authenticated
// users whose requests pass through the edge middleware correctly.

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getRequestUser }      from "../../../../lib/auth";
import { withErrorHandling, dbUnavailable } from "../../../../lib/error-handling";
import { ApiError }            from "../../../../lib/types";
import { prisma }              from "../../../../lib/prisma";
import { z }                   from "zod";

const MAX_DRAFT_BYTES    = 512_000; // 512 KB
const MAX_CHECKPOINTS    = 10;
const CHECKPOINT_TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days

const AutosaveSchema = z.object({
  projectId:  z.string().min(1).max(128).regex(/^[a-zA-Z0-9_\-]+$/, "projectId must be alphanumeric"),
  elements:   z.array(z.record(z.unknown())),
  checkpoint: z.boolean().default(false),
  label:      z.string().max(120).optional(),
});

async function resolveUserOrg(userId: string): Promise<string> {
  const dbUser = await prisma.user.findUnique({
    where:  { id: userId },
    select: { orgId: true },
  });
  if (!dbUser?.orgId) throw new ApiError(403, "You must belong to an organization to use the editor.");
  return dbUser.orgId;
}

async function assertProjectOwnership(projectId: string, userId: string, orgId: string): Promise<void> {
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
  if (alien) throw new ApiError(403, "Project not found or access denied.");
}

// POST /api/editor/autosave
export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user  = await getRequestUser(req);
  const orgId = await resolveUserOrg(user.id);

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

  await assertProjectOwnership(projectId, user.id, orgId);

  const serialized = JSON.stringify(elements);
  if (serialized.length > MAX_DRAFT_BYTES) {
    return NextResponse.json(
      { error: `Autosave payload too large (${(serialized.length / 1024).toFixed(0)} KB, max 512 KB)` },
      { status: 413 }
    );
  }

  const now = new Date();

  if (checkpoint) {
    await prisma.editorDraft.create({
      data: {
        userId:    user.id,
        orgId,
        projectId,
        type:      "checkpoint",
        label:     label ?? `Checkpoint ${now.toLocaleTimeString()}`,
        elements,
      },
    });

    const old = await prisma.editorDraft.findMany({
      where:   { userId: user.id, orgId, projectId, type: "checkpoint" },
      orderBy: { createdAt: "desc" },
      skip:    MAX_CHECKPOINTS,
      select:  { id: true },
    });
    if (old.length > 0) {
      await prisma.editorDraft.deleteMany({ where: { id: { in: old.map((o: { id: string }) => o.id) } } });
    }

    await prisma.editorDraft.deleteMany({
      where: {
        userId:    user.id,
        orgId,
        projectId,
        type:      "checkpoint",
        createdAt: { lt: new Date(now.getTime() - CHECKPOINT_TTL_MS) },
      },
    });
  } else {
    await prisma.$transaction([
      prisma.editorDraft.deleteMany({ where: { userId: user.id, orgId, projectId, type: "draft" } }),
      prisma.editorDraft.create({
        data: { userId: user.id, orgId, projectId, type: "draft", label: null, elements },
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

// GET /api/editor/autosave?projectId=xxx
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user      = await getRequestUser(req);
  const orgId     = await resolveUserOrg(user.id);
  const url       = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const checkpointId = url.searchParams.get("checkpointId");

  if (!projectId) throw new ApiError(400, "projectId query parameter required");

  await assertProjectOwnership(projectId, user.id, orgId);

  if (checkpointId) {
    const cp = await prisma.editorDraft.findFirst({
      where: { id: checkpointId, userId: user.id, orgId, projectId },
    });
    if (!cp) throw new ApiError(404, "Checkpoint not found");
    return NextResponse.json({
      id:       cp.id,
      label:    cp.label,
      elements: cp.elements,
      savedAt:  cp.createdAt.toISOString(),
    });
  }

  const draft = await prisma.editorDraft.findFirst({
    where:   { userId: user.id, orgId, projectId, type: "draft" },
    orderBy: { createdAt: "desc" },
  });

  const checkpoints = await prisma.editorDraft.findMany({
    where:   { userId: user.id, orgId, projectId, type: "checkpoint" },
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

// DELETE /api/editor/autosave?projectId=xxx
export const DELETE = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user      = await getRequestUser(req);
  const orgId     = await resolveUserOrg(user.id);
  const url       = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const type      = url.searchParams.get("type") ?? "draft";

  if (!projectId) throw new ApiError(400, "projectId query parameter required");

  await assertProjectOwnership(projectId, user.id, orgId);

  const where: Record<string, unknown> = { userId: user.id, orgId, projectId };
  if (type !== "all") where.type = "draft";

  const { count } = await prisma.editorDraft.deleteMany({ where });

  return NextResponse.json({ deleted: true, count, projectId });
});
