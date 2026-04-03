export interface BackgroundRemovalResult { assetId: string; processed: boolean; method: string; confidence: number; outputPath?: string; }
export function shouldRemoveBackground(a: { type: string; hasTransparency: boolean }): boolean { return (a.type === 'logo' || a.type === 'product') && !a.hasTransparency; }
export function planBackgroundRemoval(a: { id: string; type: string; hasTransparency: boolean }): BackgroundRemovalResult {
  if (!shouldRemoveBackground(a)) return { assetId: a.id, processed: false, method: 'skip', confidence: 1 };
  return { assetId: a.id, processed: true, method: a.type === 'logo' ? 'color_threshold' : 'semantic_segmentation', confidence: a.type === 'logo' ? 0.9 : 0.8, outputPath: `/processed/${a.id}_cutout.png` };
}
