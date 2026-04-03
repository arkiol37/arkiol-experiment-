/**
 * Scene Schema — validates individual scene definitions for the render pipeline.
 */
import { z } from 'zod';

export const SceneRoleSchema = z.enum(['hook', 'problem', 'solution', 'proof', 'cta', 'brand_reveal', 'offer', 'close', 'end']);
export const TransitionTypeSchema = z.enum(['cut', 'crossfade', 'push', 'zoom', 'wipe', 'morph', 'dissolve', 'slide']);
export const ShotTypeSchema = z.enum(['wide', 'medium', 'close_up', 'extreme_close', 'aerial', 'pov', 'over_shoulder', 'dutch_angle']);

export const SceneSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().min(0),
  role: SceneRoleSchema,
  durationSec: z.number().min(2).max(30),
  prompt: z.string().min(10).max(5000),
  voiceoverScript: z.string().max(2000).optional(),
  onScreenText: z.string().max(200).optional(),
  transitionIn: TransitionTypeSchema.default('crossfade'),
  transitionOut: TransitionTypeSchema.default('crossfade'),
  emotionTarget: z.number().min(0).max(1).default(0.5),
  shotType: ShotTypeSchema.default('medium'),
  qualityTarget: z.number().min(0).max(1).default(0.75),
});

export type Scene = z.infer<typeof SceneSchema>;

export function validateScene(input: unknown): boolean {
  return SceneSchema.safeParse(input).success;
}
