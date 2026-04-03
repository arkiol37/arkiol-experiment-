export interface EnhancementResult { assetId: string; enhanced: boolean; operations: string[]; originalSize: { w: number; h: number }; enhancedSize: { w: number; h: number }; }
export function enhanceAsset(a: { id: string; width: number; height: number; format: string; type: string }): EnhancementResult {
  const ops: string[] = []; let nw = a.width, nh = a.height;
  const t = a.type === 'logo' ? 512 : 1024;
  if (a.width < t || a.height < t) { const s = Math.max(t / a.width, t / a.height); nw = Math.round(a.width * s); nh = Math.round(a.height * s); ops.push(`upscale_${Math.round(s * 100)}pct`); }
  if (ops.some(o => o.startsWith('upscale'))) ops.push('sharpen_unsharp_mask');
  if (a.type === 'logo' && (a.format === 'jpg' || a.format === 'jpeg')) ops.push('convert_to_png');
  ops.push('optimize_quality_85');
  return { assetId: a.id, enhanced: ops.length > 1, operations: ops, originalSize: { w: a.width, h: a.height }, enhancedSize: { w: nw, h: nh } };
}
