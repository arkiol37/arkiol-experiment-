export interface AssetQualityResult { assetId: string; passed: boolean; score: number; issues: { code: string; message: string; severity: 'warning' | 'error' }[]; }
const FMTS = ['png','jpg','jpeg','webp','svg','gif'];
const MIN: Record<string, { w: number; h: number }> = { logo: { w: 200, h: 200 }, product: { w: 400, h: 400 }, screenshot: { w: 800, h: 600 } };
export function validateAssetQuality(a: { id: string; type: string; width: number; height: number; format: string; hasTransparency: boolean; fileSizeKb: number }): AssetQualityResult {
  const issues: AssetQualityResult['issues'] = []; let score = 100;
  if (!FMTS.includes(a.format.toLowerCase())) { issues.push({ code: 'UNSUPPORTED_FORMAT', message: `Format ${a.format} not supported`, severity: 'error' }); score -= 30; }
  const min = MIN[a.type] || MIN.product; if (a.width < min.w || a.height < min.h) { issues.push({ code: 'LOW_RESOLUTION', message: `${a.width}x${a.height} below ${min.w}x${min.h}`, severity: 'warning' }); score -= 15; }
  if (a.type === 'logo' && !a.hasTransparency && a.format !== 'svg') { issues.push({ code: 'NO_TRANSPARENCY', message: 'Logo should have transparent background', severity: 'warning' }); score -= 10; }
  if (a.fileSizeKb > 10240) { issues.push({ code: 'LARGE_FILE', message: `${a.fileSizeKb}KB exceeds 10MB`, severity: 'error' }); score -= 20; }
  return { assetId: a.id, passed: score >= 60, score: Math.max(0, score), issues };
}
