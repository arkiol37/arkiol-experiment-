import type { StoryboardScene, MotionPlan, MotionKeyframe } from "../types";

export interface FrameMotionData { sceneId: string; fps: number; totalFrames: number; tracks: { property: string; frames: number[] }[]; }

const EA: Record<string, (t: number) => number> = {
  linear: (t) => t, "ease-in": (t) => t * t, "ease-out": (t) => t * (2 - t),
  "ease-in-out": (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  spring: (t) => 1 - Math.pow(Math.cos(t * Math.PI * 0.5), 3) * Math.exp(-t * 3),
  bounce: (t) => { if (t < 1/2.75) return 7.5625*t*t; if (t < 2/2.75) return 7.5625*(t-=1.5/2.75)*t+0.75; return 7.5625*(t-=2.625/2.75)*t+0.984375; },
  elastic: (t) => t === 0 || t === 1 ? t : -Math.pow(2, 10*(t-1)) * Math.sin((t-1.1)*5*Math.PI),
};

export function buildFrameMotionPlan(scenes: StoryboardScene[], plans: MotionPlan[] | undefined): FrameMotionData[] {
  if (!plans) return [];
  const fps = 30;
  return scenes.map(scene => {
    const plan = plans.find(p => p.elementId === scene.id); if (!plan) return null;
    const tf = Math.ceil(scene.durationSec * fps);
    const groups = new Map<string, MotionKeyframe[]>();
    for (const kf of plan.keyframes) { const e = groups.get(kf.property) || []; e.push(kf); groups.set(kf.property, e); }
    const tracks: { property: string; frames: number[] }[] = [];
    for (const [prop, kfs] of groups) {
      const sorted = [...kfs].sort((a, b) => a.timeMs - b.timeMs);
      const frames: number[] = [];
      const defVal = prop === "opacity" || prop === "scale" ? 1 : 0;
      for (let f = 0; f < tf; f++) {
        const tMs = (f / fps) * 1000; let val = defVal;
        if (tMs >= sorted[sorted.length-1].timeMs) val = sorted[sorted.length-1].value;
        else for (let j = 0; j < sorted.length - 1; j++) {
          if (tMs >= sorted[j].timeMs && tMs <= sorted[j+1].timeMs) {
            const p = (tMs - sorted[j].timeMs) / Math.max(1, sorted[j+1].timeMs - sorted[j].timeMs);
            const ef = EA[sorted[j+1].easing] || EA.linear;
            val = sorted[j].value + (sorted[j+1].value - sorted[j].value) * ef(p); break;
          }
        }
        frames.push(val);
      }
      tracks.push({ property: prop, frames });
    }
    return { sceneId: scene.id, fps, totalFrames: tf, tracks };
  }).filter(Boolean) as FrameMotionData[];
}
