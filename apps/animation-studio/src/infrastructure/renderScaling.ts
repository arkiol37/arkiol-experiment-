export interface ScalingDecision { currentWorkers: number; targetWorkers: number; reason: string; queueDepth: number; }
export function computeScaling(m: { queueDepth: number; activeWorkers: number; maxWorkers: number; minWorkers: number }): ScalingDecision {
  let target = m.activeWorkers; let reason = 'stable';
  if (m.queueDepth > m.activeWorkers * 2) { target = Math.min(m.maxWorkers, Math.ceil(m.queueDepth / 2)); reason = `Queue depth ${m.queueDepth} high`; }
  else if (m.queueDepth === 0 && m.activeWorkers > m.minWorkers) { target = m.minWorkers; reason = 'Queue empty'; }
  return { currentWorkers: m.activeWorkers, targetWorkers: target, reason, queueDepth: m.queueDepth };
}
