/**
 * Continuity Schema — validates continuity tokens and violations
 * used across the animation pipeline.
 */
import { z } from 'zod';

export const ContinuityTokenCategorySchema = z.enum(['color', 'font', 'layout', 'motion', 'brand', 'character']);
export const ContinuityTokenScopeSchema = z.enum(['scene', 'global']);

export const ContinuityTokenSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.unknown(),
  scope: ContinuityTokenScopeSchema,
  category: ContinuityTokenCategorySchema,
});

export const ContinuityViolationSchema = z.object({
  sceneId: z.string(),
  token: ContinuityTokenSchema,
  expected: z.unknown(),
  actual: z.unknown(),
  severity: z.enum(['warning', 'error', 'critical']),
  autoFixable: z.boolean(),
  suggestedFix: z.string().optional(),
});

export type ContinuityToken = z.infer<typeof ContinuityTokenSchema>;
export type ContinuityViolation = z.infer<typeof ContinuityViolationSchema>;
