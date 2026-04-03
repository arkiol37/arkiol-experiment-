import type { DirectorIntent, StoryboardScene, MusicProfile, MusicSegment } from "../types";

const MM: Record<string, { bpm: [number, number]; key: string; energy: number }> = {
  Luxury: { bpm: [70,95], key: "Dm", energy: 0.4 }, Energetic: { bpm: [120,150], key: "Am", energy: 0.8 },
  Minimal: { bpm: [80,110], key: "C", energy: 0.3 }, Playful: { bpm: [110,135], key: "G", energy: 0.7 },
  Cinematic: { bpm: [85,110], key: "Em", energy: 0.6 }, Emotional: { bpm: [65,90], key: "F", energy: 0.5 },
  Corporate: { bpm: [100,120], key: "C", energy: 0.5 }, Bold: { bpm: [110,140], key: "Gm", energy: 0.75 },
  Calm: { bpm: [60,85], key: "D", energy: 0.25 }, Tech: { bpm: [115,135], key: "Bbm", energy: 0.65 },
};
const SEG: Record<string, MusicSegment["type"]> = { hook: "drop", problem: "verse", solution: "chorus", proof: "verse", brand_reveal: "bridge", offer: "buildup", cta: "drop" };

export function analyzeMusicIntelligence(intent: DirectorIntent, scenes: StoryboardScene[]): MusicProfile {
  const ch = MM[intent.mood] || MM.Energetic;
  const bpm = Math.round((ch.bpm[0] + ch.bpm[1]) / 2);
  const segments: MusicSegment[] = []; let cm = 0;
  for (let i = 0; i < scenes.length; i++) {
    const dm = scenes[i].durationSec * 1000;
    const type = i === 0 ? "intro" as const : i === scenes.length - 1 ? "outro" as const : (SEG[scenes[i].role] || "verse") as MusicSegment["type"];
    segments.push({ startMs: cm, endMs: cm + dm, type, energy: Math.min(1, ch.energy * (0.5 + scenes[i].emotionTarget * 0.5)) });
    cm += dm;
  }
  return { bpm, key: ch.key, energy: ch.energy, mood: intent.mood, segments };
}
