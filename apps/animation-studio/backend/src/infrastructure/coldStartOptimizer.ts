import { logger } from '../config/logger';
let warmed = false; let warmTs: Date | null = null;
export async function warmup(): Promise<{ durationMs: number; components: string[] }> {
  const start = Date.now(); const components: string[] = [];
  try { await import('../engines/orchestrator/intelligenceOrchestrator'); components.push('orchestrator'); } catch {}
  try { await import('../engines/director/animationDirector'); components.push('director'); } catch {}
  warmed = true; warmTs = new Date();
  const d = Date.now() - start; logger.info(`[ColdStart] Warmup in ${d}ms`, { components }); return { durationMs: d, components };
}
export function isWarmed(): boolean { return warmed; }
export function getWarmupAge(): number { return warmTs ? Date.now() - warmTs.getTime() : Infinity; }
