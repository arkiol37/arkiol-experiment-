/**
 * Brand Asset Schema — validates brand asset metadata for cross-app consistency.
 */
import { z } from 'zod';

export const BrandAssetTypeSchema = z.enum(['logo', 'product', 'screenshot', 'icon', 'background', 'pattern', 'illustration']);

export const BrandAssetSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  type: BrandAssetTypeSchema,
  name: z.string().min(1).max(200),
  url: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  format: z.enum(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif']),
  fileSizeBytes: z.number().int().min(1).max(50 * 1024 * 1024), // 50MB max
  hasTransparency: z.boolean(),
  palette: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().datetime(),
});

export type BrandAsset = z.infer<typeof BrandAssetSchema>;

export const BrandPaletteSchema = z.object({
  primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  background: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  text: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export type BrandPalette = z.infer<typeof BrandPaletteSchema>;
