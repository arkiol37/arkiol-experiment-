export interface RepairAction { type: 'reencode' | 'trim' | 'scale' | 'codec_fallback' | 'retry'; description: string; params: Record<string, unknown>; }
export function planRepairActions(issues: { code: string; severity: string }[]): RepairAction[] {
  return issues.map(i => {
    switch (i.code) { case 'LOW_RESOLUTION': return { type: 'scale' as const, description: 'Upscale to target', params: { method: 'lanczos' } }; case 'DURATION_MISMATCH': return { type: 'trim' as const, description: 'Trim to expected', params: {} }; case 'CODEC_ERROR': return { type: 'codec_fallback' as const, description: 'Fallback codec', params: { codec: 'libx264', crf: 23 } }; case 'CORRUPTED': return { type: 'retry' as const, description: 'Full re-render', params: {} }; default: return i.severity === 'error' ? { type: 'reencode' as const, description: `Re-encode for ${i.code}`, params: {} } : null; }
  }).filter(Boolean) as RepairAction[];
}
