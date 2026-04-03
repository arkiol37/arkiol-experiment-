export interface FallbackOption { id: string; name: string; description: string; qualityImpact: number; speedImprovement: number; changes: Record<string, unknown>; }
export function selectFallback(failedPass: string, _error: string, attempt: number): FallbackOption {
  if (attempt === 1) return { id: 'simplify', name: 'Simplify Pass', description: `Retry ${failedPass} reduced`, qualityImpact: 0.1, speedImprovement: 1.5, changes: { skipFilters: ['film_grain','depth_of_field'] } };
  if (attempt === 2) return { id: 'skip_optional', name: 'Skip Optional', description: 'Skip color grading', qualityImpact: 0.25, speedImprovement: 2, changes: { skipPasses: ['cinematic','color'] } };
  if (attempt === 3) return { id: 'fallback_codec', name: 'Fallback Codec', description: 'Simpler codec', qualityImpact: 0.15, speedImprovement: 1.3, changes: { codec: 'libx264', preset: 'fast', crf: 26 } };
  return { id: 'minimal', name: 'Minimal Render', description: 'Basic stitch only', qualityImpact: 0.4, speedImprovement: 3, changes: { skipPasses: ['depth','overlay','motion','color'], codec: 'libx264', crf: 28 } };
}
export function isRecoverable(error: string): boolean { return !['INSUFFICIENT_CREDITS','INVALID_INPUT','ACCOUNT_SUSPENDED','KILL_SWITCH'].some(c => error.includes(c)); }
