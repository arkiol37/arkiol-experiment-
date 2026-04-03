import React from 'react';
interface Track { id: string; type: string; startMs: number; endMs: number; layerIndex: number; }
const TC: Record<string, string> = { scene: 'bg-indigo-500/40', transition: 'bg-yellow-500/40', audio: 'bg-green-500/40', overlay: 'bg-pink-500/40', subtitle: 'bg-cyan-500/40' };
export default function TimelinePreview({ tracks, totalDurationMs }: { tracks: Track[]; totalDurationMs: number }) {
  const layers = [...new Set(tracks.map(t => t.layerIndex))].sort();
  if (totalDurationMs === 0) return null;
  return (<div className="space-y-2"><h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Timeline</h3><div className="bg-white/5 rounded-lg p-3 border border-white/10 space-y-1">{layers.map(l => (<div key={l} className="relative h-6 bg-white/5 rounded">{tracks.filter(t => t.layerIndex === l).map(t => { const left = (t.startMs / totalDurationMs) * 100; const width = ((t.endMs - t.startMs) / totalDurationMs) * 100; return (<div key={t.id} className={`absolute h-full rounded ${TC[t.type] || 'bg-white/20'}`} style={{ left: `${left}%`, width: `${Math.max(1, width)}%` }} title={`${t.type}: ${t.startMs}ms-${t.endMs}ms`} />); })}</div>))}<div className="flex justify-between text-[10px] text-white/30 mt-1"><span>0:00</span><span>{(totalDurationMs / 1000).toFixed(1)}s</span></div></div></div>);
}
