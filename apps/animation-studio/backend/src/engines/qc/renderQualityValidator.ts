export interface RenderQualityResult { passed: boolean; score: number; checks: { name: string; passed: boolean; details: string }[]; }
export function validateRenderOutput(o: { fileSizeBytes: number; durationMs: number; width: number; height: number; fps: number; expectedDurationMs: number; expectedWidth: number; expectedHeight: number }): RenderQualityResult {
  const checks: RenderQualityResult['checks'] = []; let score = 100;
  if (o.fileSizeBytes < 1024) { checks.push({ name: 'file_size', passed: false, details: 'Too small' }); score -= 30; } else checks.push({ name: 'file_size', passed: true, details: `${Math.round(o.fileSizeBytes/1024)}KB` });
  const dd = Math.abs(o.durationMs - o.expectedDurationMs) / o.expectedDurationMs;
  if (dd > 0.1) { checks.push({ name: 'duration', passed: false, details: `Off by ${Math.round(dd*100)}%` }); score -= 20; } else checks.push({ name: 'duration', passed: true, details: `${o.durationMs}ms` });
  if (o.width !== o.expectedWidth || o.height !== o.expectedHeight) { checks.push({ name: 'resolution', passed: false, details: `${o.width}x${o.height}` }); score -= 15; } else checks.push({ name: 'resolution', passed: true, details: `${o.width}x${o.height}` });
  if (o.fps < 24) { checks.push({ name: 'fps', passed: false, details: `${o.fps}fps` }); score -= 10; } else checks.push({ name: 'fps', passed: true, details: `${o.fps}fps` });
  return { passed: score >= 70, score: Math.max(0, score), checks };
}
