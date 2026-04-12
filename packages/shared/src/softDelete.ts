// packages/shared/src/softDelete.ts
// ─────────────────────────────────────────────────────────────────────────────
// SOFT-DELETE HELPERS FOR STUDIOPROJECTS — Task #8
//
// Provides typed helpers that:
//   • Set deletedAt + deletedBy instead of calling prisma.studioProject.delete()
//   • Inject { deletedAt: null } filter into all list/findMany queries
//   • Expose an "includeDeleted" flag for admin/audit queries
//
// ALL code that queries StudioProject MUST use these helpers or explicitly
// include { where: { deletedAt: null } } in their Prisma queries.
//
// Usage:
//   import { createSoftDeleteService } from '@arkiol/shared';
//   const sds = createSoftDeleteService(prisma);
//
//   // Soft-delete a project
//   await sds.softDeleteProject(projectId, actorUserId);
//
//   // List only non-deleted projects
//   const projects = await sds.findManyProjects({ orgId });
//
//   // Restore a project (admin only)
//   await sds.restoreProject(projectId, actorUserId);
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';

/** Filter that restricts to non-deleted projects — include this in every query. */
export const ACTIVE_PROJECT_FILTER = { deletedAt: null } as const;

/** Filter that includes soft-deleted projects — use for admin/audit only. */
export const ALL_PROJECT_FILTER = {} as const;

export interface ProjectListParams {
  orgId: string;
  /** Include soft-deleted projects (admin only). Default: false */
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt' | 'name';
  direction?: 'asc' | 'desc';
}

export class ProjectNotFoundError extends Error {
  readonly code = 'PROJECT_NOT_FOUND';
  readonly statusCode = 404;
  constructor(projectId: string) {
    super(`StudioProject ${projectId} not found or has been deleted.`);
  }
}

export class ProjectAlreadyDeletedError extends Error {
  readonly code = 'PROJECT_ALREADY_DELETED';
  readonly statusCode = 409;
  constructor(projectId: string) {
    super(`StudioProject ${projectId} has already been soft-deleted.`);
  }
}

export function createSoftDeleteService(prisma: PrismaClient) {
  /**
   * Soft-delete a project. Sets deletedAt to now() and deletedBy to actorId.
   * Does NOT hard-delete the row or its associated jobs.
   *
   * @throws ProjectNotFoundError if the project doesn't exist or belongs to another org
   * @throws ProjectAlreadyDeletedError if already deleted
   */
  async function softDeleteProject(
    projectId: string,
    actorUserId: string,
    orgId?: string,
  ): Promise<void> {
    const project = await prisma.studioProject.findFirst({
      where: {
        id:     projectId,
        ...(orgId ? { orgId } : {}),
      },
      select: { id: true, deletedAt: true, orgId: true },
    });

    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }

    if (project.deletedAt !== null) {
      throw new ProjectAlreadyDeletedError(projectId);
    }

    await prisma.studioProject.update({
      where: { id: projectId },
      data: {
        deletedAt: new Date(),
        deletedBy: actorUserId,
        status:    'archived',  // co-locate status change for consistency
      },
    });
  }

  /**
   * Restore a soft-deleted project (admin action).
   * Sets deletedAt back to null.
   *
   * @throws ProjectNotFoundError if project doesn't exist
   */
  async function restoreProject(
    projectId: string,
    actorUserId: string,
    orgId?: string,
  ): Promise<void> {
    const project = await prisma.studioProject.findFirst({
      where: { id: projectId, ...(orgId ? { orgId } : {}) },
      select: { id: true, deletedAt: true },
    });

    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }

    await prisma.studioProject.update({
      where: { id: projectId },
      data: {
        deletedAt: null,
        deletedBy: null,
        status:    'draft',
        updatedAt: new Date(),
      },
    });
  }

  /**
   * List StudioProjects for an org, filtering out soft-deleted by default.
   *
   * @example
   * // Standard query — excludes deleted
   * const projects = await sds.findManyProjects({ orgId: 'org_123' });
   *
   * @example
   * // Admin query — includes deleted
   * const all = await sds.findManyProjects({ orgId: 'org_123', includeDeleted: true });
   */
  async function findManyProjects(params: ProjectListParams) {
    const {
      orgId,
      includeDeleted = false,
      limit          = 50,
      offset         = 0,
      orderBy        = 'createdAt',
      direction      = 'desc',
    } = params;

    return prisma.studioProject.findMany({
      where: {
        orgId,
        ...(!includeDeleted ? ACTIVE_PROJECT_FILTER : ALL_PROJECT_FILTER),
      },
      orderBy: { [orderBy]: direction },
      take:    limit,
      skip:    offset,
    });
  }

  /**
   * Find a single non-deleted project.
   *
   * @throws ProjectNotFoundError if not found or deleted
   */
  async function findProjectOrThrow(
    projectId: string,
    orgId?: string,
    includeDeleted = false,
  ) {
    const project = await prisma.studioProject.findFirst({
      where: {
        id:    projectId,
        ...(orgId ? { orgId } : {}),
        ...(!includeDeleted ? ACTIVE_PROJECT_FILTER : {}),
      },
    });

    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }

    return project;
  }

  /**
   * Count active (non-deleted) projects for an org.
   */
  async function countActiveProjects(orgId: string): Promise<number> {
    return prisma.studioProject.count({
      where: { orgId, ...ACTIVE_PROJECT_FILTER },
    });
  }

  /**
   * Purge soft-deleted projects older than retentionDays.
   * This is the ONLY sanctioned hard-delete path. Run via scheduled cron.
   *
   * @param retentionDays - Days after soft-delete before hard-delete. Default: 90
   * @returns Number of rows hard-deleted
   */
  async function purgeOldDeletedProjects(retentionDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await prisma.studioProject.deleteMany({
      where: {
        deletedAt: { lte: cutoff, not: null },
      },
    });

    return result.count;
  }

  return {
    softDeleteProject,
    restoreProject,
    findManyProjects,
    findProjectOrThrow,
    countActiveProjects,
    purgeOldDeletedProjects,
    ACTIVE_PROJECT_FILTER,
    ALL_PROJECT_FILTER,
  };
}

export type SoftDeleteService = ReturnType<typeof createSoftDeleteService>;
