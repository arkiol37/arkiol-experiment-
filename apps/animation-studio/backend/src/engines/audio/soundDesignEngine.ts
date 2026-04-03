import type { StoryboardScene, DirectorIntent, SoundEffect } from "../types";
import { v4 as uuidv4 } from "uuid";

const RS: Record<string, { cat: string; vol: number; dur: number }[]> = {
  hook: [{ cat: "impact", vol: 0.6, dur: 400 }], problem: [{ cat: "tension", vol: 0.3, dur: 2000 }],
  solution: [{ cat: "resolve", vol: 0.35, dur: 1000 }], proof: [{ cat: "whoosh", vol: 0.3, dur: 400 }],
  cta: [{ cat: "ding", vol: 0.4, dur: 500 }], brand_reveal: [{ cat: "shimmer", vol: 0.25, dur: 800 }],
  offer: [{ cat: "bass_drop", vol: 0.55, dur: 700 }],
};
const VM: Record<string, number> = { Calm: 0.5, Minimal: 0.6, Luxury: 0.7, Emotional: 0.75, Corporate: 0.8, Cinematic: 0.85, Tech: 0.9, Playful: 1, Energetic: 1.1, Bold: 1.15 };

export function designSounds(scenes: StoryboardScene[], intent: DirectorIntent): SoundEffect[] {
  const effects: SoundEffect[] = []; let cm = 0; const vm = VM[intent.mood] || 1;
  for (const s of scenes) {
    const dm = s.durationSec * 1000; const sfx = RS[s.role] || [];
    if (sfx[0]) effects.push({ id: uuidv4(), category: sfx[0].cat, triggerMs: cm + 100, durationMs: sfx[0].dur, volume: sfx[0].vol * vm });
    if (s.transitionOut !== "cut" && s.position < scenes.length - 1) effects.push({ id: uuidv4(), category: "transition", triggerMs: cm + dm - 300, durationMs: 400, volume: 0.25 * vm });
    cm += dm;
  }
  return effects;
}
