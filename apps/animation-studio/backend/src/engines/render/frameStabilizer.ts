export interface StabilizationResult { applied: boolean; corrections: string[]; ffmpegFilters: string[]; }
export function analyzeInstability(m: { brightnessValues: number[]; motionVectors: number[] }): { flickerDetected: boolean; jitterDetected: boolean; dropDetected: boolean } {
  const { brightnessValues: bv, motionVectors: mv } = m;
  let fc = 0; for (let i = 1; i < bv.length; i++) if (Math.abs(bv[i]-bv[i-1]) > 30) fc++;
  const avg = mv.reduce((s,v) => s+v, 0) / mv.length;
  let drop = false; for (let i = 1; i < mv.length - 1; i++) if (mv[i] < 0.1 && mv[i+1] > avg * 2) { drop = true; break; }
  return { flickerDetected: fc > bv.length * 0.05, jitterDetected: mv.some(v => v > avg * 3), dropDetected: drop };
}
export function buildStabilizationFilters(a: { flickerDetected: boolean; jitterDetected: boolean; dropDetected: boolean }): StabilizationResult {
  const c: string[] = []; const f: string[] = [];
  if (a.flickerDetected) { c.push('Temporal brightness smoothing'); f.push('deflicker=mode=am:size=5'); }
  if (a.jitterDetected) { c.push('Video stabilization'); f.push('vidstabdetect=shakiness=5:accuracy=9'); }
  if (a.dropDetected) { c.push('Frame interpolation'); f.push('minterpolate=fps=30:mi_mode=mci'); }
  return { applied: c.length > 0, corrections: c, ffmpegFilters: f };
}
