/**
 * Render Job Schema — canonical render job contract consumed by both apps.
 */
import { z } from 'zod';
import { AspectRatioSchema, RenderModeSchema, PlatformSchema } from './creativeIntentSchema';

export const RenderJobStatusSchema = z.enum([
  'queued', 'processing', 'scene_rendering', 'mixing',
  'complete', 'failed', 'cancelled', 'dead_letter',
]);

export const RenderJobSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  storyboardId: z.string().uuid(),
  userId: z.string().uuid(),
  status: RenderJobStatusSchema,
  scenesTotal: z.number().int().min(1),
  scenesComplete: z.number().int().min(0).default(0),
  renderMode: RenderModeSchema,
  aspectRatio: AspectRatioSchema,
  platform: PlatformSchema.optional(),
  placement: z.string().optional(),
  creditsCharged: z.number().int().min(0),
  outputUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export type RenderJob = z.infer<typeof RenderJobSchema>;

export const VALID_TRANSITIONS: Record<string, string[]> = {
  queued: ['processing', 'cancelled'],
  processing: ['scene_rendering', 'failed', 'cancelled'],
  scene_rendering: ['mixing', 'failed'],
  mixing: ['complete', 'failed'],
  complete: [],
  failed: ['queued', 'dead_letter'],
  cancelled: [],
  dead_letter: [],
};

export function isValidStatusTransition(from: string, to: string): boolean {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}
