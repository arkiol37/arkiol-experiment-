import React from 'react';
interface ShotPlan { sceneId: string; shotType: string; cameraMove: string; lightingMood: string; motionIntensity: number; }
export default function ShotPlanPreview({ shots }: { shots: ShotPlan[] }) {
  return (<div className="space-y-2"><h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Shot Plan</h3><div className="grid grid-cols-2 gap-2">{shots.map((s, i) => (<div key={s.sceneId} className="bg-white/5 rounded-lg p-2.5 border border-white/10"><span className="text-xs font-medium text-white/80">{s.shotType.replace('_',' ')}</span><p className="text-[10px] text-white/50">Camera: {s.cameraMove.replace('_',' ')}</p><p className="text-[10px] text-white/40">{s.lightingMood}</p></div>))}</div></div>);
}
