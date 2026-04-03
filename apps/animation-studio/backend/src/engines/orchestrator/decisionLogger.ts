import type { DecisionLogEntry } from '../types';
const logs = new Map<string, DecisionLogEntry[]>();
export function logDecision(jobId: string, entry: DecisionLogEntry): void { const e = logs.get(jobId) || []; e.push(entry); logs.set(jobId, e); }
export function getDecisions(jobId: string): DecisionLogEntry[] { return logs.get(jobId) || []; }
export function clearDecisions(jobId: string): void { logs.delete(jobId); }
export function createDecision(engine: string, decision: string, confidence: number, alternatives: string[], reasoning: string): DecisionLogEntry {
  return { timestamp: new Date(), engine, decision, confidence, alternatives, reasoning };
}
