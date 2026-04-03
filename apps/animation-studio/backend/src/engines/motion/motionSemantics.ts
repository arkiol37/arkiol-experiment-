import type { StoryboardScene, DirectorIntent, MotionPlan, MotionKeyframe, EasingFunction } from "../types";

const RM: Record<string, { p: string; to: number; dur: number; delay: number; ease: EasingFunction }[]> = {
  hook: [{ p: "scale", to: 1, dur: 400, delay: 0, ease: "spring" }, { p: "opacity", to: 1, dur: 300, delay: 0, ease: "ease-out" }],
  problem: [{ p: "translateX", to: 0, dur: 500, delay: 200, ease: "ease-out" }, { p: "opacity", to: 1, dur: 400, delay: 200, ease: "ease-out" }],
  solution: [{ p: "scale", to: 1, dur: 500, delay: 0, ease: "spring" }, { p: "scale", to: 1.08, dur: 800, delay: 600, ease: "ease-in-out" }],
  proof: [{ p: "translateY", to: 0, dur: 400, delay: 100, ease: "ease-out" }],
  cta: [{ p: "scale", to: 1, dur: 300, delay: 0, ease: "spring" }, { p: "scale", to: 1.06, dur: 800, delay: 500, ease: "ease-in-out" }],
  brand_reveal: [{ p: "scale", to: 1, dur: 800, delay: 200, ease: "spring" }, { p: "opacity", to: 1, dur: 600, delay: 200, ease: "ease-out" }],
  offer: [{ p: "translateY", to: 0, dur: 400, delay: 0, ease: "spring" }, { p: "scale", to: 1.1, dur: 500, delay: 400, ease: "bounce" }],
};
const SPD: Record<string, number> = { Energetic: 0.75, Bold: 0.8, Playful: 0.85, Cinematic: 1.1, Luxury: 1.2, Calm: 1.3 };

export function planMotionSemantics(scenes: StoryboardScene[], intent: DirectorIntent): MotionPlan[] {
  return scenes.map(scene => {
    const motions = RM[scene.role] || RM.proof || [];
    const sm = SPD[intent.mood] || 1;
    const kf: MotionKeyframe[] = motions.map(m => ({ timeMs: Math.round(m.delay * sm), property: m.p, value: m.to, easing: m.ease }));
    kf.push({ timeMs: scene.durationSec * 1000 - 400, property: "opacity", value: 0, easing: "ease-in" });
    return { elementId: scene.id, keyframes: kf, semanticIntent: motions[0]?.p || "entrance", priority: scene.role === "hook" || scene.role === "cta" ? 10 : 5 };
  });
}
