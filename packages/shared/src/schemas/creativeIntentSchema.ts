/**
 * Creative Intent Schema — Zod-validated schema for the creative brief
 * that drives both static design (arkiol-core) and animated ad (animation-studio)
 * generation pipelines. This is the canonical input contract.
 */
import { z } from 'zod';

export const MoodSchema = z.enum([
  'Luxury', 'Energetic', 'Minimal', 'Playful', 'Cinematic',
  'Emotional', 'Corporate', 'Bold', 'Calm', 'Tech',
]);

export const AdObjectiveSchema = z.enum([
  'awareness', 'consideration', 'conversion', 'retention', 'app_install',
]);

export const PlatformSchema = z.enum(['youtube', 'facebook', 'instagram', 'tiktok']);
export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1']);
export const RenderModeSchema = z.enum(['Normal Ad', 'Cinematic Ad']);

export const HookTypeSchema = z.enum([
  'pain_point', 'curiosity_gap', 'bold_claim', 'social_proof',
  'direct_offer', 'question', 'shocking_stat',
]);

export const CreativeIntentSchema = z.object({
  brief: z.string().min(10).max(2000),
  brandName: z.string().min(1).max(100),
  industry: z.string().min(1).max(100),
  mood: MoodSchema.optional(),
  hookType: HookTypeSchema.optional(),
  objective: AdObjectiveSchema.optional(),
  platform: PlatformSchema,
  placement: z.string().min(1).max(50),
  sceneCount: z.number().int().min(2).max(10).default(5),
  aspectRatio: AspectRatioSchema.default('9:16'),
  renderMode: RenderModeSchema.default('Normal Ad'),
  maxDurationSec: z.number().int().min(5).max(120).default(30),
  brandAssetIds: z.array(z.string().uuid()).optional(),
  brandPalette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).optional(),
  targetAudience: z.string().max(500).optional(),
});

export type CreativeIntent = z.infer<typeof CreativeIntentSchema>;

export function validateCreativeIntent(input: unknown): { success: true; data: CreativeIntent } | { success: false; errors: string[] } {
  const result = CreativeIntentSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
}
