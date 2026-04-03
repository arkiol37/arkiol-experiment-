export interface VectorizationResult { assetId: string; vectorized: boolean; method: string; quality: number; svgPath?: string; }
export function shouldVectorize(a: { type: string; format: string }): boolean { return a.type === 'logo' && a.format !== 'svg'; }
export function vectorize(a: { id: string; type: string; format: string; width: number; height: number }): VectorizationResult {
  if (!shouldVectorize(a)) return { assetId: a.id, vectorized: false, method: 'skip', quality: 1 };
  const q = 0.7 + (a.width >= 512 ? 0.1 : 0) + (a.format === 'png' ? 0.05 : 0);
  return { assetId: a.id, vectorized: true, method: q > 0.8 ? 'potrace_high' : 'potrace_standard', quality: Math.min(1, q), svgPath: `/processed/${a.id}.svg` };
}
