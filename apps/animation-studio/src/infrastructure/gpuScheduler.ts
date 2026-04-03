export interface GpuSlot { id: string; allocated: boolean; renderJobId?: string; allocatedAt?: Date; }
const SLOTS: GpuSlot[] = Array.from({ length: 4 }, (_, i) => ({ id: `gpu_${i}`, allocated: false }));
export function allocateGpu(jobId: string): GpuSlot | null { const s = SLOTS.find(s => !s.allocated); if (!s) return null; s.allocated = true; s.renderJobId = jobId; s.allocatedAt = new Date(); return s; }
export function releaseGpu(jobId: string): void { const s = SLOTS.find(s => s.renderJobId === jobId); if (s) { s.allocated = false; s.renderJobId = undefined; } }
export function getGpuUtilization(): { total: number; allocated: number } { return { total: SLOTS.length, allocated: SLOTS.filter(s => s.allocated).length }; }
